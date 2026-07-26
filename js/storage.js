import {STORAGE_KEY,UI_STORAGE_KEY,OLD_KEYS} from "./constants.js";
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
  return {key,exists:true,valid:report.canApply,raw,parsed:parsed.value,normalized:report.migratedData,report,version:report.sourceVersion,score:storageProjectScore(parsed.value),timestamp:projectTimestamp(parsed.value)};
}
function blockedMemoryProject(){
  return {version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Данные заблокированы",collapsed:false}],locations:[],tags:[],future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},scenes:[],readOnlyRecovery:true};
}
function loadProjectFromStorage({storage=globalThis.localStorage,key=STORAGE_KEY,oldKeys=OLD_KEYS}={}){
  const primary=parseStorageCandidate(key,storage);
  const candidates=oldKeys.map(k=>parseStorageCandidate(k,storage)).filter(x=>x.exists&&x.valid)
    .sort((a,b)=>(b.version-a.version)||(b.timestamp-a.timestamp)||(b.score-a.score));
  if(primary.exists){
    if(primary.valid)return {ok:true,data:primary.normalized,source:key,report:primary.report,candidates};
    return {ok:false,blocked:true,data:blockedMemoryProject(),source:key,primary,candidates,raw:primary.raw};
  }
  if(candidates.length)return {ok:true,data:candidates[0].normalized,source:candidates[0].key,report:candidates[0].report,candidates,migrationNeedsConfirmation:true};
  const anyStorageError=[primary,...oldKeys.map(k=>parseStorageCandidate(k,storage))].find(x=>x.storageError);
  if(anyStorageError)return {ok:false,blocked:true,data:blockedMemoryProject(),primary:anyStorageError,candidates:[]};
  return {ok:true,data:defaultData(),source:null,fresh:true,candidates:[]};
}
function loadDataSafe(){
  const result=loadProjectFromStorage();
  startupLoadInfo=result;
  if(result.ok&&result.migrationNeedsConfirmation){
    const saved=persistProject(result.data);
    if(saved.ok){
      result.migrationNeedsConfirmation=false;
      result.migrated=true;
    }else{
      result.saveError=saved;
      storageWriteEnabled=false;
    }
  }else if(!result.ok)storageWriteEnabled=false;
  return result.data;
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
  const result=commitProjectChange(data,mutator);
  if(!result.ok){showStorageMessage(result.userMessage,"error");onError?.(result);return result}
  data=result.data;
  const status=document.getElementById("saveStatus");
  if(status)status.textContent=`Сохранено ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
  onSuccess?.(data);if(renderAfter)render();return result;
}
function showStorageMessage(message,type="warning"){
  const banner=document.getElementById("storageBanner");if(!banner)return;
  banner.textContent=message;banner.className=`storage-banner ${type}`;
}
function saveData(){
  if(!storageWriteEnabled){showStorageMessage("Автосохранение отключено: проблемная база защищена от перезаписи.","error");return false}
  const result=persistProject(data);
  if(!result.ok){showStorageMessage(result.userMessage,"error");return false}
  const status=document.getElementById("saveStatus");
  if(status)status.textContent=`Сохранено ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
  return true;
}
function downloadProblemRaw(){
  const raw=startupLoadInfo?.raw??startupLoadInfo?.primary?.raw;if(raw==null)return false;
  const blob=new Blob([raw],{type:"application/json"}),a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="author-workspace-problem-original.json";a.click();URL.revokeObjectURL(a.href);return true;
}
function initializeStorageNotice(){
  if(startupLoadInfo?.blocked){
    showStorageMessage("Основная база повреждена или имеет опасные конфликты. Она не изменена, обычное сохранение заблокировано. Нажмите «Скачать проблемный JSON» перед восстановлением.","error");
  }else if(startupLoadInfo?.migrationNeedsConfirmation){
    showStorageMessage(`Найдена резервная база ${startupLoadInfo.source}. Она открыта только для просмотра и не записана поверх V11.`,"warning");
  }else if(startupLoadInfo?.migrated){
    showStorageMessage(`Старая база ${startupLoadInfo.source} проверена и безопасно мигрирована в V11.`,"warning");
  }
}
function loadUiState(){
  try{const ui=JSON.parse(localStorage.getItem(UI_STORAGE_KEY)||"{}");navigationVisible=ui.navigationVisible!==false}catch{navigationVisible=true}
  document.querySelector(".app-shell").classList.toggle("navigation-hidden",!navigationVisible);
}
function saveUiState(){try{localStorage.setItem(UI_STORAGE_KEY,JSON.stringify({navigationVisible}))}catch{}}

Object.assign(globalThis,{storageProjectScore,parseStorageCandidate,loadProjectFromStorage,loadDataSafe,persistProject,commitProjectChange,commitDataChange,showStorageMessage,saveData,downloadProblemRaw,initializeStorageNotice,loadUiState,saveUiState});
export {storageProjectScore,parseStorageCandidate,loadProjectFromStorage,loadDataSafe,persistProject,commitProjectChange,commitDataChange,showStorageMessage,saveData,downloadProblemRaw,initializeStorageNotice,loadUiState,saveUiState};
