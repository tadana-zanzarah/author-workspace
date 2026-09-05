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
import "./location-types.js";
import "./location-base-profile.js";
import "./location-module-selection.js";
import "./location-media.js";
import "./location-hierarchy.js";
import "./locations.js";
import "./filters.js";
import "./filter-controls.js";
import "./scene-positions.js";
import "./render.js";
import "./matrix-sticky.js";
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
  // aliases/notableFeatures/naturalFeatures (multi-value comboboxes clear their own <input> on
  // every add, so their real value never shows up in serializeForm's plain input.value scan) and
  // parentId (a custom picker, not a native form control) are passed as explicit extra state,
  // same pattern as profileEditorModal's favorites/hobbies/photos above. The B3A thematic
  // textareas/inputs themselves (visualDescription, terrain, coordinates, ...) need no such
  // treatment -- they are plain native controls inside #locationProfileModal, picked up by
  // serializeForm's own querySelectorAll scan even while their disclosure section is hidden
  // (collapsing a section only toggles the `hidden` attribute, it never removes the elements).
  locationProfileModal:createDirtyTracker("locationProfileModal",()=>serializeForm("locationProfileModal",{
    aliases:multiValueInputs.locationAliases?.getValues()||[],
    parentId:currentLocationProfileParentSelection(),
    notableFeatures:multiValueInputs.locationNotableFeatures?.getValues()||[],
    naturalFeatures:multiValueInputs.locationNaturalFeatures?.getValues()||[],
    // B3B (governmentSociety/economy) chip fields -- same reasoning as notableFeatures/
    // naturalFeatures above: each multi-value combobox clears its own <input> on every add, so
    // serializeForm's plain input.value scan never sees the real chip list. These five were
    // missed when B3B shipped (corrective fix, found while wiring B3C's own chip fields in below).
    securityForces:multiValueInputs.locationSecurityForces?.getValues()||[],
    notableInstitutions:multiValueInputs.locationNotableInstitutions?.getValues()||[],
    industries:multiValueInputs.locationIndustries?.getValues()||[],
    scarcity:multiValueInputs.locationScarcity?.getValues()||[],
    tradeConnections:multiValueInputs.locationTradeConnections?.getValues()||[],
    // B3C (populationCulture) chip fields -- same reasoning as notableFeatures/naturalFeatures
    // above: each multi-value combobox clears its own <input> on every add, so serializeForm's
    // plain input.value scan never sees the real chip list.
    peoplesAndGroups:multiValueInputs.locationPeoplesAndGroups?.getValues()||[],
    languages:multiValueInputs.locationLanguages?.getValues()||[],
    holidays:multiValueInputs.locationHolidays?.getValues()||[],
    beliefs:multiValueInputs.locationBeliefs?.getValues()||[],
    // Adaptive Module Selection: add/show/hide/remove change locationProfileModuleSelectionDraft
    // without necessarily touching any native control serializeForm's own scan would see (e.g.
    // hiding a populated module changes nothing else) -- without this, Save would stay disabled.
    moduleSelection:currentLocationProfileModuleSelectionSnapshot(),
    // Location Media B4B: the whole media draft is custom state (add/primary/reorder/delete/crop
    // are button actions, never native form controls; caption/alt ARE native controls but are
    // pushed directly into the draft on every keystroke rather than left for serializeForm's own
    // scan -- see js/locations.js's Media section header for why a full-card-list re-render on
    // unrelated actions makes the pull-based pattern the thematic textareas use unsafe here).
    media:currentLocationProfileMediaSnapshot()
  })),
  tagsModal:createDirtyTracker("tagsModal",()=>serializeForm("tagsModal")),
  quickFieldModal:createDirtyTracker("quickFieldModal",()=>serializeForm("quickFieldModal")),
  recoveryModal:createDirtyTracker("recoveryModal",()=>serializeForm("recoveryModal"))
};
let characterSaveInFlight=false;
const profileSaveButton=createSaveButtonController("saveProfile","profileEditorModal");
globalThis.profileSaveButton=profileSaveButton;
document.getElementById("continueEditing").onclick=()=>resolveDiscardConfirmation(false);
document.getElementById("discardChanges").onclick=()=>resolveDiscardConfirmation(true);
document.getElementById("confirmActionCancel").onclick=()=>resolveConfirmAction(false);
document.getElementById("confirmActionConfirm").onclick=()=>resolveConfirmAction(true);
document.getElementById("confirmActionModal").onclick=e=>{if(e.target.id==="confirmActionModal")resolveConfirmAction(false)};

