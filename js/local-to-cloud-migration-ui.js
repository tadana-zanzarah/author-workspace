import {STORAGE_KEY} from "./constants.js";
import {parseProjectJson,prepareProject} from "./migrations.js";
import {buildLocalToCloudMigrationPreview} from "./local-to-cloud-migration.js";
import {confirmLocalToCloudMigrationPlan,executeLocalToCloudMigration} from "./local-to-cloud-migration-execution.js";

const ERROR_MESSAGES={
  REVISION_CONFLICT:"Облачный проект изменился после проверки. Обновите данные и повторите перенос.",
  TARGET_NOT_EMPTY:"В выбранном облачном проекте уже появились данные. Выберите пустой проект.",
  INVALID_MIGRATION_PLAN:"Данные проекта изменились или содержат ошибку. Выполните проверку ещё раз.",
  UNRESOLVED_MAPPING:"Не для всех персонажей или связей выбрано соответствие.",
  STORAGE_UPLOAD_FAILED:"Не удалось загрузить одно из изображений. Облачный проект не был перенесён.",
  STORAGE_COLLISION:"Облачное хранилище уже содержит другой файл для одного из изображений. Перенос остановлен безопасно.",
  UNKNOWN_IMPORT_RESULT:"Проверяем результат переноса… Не запускайте перенос повторно.",
  VERIFICATION_FAILED:"Данные записаны, но автоматическая проверка результата не завершилась. Не повторяйте перенос; вернитесь к проектам и проверьте облачный проект.",
  CLEANUP_INCOMPLETE:"Перенос остановлен, но очистка загруженных файлов завершилась не полностью. Повторный перенос пока недоступен.",
  FORBIDDEN:"Недостаточно прав для переноса в выбранный облачный проект.",
  DB_IMPORT_FAILED:"Не удалось перенести проект. Локальная копия не изменена."
};
const BLOCK_MESSAGES={UNRESOLVED_CHARACTER_MAPPING:"Выберите действие для персонажа.",STRUCTURAL_LINK_SCOPE_REQUIRED:"Укажите, где действует связь персонажей.",IMAGE_SCOPE_REQUIRED:"Укажите, где используется фотография.",TARGET_PROJECT_NOT_EMPTY:"Облачный проект не пуст: слияние и замена пока не поддерживаются.",DANGLING_CHARACTER_REFERENCE:"Повреждена ссылка на персонажа.",INVALID_SCENE_DATE:"В сцене указана некорректная дата.",INVALID_SCENE_TIME:"В сцене указано некорректное время.",IMAGE_TOO_LARGE:"Изображение превышает допустимый размер 3 МБ.",UNSUPPORTED_IMAGE_TYPE:"Формат изображения не поддерживается.",INVALID_IMAGE_DATA_URL:"Изображение повреждено."};

function migrationErrorMessage(code){return ERROR_MESSAGES[code]||ERROR_MESSAGES.DB_IMPORT_FAILED}
function projectCounts(project={}){return {characters:(project.characters||[]).length,scenes:(project.scenes||[]).length,chapters:(project.chapters||[]).filter(x=>x?.id!=="chapter-unassigned").length,locations:(project.locations||[]).length,tags:(project.tags||[]).length}}
function discoverLocalMigrationSources(storage=globalThis.localStorage){
  try{
    const raw=storage.getItem(STORAGE_KEY);if(!raw)return [];
    const parsed=parseProjectJson(raw);if(!parsed.ok)return [];
    const report=prepareProject(parsed.value);if(!report.canApply)return [];
    const project=report.migratedData;
    return [{id:STORAGE_KEY,title:String(project.title||project.projectTitle||"Локальный проект"),legacy:true,project,counts:projectCounts(project)}];
  }catch{return []}
}
const hasContent=data=>(data?.chapters||[]).length>0||(data?.scenes||[]).length>0||(data?.locations||[]).length>0||(data?.tags||[]).length>0||(data?.project_characters||[]).length>0;
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};
const countLabels={characters:"персонажей",scenes:"сцен",chapters:"глав",locations:"локаций",tags:"тегов",structuralLinks:"структурных связей",emotionalRelations:"изменений отношений",images:"изображений"};

