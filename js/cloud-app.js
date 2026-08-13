import {SUPABASE_CONFIG} from "./supabase-config.js";
import {createCloudApi} from "./cloud-api.js";
import {activateCloudWorkspace,hasLegacyWorkspace} from "./workspace-storage.js";

const SUPABASE_BROWSER_MODULE="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm";
const cloudState={api:null,session:null,profile:null,series:[],projects:[],busy:false};
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
  return "Не удалось выполнить облачную операцию. Подробности записаны в консоль разработчика.";
}
function showAuthMessage(message,isError=false){
  const node=byId("authMessage");node.textContent=message;node.classList.toggle("error",isError);
}
function showCloudFailure(error){
  const node=byId("cloudFailure");node.textContent=friendlyError(error);node.hidden=false;
}
function clearCloudFailure(){byId("cloudFailure").hidden=true;byId("cloudFailure").textContent=""}

async function createClient(){
  if(globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__)return globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__;
  if(["localhost","127.0.0.1"].includes(location.hostname)&&!new URLSearchParams(location.search).has("cloud"))return null;
  if(!SUPABASE_CONFIG.url||!SUPABASE_CONFIG.publishableKey)return null;
  const {createClient}=await import(SUPABASE_BROWSER_MODULE);
  return createClient(SUPABASE_CONFIG.url,SUPABASE_CONFIG.publishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
}
async function loadDashboard(){
  if(!cloudState.session)return;
  const previousState=document.body.dataset.appState;
  clearCloudFailure();
  try{
    const account=await cloudState.api.loadAccount();
    Object.assign(cloudState,account);
    renderDashboard();
    setAppState("projects");
  }catch(error){
    if(previousState==="workspace"){
      showStorageMessage(friendlyError(error),"error");
      setAppState("workspace");
    }else{
      showCloudFailure(error);
      setAppState("projects");
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
  const title=document.createElement("button");title.type="button";title.className="cloud-project-title";title.textContent=project.title;
  title.onclick=()=>openCloudProject(project);
  const select=seriesSelect(project.series_id||"");select.setAttribute("aria-label",`Цикл проекта «${project.title}»`);
  select.onchange=async()=>{
    const seriesId=select.value||null;
    const position=seriesId?sortedSeriesProjects(seriesId).length+1:null;
    await cloudOperation(()=>cloudState.api.setProjectSeries(project.id,seriesId,position));
  };
  const actions=document.createElement("div");actions.className="cloud-project-actions";
  if(project.series_id){
    const index=seriesProjects.findIndex(item=>item.id===project.id);
    for(const [label,delta] of [["↑",-1],["↓",1]]){
      const button=document.createElement("button");button.type="button";button.textContent=label;
      button.setAttribute("aria-label",delta<0?`Поднять «${project.title}»`:`Опустить «${project.title}»`);
      button.disabled=index+delta<0||index+delta>=seriesProjects.length;
      button.onclick=async()=>{
        const ordered=seriesProjects.map(item=>item.id);
        [ordered[index],ordered[index+delta]]=[ordered[index+delta],ordered[index]];
        await cloudOperation(()=>cloudState.api.reorderSeries(project.series_id,ordered));
      };
      actions.append(button);
    }
  }
  row.append(title,select,actions);return row;
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
  editor.onsubmit=async event=>{event.preventDefault();await cloudOperation(()=>cloudState.api.updateSeries(series.id,{title:title.value.trim(),description:description.value.trim()}))};
  editor.append(title,description,save);
  const projects=document.createElement("div");
  const ordered=sortedSeriesProjects(series.id);
  if(!ordered.length){const empty=document.createElement("p");empty.className="account-note";empty.textContent="В этом цикле пока нет проектов.";projects.append(empty)}
  else ordered.forEach(project=>projects.append(projectRow(project,ordered)));
  card.append(head,editor,projects);return card;
}
function renderDashboard(){
  byId("accountName").textContent=cloudState.profile?.display_name||cloudState.session?.user?.email||"";
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
async function cloudOperation(operation){
  if(cloudState.busy)return;
  cloudState.busy=true;clearCloudFailure();
  try{await operation();await loadDashboard()}
  catch(error){showCloudFailure(error)}
  finally{cloudState.busy=false}
}
async function openCloudProject(project){
  if(!(await requestEditorTransition(()=>true)))return;
  activateCloudWorkspace(project.id);
  storageWriteEnabled=true;
  data=loadDataSafe();
  selectedSceneId=null;selectedSceneIndex=null;
  normalizeSceneOrder();loadUiState();
  if(startupLoadInfo?.fresh)saveData();
  render();initializeStorageNotice();
  byId("downloadProblemRaw").hidden=!startupLoadInfo?.blocked;
  byId("openRecovery").hidden=!startupLoadInfo?.blocked;
  byId("workspaceProjectTitle").textContent=project.title;
  setAppState("workspace");
}
async function returnToProjects(){
  if(!(await requestEditorTransition(()=>true)))return;
  await loadDashboard();
}
async function logout(){
  if(!(await requestEditorTransition(()=>true)))return;
  try{await cloudState.api.signOut()}catch(error){showCloudFailure(error)}
}
function downloadLegacy(){
  const raw=localStorage.getItem(STORAGE_KEY);if(raw===null)return;
  const url=URL.createObjectURL(new Blob([raw],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download="author-workspace-legacy-backup.json";link.click();URL.revokeObjectURL(url);
}
function bindUi(){
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
    const seriesId=form.seriesId.value||null,position=seriesId?sortedSeriesProjects(seriesId).length+1:null;
    await cloudOperation(()=>cloudState.api.createProject({ownerId:cloudState.session.user.id,title:form.title.value.trim(),description:form.description.value.trim(),seriesId,position}));
    form.reset();
  };
  byId("newSeriesForm").onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget;
    await cloudOperation(()=>cloudState.api.createSeries({ownerId:cloudState.session.user.id,title:form.title.value.trim(),description:form.description.value.trim()}));
    form.reset();
  };
  byId("dashboardLogout").onclick=logout;byId("workspaceLogout").onclick=logout;
  byId("backToProjects").onclick=returnToProjects;
  byId("downloadLegacyBackup").onclick=downloadLegacy;
  byId("dismissLegacyNotice").onclick=()=>{sessionStorage.setItem("authorWorkspace:legacy-notice-dismissed","true");byId("legacyNotice").hidden=true};
}
async function initializeCloudApp(){
  setAppState("loading");
  try{
    const client=await createClient();
    if(!client){
      setAppState("workspace");
      byId("workspaceCloudBar").hidden=true;
      if(!startupLoadInfo?.blocked)showStorageMessage("Локальный режим: рабочее пространство доступно без облачного аккаунта. Для проверки Auth откройте адрес с ?cloud=1.","warning");
      return;
    }
    cloudState.api=createCloudApi(client);bindUi();
    cloudState.api.onAuthStateChange(session=>{
      cloudState.session=session;
      if(session&&document.body.dataset.appState!=="workspace")queueMicrotask(loadDashboard);
      else if(!session)setAppState("unauthenticated");
    });
    cloudState.session=await cloudState.api.getSession();
    if(cloudState.session)await loadDashboard();else setAppState("unauthenticated");
  }catch(error){
    setAppState("unauthenticated");showAuthMessage(friendlyError(error),true);
  }
}

Object.assign(globalThis,{cloudState,initializeCloudApp,openCloudProject});
initializeCloudApp();