document.querySelectorAll('input[name="profileSaveScope"]').forEach(radio=>radio.addEventListener("change",updateProfileScopeHelp));

document.querySelectorAll("#profileEditorModal .profile-field").forEach((field,index)=>{
  const top=field.querySelector(".profile-field-top");
  const heading=top?.querySelector(":scope > strong");if(!heading)return;
  if(!heading.id)heading.id=`profileFieldLabel${index+1}`;
  // A visible (non aria-hidden) sublabel sibling (see .profile-field-sublabel,
  // e.g. "на начало истории" under "Возраст") is part of the field's real
  // label, just laid out on its own grid row instead of nested inside
  // <strong> — reference both ids so the accessible name still reads
  // "Возраст на начало истории", matching the pre-restructure markup.
  const sublabel=top.querySelector(":scope > .profile-field-sublabel:not([aria-hidden])");
  if(sublabel&&!sublabel.id)sublabel.id=`profileFieldSublabel${index+1}`;
  const labelledBy=sublabel?`${heading.id} ${sublabel.id}`:heading.id;
  field.querySelectorAll("input:not([type=checkbox]),select,textarea").forEach(control=>{if(!control.getAttribute("aria-label")&&!control.getAttribute("aria-labelledby"))control.setAttribute("aria-labelledby",labelledBy)});
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




initFilterControls();

document.getElementById("projectSearch").oninput=e=>{
  filters.search=e.target.value;
  clearTimeout(searchTimer);
  searchTimer=setTimeout(render,120);
};
document.getElementById("clearFilters").onclick=()=>{
  closeFilterPopover({restoreFocus:false});
  Object.keys(filters).forEach(k=>{filters[k]=isMultiFilterKey(k)?[]:""});
  render();
};

function toggleNavigationVisible(){
  navigationVisible=!navigationVisible;
  document.querySelector(".app-shell").classList.toggle("navigation-hidden",!navigationVisible);
  syncSidebarEdgeToggle();
  saveUiState();
  scheduleMatrixStickyUpdate();
}
document.getElementById("toggleNavigation").onclick=toggleNavigationVisible;
document.getElementById("toggleNavigationReopen").onclick=toggleNavigationVisible;

// The N+1 insertion "+" (table view) centers on the scroll viewport's visible
// bounds — see updateInsertionCenter in render.js. Recompute on scroll/resize
// of that viewport, and on any resize that changes its width without a window
// resize event (e.g. the sidebar collapsing/expanding).
{
  const insertionViewport=document.querySelector(".viewport.workspace-viewport");
  if(insertionViewport){
    insertionViewport.addEventListener("scroll",updateInsertionCenter,{passive:true});
    window.addEventListener("resize",updateInsertionCenter);
    new ResizeObserver(updateInsertionCenter).observe(insertionViewport);
  }
}

// Two-row sticky matrix header + bottom horizontal scroll rail (table view) —
// see js/matrix-sticky.js. Recomputed on page scroll (vertical pin threshold
// and horizontal-rail visibility both depend on where .viewport currently sits
// relative to the header), on horizontal scroll of the matrix itself (keeps
// the pinned character row and the rail in sync with it), and on resize
// (.viewport's left/width, used to size/position the fixed overlays, changes
// with the window and with the sidebar collapsing/expanding).
{
  const stickyViewport=document.querySelector(".viewport.workspace-viewport");
  window.addEventListener("scroll",scheduleMatrixStickyUpdate,{passive:true});
  window.addEventListener("resize",scheduleMatrixStickyUpdate);
  if(stickyViewport){
    stickyViewport.addEventListener("scroll",scheduleMatrixStickyUpdate,{passive:true});
    new ResizeObserver(scheduleMatrixStickyUpdate).observe(stickyViewport);
  }
}

// <header> keeps overflow:hidden to stay one non-wrapping application row (see
// css/base.css), but that clips any descendant rendered outside header's own box —
// including these <details> dropdown panels, which used to be silently cut off instead
// of overlaying the workspace below. Detaching the open panel to <body> with
// viewport-computed coordinates escapes that clipping while leaving <details>'s native
// open/close state untouched; the interactions it was missing (Escape, outside click,
// focus management) are added on top.
//
// Opening is handled synchronously inside the summary's own "click" (preventing the
// native toggle and driving `.open` ourselves) rather than from <details>'s "toggle"
// event, which the HTML spec queues as a separate task: waiting for it would let the
// browser paint one frame of the panel still visible-but-clipped in its original
// parent before our reposition-and-detach ran. Closing has no such risk (the end
// state is simply hidden), so the async "toggle" event is a fine, simpler place to
// run that cleanup — it also catches the several existing call sites elsewhere that
// close a menu by setting `.open = false` directly rather than clicking summary.
function setupOverflowSafeMenu(detailsId){
  const details=document.getElementById(detailsId);
  if(!details)return;
  const summary=details.querySelector(":scope > summary");
  const panel=details.querySelector(":scope > .top-menu-panel, :scope > .account-menu-panel");
  if(!summary||!panel)return;
  const focusable=()=>[...panel.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
  const reposition=()=>{
    const rect=summary.getBoundingClientRect();
    panel.style.position="fixed";
    panel.style.top=`${Math.round(rect.bottom+6)}px`;
    panel.style.right=`${Math.round(window.innerWidth-rect.right)}px`;
    panel.style.left="auto";
  };
  const onResize=()=>reposition();
  const onKeydown=event=>{
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();details.open=false}
  };
  const onOutsideClick=event=>{
    if(details.open&&!details.contains(event.target)&&!panel.contains(event.target))details.open=false;
  };
  let wired=false;
  const wireOpenListeners=()=>{
    if(wired)return;wired=true;
    window.addEventListener("resize",onResize);
    document.addEventListener("keydown",onKeydown,true);
    document.addEventListener("click",onOutsideClick,true);
  };
  const unwireOpenListeners=()=>{
    if(!wired)return;wired=false;
    window.removeEventListener("resize",onResize);
    document.removeEventListener("keydown",onKeydown,true);
    document.removeEventListener("click",onOutsideClick,true);
  };
  summary.addEventListener("click",event=>{
    if(details.open)return;
    event.preventDefault();
    details.open=true;
    panel.inert=false;
    document.body.appendChild(panel);
    reposition();
    wireOpenListeners();
    focusable()[0]?.focus();
  });
  details.addEventListener("toggle",()=>{
    if(details.open){
      panel.inert=false;
      if(panel.parentElement!==document.body){document.body.appendChild(panel);reposition()}
      wireOpenListeners();
    }else{
      unwireOpenListeners();
      // Only reclaim focus if it's still stranded in the (about to be reattached)
      // panel or was lost to <body> — e.g. Escape or an outside click. Several
      // existing call sites close this menu and then immediately open a modal
      // (openChaptersManager, openInspector, ...); by the time this async "toggle"
      // fires, focus is legitimately inside that modal and must be left alone.
      const reclaim=panel.contains(document.activeElement)||document.activeElement===document.body;
      panel.style.position="";panel.style.top="";panel.style.right="";panel.style.left="";
      if(panel.parentElement!==details)details.appendChild(panel);
      // modal-manager's syncLayers() marks every non-.modal-backdrop child of <body>
      // inert while a modal is open; if a modal opens in the instant between this
      // panel being detached to <body> and this cleanup running, it can catch the
      // panel mid-flight and mark it inert. That flag has nothing to do with this
      // menu's own (now-closed) state and must not persist once the panel is back
      // inside <details> — otherwise it silently blocks all focus/interaction the
      // next time this menu opens, with no visible symptom.
      panel.inert=false;
      if(reclaim)summary.focus();
    }
  });
}
["projectMenu","workspaceAccountMenu"].forEach(setupOverflowSafeMenu);
document.getElementById("openInspector").onclick=()=>{
  renderSceneInfo();
  showModal("inspectorModal");
  document.getElementById("projectMenu").open=false;
};
document.getElementById("closeInspector").onclick=()=>hideModal("inspectorModal");
document.getElementById("inspectorModal").onclick=e=>{if(e.target.id==="inspectorModal")hideModal("inspectorModal")};

document.querySelectorAll("#viewSwitch button").forEach(btn=>btn.onclick=()=>{currentView=btn.dataset.view;render()});

document.getElementById("matrixShowActions").onchange=event=>setMatrixContentMode("actions",event.target.checked);
document.getElementById("matrixShowRelations").onchange=event=>setMatrixContentMode("relations",event.target.checked);





























document.getElementById("addSceneTag").onclick=addTagToDraft;
document.getElementById("sceneTagInput").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();addTagToDraft()}};