function createLocalToCloudMigrationUi({cloudState,openCloudProject,loadDashboard}){
  const modal=document.getElementById("localCloudMigrationModal"),body=document.getElementById("migrationWizardBody"),title=document.getElementById("migrationWizardTitle");
  if(!modal||!body)return null;
  const state={sources:[],targets:[],source:null,target:null,targetSnapshot:null,characters:[],decisions:{characters:{},links:{},images:{}},preview:null,confirmedPlan:null,executing:false,finished:false,tracker:null};
  const serialize=()=>JSON.stringify({source:state.source?.id,target:state.target?.id,decisions:state.decisions,executing:state.executing});
  state.tracker=globalThis.createDirtyTracker?.("localCloudMigrationModal",serialize);
  function close(){if(state.executing)return;globalThis.requestCloseModal("localCloudMigrationModal","button")}
  function actions(...buttons){const row=el("div","modal-actions");row.append(...buttons);return row}
  function button(text,primary,fn){const node=el("button",primary?"primary":"",text);node.type="button";node.onclick=fn;return node}
  function reset(){Object.assign(state,{sources:discoverLocalMigrationSources(),targets:[],source:null,target:null,targetSnapshot:null,characters:[],decisions:{characters:{},links:{},images:{}},preview:null,confirmedPlan:null,executing:false,finished:false})}
  async function open(opener){reset();title.textContent="Перенести локальный проект в облако";renderLoading("Проверяем доступные проекты…");globalThis.openModal("localCloudMigrationModal",{opener,initialFocus:"#migrationWizardBody button, #migrationWizardBody select"});
    try{
      state.targets=await Promise.all(cloudState.projects.map(async project=>{const snapshot=await cloudState.contentApi.loadProjectContent(project.id);return {...project,snapshot,empty:snapshot.ok&& !hasContent(snapshot.data)}}));
      const chars=await cloudState.characterApi.listCharacters();state.characters=chars.ok?(chars.data||[]):[];renderSelect();state.tracker?.captureInitialState();
    }catch{renderFailure("Не удалось проверить локальные и облачные проекты.")}
  }
  function renderLoading(message){body.replaceChildren(el("p","migration-status",message))}
  function renderFailure(message){const alert=el("div","migration-blockers",message);alert.setAttribute("role","alert");body.replaceChildren(alert,actions(button("Закрыть",false,close)))}
  function renderSelect(){
    const intro=el("p","account-note","Выберите локальный источник и пустой облачный проект. Ничего не будет записано до отдельного подтверждения.");
    const sourceLabel=el("label","migration-field"),sourceCaption=el("span","field-caption","Локальный проект"),source=el("select");source.id="migrationSource";source.append(new Option("Выберите проект",""));
    state.sources.forEach(item=>source.append(new Option(`${item.title} · ${item.counts.characters} перс. · ${item.counts.scenes} сцен`,item.id)));source.onchange=()=>state.source=state.sources.find(x=>x.id===source.value)||null;sourceLabel.append(sourceCaption,source);
    const targetLabel=el("label","migration-field"),targetCaption=el("span","field-caption","Облачный проект"),target=el("select");target.id="migrationTarget";target.append(new Option("Выберите проект",""));
    state.targets.forEach(item=>{const option=new Option(item.empty?item.title:`${item.title} — уже содержит данные`,item.id);option.disabled=!item.empty;target.append(option)});target.onchange=()=>{state.target=state.targets.find(x=>x.id===target.value)||null;state.targetSnapshot=state.target?.snapshot||null};targetLabel.append(targetCaption,target);
    const note=!state.sources.length?el("div","migration-blockers","На этом устройстве не найден доступный локальный проект."):el("p","account-note","Локальный источник останется на этом устройстве после переноса.");
    const next=button("Проверить проект",true,()=>{if(!state.source||!state.target){renderInline("Выберите источник и назначение.");return}rebuildPreview()});next.id="migrationPreviewButton";
    body.replaceChildren(intro,sourceLabel,targetLabel,note,actions(button("Отмена",false,close),next));source.focus();
  }
  function renderInline(message){let node=body.querySelector(".migration-inline-error");if(!node){node=el("p","migration-inline-error");node.setAttribute("role","alert");body.insertBefore(node,body.querySelector(".modal-actions"))}node.textContent=message}
  function buildPreview(){return buildLocalToCloudMigrationPreview({localProject:state.source.project,sourceProjectId:state.source.id,targetProjectId:state.target.id,targetProjectRevision:Number(state.targetSnapshot.revision),targetCloudState:{data:state.targetSnapshot.data},existingGlobalCharacters:state.characters,characterDecisions:state.decisions.characters,structuralLinkDecisions:state.decisions.links,imageScopeDecisions:state.decisions.images})}
  function rebuildPreview(){try{state.preview=buildPreview();renderPreview()}catch{renderFailure("Не удалось подготовить проверку проекта. Локальные данные не изменены.")}}
  function summary(preview){const grid=el("div","migration-counts");for(const [key,label] of Object.entries(countLabels)){const card=el("div","migration-count");card.append(el("strong","",String(preview.counts[key]||0)),document.createTextNode(label));grid.append(card)}return grid}
  function decisionRadio(name,value,label,checked,onchange){const wrap=el("label","migration-choice"),input=document.createElement("input");input.type="radio";input.name=name;input.value=value;input.checked=checked;input.onchange=onchange;wrap.append(input,document.createTextNode(label));return wrap}
  function renderPreview(){
    const p=state.preview;title.textContent="Проверка переноса";const frag=document.createDocumentFragment();frag.append(el("p","account-note",`${state.source.title} → ${state.target.title}`),summary(p));
    const pending=p.characterMappings.filter(x=>x.status==="pending"||state.decisions.characters[x.localCharacterId]);if(pending.length){const section=el("section","migration-decisions"),h=el("h3","","Персонажи");section.append(h);for(const item of pending){const card=el("fieldset","migration-decision"),legend=el("legend","",item.localName||"Без имени"),name=`character-${item.localCharacterId}`;card.append(legend,decisionRadio(name,"new","Создать нового персонажа",state.decisions.characters[item.localCharacterId]?.action==="CREATE_NEW_GLOBAL_IDENTITY",()=>{state.decisions.characters[item.localCharacterId]={action:"CREATE_NEW_GLOBAL_IDENTITY"};rebuildPreview()}),decisionRadio(name,"existing","Использовать существующего персонажа",state.decisions.characters[item.localCharacterId]?.action==="MAP_TO_EXISTING_CHARACTER",()=>{}));const select=el("select");select.setAttribute("aria-label",`Существующий персонаж для ${item.localName}`);select.append(new Option("Выберите персонажа",""));[...state.characters].sort((a,b)=>Number((item.candidates||[]).some(x=>x.id===b.id))-Number((item.candidates||[]).some(x=>x.id===a.id))).forEach(c=>select.append(new Option(`${c.name||"Без имени"} ${c.surname||""}`.trim(),c.id)));select.value=state.decisions.characters[item.localCharacterId]?.existingCharacterId||"";select.onchange=()=>{if(select.value){state.decisions.characters[item.localCharacterId]={action:"MAP_TO_EXISTING_CHARACTER",existingCharacterId:select.value};rebuildPreview()}};card.append(select,el("p","account-note","При выборе существующего персонажа его общая анкета не изменится; отличия сохранятся только для этого проекта."));section.append(card)}frag.append(section)}
    for(const link of p.entityPlan.structuralLinks.filter(x=>!x.scope)){const card=el("fieldset","migration-decision"),legend=el("legend","","Связь персонажей");card.append(legend,decisionRadio(`link-${link.localId}`,"global","Общая связь персонажей",state.decisions.links[link.localId]==="global",()=>{state.decisions.links[link.localId]="global";rebuildPreview()}),decisionRadio(`link-${link.localId}`,"project","Только в этом проекте",state.decisions.links[link.localId]==="project",()=>{state.decisions.links[link.localId]="project";rebuildPreview()}));frag.append(card)}
    for(const image of p.imageUploads.filter(x=>!x.scope)){const card=el("fieldset","migration-decision"),legend=el("legend","",`Фото · ${image.estimatedBytes==null?"размер неизвестен":`${Math.ceil(image.estimatedBytes/1024)} КБ`}`);card.append(legend);const src=image.source?.source?.value;if(/^data:image\/(png|jpeg|webp|gif);base64,/.test(src||"")){const img=el("img","migration-image-preview");img.src=src;img.alt=image.alt||"Предпросмотр фотографии";card.append(img)}card.append(decisionRadio(`image-${image.localPhotoId}`,"global","Общее фото персонажа",state.decisions.images[image.localPhotoId]==="global",()=>{state.decisions.images[image.localPhotoId]="global";rebuildPreview()}),decisionRadio(`image-${image.localPhotoId}`,"project","Фото только для этого проекта",state.decisions.images[image.localPhotoId]==="project",()=>{state.decisions.images[image.localPhotoId]="project";rebuildPreview()}));frag.append(card)}
    const remaining=p.blockingConflicts;const warnings=p.warnings||[];if(remaining.length){const section=el("section","migration-blockers"),h=el("h3","","Нужно исправить");section.append(h,...remaining.slice(0,12).map(x=>el("p","",BLOCK_MESSAGES[x.code]||"Данные требуют дополнительного решения.")));frag.append(section)}if(warnings.length){const section=el("section","migration-warnings"),h=el("h3","","Обратите внимание");section.append(h,...warnings.slice(0,12).map(x=>el("p","",x.code==="LEGACY_IMAGE_UPLOAD_REQUIRED"?"Локальное изображение будет загружено только после подтверждения.":"Некоторые устаревшие данные будут безопасно преобразованы.")));frag.append(section)}
    const next=button("Перейти к подтверждению",true,renderConfirmation);next.disabled=!p.ready;next.id="migrationConfirmStep";frag.append(actions(button("Назад",false,renderSelect),button("Отмена",false,close),next));body.replaceChildren(frag);state.tracker?.sync?.();
  }
  function renderConfirmation(){state.preview=buildPreview();if(!state.preview.ready)return renderPreview();title.textContent="Подтвердите перенос";const attempt=crypto.randomUUID();state.confirmedPlan=confirmLocalToCloudMigrationPlan(state.preview,{migrationAttemptId:attempt});const text=el("div","migration-confirmation");text.append(el("p","",`Источник: ${state.source.title}`),el("p","",`Назначение: ${state.target.title}`),summary(state.preview),el("p","migration-preservation","Локальная копия проекта останется на этом устройстве."),el("p","account-note","Существующие данные облачного проекта не заменяются; перенос возможен только в пустой проект."));const run=button("Перенести в облако",true,execute);run.id="executeMigration";body.replaceChildren(text,actions(button("Назад",false,renderPreview),button("Отмена",false,close),run));state.tracker?.sync?.()}
  async function execute(){if(state.executing)return;state.executing=true;modal.dataset.closeBlocked="true";globalThis.syncBeforeUnload?.();title.textContent="Перенос проекта";renderLoading(state.preview.counts.images?`Перенос проекта… Подготовка ${state.preview.counts.images} изображений.`:"Перенос проекта…");const result=await executeLocalToCloudMigration({confirmedPlan:state.confirmedPlan,client:cloudState.client,ownerId:cloudState.session.user.id,localSource:state.source.project});modal.dataset.closeBlocked="false";if(result.ok){state.finished=true;state.executing=false;state.tracker?.resetDirty?.();renderSuccess(result)}else{state.executing=false;renderExecutionFailure(result)}}
  function renderExecutionFailure(result){title.textContent=result.code==="UNKNOWN_IMPORT_RESULT"?"Проверяем результат":"Перенос остановлен";const message=migrationErrorMessage(result.code),alert=el("div",result.code==="UNKNOWN_IMPORT_RESULT"?"migration-warnings":"migration-blockers",message);alert.setAttribute("role","alert");const back=button("Вернуться к проектам",false,()=>{state.tracker?.resetDirty?.();globalThis.forceCloseModal("localCloudMigrationModal")});body.replaceChildren(alert,actions(back));if(!["UNKNOWN_IMPORT_RESULT","VERIFICATION_FAILED","CLEANUP_INCOMPLETE"].includes(result.code))body.querySelector(".modal-actions").prepend(button("Проверить ещё раз",false,rebuildPreview))}
  function renderSuccess(result){title.textContent="Проект перенесён в облако";const note=el("p","migration-preservation","Локальная копия проекта осталась на этом устройстве."),open=button("Открыть облачный проект",true,async()=>{globalThis.forceCloseModal("localCloudMigrationModal");await openCloudProject(state.target)}),back=button("Вернуться к моим проектам",false,async()=>{globalThis.forceCloseModal("localCloudMigrationModal");await loadDashboard()});body.replaceChildren(summary(state.preview),note,actions(back,open))}
  modal.addEventListener("click",event=>{if(event.target===modal&&!state.executing)globalThis.requestCloseModal("localCloudMigrationModal","backdrop")});
  return {open,state};
}

export {createLocalToCloudMigrationUi,discoverLocalMigrationSources,migrationErrorMessage};
