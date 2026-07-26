import "./constants.js";
import "./state.js";
import "./migrations.js";
import "./storage.js";
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

/* Состояние отношений вычисляется из порядка сцен, поэтому после вставки
   или перетаскивания всё наследование перестраивается автоматически. */


























document.getElementById("saveQuickField").onclick=()=>{
  if(!quickFieldState)return;
  const scene=sceneById(quickFieldState.sceneId);
  if(!scene)return hideModal("quickFieldModal");
  scene[quickFieldState.field]=document.getElementById("quickFieldSelect").value;
  if(quickFieldState.field==="chapterId")normalizeSceneOrder();
  saveData();
  quickFieldState=null;
  hideModal("quickFieldModal");
  render();
};
document.getElementById("cancelQuickField").onclick=()=>{
  quickFieldState=null;hideModal("quickFieldModal");
};
document.getElementById("quickFieldModal").onclick=event=>{
  if(event.target.id==="quickFieldModal"){
    quickFieldState=null;hideModal("quickFieldModal");
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
  data.locations.push(location);saveData();populateSceneSelectors();
  document.getElementById("sceneLocation").value=location.id;
};






document.getElementById("manageChapters").onclick=openChaptersManager;
document.getElementById("addChapter").onclick=()=>{
  saveChapterNames();data.chapters.push({id:makeId("chapter"),title:`Глава ${data.chapters.length}`,collapsed:false});
  saveData();renderChaptersManager();render();
};
document.getElementById("closeChapters").onclick=()=>{saveChapterNames();saveData();hideModal("chaptersModal");render()};
document.getElementById("chaptersModal").onclick=e=>{if(e.target.id==="chaptersModal"){saveChapterNames();saveData();hideModal("chaptersModal");render()}};





document.getElementById("manageLocations").onclick=openLocationsManager;
document.getElementById("addLocation").onclick=()=>{
  saveLocations();data.locations.push({id:makeId("location"),name:"Новая локация",description:""});
  saveData();renderLocationsManager();render();
};
document.getElementById("closeLocations").onclick=()=>{saveLocations();saveData();hideModal("locationsModal");render()};
document.getElementById("locationsModal").onclick=e=>{if(e.target.id==="locationsModal"){saveLocations();saveData();hideModal("locationsModal");render()}};





document.getElementById("manageTags").onclick=openTagsManager;
document.getElementById("addTag").onclick=()=>{
  const name=prompt("Название тега:");if(!name?.trim())return;ensureTag(name);saveData();renderTagsManager();render();
};
document.getElementById("closeTags").onclick=()=>{saveTags();saveData();hideModal("tagsModal");render()};
document.getElementById("tagsModal").onclick=e=>{if(e.target.id==="tagsModal"){saveTags();saveData();hideModal("tagsModal");render()}};






document.getElementById("saveScene").onclick=()=>{
  const existingScene=editingSceneId?sceneById(editingSceneId):null;
  const targetIndex=existingScene
    ?sceneIndexById(existingScene.id)
    :(insertBeforeSceneId?sceneIndexById(insertBeforeSceneId):data.scenes.length);
  const sceneIndex=targetIndex<0?data.scenes.length:targetIndex;
  const inherited=relationshipsBefore(sceneIndex);
  const scene={
    id:existingScene?.id||makeId("scene"),
    date:document.getElementById("sceneDate").value,
    time:document.getElementById("sceneTime").value,
    title:document.getElementById("sceneTitle").value.trim(),
    chapterId:document.getElementById("sceneChapter").value||"chapter-unassigned",
    locationId:document.getElementById("sceneLocation").value||"",
    tags:[...sceneTagDraft],
    writingStatus:document.getElementById("sceneWritingStatus").value||"idea",
    sceneText:document.getElementById("sceneText").value,
    included:document.getElementById("sceneIncluded").checked,
    status:document.getElementById("sceneStatus").value,
    dateReview:existingScene?.dateReview||false,
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

  if(existingScene){
    const existingIndex=sceneIndexById(existingScene.id);
    if(existingIndex>=0)data.scenes[existingIndex]=scene;
  }else{
    const insertionIndex=insertBeforeSceneId?sceneIndexById(insertBeforeSceneId):data.scenes.length;
    data.scenes.splice(insertionIndex<0?data.scenes.length:insertionIndex,0,scene);
  }

  normalizeSceneOrder();saveData();hideModal("sceneModal");render();
};



document.getElementById("saveText").onclick=()=>{
  const scene=sceneById(textEditingSceneId);
  if(!scene)return;
  scene.sceneText=document.getElementById("fullSceneText").value;
  saveData();
  hideModal("textModal");
};
document.getElementById("closeText").onclick=()=>hideModal("textModal");
document.getElementById("textModal").onclick=e=>{if(e.target.id==="textModal")hideModal("textModal")};







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
document.getElementById("cancelScene").onclick=()=>hideModal("sceneModal");
document.getElementById("sceneModal").onclick=e=>{if(e.target.id==="sceneModal")hideModal("sceneModal")};


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
  data.characters.push(character);
  data.profiles ||= {};
  data.profiles[character.id]=emptyProfile(character.id,name);
  saveData();
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
  e.target.value="";
};

document.getElementById("cancelProfile").onclick=()=>hideModal("profileEditorModal");
document.getElementById("profileEditorModal").onclick=e=>{
  if(e.target.id==="profileEditorModal")hideModal("profileEditorModal");
};
document.getElementById("saveProfile").onclick=()=>{
  const character=characterById(profileEditingId);
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
  character.name=newName;
  data.profiles[character.id]=profile;
  saveData();
  hideModal("profileEditorModal");
  renderProfiles();
  render();
};





document.getElementById("allScenesBtn").onclick=openAllScenes;
document.getElementById("saveAllScenes").onclick=()=>{
  saveAllScenes();
  hideModal("allScenesModal");
};
document.getElementById("closeAllScenes").onclick=()=>{
  if(confirm("Закрыть окно? Несохранённые изменения в текстах будут потеряны.")){
    hideModal("allScenesModal");
  }
};
document.getElementById("allScenesModal").onclick=e=>{
  if(e.target.id==="allScenesModal"&&confirm("Закрыть окно? Несохранённые изменения в текстах будут потеряны.")){
    hideModal("allScenesModal");
  }
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
document.getElementById("importInput").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    const imported=normalizeData(parsed);
    const previous=data;
    data=imported;
    storageWriteEnabled=true;
    normalizeSceneOrder();
    if(!saveData()){
      data=previous;
      throw new Error("Не удалось сохранить импортированный проект");
    }
    selectedSceneId=null;selectedSceneIndex=null;
    render();
    showStorageMessage("Импорт завершён. Данные сохранены в формате V11.","warning");
  }catch(error){
    showStorageMessage("Не удалось импортировать файл. Текущий проект не был изменён.","error");
  }
  e.target.value="";
};
document.getElementById("clearBtn").onclick=()=>{
  const warning="Будут безвозвратно удалены сцены, главы, персонажи, отношения, локации, теги, фотографии и весь текст. Перед очисткой рекомендуется нажать «Экспорт».\\n\\nДля продолжения введите слово УДАЛИТЬ:";
  const answer=prompt(warning);
  if(answer!=="УДАЛИТЬ")return;
  data=defaultData();
  selectedSceneId=null;
  selectedSceneIndex=null;
  storageWriteEnabled=true;
  normalizeSceneOrder();
  saveData();
  render();
};

normalizeSceneOrder();
loadUiState();
if(!startupLoadInfo?.fatal){
  saveData();
}
render();
initializeStorageNotice();
