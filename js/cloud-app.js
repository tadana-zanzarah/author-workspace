import {SUPABASE_CONFIG} from "./supabase-config.js";
import {createCloudApi} from "./cloud-api.js";
import {createCloudContentApi} from "./cloud-content-api.js";
import {createCloudCharacterApi} from "./cloud-character-api.js";
import {createCloudCharacterImageApi} from "./cloud-character-image-api.js";
import {createCloudProjectSync} from "./cloud-project-sync.js";
import {activateCloudWorkspace,hasLegacyWorkspace,getLastOpenProjectId,setLastOpenProjectId} from "./workspace-storage.js";
import {AUTH_MESSAGES,authErrorMessage,authReturnUrl,inspectAuthReturn} from "./auth-flow.js";
import {createLocalToCloudMigrationUi} from "./local-to-cloud-migration-ui.js";

const SUPABASE_BROWSER_MODULE="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm";
const cloudState={client:null,api:null,contentApi:null,characterApi:null,imageApi:null,session:null,profile:null,series:[],projects:[],busy:false,authRevision:0,dashboardRequest:0,dashboardStatus:"idle",projectSync:null,authMode:"login",dashboardSessionId:null,migrationUi:null,autoRestoreAttemptedForUserId:null};
const byId=id=>document.getElementById(id);

