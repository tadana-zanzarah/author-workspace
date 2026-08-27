import "./constants.js";
import "./workspace-storage.js";
import "./state.js";
import "./dirty-state.js";
import "./modal-manager.js";
import "./migrations.js";
import "./multi-value-input.js";
import "./storage.js";
import "./dates.js";
import "./utils.js";
import "./relationships.js";
import "./character-links.js";
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
  profileEditorModal:createDirtyTracker("profileEditorModal",()=>serializeForm("profileEditorModal",{photos:safeOwnCopy(profileDraftPhotos),primaryPhotoId:profileDraftPrimaryPhotoId,characterLinks:safeOwnCopy(profileDraftCharacterLinks),favorites:multiValueInputs.favorites?.getValues()||[],hobbies:multiValueInputs.hobbies?.getValues()||[]})),
  characterLinkModal:createDirtyTracker("characterLinkModal",()=>serializeForm("characterLinkModal")),
  chaptersModal:createDirtyTracker("chaptersModal",()=>serializeForm("chaptersModal")),
  locationsModal:createDirtyTracker("locationsModal",()=>serializeForm("locationsModal")),
  tagsModal:createDirtyTracker("tagsModal",()=>serializeForm("tagsModal")),
  quickFieldModal:createDirtyTracker("quickFieldModal",()=>serializeForm("quickFieldModal")),
  recoveryModal:createDirtyTracker("recoveryModal",()=>serializeForm("recoveryModal"))
};
document.getElementById("continueEditing").onclick=()=>resolveDiscardConfirmation(false);
document.getElementById("discardChanges").onclick=()=>resolveDiscardConfirmation(true);

document.querySelectorAll("#profileEditorModal .profile-field").forEach((field,index)=>{
  const heading=field.querySelector(".profile-field-top > strong");if(!heading)return;
  if(!heading.id)heading.id=`profileFieldLabel${index+1}`;
  field.querySelectorAll("input:not([type=checkbox]),select,textarea").forEach(control=>{if(!control.getAttribute("aria-label")&&!control.getAttribute("aria-labelledby"))control.setAttribute("aria-labelledby",heading.id)});
});

/* Состояние отношений вычисляется из порядка сцен, поэтому после вставки
   или перетаскивания всё наследование перестраивается автоматически. */


























