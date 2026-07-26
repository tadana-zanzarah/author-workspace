function storageProjectScore(project){
  if(!project||typeof project!=="object")return -1;
  const scenes=Array.isArray(project.scenes)?project.scenes.length:0;
  const characters=Array.isArray(project.characters)?project.characters.length:0;
  const chapters=Array.isArray(project.chapters)?project.chapters.length:0;
  const locations=Array.isArray(project.locations)?project.locations.length:0;
  const tags=Array.isArray(project.tags)?project.tags.length:0;
  const textSize=(project.scenes||[]).reduce((n,s)=>n+String(s?.sceneText||s?.text||"").length,0);
  const photos=Object.values(project.profiles||{}).reduce((n,p)=>n+(Array.isArray(p?.photos)?p.photos.length:0),0);
  return scenes*100000+textSize+characters*5000+chapters*2000+locations*1000+tags*500+photos*10000;
}

function parseStorageCandidate(key){
  const raw=localStorage.getItem(key);
  if(raw===null)return {key,exists:false};
  try{
    const parsed=JSON.parse(raw);
    const normalized=normalizeData(parsed);
    return {key,exists:true,valid:true,parsed,normalized,score:storageProjectScore(parsed)};
  }catch(error){
    return {key,exists:true,valid:false,error};
  }
}

function loadDataSafe(){
  const v11=parseStorageCandidate(STORAGE_KEY);
  if(v11.exists&&v11.valid){
    startupLoadInfo={source:STORAGE_KEY,migrated:false,errors:[]};
    return v11.normalized;
  }

  const candidates=OLD_KEYS.map(parseStorageCandidate);
  const valid=candidates.filter(x=>x.exists&&x.valid).sort((a,b)=>b.score-a.score);
  const errors=[v11,...candidates].filter(x=>x.exists&&!x.valid);

  if(valid.length){
    const chosen=valid[0];
    startupLoadInfo={source:chosen.key,migrated:true,errors};
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(chosen.normalized));
    }catch(error){
      storageWriteEnabled=false;
      startupLoadInfo.saveError=error;
    }
    return chosen.normalized;
  }

  const anyExisting=[v11,...candidates].some(x=>x.exists);
  if(anyExisting){
    storageWriteEnabled=false;
    startupLoadInfo={source:null,migrated:false,errors,fatal:true};
    return defaultData();
  }

  startupLoadInfo={source:null,migrated:false,errors:[],fresh:true};
  return defaultData();
}

function showStorageMessage(message,type="warning"){
  const banner=document.getElementById("storageBanner");
  if(!banner)return;
  banner.textContent=message;
  banner.className=`storage-banner ${type}`;
}

function saveData(){
  if(!storageWriteEnabled){
    showStorageMessage("Автосохранение отключено: ранее обнаружена ошибка чтения или записи. Сначала экспортируйте данные и перезагрузите файл после проверки.","error");
    return false;
  }
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
    const status=document.getElementById("saveStatus");
    if(status)status.textContent=`Сохранено ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
    return true;
  }catch(error){
    storageWriteEnabled=false;
    const quota=error?.name==="QuotaExceededError";
    showStorageMessage(quota
      ?"Память браузера переполнена. Последние изменения не сохранены. Немедленно экспортируйте JSON; уменьшите количество или размер фотографий."
      :"Не удалось сохранить проект в браузере. Последние изменения могут быть не сохранены. Экспортируйте JSON.", "error");
    return false;
  }
}

function initializeStorageNotice(){
  if(startupLoadInfo?.fatal){
    showStorageMessage("Найдены данные проекта, но их не удалось прочитать. Пустой проект открыт только в памяти и НЕ будет записан поверх старых данных. Импортируйте исправную резервную копию или экспортируйте содержимое localStorage вручную.","error");
  }else if(startupLoadInfo?.migrated){
    const suffix=startupLoadInfo.saveError?" Миграцию не удалось сохранить из-за ошибки браузера.":" Копия сохранена в формате V11.";
    showStorageMessage(`Загружена наиболее заполненная база ${startupLoadInfo.source}.${suffix}`,startupLoadInfo.saveError?"error":"warning");
  }else if(startupLoadInfo?.errors?.length){
    showStorageMessage("База V11 повреждена, поэтому загружена исправная предыдущая версия. Рекомендуется сразу сделать экспорт JSON.","warning");
  }
}

function loadUiState(){
  try{
    const ui=JSON.parse(localStorage.getItem(UI_STORAGE_KEY)||"{}");
    navigationVisible=ui.navigationVisible!==false;
  }catch(error){navigationVisible=true}
  document.querySelector(".app-shell").classList.toggle("navigation-hidden",!navigationVisible);
}

function saveUiState(){
  try{localStorage.setItem(UI_STORAGE_KEY,JSON.stringify({navigationVisible}))}catch(error){}
}

Object.assign(globalThis,{storageProjectScore,parseStorageCandidate,loadDataSafe,showStorageMessage,saveData,initializeStorageNotice,loadUiState,saveUiState});
export {storageProjectScore,parseStorageCandidate,loadDataSafe,showStorageMessage,saveData,initializeStorageNotice,loadUiState,saveUiState};