function setAppState(state){
  document.body.dataset.appState=state;
  byId("sessionLoading").hidden=state!=="loading";
  byId("authScreen").hidden=state!=="unauthenticated";
  byId("projectsScreen").hidden=state!=="projects";
  byId("workspaceCloudBar").hidden=state!=="workspace";
  byId("workspaceAccountMenu").hidden=state!=="workspace";
}
function friendlyError(error,authOperation=false){
  console.error("[Author Workspace cloud]",error);
  const message=authErrorMessage(error);
  return authOperation||message!==AUTH_MESSAGES.unknown?message:"Не удалось выполнить облачную операцию.";
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
let dashboardLoadPromise=null;
async function loadDashboard(){
  if(!cloudState.session)return;
  // acceptSession() is invoked both by the auth-state-change listener and directly by the
  // sign-in/reload call sites, so two calls for the same user routinely race here. The old
  // guard silently no-op'd the second call instead of waiting for the first's real data —
  // harmless for callers that only cared about the UI state, but attemptLastProjectRestore
  // needs cloudState.projects to actually be populated, so the second caller must await the
  // same in-flight load rather than fall through immediately.
  if(dashboardLoadPromise&&cloudState.dashboardSessionId===cloudState.session.user?.id)return dashboardLoadPromise;
  cloudState.dashboardSessionId=cloudState.session.user?.id||null;
  const request=++cloudState.dashboardRequest;
  const previousState=document.body.dataset.appState;
  clearCloudMessages();
  if(previousState!=="workspace"){
    setAppState("projects");
    renderDashboardStatus("loading");
  }
  dashboardLoadPromise=(async()=>{
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
    }finally{
      dashboardLoadPromise=null;
    }
  })();
  return dashboardLoadPromise;
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
  const remove=document.createElement("button");remove.type="button";remove.className="danger";remove.textContent="Удалить проект";
  remove.setAttribute("aria-label",`Удалить проект «${project.title}»`);
  remove.onclick=async()=>{
    const confirmed=await showConfirmAction({
      title:`Удалить проект «${project.title}»?`,
      description:"Главы, сцены, персонажи и весь текст этого проекта будут удалены. Отменить это действие через интерфейс нельзя.",
      confirmLabel:"Удалить проект",cancelLabel:"Отмена"
    });
    if(!confirmed||remove.disabled)return;
    const idleLabel=remove.textContent;remove.disabled=true;remove.textContent="Удаление…";
    const ok=await cloudOperation(()=>cloudState.api.deleteProject(project.id),`Проект «${project.title}» удалён.`);
    if(ok){if(getLastOpenProjectId(cloudState.session?.user?.id)===project.id)setLastOpenProjectId(cloudState.session?.user?.id,null)}
    else{remove.disabled=false;remove.textContent=idleLabel}
  };
  actions.append(remove);
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
  byId("openLocalCloudMigration").hidden=!hasLegacyWorkspace();
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
  setLastOpenProjectId(cloudState.session?.user?.id,project.id);
  storageWriteEnabled=false;
  const localBeforeLoad=loadDataSafe();
  data=localBeforeLoad;
  selectedSceneId=null;selectedSceneIndex=null;
  byId("workspaceProjectTitle").textContent=project.title;
  setAppState("workspace");
  clearCloudMessages();
  byId("board").innerHTML='<div class="section-empty-state" role="status"><strong>Загрузка проекта…</strong></div>';
  const sync=createCloudProjectSync({projectId:project.id,api:cloudState.contentApi,characterApi:cloudState.characterApi,imageApi:cloudState.imageApi,onState:(status,payload)=>{
    if(status==="loading")byId("saveStatus").textContent="Синхронизация…";
    // A successful mutation must clear a save-error banner left by an earlier failed one —
    // otherwise it keeps showing a now-resolved problem until the page is reloaded, which made
    // it look like a stray leftover rather than tied to the save that actually failed.
    else if(status==="saved"){byId("saveStatus").textContent="Сохранено";clearStaleErrorBanner()}
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
function setAuthMode(mode,{message="",focus=true}={}){
  cloudState.authMode=mode;
  const signup=mode==="signup",form=byId("authForm");
  form.dataset.mode=mode;form.hidden=false;byId("signupSuccess").hidden=true;
  byId("authTitle").textContent=signup?"Создание аккаунта":"Вход";
  byId("authNote").textContent=signup?"Создайте аккаунт, чтобы хранить проекты в облаке.":"Войдите, чтобы открыть свои проекты.";
  byId("authDisplayNameField").hidden=!signup;byId("authPasswordConfirmField").hidden=!signup;
  byId("authDisplayName").required=signup;byId("authPasswordConfirm").required=signup;
  byId("authPassword").autocomplete=signup?"new-password":"current-password";
  byId("signInButton").textContent=signup?"Создать аккаунт":"Войти";
  byId("authModeSwitch").textContent=signup?"Уже есть аккаунт? Войти":"Нет аккаунта? Создать аккаунт";
  showAuthMessage(message,false);if(focus)byId(signup?"authDisplayName":"authEmail").focus();
}
function showSignupSuccess(email){
  byId("authForm").hidden=true;byId("signupSuccess").hidden=false;
  byId("signupSuccessText").textContent=`Мы отправили письмо со ссылкой подтверждения на ${email}. После подтверждения адреса вернитесь сюда и войдите.`;
  byId("signupSuccessLogin").focus();
}
async function attemptLastProjectRestore(session){
  const userId=session?.user?.id;
  // One-shot per signed-in session: последующие обновления dashboard (создание
  // проекта, retry, cloudOperation) не должны заново открывать прошлый проект —
  // иначе явный Back на dashboard превратился бы в auto-reopen loop.
  if(!userId||cloudState.autoRestoreAttemptedForUserId===userId)return;
  cloudState.autoRestoreAttemptedForUserId=userId;
  if(document.body.dataset.appState==="workspace")return;
  const lastProjectId=getLastOpenProjectId(userId);
  if(!lastProjectId)return;
  const project=cloudState.projects.find(item=>item.id===lastProjectId);
  if(!project){setLastOpenProjectId(userId,null);return}
  await openCloudProject(project);
}
async function acceptSession(session,{forceDashboard=false}={}){
  if(!session)return false;
  cloudState.session=session;clearConsumedAuthUrl();
  if(forceDashboard||cloudState.dashboardSessionId!==session.user?.id||cloudState.dashboardStatus!=="success")await loadDashboard();
  await attemptLastProjectRestore(session);
  return true;
}
async function returnToProjects(){
  if(!(await requestEditorTransition(()=>true)))return;
  byId("workspaceAccountMenu").open=false;
  cloudState.session=await cloudState.api.getSession();
  if(!cloudState.session){setAppState("unauthenticated");return}
  // Явный переход на dashboard — это выбор пользователя "сейчас без проекта",
  // поэтому last-open preference очищается, а не auto-reopen'ится при следующей загрузке.
  setLastOpenProjectId(cloudState.session.user?.id,null);
  await loadDashboard();
}

function clearConsumedAuthUrl(){
  const url=new URL(location.href);
  const authKeys=new Set(["access_token","refresh_token","expires_in","expires_at","token_type","type","code","error","error_code","error_description"]);
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
    const form=event.currentTarget;
    if(cloudState.authMode==="signup"){
      if(form.password.value!==form.passwordConfirm.value){showAuthMessage("Пароли не совпадают.",true);form.passwordConfirm.focus();return}
      try{
        const email=form.email.value.trim();
        const result=await cloudState.api.signUp({email,password:form.password.value,displayName:form.displayName.value.trim(),emailRedirectTo:authReturnUrl(location.href)});
        if(result.session)await acceptSession(result.session,{forceDashboard:true});else showSignupSuccess(email);
      }catch(error){showAuthMessage(friendlyError(error,true),true)}
      return;
    }
    try{
      const result=await cloudState.api.signIn({email:form.email.value.trim(),password:form.password.value});
      if(result.session)await acceptSession(result.session,{forceDashboard:true});
    }catch(error){showAuthMessage(friendlyError(error,true),true)}
  };
  byId("authModeSwitch").onclick=()=>setAuthMode(cloudState.authMode==="login"?"signup":"login");
  byId("signupSuccessLogin").onclick=()=>setAuthMode("login");
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
  byId("openLocalCloudMigration").onclick=event=>cloudState.migrationUi?.open(event.currentTarget);
}
async function initializeCloudApp(){
  setAppState("loading");
  try{
    const client=await createClient();
    if(!client){
      setAppState("workspace");
      byId("workspaceCloudBar").hidden=true;
      byId("workspaceAccountMenu").hidden=true;
      if(!startupLoadInfo?.blocked)showStorageMessage("Локальный режим: рабочее пространство доступно без облачного аккаунта. Уберите ?local=1, чтобы открыть облачный вход.","warning");
      return;
    }
    cloudState.client=client;cloudState.api=createCloudApi(client);cloudState.contentApi=createCloudContentApi(client);cloudState.characterApi=createCloudCharacterApi(client);cloudState.imageApi=createCloudCharacterImageApi(client,{getUserId:async()=>cloudState.session?.user?.id});cloudState.migrationUi=createLocalToCloudMigrationUi({cloudState,openCloudProject,loadDashboard});bindUi();
    const authReturn=inspectAuthReturn(location.href);
    cloudState.api.onAuthStateChange((session,event)=>{
      cloudState.authRevision++;
      cloudState.session=session;
      if(session)clearConsumedAuthUrl();
      if(session&&(event==="INITIAL_SESSION"||event==="SIGNED_IN"))queueMicrotask(()=>acceptSession(session));
      else if(!session){cloudState.dashboardRequest++;cloudState.dashboardSessionId=null;cloudState.dashboardStatus="idle";cloudState.autoRestoreAttemptedForUserId=null;setAppState("unauthenticated");setAuthMode("login",{focus:false})}
    });
    const authRevision=cloudState.authRevision;
    const initialSession=await cloudState.api.getSession();
    if(authRevision===cloudState.authRevision)cloudState.session=initialSession;
    if(cloudState.session)clearConsumedAuthUrl();
    if(cloudState.session&&authRevision===cloudState.authRevision)await acceptSession(cloudState.session);
    else if(!cloudState.session){setAppState("unauthenticated");setAuthMode("login",{message:authReturn.isAuthReturn&&!authReturn.error?"Email подтверждён. Теперь войдите в аккаунт.":authReturn.error?authErrorMessage({message:authReturn.error}):"",focus:false});clearConsumedAuthUrl()}
  }catch(error){
    setAppState("unauthenticated");showAuthMessage(friendlyError(error,true),true);
  }
}

Object.assign(globalThis,{cloudState,initializeCloudApp,openCloudProject});
initializeCloudApp();
