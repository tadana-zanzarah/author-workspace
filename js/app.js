import "./constants.js";
import "./state.js";
import "./dirty-state.js";
import "./migrations.js";
import "./storage.js";
import "./dates.js";
import "./utils.js";
import "./relationships.js";
import "./scenes.js";
import "./characters.js";
import "./chapters.js";
import "./filters.js";
import "./render.js";
import "./drag-drop.js";
import "./import-export.js";

// Инициализация данных выполняется после регистрации функций миграции и хранения.
data=loadDataSafe();

const editorTrackers={
  sceneModal:createDirtyTracker("sceneModal",()=>serializeForm("sceneModal",{tags:[...sceneTagDraft],newTags:{...sceneNewTagDraft}})),
  textModal:createDirtyTracker("textModal",()=>serializeForm("textModal")),
  allScenesModal:createDirtyTracker("allScenesModal",()=>serializeForm("allScenesModal")),
  profileEditorModal:createDirtyTracker("profileEditorModal",()=>serializeForm("profileEditorModal",{photos:[...profileDraftPhotos]})),
  chaptersModal:createDirtyTracker("chaptersModal",()=>serializeForm("chaptersModal")),
  locationsModal:createDirtyTracker("locationsModal",()=>serializeForm("locationsModal")),
  tagsModal:createDirtyTracker("tagsModal",()=>serializeForm("tagsModal")),
  quickFieldModal:createDirtyTracker("quickFieldModal",()=>serializeForm("quickFieldModal")),
  recoveryModal:createDirtyTracker("recoveryModal",()=>serializeForm("recoveryModal"))
};
document.getElementById("continueEditing").onclick=()=>resolveDiscardConfirmation(false);
document.getElementById("discardChanges").onclick=()=>resolveDiscardConfirmation(true);

/* Состояние отношений вычисляется из порядка сцен, поэтому после вставки
   или перетаскивания всё наследование перестраивается автоматически. */


























document.getElementById("saveQuickField").onclick=()=>{
  if(!quickFieldState)return;
  const {sceneId,field}=quickFieldState;
  const value=document.getElementById("quickFieldSelect").value;
  const result=commitDataChange(next=>{
    const scene=next.scenes.find(item=>item.id===sceneId);if(!scene)throw new Error("scene missing");
    if(scene[field]===value)return;
    scene[field]=value;
    if(field==="chapterId"){
      scene.dateReview=true;
      const order=new Map(next.chapters.map((c,i)=>[c.id,i]));
      next.scenes.sort((a,b)=>(order.get(a.chapterId)??9999)-(order.get(b.chapterId)??9999));
    }
  },{renderAfter:false});
  if(!result.ok)return;
  quickFieldState=null;
  trackerFor("quickFieldModal").captureInitialState();forceHideModal("quickFieldModal");
  render();
};
document.getElementById("cancelQuickField").onclick=async()=>{
  if(await requestCloseModal("quickFieldModal","button"))quickFieldState=null;
};
document.getElementById("quickFieldModal").onclick=async event=>{
  if(event.target.id==="quickFieldModal"){
    if(await requestCloseModal("quickFieldModal","backdrop"))quickFieldState=null;
  }
};




["Chapter","Character","Location","Tag","Writing","Placement"].forEach(key=>{
  const el=document.getElementById("filter"+key);
  el.onchange=()=>{filters[key.toLowerCase()]=el.value;render()};
});

document.getElementById("projectSearch").oninput=e=>{
  filters.search=e.target.value;
  clearTimeout(searchTimer);
  searchTimer=setTimeout(render,120);
};
document.getElementById("clearFilters").onclick=()=>{Object.keys(filters).forEach(k=>filters[k]="");render()};


document.getElementById("toggleNavigation").onclick=()=>{
  navigationVisible=!navigationVisible;
  document.querySelector(".app-shell").classList.toggle("navigation-hidden",!navigationVisible);
  saveUiState();
};
document.getElementById("openInspector").onclick=()=>{
  renderSceneInfo();
  showModal("inspectorModal");
  document.getElementById("projectMenu").open=false;
};
document.getElementById("closeInspector").onclick=()=>hideModal("inspectorModal");
document.getElementById("inspectorModal").onclick=e=>{if(e.target.id==="inspectorModal")hideModal("inspectorModal")};

