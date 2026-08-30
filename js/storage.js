import {STORAGE_KEY,UI_STORAGE_KEY,OLD_KEYS} from "./constants.js";
import {activeWorkspaceContext} from "./workspace-storage.js";
import {parseProjectJson,prepareProject,defaultData,safeOwnCopy} from "./migrations.js";

function storageProjectScore(project){
  const scenes=Array.isArray(project?.scenes)?project.scenes.length:0;
  const characters=Array.isArray(project?.characters)?project.characters.length:0;
  const textSize=(project?.scenes||[]).reduce((n,s)=>n+String(s?.sceneText||s?.text||"").length,0);
  return scenes*100000+textSize+characters*5000;
}
function projectTimestamp(project){
  for(const value of [project?.updatedAt,project?.modifiedAt,project?.lastModified]){
    const time=Date.parse(value);if(Number.isFinite(time))return time;
  }
  return 0;
}
function parseStorageCandidate(key,storage=globalThis.localStorage){
  let raw;
  try{raw=storage.getItem(key)}catch(error){return {key,exists:false,valid:false,error,storageError:true}}
  if(raw===null)return {key,exists:false};
  const parsed=parseProjectJson(raw);
  if(!parsed.ok)return {key,exists:true,valid:false,raw,error:parsed.error};
  const report=prepareProject(parsed.value);
  const count=name=>Array.isArray(parsed.value?.[name])?parsed.value[name].length:0;
  const onlyResolvable=report.errors.length===0&&report.conflicts.every(x=>x.type==="ambiguous-character-name"||x.resolution==="confirmation");
  return {key,exists:true,valid:report.canApply,raw,parsed:parsed.value,normalized:report.migratedData,report,version:report.sourceVersion,score:storageProjectScore(parsed.value),timestamp:projectTimestamp(parsed.value),summary:{scenes:count("scenes"),characters:count("characters"),chapters:count("chapters"),locations:count("locations"),tags:count("tags"),criticalErrors:report.errors.length+report.conflicts.filter(x=>x.critical).length,warnings:report.warnings.length,canOpen:report.canApply&&report.sourceVersion===11,canMigrate:report.canApply||onlyResolvable}};
}
function blockedMemoryProject(){
  return {version:11,characters:[],profiles:{},characterLinks:[],chapters:[{id:"chapter-unassigned",title:"Данные заблокированы",collapsed:false}],locations:[],tags:[],future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},scenes:[],readOnlyRecovery:true};
}
function loadProjectFromStorage({storage=globalThis.localStorage,key=STORAGE_KEY,oldKeys=OLD_KEYS,discover=true}={}){
  const primary=parseStorageCandidate(key,storage);
  const discovered=[];
  if(discover)try{for(let i=0;i<storage.length;i++){const candidateKey=storage.key(i);if(candidateKey&&candidateKey!==key&&/novel|author.?workspace|timeline/i.test(candidateKey))discovered.push(candidateKey)}}catch{}
  const candidateKeys=[...new Set([...oldKeys,...discovered])];
  const candidates=candidateKeys.map(k=>parseStorageCandidate(k,storage)).filter(x=>x.exists)
    .sort((a,b)=>(b.version-a.version)||(b.timestamp-a.timestamp)||(b.score-a.score));
  if(primary.exists){
    if(primary.valid)return {ok:true,data:primary.normalized,source:key,report:primary.report,candidates};
    return {ok:false,blocked:true,data:blockedMemoryProject(),source:key,primary,candidates,raw:primary.raw};
  }
  if(candidates.length)return {ok:false,blocked:true,data:blockedMemoryProject(),source:null,primary,candidates,recoveryRequired:true};
  const anyStorageError=[primary,...candidateKeys.map(k=>parseStorageCandidate(k,storage))].find(x=>x.storageError);
  if(anyStorageError)return {ok:false,blocked:true,data:blockedMemoryProject(),primary:anyStorageError,candidates:[]};
  return {ok:true,data:defaultData(),source:null,fresh:true,candidates:[]};
}
function loadDataSafe(options={}){
  const context=activeWorkspaceContext();
  const result=loadProjectFromStorage({key:context.storageKey,oldKeys:context.legacy?OLD_KEYS:[],discover:context.legacy,...options});
  startupLoadInfo=result;
  if(!result.ok)storageWriteEnabled=false;
  return result.data;
}

function recoveryBackupKey(primaryKey=activeWorkspaceContext().storageKey,now=new Date()){
  return `${primaryKey}-recovery-backup-${now.toISOString().replace(/[:.]/g,"-")}`;
}