document.getElementById("saveQuickField").onclick=async()=>{
  if(!quickFieldState)return;
  const {sceneId,field}=quickFieldState;
  const value=document.getElementById("quickFieldSelect").value;
  if(isCloudWorkspace()){
    const current=sceneById(sceneId);if(!current)return;
    const result=field==="chapterId"
      ?await runCloudMutation("moveScene",(api,revision)=>api.moveScene(cloudProjectSync.projectId,sceneId,revision,{chapterId:value==="chapter-unassigned"?null:value,beforeSceneId:null}))
      :await runCloudMutation("updateScene",(api,revision)=>api.updateScene(cloudProjectSync.projectId,sceneId,revision,sceneToCloud({...current,[field]:value})));
    if(!result.ok)return;quickFieldState=null;trackerFor("quickFieldModal").captureInitialState();forceHideModal("quickFieldModal");return;
  }
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
document.getElementById("quickAddLocation").onclick=async()=>{
  const name=prompt("Название новой локации:");
  if(!name?.trim())return;
  if(isCloudWorkspace()){
    const result=await runCloudMutation("createLocation",(api,revision)=>api.createLocation(cloudProjectSync.projectId,revision,{name:name.trim(),description:""}),{renderAfter:false});
    if(!result.ok)return;data=cloudProjectSync.confirmedProject;populateSceneSelectors();document.getElementById("sceneLocation").value=result.data?.id||"";return;
  }
  const location={id:makeId("location"),name:name.trim(),description:""};
  const result=commitDataChange(next=>next.locations.push(location),{renderAfter:false});
  if(!result.ok)return;
  populateSceneSelectors();
  document.getElementById("sceneLocation").value=location.id;
};






document.getElementById("manageChapters").onclick=openChaptersManager;
document.getElementById("addChapter").onclick=async()=>{
  if(isCloudWorkspace()){
    const title=`Глава ${data.chapters.filter(c=>c.id!=="chapter-unassigned").length+1}`;
    const result=await runCloudMutation("createChapter",(api,revision)=>api.createChapter(cloudProjectSync.projectId,revision,{title,position:(data.chapters.length+1)*1000}));
    if(result.ok){renderChaptersManager();trackerFor("chaptersModal").captureInitialState()}return;
  }
  const names=new Map([...document.querySelectorAll(".chapter-name-input")].map(input=>[input.dataset.id,input.value.trim()]));
  const id=makeId("chapter"),title=`Глава ${data.chapters.length}`;
  const result=commitDataChange(next=>{next.chapters.forEach(c=>{if(names.get(c.id))c.title=names.get(c.id)});next.chapters.push({id,title,collapsed:false})},{renderAfter:false});
  if(result.ok){renderChaptersManager();trackerFor("chaptersModal").captureInitialState();render()}
};
async function saveChapterDraft(){
  const names=new Map([...document.querySelectorAll(".chapter-name-input")].map(input=>[input.dataset.id,input.value.trim()]));
  if(isCloudWorkspace()){
    for(const chapter of data.chapters.filter(c=>c.id!=="chapter-unassigned"))if(names.get(chapter.id)&&names.get(chapter.id)!==chapter.title){const result=await runCloudMutation("updateChapter",(api,revision)=>api.updateChapter(cloudProjectSync.projectId,chapter.id,revision,{title:names.get(chapter.id)}));if(!result.ok)return result}
    renderChaptersManager();trackerFor("chaptersModal").captureInitialState();return {ok:true};
  }
  const result=commitDataChange(next=>next.chapters.forEach(c=>{if(names.get(c.id))c.title=names.get(c.id)}),{renderAfter:false});
  if(result.ok){renderChaptersManager();trackerFor("chaptersModal").captureInitialState();render()}
  return result;
}
document.getElementById("saveChapters").onclick=saveChapterDraft;
document.getElementById("closeChapters").onclick=()=>requestCloseModal("chaptersModal","button");
document.getElementById("chaptersModal").onclick=e=>{if(e.target.id==="chaptersModal")requestCloseModal("chaptersModal","backdrop")};





document.getElementById("manageLocations").onclick=openLocationsManager;
document.getElementById("addLocation").onclick=async()=>{
  if(isCloudWorkspace()){
    const result=await runCloudMutation("createLocation",(api,revision)=>api.createLocation(cloudProjectSync.projectId,revision,{name:"Новая локация",description:""}));
    if(result.ok){renderLocationsManager();trackerFor("locationsModal").captureInitialState()}return;
  }
  const values=[...document.querySelectorAll(".location-name-input")].map(input=>({id:input.dataset.id,name:input.value.trim(),description:document.querySelector(`.location-desc-input[data-id="${cssEscape(input.dataset.id)}"]`)?.value.trim()||""}));
  const result=commitDataChange(next=>{values.forEach(v=>{const l=next.locations.find(x=>x.id===v.id);if(l&&v.name)Object.assign(l,v)});next.locations.push({id:makeId("location"),name:"Новая локация",description:""})},{renderAfter:false});
  if(result.ok){renderLocationsManager();trackerFor("locationsModal").captureInitialState();render()}
};
async function saveLocationDraft(){
  const values=[...document.querySelectorAll(".location-name-input")].map(input=>({id:input.dataset.id,name:input.value.trim(),description:document.querySelector(`.location-desc-input[data-id="${cssEscape(input.dataset.id)}"]`)?.value.trim()||""}));
  if(isCloudWorkspace()){
    for(const value of values){const old=locationById(value.id);if(old&&value.name&&(old.name!==value.name||(old.description||"")!==value.description)){const result=await runCloudMutation("updateLocation",(api,revision)=>api.updateLocation(cloudProjectSync.projectId,value.id,revision,value));if(!result.ok)return result}}
    renderLocationsManager();trackerFor("locationsModal").captureInitialState();return {ok:true};
  }
  const result=commitDataChange(next=>values.forEach(v=>{const l=next.locations.find(x=>x.id===v.id);if(l&&v.name)Object.assign(l,v)}),{renderAfter:false});
  if(result.ok){renderLocationsManager();trackerFor("locationsModal").captureInitialState();render()}
  return result;
}
document.getElementById("saveLocations").onclick=saveLocationDraft;
document.getElementById("closeLocations").onclick=()=>requestCloseModal("locationsModal","button");
document.getElementById("locationsModal").onclick=e=>{if(e.target.id==="locationsModal")requestCloseModal("locationsModal","backdrop")};





document.getElementById("manageTags").onclick=openTagsManager;
document.getElementById("addTag").onclick=async()=>{
  const name=canonicalTagName(prompt("Название тега:"));if(!name)return;
  if(isCloudWorkspace()){
    const result=await runCloudMutation("createTag",(api,revision)=>api.createTag(cloudProjectSync.projectId,revision,{name}));
    if(result.ok){renderTagsManager();trackerFor("tagsModal").captureInitialState()}return;
  }
  const result=commitDataChange(next=>{if(!next.tags.some(t=>t.name.toLocaleLowerCase("ru")===name.toLocaleLowerCase("ru")))next.tags.push({id:makeId("tag"),name})},{renderAfter:false});
  if(result.ok){renderTagsManager();trackerFor("tagsModal").captureInitialState();render()}
};
async function saveTagDraft(){
  const values=new Map([...document.querySelectorAll(".tag-name-input")].map(input=>[input.dataset.id,canonicalTagName(input.value)]));
  if(isCloudWorkspace()){
    for(const tag of data.tags)if(values.get(tag.id)&&values.get(tag.id)!==tag.name){const result=await runCloudMutation("updateTag",(api,revision)=>api.updateTag(cloudProjectSync.projectId,tag.id,revision,{name:values.get(tag.id)}));if(!result.ok)return result}
    renderTagsManager();trackerFor("tagsModal").captureInitialState();return {ok:true};
  }
  const result=commitDataChange(next=>next.tags.forEach(t=>{if(values.get(t.id))t.name=values.get(t.id)}),{renderAfter:false});
  if(result.ok){renderTagsManager();trackerFor("tagsModal").captureInitialState();render()}
  return result;
}
document.getElementById("saveTags").onclick=saveTagDraft;
document.getElementById("closeTags").onclick=()=>requestCloseModal("tagsModal","button");
document.getElementById("tagsModal").onclick=e=>{if(e.target.id==="tagsModal")requestCloseModal("tagsModal","backdrop")};






document.getElementById("saveScene").onclick=async()=>{
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

  if(isCloudWorkspace()){
    const resolvedTags=[];
    for(const tagId of scene.tags){
      if(!sceneNewTagDraft[tagId]){resolvedTags.push(tagId);continue}
      const created=await runCloudMutation("createTag",(api,revision)=>api.createTag(cloudProjectSync.projectId,revision,{name:sceneNewTagDraft[tagId]}),{renderAfter:false});
      if(!created.ok)return;resolvedTags.push(created.data?.id);
    }
    const cloudScene={...scene,tags:resolvedTags};
    const previousPosition=data.scenes[sceneIndex-1]?.position,nextPosition=data.scenes[sceneIndex]?.position;
    const createPosition=previousPosition==null?(nextPosition??1000)-1000:nextPosition==null?previousPosition+1000:(previousPosition+nextPosition)/2;
    const mutation=existingScene
      ?(api,revision)=>api.updateScene(cloudProjectSync.projectId,existingScene.id,revision,sceneToCloud(cloudScene))
      :(api,revision)=>api.createScene(cloudProjectSync.projectId,revision,sceneToCloud(cloudScene,createPosition));
    const result=await runCloudMutation(existingScene?"updateScene":"createScene",mutation,{renderAfter:false});
    if(!result.ok)return;
    const sceneId=existingScene?.id||result.data?.id;
    if(sceneId){
      const tagsResult=await runCloudMutation("setSceneTags",(api,revision)=>api.setSceneTags(cloudProjectSync.projectId,sceneId,revision,resolvedTags),{renderAfter:false});
      if(!tagsResult.ok)return;
      const participants=Object.entries(scene.people).map(([characterId,person],sortOrder)=>({projectCharacterId:characterById(characterId)?.projectCharacterId,action:person.action,legacyState:person.legacyState||null,sortOrder})).filter(item=>item.projectCharacterId);
      const participantResult=await runCloudMutation("setSceneCharacters",(_api,revision)=>cloudState.characterApi.setSceneCharacters(cloudProjectSync.projectId,sceneId,revision,participants),{renderAfter:false});
      if(!participantResult.ok)return;
      const changes=[];
      for(const [fromId,person] of Object.entries(scene.people))for(const toId of new Set([...Object.keys(person.relationChanges||{}),...(person.visibleRelations||[])])){
        const explicit=Object.prototype.hasOwnProperty.call(person.relationChanges||{},toId),value=person.relationChanges?.[toId];
        changes.push({fromProjectCharacterId:characterById(fromId)?.projectCharacterId,toProjectCharacterId:characterById(toId)?.projectCharacterId,
          valueOperation:explicit?(value?"set":"clear"):null,value:explicit&&value?value:null,visible:(person.visibleRelations||[]).includes(toId)});
      }
      const relationResult=await runCloudMutation("setSceneRelationChanges",(_api,revision)=>cloudState.characterApi.setSceneRelationChanges(cloudProjectSync.projectId,sceneId,revision,changes.filter(item=>item.fromProjectCharacterId&&item.toProjectCharacterId)),{renderAfter:false});
      if(!relationResult.ok)return;
    }
    data=cloudProjectSync.confirmedProject;trackerFor("sceneModal").captureInitialState();forceHideModal("sceneModal");render();return;
  }

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



document.getElementById("saveText").onclick=async()=>{
  const scene=sceneById(textEditingSceneId);
  if(!scene)return;
  const value=document.getElementById("fullSceneText").value;
  if(isCloudWorkspace()){
    const result=await runCloudMutation("updateScene",(api,revision)=>api.updateScene(cloudProjectSync.projectId,scene.id,revision,sceneToCloud({...scene,sceneText:value})));
    if(!result.ok)return;trackerFor("textModal").captureInitialState();forceHideModal("textModal");return;
  }
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


function openCharactersManager(){
  const menu=document.getElementById("projectMenu");menu.open=false;menu.querySelector("summary")?.focus();
  renderProfiles();
  showModal("charsModal");
}
document.getElementById("manageChars").onclick=openCharactersManager;
document.getElementById("sidebarManageChars").onclick=openCharactersManager;
document.getElementById("projectMenu").addEventListener("click",event=>{
  if(!event.target.closest("button,.file-label"))return;
  const menu=document.getElementById("projectMenu");menu.open=false;menu.querySelector("summary")?.focus();
},{capture:true});
document.getElementById("closeChars").onclick=()=>hideModal("charsModal");
document.getElementById("charsModal").onclick=e=>{if(e.target.id==="charsModal")hideModal("charsModal")};












document.getElementById("closeCharacterTimeline").onclick=()=>hideModal("characterTimelineModal");
document.getElementById("characterTimelineModal").onclick=e=>{if(e.target.id==="characterTimelineModal")hideModal("characterTimelineModal")};


document.getElementById("addChar").onclick=async()=>{
  if(!isCloudWorkspace()){const character={id:makeId("character"),name:""};profileDraftCharacter=character;editProfile(character.id);return}
  document.getElementById("characterCreateError").textContent="";document.getElementById("existingCharacterField").hidden=true;
  const result=await cloudState.characterApi.listCharacters();
  const attached=new Set(data.characters.map(item=>item.id)),available=(result.data||[]).filter(item=>!attached.has(item.id));
  document.getElementById("existingCharacterSelect").replaceChildren(...available.map(item=>{const option=document.createElement("option");option.value=item.id;option.textContent=[item.name,item.surname].filter(Boolean).join(" ")||"Без имени";return option}));
  document.getElementById("attachExistingCharacter").disabled=!available.length;showModal("characterCreateModal",{initialFocus:"#createNewCharacter"});
};
document.getElementById("cancelCharacterCreate").onclick=()=>forceHideModal("characterCreateModal");
document.getElementById("characterCreateModal").onclick=e=>{if(e.target.id==="characterCreateModal")forceHideModal("characterCreateModal")};
document.getElementById("createNewCharacter").onclick=()=>{forceHideModal("characterCreateModal");const character={id:makeId("character"),name:""};profileDraftCharacter=character;editProfile(character.id)};
document.getElementById("attachExistingCharacter").onclick=async()=>{
  const field=document.getElementById("existingCharacterField");if(field.hidden){field.hidden=false;document.getElementById("existingCharacterSelect").focus();return}
  const characterId=document.getElementById("existingCharacterSelect").value;if(!characterId)return;
  const result=await runCloudMutation("attachProjectCharacter",(_api,revision)=>cloudState.characterApi.attachProjectCharacter(cloudProjectSync.projectId,characterId,revision,{}));
  if(!result.ok){document.getElementById("characterCreateError").textContent=result.message;return}forceHideModal("characterCreateModal");data=cloudProjectSync.confirmedProject;renderProfiles();render();
};




document.getElementById("pf_birthMonth").onchange=updateZodiac;
document.getElementById("pf_birthDay").onchange=updateZodiac;





document.getElementById("profilePhotosInput").onchange=async e=>{
  const files=[...e.target.files];
  for(const file of files){
    try{const photo=await readOriginalImage(file);profileDraftPhotos.push(photo);profileDraftPrimaryPhotoId ||= photo.id}
    catch(err){alert(`Не удалось добавить изображение ${file.name}: ${err.message||"ошибка чтения"}`)}
  }
  renderProfilePhotos();
  syncBeforeUnload();
  e.target.value="";
};
document.getElementById("photoCropZoom").oninput=e=>{if(photoCropState){photoCropState.draft.zoom=Number(e.target.value);syncCropPreview()}};
document.getElementById("savePhotoCrop").onclick=savePhotoCrop;
document.getElementById("cancelPhotoCrop").onclick=cancelPhotoCrop;
document.getElementById("photoCropModal").onclick=e=>{if(e.target.id==="photoCropModal")cancelPhotoCrop()};
document.getElementById("closePhotoLightbox").onclick=()=>forceHideModal("photoLightboxModal");
document.getElementById("photoLightboxModal").onclick=e=>{if(e.target.id==="photoLightboxModal")forceHideModal("photoLightboxModal")};
{
  const viewport=document.getElementById("photoCropViewport");let pointer=null;
  viewport.onpointerdown=e=>{pointer={id:e.pointerId,x:e.clientX,y:e.clientY};viewport.setPointerCapture(e.pointerId)};
  viewport.onpointermove=e=>{if(!pointer||pointer.id!==e.pointerId||!photoCropState)return;const rect=viewport.getBoundingClientRect();nudgePhotoCrop((e.clientX-pointer.x)/rect.width,(e.clientY-pointer.y)/rect.height);pointer.x=e.clientX;pointer.y=e.clientY};
  viewport.onpointerup=viewport.onpointercancel=()=>{pointer=null};
}

document.getElementById("cancelProfile").onclick=()=>requestCloseModal("profileEditorModal","button");
document.getElementById("profileEditorModal").onclick=e=>{
  if(e.target.id==="profileEditorModal")requestCloseModal("profileEditorModal","backdrop");
};
document.getElementById("addCharacterLink").onclick=()=>openCharacterLinkEditor();
document.getElementById("cancelCharacterLink").onclick=()=>requestCloseModal("characterLinkModal","button");
document.getElementById("saveCharacterLink").onclick=saveDraftCharacterLink;
document.getElementById("characterLinkType").onchange=syncCharacterLinkCustomFields;
document.getElementById("characterLinkReverseType").onchange=syncCharacterLinkCustomFields;
document.getElementById("characterLinkModal").onclick=e=>{if(e.target.id==="characterLinkModal")requestCloseModal("characterLinkModal","backdrop")};
async function syncCloudCharacterLinks(original,draft){
  const api=cloudState.characterApi,projectId=cloudProjectSync.projectId,originalById=new Map(original.map(item=>[item.id,item])),draftById=new Map(draft.map(item=>[item.id,item]));
  for(const old of original)if(!draftById.has(old.id)){
    const result=old.scope==="global"?await api.deleteLink(old.id,{expectedLinkRevision:old.revision}):await runCloudMutation("deleteCharacterLink",(_api,revision)=>api.deleteLink(old.id,{expectedProjectRevision:revision}),{renderAfter:false});if(!result.ok)return result;
  }
  for(const link of draft){
    const old=originalById.get(link.id),cloudCategory=({marriage:"romantic",legal:"other",guardianship:"other"})[link.category]||link.category,cloudStructure=({parent_child:"biological",sibling:"biological",partnership:"chosen",guardianship:"legal"})[link.structureKind]||link.structureKind,payload={fromCharacterId:link.fromCharacterId,toCharacterId:link.toCharacterId,category:cloudCategory,type:link.type,reverseType:link.reverseType,customLabel:link.customLabel,reverseCustomLabel:link.reverseCustomLabel,notes:link.notes,structureKind:cloudStructure,metadata:{...(link.metadata||{}),uiCategory:link.category,uiStructureKind:link.structureKind}};
    let result;if(!old)result=link.scope==="global"?await api.createLink(null,null,payload):await runCloudMutation("createCharacterLink",(_api,revision)=>api.createLink(projectId,revision,payload),{renderAfter:false});
    else if(JSON.stringify({...old,id:undefined,revision:undefined})!==JSON.stringify({...link,id:undefined,revision:undefined}))result=old.scope==="global"?await api.updateLink(old.id,{expectedLinkRevision:old.revision},payload):await runCloudMutation("updateCharacterLink",(_api,revision)=>api.updateLink(old.id,{expectedProjectRevision:revision},payload),{renderAfter:false});
    if(result&&!result.ok){showStorageMessage(result.message,"error");return result}
  }
  const loaded=await cloudProjectSync.reload();if(loaded.ok)data=loaded.data;return loaded;
}
document.getElementById("saveProfile").onclick=async()=>{
  const character=characterById(profileEditingId)||profileDraftCharacter;
  if(!character)return;
  const nameInput=document.getElementById("pf_name");
  const newName=nameInput.value.trim();
  if(!newName){nameInput.setCustomValidity("Введите имя персонажа.");nameInput.reportValidity();nameInput.focus();return}
  nameInput.setCustomValidity("");
  if(!isCloudWorkspace()&&data.characters.some(c=>c.id!==character.id&&c.name.toLocaleLowerCase("ru")===newName.toLocaleLowerCase("ru"))){
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
    primaryPhotoId:profileDraftPrimaryPhotoId,
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
    favorites:multiValueInputs.favorites.getValues(),
    hobbies:multiValueInputs.hobbies.getValues(),
    character:document.getElementById("pf_character").value.trim(),
    features:document.getElementById("pf_features").value.trim(),
    description:document.getElementById("pf_description").value.trim(),
    hidden,initialRelations
  };
  if(isCloudWorkspace()){
    const api=cloudState.characterApi,projectId=cloudProjectSync.projectId;
    const profilePayload={...profile};for(const key of ["id","characterId","name","surname","photos","primaryPhotoId","initialRelations","_cloud"])delete profilePayload[key];
    let result;
    if(profileDraftCharacter){
      result=await runCloudMutation("createCharacterAndAttach",(_api,revision)=>api.createCharacterAndAttach(projectId,revision,{name:newName,surname:profile.surname,baseProfile:profilePayload},{}),{renderAfter:false});
    }else if(document.getElementById("profileSaveScope").value==="global"){
      result=await api.updateCharacter(character.id,character.characterRevision,{name:newName,surname:profile.surname,baseProfile:profilePayload});
      if(result.ok){const loaded=await cloudProjectSync.reload();if(loaded.ok)data=loaded.data}
      else showStorageMessage(result.message,"error");
    }else{
      const base=old._cloud?.baseProfile||{},previous=old._cloud?.overrides||{},overrides={...previous};
      for(const [key,value] of Object.entries(profilePayload)){if(JSON.stringify(value)===JSON.stringify(base[key]))delete overrides[key];else overrides[key]=value}
      result=await runCloudMutation("updateProjectCharacter",(_api,revision)=>api.updateProjectCharacter(projectId,character.projectCharacterId,revision,{overrides,role:character.role,sortOrder:character.sortOrder}),{renderAfter:false});
    }
    if(!result?.ok)return;
    const createdId=result.data?.character?.id,current=cloudProjectSync.confirmedProject.characters.find(item=>item.id===(createdId||character.id));
    if(current){
      const relations=[];
      for(const source of cloudProjectSync.confirmedProject.characters){
        const values=source.id===current.id?initialRelations:(cloudProjectSync.confirmedProject.profiles[source.id]?.initialRelations||{});
        for(const [targetId,value] of Object.entries(values))relations.push({fromProjectCharacterId:source.projectCharacterId,toProjectCharacterId:cloudProjectSync.confirmedProject.characters.find(item=>item.id===targetId)?.projectCharacterId,valueOperation:"set",value,visible:true});
      }
      const relResult=await runCloudMutation("setInitialRelations",(_api,revision)=>api.setInitialRelations(projectId,revision,relations.filter(item=>item.toProjectCharacterId)),{renderAfter:false});if(!relResult.ok)return;
    }
    const linkResult=await syncCloudCharacterLinks(data.characterLinks||[],profileDraftCharacterLinks);if(!linkResult?.ok)return;
    const savedProfile=cloudProjectSync.confirmedProject.profiles[createdId||character.id];if(savedProfile&&profileDraftPhotos.length){savedProfile.photos=safeOwnCopy(profileDraftPhotos);savedProfile.primaryPhotoId=profileDraftPrimaryPhotoId;cloudProjectSync.cache()}
    data=cloudProjectSync.confirmedProject;trackerFor("profileEditorModal").captureInitialState();forceHideModal("profileEditorModal");profileDraftCharacter=null;renderProfiles();render();return;
  }
  const result=commitDataChange(next=>{
    let target=next.characters.find(c=>c.id===character.id);
    if(!target){target={...character};next.characters.push(target);next.profiles ||= {}}
    target.name=newName;next.profiles[character.id]=profile;next.characterLinks=safeOwnCopy(profileDraftCharacterLinks);
  },{renderAfter:false});
  if(!result.ok)return;
  trackerFor("profileEditorModal").captureInitialState();forceHideModal("profileEditorModal");profileDraftCharacter=null;
  renderProfiles();
  render();
};





document.getElementById("allScenesBtn").onclick=openAllScenes;
document.getElementById("saveAllScenes").onclick=async()=>{
  const result=await saveAllScenes();
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
  a.download="author-workspace-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
};
document.getElementById("downloadProblemRaw").onclick=downloadProblemRaw;
document.getElementById("importInput").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  if(isCloudWorkspace()){showStorageMessage("Импорт local JSON в облачный проект пока не включён. Файл и облачные данные не изменены.","warning");e.target.value="";return}
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
        const activeKey=activeWorkspaceContext().storageKey;
        candidate.isImport=true;startupLoadInfo={ok:false,blocked:true,primary:parseStorageCandidate(activeKey),candidates:[candidate],raw:localStorage.getItem(activeKey)};
        openRecoveryModal();showStorageMessage("Импорт требует ручного решения. Текущий проект не изменён.","warning");e.target.value="";return;
      }
      const details=[...report.errors,...report.conflicts].slice(0,5).map(x=>x.message||`${x.type}: ${x.id||x.name||x.path||""}`).join("\n");
      throw new Error(`Импорт заблокирован проверкой целостности.\n${details}`);
    }
    const summary=`Проверка завершена.\nВерсия: ${report.sourceVersion} → 11\nШагов миграции: ${report.performedSteps.length}\nПредупреждений: ${report.warnings.length}\nНеизвестные поля сохраняются.\n\nПрименить импорт и заменить текущий проект?`;
    if(!confirm(summary)){showStorageMessage("Импорт отменён. Текущий проект не изменён.","warning");return}
    const saved=persistProject(report.migratedData,{key:activeWorkspaceContext().storageKey});
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
  if(isCloudWorkspace()){showStorageMessage("Полная очистка облачного проекта пока недоступна: удаляйте подтверждённые сущности отдельно.","warning");return}
  const warning="Будут безвозвратно удалены сцены, главы, персонажи, отношения, локации, теги, фотографии и весь текст. Перед очисткой рекомендуется нажать «Экспорт».\\n\\nДля продолжения введите слово УДАЛИТЬ:";
  const answer=prompt(warning);
  if(answer!=="УДАЛИТЬ")return;
  const next=defaultData();
  const saved=persistProject(next,{key:activeWorkspaceContext().storageKey});
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
await import("./cloud-app.js");