document.querySelectorAll("#viewSwitch button").forEach(btn=>btn.onclick=()=>{currentView=btn.dataset.view;render()});





























document.getElementById("addSceneTag").onclick=addTagToDraft;
document.getElementById("sceneTagInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addTagToDraft()}};
document.getElementById("quickAddLocation").onclick=()=>{
  const name=prompt("Название новой локации:");
  if(!name?.trim())return;
  const location={id:makeId("location"),name:name.trim(),description:""};
  const result=commitDataChange(next=>next.locations.push(location),{renderAfter:false});
  if(!result.ok)return;
  populateSceneSelectors();
  document.getElementById("sceneLocation").value=location.id;
};






document.getElementById("manageChapters").onclick=openChaptersManager;
document.getElementById("addChapter").onclick=()=>{
  const names=new Map([...document.querySelectorAll(".chapter-name-input")].map(input=>[input.dataset.id,input.value.trim()]));
  const id=makeId("chapter"),title=`Глава ${data.chapters.length}`;
  const result=commitDataChange(next=>{next.chapters.forEach(c=>{if(names.get(c.id))c.title=names.get(c.id)});next.chapters.push({id,title,collapsed:false})},{renderAfter:false});
  if(result.ok){renderChaptersManager();trackerFor("chaptersModal").captureInitialState();render()}
};
function saveChapterDraft(){
  const names=new Map([...document.querySelectorAll(".chapter-name-input")].map(input=>[input.dataset.id,input.value.trim()]));
  const result=commitDataChange(next=>next.chapters.forEach(c=>{if(names.get(c.id))c.title=names.get(c.id)}),{renderAfter:false});
  if(result.ok){renderChaptersManager();trackerFor("chaptersModal").captureInitialState();render()}
  return result;
}
document.getElementById("saveChapters").onclick=saveChapterDraft;
document.getElementById("closeChapters").onclick=()=>requestCloseModal("chaptersModal","button");
document.getElementById("chaptersModal").onclick=e=>{if(e.target.id==="chaptersModal")requestCloseModal("chaptersModal","backdrop")};





document.getElementById("manageLocations").onclick=openLocationsManager;
document.getElementById("addLocation").onclick=()=>{
  const values=[...document.querySelectorAll(".location-name-input")].map(input=>({id:input.dataset.id,name:input.value.trim(),description:document.querySelector(`.location-desc-input[data-id="${cssEscape(input.dataset.id)}"]`)?.value.trim()||""}));
  const result=commitDataChange(next=>{values.forEach(v=>{const l=next.locations.find(x=>x.id===v.id);if(l&&v.name)Object.assign(l,v)});next.locations.push({id:makeId("location"),name:"Новая локация",description:""})},{renderAfter:false});
  if(result.ok){renderLocationsManager();trackerFor("locationsModal").captureInitialState();render()}
};
function saveLocationDraft(){
  const values=[...document.querySelectorAll(".location-name-input")].map(input=>({id:input.dataset.id,name:input.value.trim(),description:document.querySelector(`.location-desc-input[data-id="${cssEscape(input.dataset.id)}"]`)?.value.trim()||""}));
  const result=commitDataChange(next=>values.forEach(v=>{const l=next.locations.find(x=>x.id===v.id);if(l&&v.name)Object.assign(l,v)}),{renderAfter:false});
  if(result.ok){renderLocationsManager();trackerFor("locationsModal").captureInitialState();render()}
  return result;
}
document.getElementById("saveLocations").onclick=saveLocationDraft;
document.getElementById("closeLocations").onclick=()=>requestCloseModal("locationsModal","button");
document.getElementById("locationsModal").onclick=e=>{if(e.target.id==="locationsModal")requestCloseModal("locationsModal","backdrop")};





document.getElementById("manageTags").onclick=openTagsManager;
document.getElementById("addTag").onclick=()=>{
  const name=canonicalTagName(prompt("Название тега:"));if(!name)return;
  const result=commitDataChange(next=>{if(!next.tags.some(t=>t.name.toLocaleLowerCase("ru")===name.toLocaleLowerCase("ru")))next.tags.push({id:makeId("tag"),name})},{renderAfter:false});
  if(result.ok){renderTagsManager();trackerFor("tagsModal").captureInitialState();render()}
};
function saveTagDraft(){
  const values=new Map([...document.querySelectorAll(".tag-name-input")].map(input=>[input.dataset.id,canonicalTagName(input.value)]));
  const result=commitDataChange(next=>next.tags.forEach(t=>{if(values.get(t.id))t.name=values.get(t.id)}),{renderAfter:false});
  if(result.ok){renderTagsManager();trackerFor("tagsModal").captureInitialState();render()}
  return result;
}
document.getElementById("saveTags").onclick=saveTagDraft;
document.getElementById("closeTags").onclick=()=>requestCloseModal("tagsModal","button");
document.getElementById("tagsModal").onclick=e=>{if(e.target.id==="tagsModal")requestCloseModal("tagsModal","backdrop")};






document.getElementById("saveScene").onclick=()=>{
  const existingScene=editingSceneId?sceneById(editingSceneId):null;
  const targetIndex=existingScene
    ?sceneIndexById(existingScene.id)
    :(insertBeforeSceneId?sceneIndexById(insertBeforeSceneId):data.scenes.length);
  const sceneIndex=targetIndex<0?data.scenes.length:targetIndex;
  const inherited=relationshipsBefore(sceneIndex);
  const enteredDate=document.getElementById("sceneDate").value,enteredTime=document.getElementById("sceneTime").value;
  const sceneDate=existingScene?.date&&!validateDateString(existingScene.date)&&enteredDate===""?existingScene.date:enteredDate;
  const sceneTime=existingScene?.time&&!validateTimeString(existingScene.time)&&enteredTime===""?existingScene.time:enteredTime;
  const scene={
    id:existingScene?.id||makeId("scene"),
    date:sceneDate,
    time:sceneTime,
    title:document.getElementById("sceneTitle").value.trim(),
    chapterId:document.getElementById("sceneChapter").value||"chapter-unassigned",
    locationId:document.getElementById("sceneLocation").value||"",
    tags:[...sceneTagDraft],
    writingStatus:document.getElementById("sceneWritingStatus").value||"idea",
    sceneText:document.getElementById("sceneText").value,
    included:document.getElementById("sceneIncluded").checked,
    status:document.getElementById("sceneStatus").value,
    dateReview:existingScene?((existingScene.date||"")!==sceneDate||(existingScene.time||"")!==sceneTime||(existingScene.chapterId||"chapter-unassigned")!==(document.getElementById("sceneChapter").value||"chapter-unassigned")?true:!!existingScene.dateReview):!!(sceneDate||sceneTime),
    people:{}
  };

  data.characters.forEach(character=>{
    const charId=character.id;
    const action=document.querySelector(`.p-action[data-char-id="${cssEscape(charId)}"]`).value.trim();
    const legacyEl=document.querySelector(`.p-legacy[data-char-id="${cssEscape(charId)}"]`);
    const legacyState=legacyEl?legacyEl.value.trim():"";
    const relationChanges={};
    const visibleRelations=[];

    document.querySelectorAll(`.rel-value[data-char-id="${cssEscape(charId)}"]`).forEach(input=>{
      const target=input.dataset.targetId;
      const value=input.value.trim();
      // relationChanges теперь означает не "разницу с текущим соседом",
      // а явное решение автора в этой конкретной сцене.
      if(input.dataset.explicit==="true")relationChanges[target]=value;
    });
    document.querySelectorAll(`.rel-visible[data-char-id="${cssEscape(charId)}"]:checked`).forEach(cb=>{
      const target=cb.dataset.targetId;
      const input=document.querySelector(`.rel-value[data-char-id="${cssEscape(charId)}"][data-target-id="${cssEscape(target)}"]`);
      if(input&&input.value.trim())visibleRelations.push(target);
    });

    if(action||legacyState||Object.keys(relationChanges).length||visibleRelations.length){
      scene.people[charId]={action,relationChanges,visibleRelations,legacyState};
    }
  });

  const result=commitDataChange(next=>{
    for(const [id,name] of Object.entries(sceneNewTagDraft))if(scene.tags.includes(id)&&!next.tags.some(tag=>tag.id===id))next.tags.push({id,name});
    if(existingScene){
      const existingIndex=next.scenes.findIndex(item=>item.id===existingScene.id);
      if(existingIndex<0)throw new Error("scene missing");
      next.scenes[existingIndex]=scene;
    }else{
      const insertionIndex=insertBeforeSceneId?next.scenes.findIndex(item=>item.id===insertBeforeSceneId):next.scenes.length;
      next.scenes.splice(insertionIndex<0?next.scenes.length:insertionIndex,0,scene);
    }
    const order=new Map(next.chapters.map((c,i)=>[c.id,i]));
    next.scenes=next.scenes.map((item,i)=>({item,i})).sort((a,b)=>(order.get(a.item.chapterId)??9999)-(order.get(b.item.chapterId)??9999)||a.i-b.i).map(x=>x.item);
  },{renderAfter:false});
  if(!result.ok)return;
  trackerFor("sceneModal").captureInitialState();forceHideModal("sceneModal");render();
};



document.getElementById("saveText").onclick=()=>{
  const scene=sceneById(textEditingSceneId);
  if(!scene)return;
  const value=document.getElementById("fullSceneText").value;
  const result=commitDataChange(next=>{next.scenes.find(s=>s.id===textEditingSceneId).sceneText=value},{renderAfter:false});
  if(!result.ok)return;
  trackerFor("textModal").captureInitialState();forceHideModal("textModal");
};
document.getElementById("closeText").onclick=()=>requestCloseModal("textModal","button");
document.getElementById("textModal").onclick=e=>{if(e.target.id==="textModal")requestCloseModal("textModal","backdrop")};







/* Перетаскивание сцен */













document.getElementById("sortScenesList").addEventListener("dragstart",sortDragStart);
document.getElementById("sortScenesList").addEventListener("dragover",sortDragOver);
document.getElementById("sortScenesList").addEventListener("dragleave",event=>{
  const row=event.target.closest("[data-sort-scene-id]");
  if(row)row.classList.remove("drop-before","drop-after");
});
document.getElementById("sortScenesList").addEventListener("drop",sortDrop);
document.getElementById("sortScenesList").addEventListener("dragend",sortDragEnd);
document.getElementById("openSortScenes").onclick=openSortScenes;
document.getElementById("closeSortScenes").onclick=()=>hideModal("sortScenesModal");
document.getElementById("sortScenesModal").onclick=event=>{
  if(event.target.id==="sortScenesModal")hideModal("sortScenesModal");
};




document.getElementById("board").addEventListener("click",event=>{
  const button=event.target.closest('[data-action="insert-scene"]');
  if(!button)return;
  event.stopPropagation();
  openNewSceneAt(button.dataset.beforeSceneId||null,button.dataset.chapterId||"");
});
document.getElementById("addFirst").onclick=()=>openNewSceneAt(null,filters.chapter||data.chapters[0]?.id||"chapter-unassigned");
document.getElementById("cancelScene").onclick=()=>requestCloseModal("sceneModal","button");
document.getElementById("sceneModal").onclick=e=>{if(e.target.id==="sceneModal")requestCloseModal("sceneModal","backdrop")};


document.getElementById("manageChars").onclick=()=>{
  renderProfiles();
  showModal("charsModal");
};
document.getElementById("closeChars").onclick=()=>hideModal("charsModal");
document.getElementById("charsModal").onclick=e=>{if(e.target.id==="charsModal")hideModal("charsModal")};












document.getElementById("closeCharacterTimeline").onclick=()=>hideModal("characterTimelineModal");
document.getElementById("characterTimelineModal").onclick=e=>{if(e.target.id==="characterTimelineModal")hideModal("characterTimelineModal")};


document.getElementById("addChar").onclick=()=>{
  let base="Новый персонаж",name=base,n=2;
  while(data.characters.some(c=>c.name===name))name=`${base} ${n++}`;
  const character={id:makeId("character"),name};
  profileDraftCharacter=character;
  editProfile(character.id);
};




document.getElementById("pf_birthMonth").onchange=updateZodiac;
document.getElementById("pf_birthDay").onchange=updateZodiac;





document.getElementById("profilePhotosInput").onchange=async e=>{
  const files=[...e.target.files];
  for(const file of files){
    try{profileDraftPhotos.push(await compressImage(file))}
    catch(err){alert(`Не удалось добавить изображение ${file.name}`)}
  }
  renderProfilePhotos();
  syncBeforeUnload();
  e.target.value="";
};

document.getElementById("cancelProfile").onclick=()=>requestCloseModal("profileEditorModal","button");
document.getElementById("profileEditorModal").onclick=e=>{
  if(e.target.id==="profileEditorModal")requestCloseModal("profileEditorModal","backdrop");
};
document.getElementById("saveProfile").onclick=()=>{
  const character=characterById(profileEditingId)||profileDraftCharacter;
  if(!character)return;
  const newName=document.getElementById("pf_name").value.trim()||character.name;
  if(data.characters.some(c=>c.id!==character.id&&c.name.toLocaleLowerCase("ru")===newName.toLocaleLowerCase("ru"))){
    alert("Персонаж с таким именем уже существует.");
    return;
  }
  const old=normalizeProfile(data.profiles?.[character.id],character);
  const hidden={};
  ["race","sex","secondarySex","age","birthday","zodiac","height","build","profession",
   "orientation","favorites","hobbies","character","features","description"].forEach(key=>{
    hidden[key]=document.getElementById("hide_"+key).checked;
  });
  const initialRelations={};
  document.querySelectorAll(".initial-rel-input").forEach(input=>{
    const value=input.value.trim();
    if(value)initialRelations[input.dataset.targetId]=value;
  });
  const profile={
    ...old,
    id:character.id,
    characterId:character.id,
    name:newName,
    surname:document.getElementById("pf_surname").value.trim(),
    photos:[...profileDraftPhotos],
    race:document.getElementById("pf_race").value.trim(),
    sex:document.getElementById("pf_sex").value,
    secondarySex:document.getElementById("pf_secondarySex").value.trim(),
    age:document.getElementById("pf_age").value,
    birthday:{
      year:document.getElementById("pf_birthYear").value,
      month:document.getElementById("pf_birthMonth").value,
      day:document.getElementById("pf_birthDay").value
    },
    zodiac:document.getElementById("pf_zodiac").value,
    height:document.getElementById("pf_height").value.trim(),
    build:document.getElementById("pf_build").value.trim(),
    profession:document.getElementById("pf_profession").value.trim(),
    orientation:document.getElementById("pf_orientation").value.trim(),
    favorites:document.getElementById("pf_favorites").value.trim(),
    hobbies:document.getElementById("pf_hobbies").value.trim(),
    character:document.getElementById("pf_character").value.trim(),
    features:document.getElementById("pf_features").value.trim(),
    description:document.getElementById("pf_description").value.trim(),
    hidden,initialRelations
  };
  const result=commitDataChange(next=>{
    let target=next.characters.find(c=>c.id===character.id);
    if(!target){target={...character};next.characters.push(target);next.profiles ||= {}}
    target.name=newName;next.profiles[character.id]=profile;
  },{renderAfter:false});
  if(!result.ok)return;
  trackerFor("profileEditorModal").captureInitialState();forceHideModal("profileEditorModal");profileDraftCharacter=null;
  renderProfiles();
  render();
};





document.getElementById("allScenesBtn").onclick=openAllScenes;
document.getElementById("saveAllScenes").onclick=()=>{
  const result=saveAllScenes();
  if(result?.ok){trackerFor("allScenesModal").captureInitialState();forceHideModal("allScenesModal")}
};
document.getElementById("closeAllScenes").onclick=()=>requestCloseModal("allScenesModal","button");
document.getElementById("allScenesModal").onclick=e=>{
  if(e.target.id==="allScenesModal")requestCloseModal("allScenesModal","backdrop");
};



document.getElementById("exportTextBtn").onclick=exportWholeText;

document.getElementById("exportBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="author-workspace-backup-v11-stage3.json";
  a.click();
  URL.revokeObjectURL(a.href);
};
document.getElementById("downloadProblemRaw").onclick=downloadProblemRaw;
document.getElementById("importInput").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  const visible=[...dirtyTrackers.values()].find(tracker=>tracker.active&&document.getElementById(tracker.id)?.style.display==="flex");
  if(visible&&!(await requestCloseModal(visible.id,"import"))){e.target.value="";return}
  try{
    const parsed=parseProjectJson(await file.text());
    if(!parsed.ok)throw new Error(parsed.error.message);
    const report=prepareProject(parsed.value);
    if(!report.canApply){
      const resolvable=report.errors.length===0&&report.conflicts.length>0&&report.conflicts.every(item=>item.type==="ambiguous-character-name"||item.resolution==="confirmation");
      if(resolvable){
        const raw=await file.text(),candidate=parseStorageCandidate(`Импорт: ${file.name}`,{getItem:()=>raw});
        candidate.isImport=true;startupLoadInfo={ok:false,blocked:true,primary:parseStorageCandidate(STORAGE_KEY),candidates:[candidate],raw:localStorage.getItem(STORAGE_KEY)};
        openRecoveryModal();showStorageMessage("Импорт требует ручного решения. Текущий проект не изменён.","warning");e.target.value="";return;
      }
      const details=[...report.errors,...report.conflicts].slice(0,5).map(x=>x.message||`${x.type}: ${x.id||x.name||x.path||""}`).join("\n");
      throw new Error(`Импорт заблокирован проверкой целостности.\n${details}`);
    }
    const summary=`Проверка завершена.\nВерсия: ${report.sourceVersion} → 11\nШагов миграции: ${report.performedSteps.length}\nПредупреждений: ${report.warnings.length}\nНеизвестные поля сохраняются.\n\nПрименить импорт и заменить текущий проект?`;
    if(!confirm(summary)){showStorageMessage("Импорт отменён. Текущий проект не изменён.","warning");return}
    const saved=persistProject(report.migratedData);
    if(!saved.ok)throw new Error(saved.userMessage);
    data=report.migratedData;storageWriteEnabled=true;
    selectedSceneId=null;selectedSceneIndex=null;
    render();
    showStorageMessage(`Импорт завершён после предварительной проверки. Предупреждений: ${report.warnings.length}.`,"warning");
  }catch(error){
    showStorageMessage(error.message||"Не удалось импортировать файл. Текущий проект не был изменён.","error");
  }
  e.target.value="";
};
document.getElementById("clearBtn").onclick=()=>{
  const warning="Будут безвозвратно удалены сцены, главы, персонажи, отношения, локации, теги, фотографии и весь текст. Перед очисткой рекомендуется нажать «Экспорт».\\n\\nДля продолжения введите слово УДАЛИТЬ:";
  const answer=prompt(warning);
  if(answer!=="УДАЛИТЬ")return;
  const next=defaultData();
  const saved=persistProject(next);
  if(!saved.ok){showStorageMessage(saved.userMessage,"error");return}
  data=next;
  selectedSceneId=null;
  selectedSceneIndex=null;
  storageWriteEnabled=true;
  normalizeSceneOrder();
  render();
};

normalizeSceneOrder();
loadUiState();
if(startupLoadInfo?.fresh){
  saveData();
}
render();
initializeStorageNotice();
document.getElementById("downloadProblemRaw").hidden=!startupLoadInfo?.blocked;
document.getElementById("openRecovery").hidden=!startupLoadInfo?.blocked;
document.getElementById("openRecovery").onclick=openRecoveryModal;
initializeRecoveryUi();