let quickLocationInFlight=false;
document.getElementById("quickAddLocation").onclick=()=>{
  const input=document.getElementById("quickLocationName"),createBtn=document.getElementById("quickLocationCreate");
  input.value="";createBtn.disabled=true;document.getElementById("quickLocationStatus").textContent="";document.getElementById("quickLocationStatus").className="save-status";
  openModal("quickLocationModal",{initialFocus:"#quickLocationName"});
};
document.getElementById("quickLocationName").oninput=()=>{document.getElementById("quickLocationCreate").disabled=!document.getElementById("quickLocationName").value.trim()};
document.getElementById("quickLocationName").onkeydown=e=>{
  if(e.key==="Enter"){e.preventDefault();if(!document.getElementById("quickLocationCreate").disabled)document.getElementById("quickLocationCreate").click()}
};
document.getElementById("quickLocationCreate").onclick=async()=>{
  if(quickLocationInFlight)return;
  const name=document.getElementById("quickLocationName").value.trim();if(!name)return;
  const button=document.getElementById("quickLocationCreate"),idleLabel=button.textContent,status=document.getElementById("quickLocationStatus");
  quickLocationInFlight=true;button.disabled=true;button.textContent="Создание…";status.textContent="";status.className="save-status";
  let succeeded=false;
  try{
    if(isCloudWorkspace()){
      const result=await runCloudMutation("createLocation",(api,revision)=>api.createLocation(cloudProjectSync.projectId,revision,{name,description:""}),{renderAfter:false});
      if(!result.ok){status.textContent=result.message||"Не удалось создать локацию.";status.className="save-status error";return}
      data=cloudProjectSync.confirmedProject;populateSceneSelectors();document.getElementById("sceneLocation").value=result.data?.id||"";
    }else{
      const location={id:makeId("location"),name,description:""};
      const result=commitDataChange(next=>next.locations.push(location),{renderAfter:false});
      if(!result.ok){status.textContent=result.userMessage||"Не удалось создать локацию.";status.className="save-status error";return}
      populateSceneSelectors();document.getElementById("sceneLocation").value=location.id;
    }
    succeeded=true;
    syncBeforeUnload();
    forceCloseModal("quickLocationModal");
  }finally{
    quickLocationInFlight=false;button.textContent=idleLabel;
    button.disabled=succeeded||!document.getElementById("quickLocationName").value.trim();
  }
};
document.getElementById("quickLocationCancel").onclick=()=>forceCloseModal("quickLocationModal");
document.getElementById("quickLocationModal").onclick=e=>{if(e.target.id==="quickLocationModal")forceCloseModal("quickLocationModal")};






