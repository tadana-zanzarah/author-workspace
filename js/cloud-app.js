import {SUPABASE_CONFIG} from "./supabase-config.js";
import {createCloudApi} from "./cloud-api.js";
import {createCloudContentApi} from "./cloud-content-api.js";
import {createCloudProjectSync} from "./cloud-project-sync.js";
import {activateCloudWorkspace,hasLegacyWorkspace} from "./workspace-storage.js";

const SUPABASE_BROWSER_MODULE="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm";
const cloudState={api:null,contentApi:null,session:null,profile:null,series:[],projects:[],busy:false,authRevision:0,dashboardRequest:0,dashboardStatus:"idle",projectSync:null};
const byId=id=>document.getElementById(id);

function setAppState(state){
  document.body.dataset.appState=state;
  byId("sessionLoading").hidden=state!=="loading";
  byId("authScreen").hidden=state!=="unauthenticated";
  byId("projectsScreen").hidden=state!=="projects";
  byId("workspaceCloudBar").hidden=state!=="workspace";
}
function friendlyError(error){
  console.error("[Author Workspace cloud]",error);
  const message=String(error?.message||"");
  if(/invalid login credentials/i.test(message))return "Неверный email или пароль.";
  if(/email not confirmed/i.test(message))return "Сначала подтвердите email по ссылке из письма.";
  if(/user already registered/i.test(message))return "Аккаунт с таким email уже существует.";
  if(/password/i.test(message)&&/least|short|weak/i.test(message))return "Пароль слишком короткий или слабый.";
  if(/failed to fetch|network|load failed/i.test(message))return "Облачный сервис сейчас недоступен. Локальные данные не изменены.";
  return "Не удалось выполнить облачную операцию.";
}
function showAuthMessage(message,isError=false){
  const node=byId("authMessage");node.textContent=message;node.classList.toggle("error",isError);
}
function showCloudFailure(error){
  const node=byId("cloudFailure");node.textContent=friendlyError(error);node.hidden=false;
}
function clearCloudFailure(){byId("cloudFailure").hidden=true;byId("cloudFailure").textContent=""}
function clearCloudMessages(){
  clearCloudFailure();showDashboardMessage("");
  const banner=byId("storageBanner");if(banner){banner.textContent="";banner.className="storage-banner"}
}
function showDashboardMessage(message,isError=false){
  const node=byId("dashboardMessage");node.textContent=message;node.classList.toggle("error",isError);
}
function renderDashboardStatus(status,error=null){
  cloudState.dashboardStatus=status;
  byId("projectsLoadingState").hidden=status!=="loading";
  byId("projectsErrorState").hidden=status!=="error";
  byId("projectsEmptyState").hidden=status!=="success"||cloudState.projects.length!==0;
  byId("seriesList").closest("section").hidden=status!=="success";
  byId("standaloneProjects").closest("section").hidden=status!=="success";
  if(error)byId("projectsErrorMessage").textContent="Проверьте подключение и попробуйте ещё раз.";
}