function restoreProjectCandidate({storage=globalThis.localStorage,primaryKey=activeWorkspaceContext().storageKey,candidateKey,candidateRaw:rawOverride,candidateReport,characterResolutions={}}={}){
  let original,candidateRaw;
  try{original=storage.getItem(primaryKey);candidateRaw=rawOverride??storage.getItem(candidateKey)}catch(error){return {ok:false,error,userMessage:storageErrorMessage(error)}}
  if(candidateRaw==null)return {ok:false,userMessage:"Выбранная резервная версия больше не найдена. Исходные данные не изменены."};
  const parsed=parseProjectJson(candidateRaw);if(!parsed.ok)return {ok:false,userMessage:"Выбранная резервная версия повреждена. Исходные данные не изменены."};
  const report=candidateReport?.canApply?candidateReport:prepareProject(parsed.value,{characterResolutions});
  if(!report.canApply)return {ok:false,report,userMessage:"В выбранной версии остались нерешённые конфликты. Восстановление не выполнено."};
  const backupKey=recoveryBackupKey(primaryKey);
  try{
    if(original!==null)storage.setItem(backupKey,original);
    const serialized=JSON.stringify(report.migratedData);
    storage.setItem(primaryKey,serialized);
    if(storage.getItem(primaryKey)!==serialized)throw new Error("verification failed");
    return {ok:true,data:report.migratedData,report,backupKey};
  }catch(error){
    try{if(original!==null&&storage.getItem(primaryKey)!==original)storage.setItem(primaryKey,original)}catch{}
    return {ok:false,error,backupKey,userMessage:"Не удалось сохранить восстановленный проект. Исходные данные не изменены."};
  }
}
function storageErrorMessage(error){
  if(error?.name==="QuotaExceededError")return "Память браузера переполнена. Изменение не сохранено; уменьшите размер фотографий или экспортируйте резервную копию.";
  if(error?.name==="SecurityError")return "Браузер запретил доступ к локальному хранилищу. Изменение не сохранено.";
  if(error?.name==="TypeError"&&/circular|cyclic/i.test(error.message||""))return "Проект содержит циклическую структуру и не может быть сохранён.";
  return "Не удалось сохранить проект в браузере. Подтверждённые данные и открытая форма оставлены без изменений.";
}
function persistProject(project,{storage=globalThis.localStorage,key=STORAGE_KEY}={}){
  try{
    const serialized=JSON.stringify(project);
    if(typeof serialized!=="string")throw new TypeError("Проект не сериализуется");
    storage.setItem(key,serialized);
    return {ok:true,serialized};
  }catch(error){return {ok:false,error,userMessage:storageErrorMessage(error)}}
}
function cloneProject(project){
  if(typeof structuredClone==="function")return structuredClone(project);
  return safeOwnCopy(project);
}
function commitProjectChange(current,mutator,{storage=globalThis.localStorage,key=STORAGE_KEY,validate=true}={}){
  let next;
  try{next=cloneProject(current);mutator(next)}
  catch(error){return {ok:false,error,userMessage:"Изменение не удалось подготовить. Текущий проект не изменён."}}
  if(validate){
    const report=prepareProject(next);
    if(!report.canApply)return {ok:false,report,userMessage:"Изменение нарушает целостность проекта и не было применено."};
    next=report.migratedData;
  }
  const persisted=persistProject(next,{storage,key});
  return persisted.ok?{ok:true,data:next,report:null}:persisted;
}
function commitDataChange(mutator,{renderAfter=true,onSuccess,onError}={}){
  if(!storageWriteEnabled){
    const result={ok:false,userMessage:"Автосохранение заблокировано: сначала сохраните проблемные исходные данные."};
    showStorageMessage(result.userMessage,"error");onError?.(result);return result;
  }
  const result=commitProjectChange(data,mutator,{key:activeWorkspaceContext().storageKey});
  if(!result.ok){showStorageMessage(result.userMessage,"error");onError?.(result);return result}
  data=result.data;
  setSaveStatus(`Сохранено ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`,{transient:true});
  clearStaleErrorBanner();
  onSuccess?.(data);if(renderAfter)render();return result;
}
// Save status is transient, on-demand feedback (spec: "workspace-density-navigation"),
// not a permanent header fixture. A healthy idle project shows nothing here — the
// underlying save/error state machine (storageBanner, dirty-trackers, cloud onState)
// is unchanged; only how long the *text* lingers in the header changes.
let saveStatusClearTimer=null;
function setSaveStatus(text,{transient=false}={}){
  const status=document.getElementById("saveStatus");
  if(!status)return;
  clearTimeout(saveStatusClearTimer);
  status.textContent=text||"";
  status.classList.toggle("is-active",!!text);
  if(transient&&text)saveStatusClearTimer=setTimeout(()=>{status.textContent="";status.classList.remove("is-active")},2200);
}
function showStorageMessage(message,type="warning"){
  const banner=document.getElementById("storageBanner");if(!banner)return;
  banner.textContent=message;banner.className=`storage-banner ${type}`;
}
// A save failure shows an "error" banner; a later successful save must clear it, otherwise the
// banner is left showing a resolved problem as if it were still happening (it only disappears on
// reload, which made it look transient/left-over rather than tied to the save that actually failed).
// Only the "error" class is cleared here — real non-error warnings (legacy/migration notices) are
// unrelated to a save succeeding and must keep being shown.
function clearStaleErrorBanner(){
  const banner=document.getElementById("storageBanner");
  if(banner?.classList.contains("error")){banner.textContent="";banner.className="storage-banner"}
}
function saveData(){
  if(!storageWriteEnabled){showStorageMessage("Автосохранение отключено: проблемная база защищена от перезаписи.","error");return false}
  const result=persistProject(data,{key:activeWorkspaceContext().storageKey});
  if(!result.ok){showStorageMessage(result.userMessage,"error");return false}
  setSaveStatus(`Сохранено ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`,{transient:true});
  clearStaleErrorBanner();
  return true;
}
function downloadProblemRaw(){
  const raw=startupLoadInfo?.raw??startupLoadInfo?.primary?.raw;if(raw==null)return false;
  const blob=new Blob([raw],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="author-workspace-problem-original.json";a.click();URL.revokeObjectURL(a.href);return true;
}

function downloadRecoveryText(text,filename){
  const blob=new Blob([text],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
}

function recoveryCandidateByKey(key){return startupLoadInfo?.candidates?.find(item=>item.key===key)}

function renderRecoveryPreview(candidate,options){
  const root=document.getElementById("recoveryPreview"),apply=document.getElementById("applyRecovery"),download=document.getElementById("downloadMigratedRecovery");
  if(!candidate){root.innerHTML="<p>Выберите резервную версию.</p>";apply.disabled=true;download.disabled=true;return}
  options ||= candidate.recoveryOptions||{characterResolutions:{},confirmations:{}};candidate.recoveryOptions=options;
  const report=prepareProject(candidate.parsed,options);candidate.previewReport=report;
  const conflicts=report.manualConflicts||[];
  let html=`<h3>Предварительная проверка: ${candidate.key}</h3>`;
  if(conflicts.length)html+=conflicts.map(group=>`<section class="recovery-conflict"><strong>Найдены персонажи с одинаковым именем: ${esc(group.name)}</strong><p>Для каждой ссылки выберите нужного персонажа. Автоматического выбора не будет.</p>${group.references.map(ref=>`<label>${esc(ref.label)}<select data-recovery-path="${esc(ref.path)}"><option value="">Выберите персонажа</option>${group.candidates.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.surname?` ${esc(c.surname)}`:""} — ID: ${esc(c.id)}${c.description?` · ${esc(c.description)}`:""}</option>`).join("")}</select></label>`).join("")}</section>`).join("");
  if(report.confirmationConflicts?.length)html+=`<section class="recovery-conflict"><strong>Исправления, требующие подтверждения</strong>${report.confirmationConflicts.map(conflict=>`<label><input type="checkbox" data-recovery-confirm="${esc(conflict.path)}"> ${esc(conflict.message)} Разрешить безопасно убрать эту ссылку.</label>`).join("")}</section>`;
  if(report.unrecoverableConflicts?.length)html+=`<section class="recovery-conflict"><strong>Восстановление этой версии заблокировано</strong>${report.unrecoverableConflicts.map(conflict=>`<p>${esc(conflict.message||conflict.type)}</p>`).join("")}</section>`;
  const unresolved=report.conflicts.filter(x=>x.critical).length;
  html+=`<p>Предупреждений: ${report.warnings.length}. Нерешённых конфликтов: ${unresolved}.</p><p>${report.canApply?"Предварительная версия готова. Применение возможно только после подтверждения.":"Применение заблокировано, пока конфликты не разрешены."}</p>`;
  root.innerHTML=html;apply.disabled=!report.canApply;download.disabled=!report.canApply;
  root.querySelectorAll("[data-recovery-path]").forEach(select=>{select.value=options.characterResolutions[select.dataset.recoveryPath]||"";select.onchange=()=>{if(select.value)options.characterResolutions[select.dataset.recoveryPath]=select.value;else delete options.characterResolutions[select.dataset.recoveryPath];renderRecoveryPreview(candidate,options)}});
  root.querySelectorAll("[data-recovery-confirm]").forEach(input=>{input.checked=!!options.confirmations[input.dataset.recoveryConfirm];input.onchange=()=>{if(input.checked)options.confirmations[input.dataset.recoveryConfirm]=true;else delete options.confirmations[input.dataset.recoveryConfirm];renderRecoveryPreview(candidate,options)}});
}

function renderRecoveryCandidates(){
  const root=document.getElementById("recoveryCandidates"),candidates=startupLoadInfo?.candidates||[];
  root.innerHTML=candidates.map(candidate=>{const s=candidate.summary;return `<label class="recovery-candidate"><input type="radio" name="recoveryCandidate" value="${esc(candidate.key)}" ${s.canMigrate?"":"disabled"}><span><strong>${esc(candidate.key)}</strong> · версия ${candidate.version??"не распознана"}${candidate.timestamp?` · изменён ${new Date(candidate.timestamp).toLocaleString("ru-RU")}`:""}<br>Сцен: ${s.scenes}; персонажей: ${s.characters}; глав: ${s.chapters}; локаций: ${s.locations}; тегов: ${s.tags}.<br>Критических проблем: ${s.criticalErrors}; предупреждений: ${s.warnings}. Можно открыть: ${s.canOpen?"да":"нет"}; можно мигрировать: ${s.canMigrate?"да":"нет"}.</span><button type="button" data-download-raw="${esc(candidate.key)}">Скачать исходный JSON</button></label>`}).join("")||"<p>Подходящие резервные версии не найдены.</p>";
  root.querySelectorAll('input[name="recoveryCandidate"]').forEach(radio=>radio.onchange=()=>renderRecoveryPreview(recoveryCandidateByKey(radio.value)));
  root.querySelectorAll("[data-download-raw]").forEach(button=>button.onclick=()=>{const candidate=recoveryCandidateByKey(button.dataset.downloadRaw);downloadRecoveryText(candidate.raw,`${candidate.key}-original.json`)});
}

function openRecoveryModal(){
  return requestEditorTransition(()=>{renderRecoveryCandidates();renderRecoveryPreview(null);showModal("recoveryModal");trackerFor("recoveryModal")?.captureInitialState()});
}

function initializeRecoveryUi(){
  const modal=document.getElementById("recoveryModal");if(!modal)return;
  document.getElementById("downloadPrimaryRecovery").onclick=downloadProblemRaw;
  document.getElementById("cancelRecovery").onclick=()=>requestCloseModal("recoveryModal","button");
  document.getElementById("downloadMigratedRecovery").onclick=()=>{const selected=document.querySelector('input[name="recoveryCandidate"]:checked'),candidate=selected&&recoveryCandidateByKey(selected.value);if(candidate?.previewReport?.canApply)downloadRecoveryText(JSON.stringify(candidate.previewReport.migratedData,null,2),`${candidate.key}-preview.json`)};
  document.getElementById("applyRecovery").onclick=()=>{
    const selected=document.querySelector('input[name="recoveryCandidate"]:checked'),candidate=selected&&recoveryCandidateByKey(selected.value);if(!candidate?.previewReport?.canApply)return;
    if(!confirm("Восстановить выбранную версию? Повреждённая основная база будет отдельно сохранена в браузере."))return;
    const result=restoreProjectCandidate({candidateKey:candidate.key,candidateRaw:candidate.raw,candidateReport:candidate.previewReport});
    if(!result.ok){showStorageMessage(result.userMessage,"error");return}
    data=result.data;storageWriteEnabled=true;startupLoadInfo={ok:true,recovered:true,backupKey:result.backupKey,candidates:startupLoadInfo.candidates};forceHideModal("recoveryModal");render();showStorageMessage("Проект восстановлен. Исходная повреждённая база сохранена отдельно.","warning");
  };
  document.getElementById("newProjectRecovery").onclick=()=>{
    if(prompt("Новый пустой проект заменит текущую повреждённую базу после создания резервной копии. Введите НОВЫЙ ПРОЕКТ:")!=="НОВЫЙ ПРОЕКТ")return;
    const temporaryKey=`${activeWorkspaceContext().storageKey}-new-project-source`,empty=defaultData();
    try{localStorage.setItem(temporaryKey,JSON.stringify(empty));const result=restoreProjectCandidate({candidateKey:temporaryKey});if(!result.ok){showStorageMessage(result.userMessage,"error");return}data=result.data;storageWriteEnabled=true;forceHideModal("recoveryModal");render();showStorageMessage("Создан новый пустой проект. Предыдущая база сохранена отдельно.","warning")}finally{try{localStorage.removeItem(temporaryKey)}catch{}}
  };
  if(startupLoadInfo?.blocked)openRecoveryModal();
}
function initializeStorageNotice(){
  if(startupLoadInfo?.blocked){
    showStorageMessage("Основная база повреждена или имеет опасные конфликты. Она не изменена, обычное сохранение заблокировано. Нажмите «Скачать проблемный JSON» перед восстановлением.","error");
  }else if(startupLoadInfo?.migrationNeedsConfirmation){
    showStorageMessage(`Найдена резервная база ${startupLoadInfo.source}. Она открыта только для просмотра и не записана поверх основной базы.`,"warning");
  }else if(startupLoadInfo?.migrated){
    showStorageMessage(`Старая база ${startupLoadInfo.source} проверена и безопасно подготовлена для актуальной версии.`,"warning");
  }
}
const SIDEBAR_SECTION_KEYS=["chapters","characters","locations"];
function loadUiState(){
  let storedSections={},storedMatrixContentMode={};
  try{
    const ui=JSON.parse(localStorage.getItem(activeWorkspaceContext().uiStorageKey)||"{}");
    navigationVisible=ui.navigationVisible!==false;
    storedSections=ui.sidebarSections||{};
    storedMatrixContentMode=ui.matrixContentMode||{};
  }catch{navigationVisible=true}
  document.querySelector(".app-shell").classList.toggle("navigation-hidden",!navigationVisible);
  syncSidebarEdgeToggle();
  sidebarSections=Object.fromEntries(SIDEBAR_SECTION_KEYS.map(key=>[key,storedSections[key]!==false]));
  applySidebarSectionState();
  matrixContentMode={actions:storedMatrixContentMode.actions!==false,relations:storedMatrixContentMode.relations===true};
  if(!matrixContentMode.actions&&!matrixContentMode.relations)matrixContentMode={actions:true,relations:false};
  syncMatrixContentControls();
}
function saveUiState(){try{localStorage.setItem(activeWorkspaceContext().uiStorageKey,JSON.stringify({navigationVisible,sidebarSections,matrixContentMode}))}catch{}}
// The sidebar collapse control lives attached to the sidebar's own edge (not a
// standalone header button): one element whose icon/label/aria-expanded flips
// between the open ("‹", collapse) and closed ("›", expand) states.
function syncSidebarEdgeToggle(){
  const toggle=document.getElementById("toggleNavigation");
  if(!toggle)return;
  const icon=toggle.querySelector(".sidebar-edge-toggle-icon");
  const label=navigationVisible?"Свернуть навигацию":"Открыть навигацию";
  toggle.setAttribute("aria-expanded",String(navigationVisible));
  toggle.setAttribute("aria-label",label);
  toggle.title=label;
  if(icon)icon.textContent=navigationVisible?"‹":"›";
}
function applySidebarSectionState(){
  for(const key of SIDEBAR_SECTION_KEYS){
    const expanded=sidebarSections[key]!==false;
    const section=document.querySelector(`[data-sidebar-section="${key}"]`);
    const toggle=document.querySelector(`[data-sidebar-toggle="${key}"]`);
    section?.classList.toggle("collapsed",!expanded);
    toggle?.setAttribute("aria-expanded",String(expanded));
    const icon=toggle?.querySelector(".sidebar-toggle-icon");
    if(icon)icon.textContent=expanded?"▾":"▸";
  }
}
function toggleSidebarSection(key){
  if(!SIDEBAR_SECTION_KEYS.includes(key))return;
  sidebarSections={...sidebarSections,[key]:sidebarSections[key]===false};
  applySidebarSectionState();
  saveUiState();
}

Object.assign(globalThis,{storageProjectScore,parseStorageCandidate,loadProjectFromStorage,loadDataSafe,recoveryBackupKey,restoreProjectCandidate,persistProject,commitProjectChange,commitDataChange,setSaveStatus,showStorageMessage,clearStaleErrorBanner,saveData,downloadProblemRaw,openRecoveryModal,initializeRecoveryUi,initializeStorageNotice,loadUiState,saveUiState,syncSidebarEdgeToggle,applySidebarSectionState,toggleSidebarSection});
export {storageProjectScore,parseStorageCandidate,loadProjectFromStorage,loadDataSafe,recoveryBackupKey,restoreProjectCandidate,persistProject,commitProjectChange,commitDataChange,setSaveStatus,showStorageMessage,clearStaleErrorBanner,saveData,downloadProblemRaw,openRecoveryModal,initializeRecoveryUi,initializeStorageNotice,loadUiState,saveUiState,syncSidebarEdgeToggle,applySidebarSectionState,toggleSidebarSection};