document.getElementById("manageChapters").onclick=openChaptersManager;
document.getElementById("addChapter").onclick=addChapterDraftRow;
document.getElementById("saveChapters").onclick=saveChapterDraft;
document.getElementById("closeChapters").onclick=()=>requestCloseModal("chaptersModal","button");
document.getElementById("chaptersModal").onclick=e=>{if(e.target.id==="chaptersModal")requestCloseModal("chaptersModal","backdrop")};





document.getElementById("manageLocations").onclick=openLocationGallery;
document.getElementById("addLocation").onclick=openCreateLocationModal;
document.getElementById("closeLocations").onclick=()=>hideModal("locationsModal");
document.getElementById("locationsModal").onclick=e=>{if(e.target.id==="locationsModal")hideModal("locationsModal")};
document.getElementById("locationGallerySearch").oninput=e=>setLocationGallerySearch(e.target.value);
document.getElementById("locationGalleryTypeFilter").onchange=e=>setLocationGalleryTypeFilter(e.target.value);
populateLocationTypePresetSelect(document.getElementById("locProfileTypePreset"));
document.getElementById("createLocationName").oninput=updateCreateLocationSubmitState;
document.getElementById("createLocationName").onkeydown=e=>{
  if(e.key==="Enter"){e.preventDefault();if(!document.getElementById("createLocationSubmit").disabled)document.getElementById("createLocationSubmit").click()}
};
document.getElementById("createLocationSubmit").onclick=submitCreateLocation;
document.getElementById("createLocationCancel").onclick=()=>forceCloseModal("createLocationModal");
document.getElementById("createLocationModal").onclick=e=>{if(e.target.id==="createLocationModal")forceCloseModal("createLocationModal")};
document.getElementById("locationProfileEdit").onclick=enterLocationProfileEdit;
document.getElementById("locationProfileCancelEdit").onclick=cancelLocationProfileEdit;
document.getElementById("locationProfileSave").onclick=saveLocationProfile;
document.getElementById("locationProfileDelete").onclick=deleteLocationFromProfile;
document.getElementById("locationProfileClose").onclick=()=>requestCloseModal("locationProfileModal","button");
document.getElementById("locationProfileModal").onclick=e=>{if(e.target.id==="locationProfileModal")requestCloseModal("locationProfileModal","backdrop")};