async function createClient(){
  if(globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__)return globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__;
  if(new URLSearchParams(location.search).has("local"))return null;
  if(!SUPABASE_CONFIG.url||!SUPABASE_CONFIG.publishableKey)return null;
  const {createClient}=await import(SUPABASE_BROWSER_MODULE);
  return createClient(SUPABASE_CONFIG.url,SUPABASE_CONFIG.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
}
async function loadDashboard(){
  if(!cloudState.session)return;
  const request=++cloudState.dashboardRequest;
  const previousState=document.body.dataset.appState;
  clearCloudMessages();
  if(previousState!=="workspace"){
    setAppState("projects");
    renderDashboardStatus("loading");
  }
  try{
    const account=await cloudState.api.loadAccount();
    if(request!==cloudState.dashboardRequest||!cloudState.session)return;
    Object.assign(cloudState,account);
    renderDashboard();
    setAppState("projects");
    renderDashboardStatus("success");
    clearCloudMessages();
  }catch(error){
    if(request!==cloudState.dashboardRequest)return;
    if(previousState==="workspace"){
      showStorageMessage(friendlyError(error),"error");
      setAppState("workspace");
    }else{
      showCloudFailure(error);
      setAppState("projects");
      renderDashboardStatus("error",error);
    }
  }
}
function sortedSeriesProjects(seriesId){
  return cloudState.projects.filter(project=>project.series_id===seriesId)
    .sort((a,b)=>(a.position_in_series??Number.MAX_SAFE_INTEGER)-(b.position_in_series??Number.MAX_SAFE_INTEGER)||a.created_at.localeCompare(b.created_at));
}
function option(value,label,selected=false){
  const node=document.createElement("option");node.value=value;node.textContent=label;node.selected=selected;return node;
}
function seriesSelect(selectedId=""){
  const select=document.createElement("select");
  select.append(option("","Без цикла",!selectedId));
  cloudState.series.forEach(series=>select.append(option(series.id,series.title,series.id===selectedId)));
  return select;
}
function projectRow(project,seriesProjects=[]){
  const row=document.createElement("div");row.className="cloud-project";row.dataset.projectId=project.id;
  const identity=document.createElement("div");
  const title=document.createElement("strong");title.className="cloud-project-title";title.textContent=project.title;
  const description=document.createElement("div");description.className="account-note";description.textContent=project.description||"Без описания";
  identity.append(title,description);
  const seriesControl=document.createElement("label");seriesControl.className="project-series-control";
  const seriesCaption=document.createElement("span");seriesCaption.textContent=project.series_id?"Переместить в другой цикл":"Переместить в цикл";
  const select=seriesSelect(project.series_id||"");select.setAttribute("aria-label",`Цикл проекта «${project.title}»`);
  select.onchange=async()=>{
    const seriesId=select.value||null;
    const position=seriesId?sortedSeriesProjects(seriesId).length+1:null;
    const ok=await cloudOperation(()=>cloudState.api.setProjectSeries(project.id,seriesId,position),seriesId?"Проект перемещён в цикл.":"Проект убран из цикла.");
    if(!ok)select.value=project.series_id||"";
  };
  seriesControl.append(seriesCaption,select);
  const actions=document.createElement("div");actions.className="cloud-project-actions";
  const open=document.createElement("button");open.type="button";open.className="primary";open.textContent="Открыть";open.onclick=()=>openCloudProject(project);actions.append(open);
  if(project.series_id){
    const detach=document.createElement("button");detach.type="button";detach.textContent="Убрать из цикла";
    detach.onclick=()=>cloudOperation(()=>cloudState.api.setProjectSeries(project.id,null,null),"Проект убран из цикла.");
    actions.append(detach);
  }
  if(project.series_id){
    const index=seriesProjects.findIndex(item=>item.id===project.id);
    for(const [label,delta] of [["↑",-1],["↓",1]]){
      const button=document.createElement("button");button.type="button";button.textContent=label;
      button.setAttribute("aria-label",delta<0?`Поднять «${project.title}»`:`Опустить «${project.title}»`);
      button.disabled=index+delta<0||index+delta>=seriesProjects.length;
      button.onclick=async()=>{
        const ordered=seriesProjects.map(item=>item.id);
        [ordered[index],ordered[index+delta]]=[ordered[index+delta],ordered[index]];
        await cloudOperation(()=>cloudState.api.reorderSeries(project.series_id,ordered),"Порядок проектов сохранён.");
      };
      actions.append(button);
    }
  }
  row.append(identity,seriesControl,actions);return row;
}
function seriesCard(series){
  const card=document.createElement("article");card.className="cloud-card";card.dataset.seriesId=series.id;
  const head=document.createElement("div");head.className="cloud-card-head";
  const heading=document.createElement("h3");heading.textContent=series.title;
  const archive=document.createElement("button");archive.type="button";archive.className="danger";archive.textContent="Удалить цикл";
  archive.onclick=async()=>{
    if(!confirm(`Удалить цикл «${series.title}»? Проекты останутся и станут самостоятельными.`))return;
    await cloudOperation(()=>cloudState.api.archiveSeries(series.id));
  };
  head.append(heading,archive);
  const editor=document.createElement("form");editor.className="series-editor";
  const title=document.createElement("input");title.value=series.title;title.maxLength=200;title.required=true;title.setAttribute("aria-label","Название цикла");
  const description=document.createElement("input");description.value=series.description||"";description.maxLength=10000;description.setAttribute("aria-label","Описание цикла");
  const save=document.createElement("button");save.type="submit";save.textContent="Сохранить цикл";
  editor.onsubmit=async event=>{event.preventDefault();await cloudOperation(()=>cloudState.api.updateSeries(series.id,{title:title.value.trim(),description:description.value.trim()}),"Цикл обновлён.")};
  editor.append(title,description,save);
  const projects=document.createElement("div");
  const ordered=sortedSeriesProjects(series.id);
  if(!ordered.length){const empty=document.createElement("p");empty.className="account-note";empty.textContent="В этом цикле пока нет проектов.";projects.append(empty)}
  else ordered.forEach(project=>projects.append(projectRow(project,ordered)));
  card.append(head,editor,projects);return card;
}
function renderDashboard(){
  const accountLabel=cloudState.session?.user?.email||cloudState.profile?.display_name||"Аккаунт";
  byId("accountName").textContent=`${accountLabel} ▾`;byId("workspaceAccountName").textContent=`${accountLabel} ▾`;
  const seriesList=byId("seriesList");seriesList.replaceChildren();
  if(cloudState.series.length)cloudState.series.forEach(series=>seriesList.append(seriesCard(series)));
  else{const empty=document.createElement("p");empty.className="account-note";empty.textContent="Циклов пока нет.";seriesList.append(empty)}
  const standalone=byId("standaloneProjects");standalone.replaceChildren();
  const projects=cloudState.projects.filter(project=>!project.series_id);
  if(projects.length)projects.forEach(project=>standalone.append(projectRow(project)));
  else{const empty=document.createElement("p");empty.className="account-note";empty.textContent="Самостоятельных проектов пока нет.";standalone.append(empty)}
  const formSelect=byId("newProjectForm").elements.seriesId;formSelect.replaceChildren(option("","Без цикла"));
  cloudState.series.forEach(series=>formSelect.append(option(series.id,series.title)));
  byId("legacyNotice").hidden=!hasLegacyWorkspace()||sessionStorage.getItem("authorWorkspace:legacy-notice-dismissed")==="true";
}
async function cloudOperation(operation,successMessage=""){
  if(cloudState.busy)return false;
  cloudState.busy=true;clearCloudFailure();
  try{await operation();await loadDashboard();if(successMessage)showDashboardMessage(successMessage);return true}
  catch(error){showCloudFailure(error);showDashboardMessage(friendlyError(error),true);return false}
  finally{cloudState.busy=false}
}
async function openCloudProject(project){
  if(!(await requestEditorTransition(()=>true)))return;
  activateCloudWorkspace(project.id);
  storageWriteEnabled=false;
  const localBeforeLoad=loadDataSafe();
  data=localBeforeLoad;
  selectedSceneId=null;selectedSceneIndex=null;
  byId("workspaceProjectTitle").textContent=project.title;
  setAppState("workspace");
  clearCloudMessages();
  byId("board").innerHTML='<div class="section-empty-state" role="status"><strong>Загрузка проекта…</strong></div>';
  const sync=createCloudProjectSync({projectId:project.id,api:cloudState.contentApi,onState:(status,payload)=>{
    if(status==="loading")byId("saveStatus").textContent="Синхронизация…";
    else if(status==="saved")byId("saveStatus").textContent="Сохранено";
    else if(status==="conflict")showStorageMessage("Проект изменился в другом окне или на другом устройстве. Форма и черновик сохранены; загрузите актуальную версию или отмените операцию.","error");
    else if(status==="save-error")showStorageMessage(payload?.message||"Не удалось сохранить облачные изменения.","error");
  },onConflict:()=>setTimeout(async()=>{
    if(!confirm("Проект изменился в другом окне или на другом устройстве. Загрузить актуальную облачную версию? Введённый текст открытой формы останется в форме, но перед повторным сохранением проверьте изменения."))return;
    const reloaded=await sync.reload();if(reloaded.ok){data=reloaded.data;render();showStorageMessage("Актуальная облачная версия загружена. Черновик открытой формы не закрыт — проверьте его перед сохранением.","warning")}
  },0)});
  cloudState.projectSync=sync;globalThis.cloudProjectSync=sync;
  try{
    const loaded=await sync.load();
    if(!loaded.ok&&loaded.code==="LOCAL_CONTENT_CLOUD_EMPTY"){
      data=localBeforeLoad;storageWriteEnabled=false;normalizeSceneOrder();loadUiState();render();
      showStorageMessage("В этом браузере найдены локальные данные проекта, а облачная версия пуста. Локальные данные не удалены. Скачайте резервную копию через «Экспорт»; перенос в облако будет добавлен отдельным этапом.","error");
      return;
    }
    data=loaded.data;storageWriteEnabled=true;normalizeSceneOrder();loadUiState();render();clearCloudMessages();
    byId("saveStatus").textContent="Сохранено";
  }catch(error){
    data=localBeforeLoad;storageWriteEnabled=false;normalizeSceneOrder();loadUiState();render();
    showStorageMessage("Не удалось загрузить облачный проект. Локальная копия показана только для восстановления; изменения не синхронизируются.","error");
  }
}
async function returnToProjects(){
  if(!(await requestEditorTransition(()=>true)))return;
  byId("workspaceAccountMenu").open=false;
  cloudState.session=await cloudState.api.getSession();
  if(!cloudState.session){setAppState("unauthenticated");return}
  await loadDashboard();
}

function clearConsumedAuthUrl(){
  const url=new URL(location.href);
  const authKeys=new Set(["access_token","refresh_token","expires_in","expires_at","token_type","type","code"]);
  let changed=false;
  for(const key of [...url.searchParams.keys()])if(authKeys.has(key)){url.searchParams.delete(key);changed=true}
  const hash=new URLSearchParams(url.hash.replace(/^#/,""));
  for(const key of [...hash.keys()])if(authKeys.has(key)){hash.delete(key);changed=true}
  if(changed){url.hash=hash.toString()?`#${hash}`:"";history.replaceState(history.state,"",url)}
}
async function logout(){
  if(!(await requestEditorTransition(()=>true)))return;
  try{
    await cloudState.api.signOut();
    byId("dashboardAccountMenu").open=false;byId("workspaceAccountMenu").open=false;
  }
  catch(error){
    const message=friendlyError(error);
    if(document.body.dataset.appState==="workspace")showStorageMessage(message,"error");else showCloudFailure(error);
  }
}
function downloadLegacy(){
  const raw=localStorage.getItem(STORAGE_KEY);if(raw===null)return;
  const url=URL.createObjectURL(new Blob([raw],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download="author-workspace-legacy-backup.json";link.click();URL.revokeObjectURL(url);
}
function bindUi(){
  const projectTracker=createDirtyTracker("newProjectModal",()=>serializeForm("newProjectForm"));
  const seriesTracker=createDirtyTracker("newSeriesModal",()=>serializeForm("newSeriesForm"));
  const openCreationModal=(modalId,tracker,errorId)=>{
    byId(errorId).textContent="";openModal(modalId);tracker.captureInitialState();
  };
  byId("authForm").onsubmit=async event=>{
    event.preventDefault();showAuthMessage("");
    try{
      await cloudState.api.signIn({email:event.currentTarget.email.value.trim(),password:event.currentTarget.password.value});
    }catch(error){showAuthMessage(friendlyError(error),true)}
  };
  byId("signUpButton").onclick=async()=>{
    const form=byId("authForm");if(!form.reportValidity())return;
    try{
      const result=await cloudState.api.signUp({email:form.email.value.trim(),password:form.password.value,displayName:form.displayName.value.trim()});
      showAuthMessage(result.session?"Аккаунт создан.":"Проверьте почту для подтверждения регистрации.");
    }catch(error){showAuthMessage(friendlyError(error),true)}
  };
  byId("newProjectForm").onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget;
    const title=form.elements.namedItem("title").value.trim();
    if(!title){form.elements.namedItem("title").focus();return}
    const seriesId=form.elements.namedItem("seriesId").value||null,position=seriesId?sortedSeriesProjects(seriesId).length+1:null;
    const ok=await cloudOperation(()=>cloudState.api.createProject({ownerId:cloudState.session.user.id,title,description:form.elements.namedItem("description").value.trim(),seriesId,position}),`Проект «${title}» создан.`);
    if(!ok){byId("newProjectError").textContent="Не удалось создать проект. Проверьте данные и попробуйте снова.";return}
    projectTracker.resetDirty();forceCloseModal("newProjectModal");form.reset();
  };
  byId("newSeriesForm").onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget;
    const title=form.elements.namedItem("title").value.trim();
    if(!title){form.elements.namedItem("title").focus();return}
    const ok=await cloudOperation(()=>cloudState.api.createSeries({ownerId:cloudState.session.user.id,title,description:form.elements.namedItem("description").value.trim()}),`Цикл «${title}» создан.`);
    if(!ok){byId("newSeriesError").textContent="Не удалось создать цикл. Проверьте данные и попробуйте снова.";return}
    seriesTracker.resetDirty();forceCloseModal("newSeriesModal");form.reset();
  };
  byId("openNewProject").onclick=()=>openCreationModal("newProjectModal",projectTracker,"newProjectError");
  byId("emptyNewProject").onclick=()=>openCreationModal("newProjectModal",projectTracker,"newProjectError");
  byId("openNewSeries").onclick=()=>openCreationModal("newSeriesModal",seriesTracker,"newSeriesError");
  byId("cancelNewProject").onclick=()=>requestCloseModal("newProjectModal","button");
  byId("cancelNewSeries").onclick=()=>requestCloseModal("newSeriesModal","button");
  byId("newProjectModal").onclick=event=>{if(event.target.id==="newProjectModal")requestCloseModal("newProjectModal","backdrop")};
  byId("newSeriesModal").onclick=event=>{if(event.target.id==="newSeriesModal")requestCloseModal("newSeriesModal","backdrop")};
  byId("dashboardLogout").onclick=logout;byId("workspaceLogout").onclick=logout;
  byId("backToProjects").onclick=returnToProjects;byId("workspaceProjects").onclick=returnToProjects;
  byId("accountProjects").onclick=()=>{byId("dashboardAccountMenu").open=false};
  byId("downloadLegacyBackup").onclick=downloadLegacy;
  byId("dismissLegacyNotice").onclick=()=>{sessionStorage.setItem("authorWorkspace:legacy-notice-dismissed","true");byId("legacyNotice").hidden=true};
  byId("retryDashboard").onclick=loadDashboard;
}
async function initializeCloudApp(){
  setAppState("loading");
  try{
    const client=await createClient();
    if(!client){
      setAppState("workspace");
      byId("workspaceCloudBar").hidden=true;
      if(!startupLoadInfo?.blocked)showStorageMessage("Локальный режим: рабочее пространство доступно без облачного аккаунта. Уберите ?local=1, чтобы открыть облачный вход.","warning");
      return;
    }
    cloudState.api=createCloudApi(client);cloudState.contentApi=createCloudContentApi(client);bindUi();
    cloudState.api.onAuthStateChange((session,event)=>{
      cloudState.authRevision++;
      cloudState.session=session;
      if(session)clearConsumedAuthUrl();
      if(session&&(event==="INITIAL_SESSION"||event==="SIGNED_IN"))queueMicrotask(loadDashboard);
      else if(!session){cloudState.dashboardRequest++;setAppState("unauthenticated")}
    });
    const authRevision=cloudState.authRevision;
    const initialSession=await cloudState.api.getSession();
    if(authRevision===cloudState.authRevision)cloudState.session=initialSession;
    if(cloudState.session)clearConsumedAuthUrl();
    if(cloudState.session&&authRevision===cloudState.authRevision)await loadDashboard();
    else if(!cloudState.session)setAppState("unauthenticated");
  }catch(error){
    setAppState("unauthenticated");showAuthMessage(friendlyError(error),true);
  }
}

Object.assign(globalThis,{cloudState,initializeCloudApp,openCloudProject});
initializeCloudApp();