document.getElementById("manageTags").onclick=openTagsManager;
document.getElementById("addTag").onclick=addTagDraftRow;
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

  syncPeopleDraftFromDom();
  data.characters.forEach(character=>{
    const charId=character.id;
    if(!Object.prototype.hasOwnProperty.call(sceneParticipantDraft,charId))return;
    const p=sceneParticipantDraft[charId];
    const action=(p.action||"").trim();
    const legacyState=(p.legacyState||"").trim();
    // relationChanges означает не "разницу с текущим соседом", а явное решение автора в этой сцене.
    const relationChanges=Object.fromEntries(Object.entries(p.relationChanges||{}).map(([target,value])=>[target,(value||"").trim()]));
    const visibleRelations=[...(p.visibleRelations||[])];

    // Ключ в sceneParticipantDraft — явное решение "персонаж в сцене"; сохраняем его даже без текста.
    scene.people[charId]={action,relationChanges,visibleRelations,legacyState};
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
// Deliberately no chapter argument: this button creates a scene "in the air" —
// it must never inherit the active filter's chapter, the first chapter, or a
// stale positional-insertion chapter left over from a cancelled Create Scene.
// See the "positional" contract in openNewSceneAtNow (js/scenes.js).
document.getElementById("addFirst").onclick=()=>openNewSceneAt(null,null);
// A positional create ("insert before scene X" in chapter A) carries insertBeforeSceneId
// that only makes sense in chapter A. If the user then changes the chapter dropdown to B,
// reusing that stale id would save a scene in B with a position derived from A's neighbors
// (docs/cloud-content-architecture.md's move_scene semantics don't apply to create, so this
// silently produces an arbitrary in-chapter position). Reset to the safe append policy for
// whichever chapter ends up selected instead of attempting a cross-chapter remap.
document.getElementById("sceneChapter").onchange=function(){
  if(editingSceneId)return;
  const target=resolveCreateInsertionTarget(insertChapterId,insertBeforeSceneId,this.value);
  insertChapterId=target.chapterId;
  insertBeforeSceneId=target.beforeSceneId;
};
document.getElementById("cancelScene").onclick=()=>requestCloseModal("sceneModal","button");
document.getElementById("sceneModal").onclick=e=>{if(e.target.id==="sceneModal")requestCloseModal("sceneModal","backdrop")};


function openCharactersManager(){
  const menu=document.getElementById("projectMenu");menu.open=false;menu.querySelector("summary")?.focus();
  renderProfiles();
  showModal("charsModal");
  updateProfileGalleryCardHeight();
}
document.getElementById("manageChars").onclick=openCharactersManager;
document.getElementById("sidebarManageChars").onclick=openCharactersManager;

// Keeps --profile-card-h (see css/profiles.css) in sync with the gallery's
// actual available height: on window resize, and via ResizeObserver for
// anything that changes #profilesGrid's box without a window resize event
// (opening the modal itself — 0 to real size — the sidebar collapsing, etc.).
{
  const profilesGrid=document.getElementById("profilesGrid");
  if(profilesGrid){
    window.addEventListener("resize",updateProfileGalleryCardHeight);
    new ResizeObserver(updateProfileGalleryCardHeight).observe(profilesGrid);
  }
}
// Bound to the panel node itself (captured once, before setupOverflowSafeMenu ever
// reparents it) rather than to #projectMenu: while the menu is open, the panel is a
// child of <body> (see setupOverflowSafeMenu above), so a listener on #projectMenu
// would stop seeing bubbled clicks from inside it.
document.querySelector("#projectMenu .top-menu-panel").addEventListener("click",event=>{
  if(!event.target.closest("button,.file-label"))return;
  const menu=document.getElementById("projectMenu");menu.open=false;menu.querySelector("summary")?.focus();
});
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
  const result=await runCloudMutation("attachProjectCharacter",(_api,revision)=>cloudState.characterApi.attachProjectCharacter(cloudProjectSync.projectId,characterId,revision,{sortOrder:nextCharacterSortOrder()}));
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

// Location Media B4B: crop/lightbox bindings, mirroring the Character photo bindings immediately
// above exactly (same modal-manager/backdrop-click/pointer-drag mechanics, separate DOM elements
// so the two features never share mutable crop/lightbox state).
document.getElementById("locMediaFileInput").onchange=handleLocationMediaFileChosen;
document.getElementById("locationMediaCropZoom").oninput=e=>{if(locationMediaCropState){locationMediaCropState.draft.zoom=Number(e.target.value);syncLocationMediaCropPreview()}};
document.getElementById("saveLocationMediaCrop").onclick=saveLocationMediaCrop;
document.getElementById("cancelLocationMediaCrop").onclick=cancelLocationMediaCrop;
document.getElementById("locationMediaCropModal").onclick=e=>{if(e.target.id==="locationMediaCropModal")cancelLocationMediaCrop()};
document.getElementById("closeLocationMediaLightbox").onclick=()=>forceHideModal("locationMediaLightboxModal");
document.getElementById("locationMediaLightboxModal").onclick=e=>{if(e.target.id==="locationMediaLightboxModal")forceHideModal("locationMediaLightboxModal")};
{
  const viewport=document.getElementById("locationMediaCropViewport");let pointer=null;
  viewport.onpointerdown=e=>{pointer={id:e.pointerId,x:e.clientX,y:e.clientY};viewport.setPointerCapture(e.pointerId)};
  viewport.onpointermove=e=>{if(!pointer||pointer.id!==e.pointerId||!locationMediaCropState)return;const rect=viewport.getBoundingClientRect();nudgeLocationMediaCrop((e.clientX-pointer.x)/rect.width,(e.clientY-pointer.y)/rect.height);pointer.x=e.clientX;pointer.y=e.clientY};
  viewport.onpointerup=viewport.onpointercancel=()=>{pointer=null};
}

document.getElementById("cancelProfile").onclick=()=>requestCloseModal("profileEditorModal","button");
document.getElementById("profileEditorModal").onclick=e=>{
  if(e.target.id==="profileEditorModal")requestCloseModal("profileEditorModal","backdrop");
};
document.getElementById("addSceneParticipant").onclick=addSceneParticipant;
document.getElementById("addCharacterLink").onclick=()=>openCharacterLinkEditor();
document.getElementById("cancelCharacterLink").onclick=()=>requestCloseModal("characterLinkModal","button");
document.getElementById("saveCharacterLink").onclick=saveDraftCharacterLink;
document.getElementById("characterLinkType").onchange=syncCharacterLinkCustomFields;
document.getElementById("characterLinkReverseType").onchange=syncCharacterLinkCustomFields;
document.getElementById("characterLinkModal").onclick=e=>{if(e.target.id==="characterLinkModal")requestCloseModal("characterLinkModal","backdrop")};
async function syncCloudCharacterLinks(original,draft){
  const api=cloudState.characterApi,projectId=cloudProjectSync.projectId,originalById=new Map(original.map(item=>[item.id,item])),draftById=new Map(draft.map(item=>[item.id,item]));
  let changed=false;
  for(const old of original)if(!draftById.has(old.id)){
    const result=old.scope==="global"?await api.deleteLink(old.id,{expectedLinkRevision:old.revision}):await runCloudMutation("deleteCharacterLink",(_api,revision)=>api.deleteLink(old.id,{expectedProjectRevision:revision}),{renderAfter:false});
    if(!result.ok){showStorageMessage(result.message,"error");return result}
    changed=true;
  }
  for(const link of draft){
    const old=originalById.get(link.id),cloudCategory=({marriage:"romantic",legal:"other",guardianship:"other"})[link.category]||link.category,cloudStructure=({parent_child:"biological",sibling:"biological",partnership:"chosen",guardianship:"legal"})[link.structureKind]||link.structureKind,payload={fromCharacterId:link.fromCharacterId,toCharacterId:link.toCharacterId,category:cloudCategory,type:link.type,reverseType:link.reverseType,customLabel:link.customLabel,reverseCustomLabel:link.reverseCustomLabel,notes:link.notes,structureKind:cloudStructure,metadata:{...(link.metadata||{}),uiCategory:link.category,uiStructureKind:link.structureKind}};
    let result;if(!old)result=link.scope==="global"?await api.createLink(null,null,payload):await runCloudMutation("createCharacterLink",(_api,revision)=>api.createLink(projectId,revision,payload),{renderAfter:false});
    else if(JSON.stringify({...old,id:undefined,revision:undefined})!==JSON.stringify({...link,id:undefined,revision:undefined}))result=old.scope==="global"?await api.updateLink(old.id,{expectedLinkRevision:old.revision},payload):await runCloudMutation("updateCharacterLink",(_api,revision)=>api.updateLink(old.id,{expectedProjectRevision:revision},payload),{renderAfter:false});
    if(result){if(!result.ok){showStorageMessage(result.message,"error");return result}changed=true}
  }
  if(!changed)return {ok:true};
  const loaded=await cloudProjectSync.reload();if(loaded.ok)data=loaded.data;else showStorageMessage(loaded.message||"Не удалось обновить данные после сохранения связей.","error");return loaded;
}
async function reloadAfterImageMutation(){const loaded=await cloudProjectSync.reload();if(loaded.ok)data=loaded.data;return loaded}
async function syncCloudCharacterImages(character,oldPhotos,draftPhotos,primaryPhotoId,scope){
  const api=cloudState.imageApi,projectScoped=scope==="project",projectCharacterId=projectScoped?character.projectCharacterId:null;
  const oldById=new Map(oldPhotos.filter(photo=>photo.source?.kind==="storage").map(photo=>[photo.id,photo]));
  for(let index=0;index<draftPhotos.length;index++){
    const photo=draftPhotos[index],file=profileDraftPhotoFiles.get(photo.id),isPrimary=photo.id===primaryPhotoId;
    if(file){
      const expectedRevision=projectScoped?cloudProjectSync.revision:character.characterRevision;
      const result=await api.uploadImage({characterId:character.id,projectCharacterId,photoId:photo.id,file,photo,scope,expectedRevision,isPrimary,sortOrder:index});
      if(!result.ok){showStorageMessage(result.orphaned?"Изображение не сохранено; загруженный объект отмечен для ручной очистки.":result.message||"Не удалось загрузить изображение.","error");return result}
      profileDraftPhotoFiles.delete(photo.id);URL.revokeObjectURL(photo.source.value);const loaded=await reloadAfterImageMutation();if(!loaded.ok)return loaded;
      character=characterById(character.id);
      continue;
    }
    const before=oldById.get(photo.id);if(!before)continue;
    const changed=JSON.stringify([before.crop,before.alt,before.caption,before.isPrimary,before.sortOrder])!==JSON.stringify([photo.crop,photo.alt,photo.caption,isPrimary,index]);
    if(changed){const expected=before.scope==="project"?cloudProjectSync.revision:before.revision,result=await api.updateImage(photo.id,expected,{crop:photo.crop,alt:photo.alt,caption:photo.caption,isPrimary,sortOrder:index,metadata:Object.fromEntries(Object.entries(photo).filter(([key])=>!["id","source","crop","alt","caption","revision","isPrimary","sortOrder","scope","projectCharacterId"].includes(key)))});if(!result.ok){showStorageMessage(result.message||"Изображение изменено в другом сеансе.","error");return result}const loaded=await reloadAfterImageMutation();if(!loaded.ok)return loaded}
    oldById.delete(photo.id);
  }
  for(const removed of oldById.values()){const expected=removed.scope==="project"?cloudProjectSync.revision:removed.revision,result=await api.deleteImage(removed.id,expected);if(!result.ok){showStorageMessage(result.message||"Не удалось удалить изображение.",result.recoverable?"warning":"error");return result}const loaded=await reloadAfterImageMutation();if(!loaded.ok)return loaded}
  return {ok:true};
}
document.getElementById("saveProfile").onclick=async()=>{
  if(characterSaveInFlight)return;
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
  characterSaveInFlight=true;profileSaveButton.beginSaving();
  try{
  const wasNewCharacter=!!profileDraftCharacter;
  const old=normalizeProfile(data.profiles?.[character.id],character);
  const hidden={};
  ["race","sex","secondarySex","age","birthday","zodiac","height","build","eyeColor","hairColor","hairstyle","profession",
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
    eyeColor:document.getElementById("pf_eyeColor").value.trim(),
    hairColor:document.getElementById("pf_hairColor").value.trim(),
    hairstyle:document.getElementById("pf_hairstyle").value.trim(),
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
    const profilePayload={...profile};for(const key of ["id","characterId","name","surname","photos","primaryPhotoId","initialRelations","_cloud","_legacyLocalPhotosPending"])delete profilePayload[key];
    let result;
    if(profileDraftCharacter){
      result=await runCloudMutation("createCharacterAndAttach",(_api,revision)=>api.createCharacterAndAttach(projectId,revision,{name:newName,surname:profile.surname,baseProfile:profilePayload},{sortOrder:nextCharacterSortOrder()}),{renderAfter:false});
      if(result?.ok){
        const newId=result.data?.character?.id,tempId=character.id;
        if(newId){
          const remapId=id=>id===tempId?newId:id;
          profileDraftCharacterLinks=profileDraftCharacterLinks.map(link=>({...link,fromCharacterId:remapId(link.fromCharacterId),toCharacterId:remapId(link.toCharacterId)}));
          profileEditingId=newId;profileDraftCharacter=null;
        }
      }
    }else if(profileSaveScopeValue()==="global"){
      result=await api.updateCharacter(character.id,character.characterRevision,{name:newName,surname:profile.surname,baseProfile:profilePayload});
      if(result.ok){const loaded=await cloudProjectSync.reload();if(loaded.ok)data=loaded.data;else showStorageMessage(loaded.message||"Не удалось обновить данные после сохранения.","error")}
    }else{
      const base=old._cloud?.baseProfile||{},previous=old._cloud?.overrides||{},overrides={...previous};
      for(const [key,value] of Object.entries(profilePayload)){if(JSON.stringify(value)===JSON.stringify(base[key]))delete overrides[key];else overrides[key]=value}
      result=await runCloudMutation("updateProjectCharacter",(_api,revision)=>api.updateProjectCharacter(projectId,character.projectCharacterId,revision,{overrides,role:character.role,sortOrder:character.sortOrder}),{renderAfter:false});
    }
    if(!result?.ok){showStorageMessage(result?.message||"Не удалось сохранить анкету.","error");return}
    const createdId=result.data?.character?.id,current=cloudProjectSync.confirmedProject.characters.find(item=>item.id===(createdId||character.id));
    const imageResult=current?await syncCloudCharacterImages(current,old.photos||[],profileDraftPhotos,profileDraftPrimaryPhotoId,profileSaveScopeValue()):{ok:true};
    if(!imageResult.ok){showStorageMessage(imageResult.message||"Не удалось сохранить изображения персонажа.","error");return}
    if(current){
      const existingInitialRelations=cloudProjectSync.confirmedProject.profiles[current.id]?.initialRelations||{};
      const normalizeRelations=map=>Object.entries(map).filter(([,v])=>v).sort(([a],[b])=>a<b?-1:a>b?1:0);
      const relationsChanged=JSON.stringify(normalizeRelations(initialRelations))!==JSON.stringify(normalizeRelations(existingInitialRelations));
      if(relationsChanged){
        const relations=[];
        for(const source of cloudProjectSync.confirmedProject.characters){
          const values=source.id===current.id?initialRelations:(cloudProjectSync.confirmedProject.profiles[source.id]?.initialRelations||{});
          for(const [targetId,value] of Object.entries(values))relations.push({fromProjectCharacterId:source.projectCharacterId,toProjectCharacterId:cloudProjectSync.confirmedProject.characters.find(item=>item.id===targetId)?.projectCharacterId,valueOperation:"set",value,visible:true});
        }
        const relResult=await runCloudMutation("setInitialRelations",(_api,revision)=>api.setInitialRelations(projectId,revision,relations.filter(item=>item.toProjectCharacterId)),{renderAfter:false});
        if(!relResult.ok){showStorageMessage(relResult.message||"Не удалось сохранить отношения персонажа.","error");return}
      }
    }
    const linkResult=await syncCloudCharacterLinks(data.characterLinks||[],profileDraftCharacterLinks);if(!linkResult?.ok)return;
    data=cloudProjectSync.confirmedProject;trackerFor("profileEditorModal").captureInitialState();forceHideModal("profileEditorModal");profileDraftCharacter=null;
    showStorageMessage(wasNewCharacter?"Персонаж добавлен.":"Анкета сохранена.","success");
    renderProfiles();render();return;
  }
  const result=commitDataChange(next=>{
    let target=next.characters.find(c=>c.id===character.id);
    if(!target){target={...character};next.characters.push(target);next.profiles ||= {}}
    target.name=newName;next.profiles[character.id]=profile;next.characterLinks=safeOwnCopy(profileDraftCharacterLinks);
  },{renderAfter:false});
  if(!result.ok)return;
  trackerFor("profileEditorModal").captureInitialState();forceHideModal("profileEditorModal");profileDraftCharacter=null;
  showStorageMessage(wasNewCharacter?"Персонаж добавлен.":"Анкета сохранена.","success");
  renderProfiles();
  render();
  }finally{
    characterSaveInFlight=false;profileSaveButton.endSaving();
  }
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
