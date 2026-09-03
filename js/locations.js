/* Location Gallery + Location Profile (Phase A).
 *
 * Identity naming contract (see Location Architecture V2 Phase 2 migrations):
 * `participationId` is project_locations.id — the id hydrated onto every entry in
 * data.locations[] as `.id`, and the exact value scene.locationId references. It is the
 * only identifier this file's UI operates on. `canonicalLocationId` is the global
 * public.locations.id (hydrated as `.locationId` in cloud mode; local/non-cloud projects
 * have no canonical/participation split at all, so it falls back to the participation id).
 * Phase A never attaches/reuses a canonical Location across projects, so canonicalLocationId
 * is tracked here only to keep the naming explicit for future phases — never displayed or
 * sent to an RPC in this phase.
 */

function locationById(participationId){return data.locations.find(l=>l.id===participationId)}

function locationCanonicalId(location){return location?.locationId||location?.id||null}

function locationSceneEntries(participationId){
  return data.scenes.filter(scene=>scene.locationId===participationId);
}

let locationGalleryQuery="";
let locationProfileParticipationId=null;
let locationProfileMode="read";
let createLocationInFlight=false;

const locationProfileSaveButton=createSaveButtonController("locationProfileSave","locationProfileModal",{statusId:"locationProfileStatus"});

/* ---------- Gallery ---------- */

function openLocationGallery(){
  closeProjectMenu();
  locationGalleryQuery="";
  const searchInput=document.getElementById("locationGallerySearch");
  if(searchInput)searchInput.value="";
  renderLocationGallery();
  showModal("locationsModal");
}

function setLocationGallerySearch(value){
  locationGalleryQuery=value||"";
  renderLocationGallery();
}

function locationMatchesGalleryQuery(location,query){
  if(!query)return true;
  const haystack=`${location.name||""}\n${location.description||""}`.toLocaleLowerCase("ru");
  return haystack.includes(query);
}

function renderLocationGallery(){
  const grid=document.getElementById("locationsGalleryGrid");if(!grid)return;
  const query=locationGalleryQuery.trim().toLocaleLowerCase("ru");
  const items=data.locations.filter(location=>locationMatchesGalleryQuery(location,query));
  if(!items.length){
    grid.innerHTML=`<div class="empty-work">${data.locations.length?"Совпадений не найдено.":"В этом проекте пока нет локаций. Создайте первую, когда будете готовы."}</div>`;
    return;
  }
  grid.innerHTML=items.map(location=>{
    const participationId=location.id;
    const sceneCount=locationSceneEntries(participationId).length;
    const monogram=(location.name||"").trim().charAt(0).toLocaleUpperCase("ru")||"?";
    const excerpt=(location.description||"").trim();
    return `<article class="location-card" data-location-id="${esc(participationId)}">
      <button type="button" class="location-card-open" onclick="openLocationProfile('${jsq(participationId)}')" aria-label="Открыть локацию «${esc(location.name||"без названия")}»">
        <span class="location-card-identity">
          <span class="location-card-monogram" aria-hidden="true">${esc(monogram)}</span>
          <span class="location-card-name">${esc(location.name||"Без названия")}</span>
        </span>
        ${excerpt?`<span class="location-card-excerpt">${esc(excerpt)}</span>`:""}
      </button>
      <div class="location-card-footer">
        <span class="stat-pill">Сцен <strong>${sceneCount}</strong></span>
        <span class="location-card-footer-spacer" aria-hidden="true"></span>
        <button type="button" class="row-action-quiet danger-quiet" aria-label="Удалить локацию «${esc(location.name||"без названия")}»" title="Удалить" onclick="deleteLocationFromGallery('${jsq(participationId)}')">🗑</button>
      </div>
    </article>`;
  }).join("");
}

/* ---------- Shared delete (Gallery + Profile) ---------- */

async function deleteLocationEntity(participationId){
  const location=locationById(participationId);
  if(!location)return {ok:false,cancelled:true};
  const confirmed=await showConfirmAction({title:"Удалить локацию?",description:isCloudWorkspace()
    ?`Локация «${location.name||"без названия"}» будет удалена из проекта. Если она ещё используется в сценах, удаление будет отклонено — сначала уберите её из этих сцен.`
    :`Локация «${location.name||"без названия"}» будет удалена. В сценах она станет не указанной.`});
  if(!confirmed)return {ok:false,cancelled:true};
  if(isCloudWorkspace()){
    const result=await runCloudMutation("deleteLocation",(api,revision)=>api.deleteLocation(cloudProjectSync.projectId,participationId,revision),{renderAfter:false});
    if(result.ok)data=cloudProjectSync.confirmedProject;
    return result;
  }
  return commitDataChange(next=>{
    next.locations=next.locations.filter(l=>l.id!==participationId);
    next.scenes.forEach(s=>{if(s.locationId===participationId)s.locationId=""});
  },{renderAfter:false});
}

async function deleteLocationFromGallery(participationId){
  const result=await deleteLocationEntity(participationId);
  if(!result.ok){if(!result.cancelled)alert(result.message||"Не удалось удалить локацию.");return}
  renderLocationGallery();
  render();
}

/* ---------- Profile ---------- */

// The Profile opens in a read-only display (name/scene-count header, a readable summary,
// and the read-only "Scenes here" list) rather than immediately looking like an edit form.
// "Редактировать" is the single entry into edit mode, which is the only place name/
// description become editable inputs and Save/Delete live. This mirrors why Scenes-here is
// read-view-only: it isn't editable content, and keeping edit mode to just its two fields
// keeps the dirty-tracked form small and focused.
function populateLocationProfile(participationId){
  const location=locationById(participationId);if(!location)return false;
  locationProfileParticipationId=participationId;
  document.getElementById("locationProfileTitle").textContent=location.name||"Локация";
  const sceneCount=locationSceneEntries(participationId).length;
  document.getElementById("locationProfileSceneCount").innerHTML=`Сцен <strong>${sceneCount}</strong>`;
  syncLocationProfileEditFields(location);
  renderLocationProfileSummary(location);
  renderLocationProfileScenes(participationId);
  return true;
}

function syncLocationProfileEditFields(location){
  document.getElementById("locProfileName").value=location.name||"";
  document.getElementById("locProfileDescription").value=location.description||"";
}

function renderLocationProfileSummary(location){
  const el=document.getElementById("locationProfileSummary");if(!el)return;
  const description=(location.description||"").trim();
  el.innerHTML=description
    ?`<p class="location-profile-description">${esc(description)}</p>`
    :`<button type="button" class="location-profile-description-empty" onclick="enterLocationProfileEdit()">Описание пока не добавлено</button>`;
}

function renderLocationProfileScenes(participationId){
  const container=document.getElementById("locationProfileScenes");if(!container)return;
  const scenes=locationSceneEntries(participationId);
  if(!scenes.length){
    container.innerHTML='<div class="location-profile-scenes-empty">У этой локации пока нет сцен в этом проекте.</div>';
    return;
  }
  container.innerHTML=scenes.map(scene=>{
    const chapter=chapterById(scene.chapterId),ws=writingStatusById(scene.writingStatus);
    const meta=[readableDate(scene)||"без даты",chapter?.title||"Без главы",ws.label].join(" · ");
    return `<button type="button" class="location-profile-scene-row" onclick="editScene('${jsq(scene.id)}')">
      <span class="location-profile-scene-title">${esc(scene.title||"Без названия")}</span>
      <span class="location-profile-scene-meta">${esc(meta)}</span>
    </button>`;
  }).join("");
}

function showLocationProfileReadMode(){
  locationProfileMode="read";
  document.getElementById("locationProfileReadView").hidden=false;
  document.getElementById("locationProfileEditView").hidden=true;
}

function showLocationProfileEditMode(){
  locationProfileMode="edit";
  document.getElementById("locationProfileReadView").hidden=true;
  document.getElementById("locationProfileEditView").hidden=false;
  trackerFor("locationProfileModal").captureInitialState();
  locationProfileSaveButton.refresh();
  document.getElementById("locProfileName").focus();
}

function enterLocationProfileEdit(){
  const location=locationById(locationProfileParticipationId);if(!location)return;
  syncLocationProfileEditFields(location);
  showLocationProfileEditMode();
}

// Cancel is "exit edit mode", not "close the Profile" — same dirty-state guard as any other
// draft-destroying transition, just resolved back to read mode instead of a closed modal.
async function cancelLocationProfileEdit(){
  if(!await confirmDiscardIfDirty("locationProfileModal"))return;
  const location=locationById(locationProfileParticipationId);
  if(location)syncLocationProfileEditFields(location);
  trackerFor("locationProfileModal").captureInitialState();
  showLocationProfileReadMode();
}

function openLocationProfile(participationId){
  return requestEditorTransition(()=>openLocationProfileNow(participationId));
}

function openLocationProfileNow(participationId){
  if(!populateLocationProfile(participationId))return;
  showLocationProfileReadMode();
  showModal("locationProfileModal",{initialFocus:"#locationProfileEdit"});
  trackerFor("locationProfileModal").captureInitialState();
  locationProfileSaveButton.refresh();
}

// Sidebar/entity navigation opens the concrete Location Profile directly — the
// Gallery (see openLocationGallery) is the separate browse/search/create overview,
// reached from the sidebar section's "•••" manage button and the top menu instead.
function openLocationEntity(participationId){
  return openLocationProfile(participationId);
}

async function saveLocationProfile(){
  if(locationProfileSaveButton.saving)return;
  const participationId=locationProfileParticipationId;
  const location=locationById(participationId);
  if(!location)return;
  const name=document.getElementById("locProfileName").value.trim();
  const description=document.getElementById("locProfileDescription").value.trim();
  if(!name){locationProfileSaveButton.showStatus("Название локации не может быть пустым.","error");return}
  locationProfileSaveButton.beginSaving();
  try{
    if(isCloudWorkspace()){
      const result=await runCloudMutation("updateLocation",(api,revision)=>api.updateLocation(cloudProjectSync.projectId,participationId,revision,{name,description}),{renderAfter:false});
      if(!result.ok){locationProfileSaveButton.showStatus(result.message||"Не удалось сохранить локацию.","error");return}
      data=cloudProjectSync.confirmedProject;
    }else{
      const result=commitDataChange(next=>{
        const target=next.locations.find(l=>l.id===participationId);
        if(target){target.name=name;target.description=description}
      },{renderAfter:false});
      if(!result.ok){locationProfileSaveButton.showStatus(result.userMessage||"Не удалось сохранить локацию.","error");return}
    }
    // Success is a real, visible state (not skipped straight through) before returning to
    // read mode with the refreshed data, per the corrective-pass save-state contract.
    locationProfileSaveButton.showStatus("Локация сохранена.","success");
    await new Promise(resolve=>setTimeout(resolve,700));
    populateLocationProfile(participationId);
    trackerFor("locationProfileModal").captureInitialState();
    showLocationProfileReadMode();
    renderLocationGallery();
    render();
  }finally{
    locationProfileSaveButton.endSaving();
  }
}

async function deleteLocationFromProfile(){
  const participationId=locationProfileParticipationId;if(!participationId)return;
  const result=await deleteLocationEntity(participationId);
  if(!result.ok){if(!result.cancelled)locationProfileSaveButton.showStatus(result.message||"Не удалось удалить локацию.","error");return}
  trackerFor("locationProfileModal").deactivate();
  forceCloseModal("locationProfileModal");
  renderLocationGallery();
  render();
}

/* ---------- Create ---------- */

function openCreateLocationModal(){
  closeProjectMenu();
  const nameInput=document.getElementById("createLocationName"),descInput=document.getElementById("createLocationDescription");
  const submitBtn=document.getElementById("createLocationSubmit"),status=document.getElementById("createLocationStatus");
  nameInput.value="";descInput.value="";submitBtn.disabled=true;status.textContent="";status.className="save-status";
  openModal("createLocationModal",{initialFocus:"#createLocationName"});
}

function updateCreateLocationSubmitState(){
  document.getElementById("createLocationSubmit").disabled=!document.getElementById("createLocationName").value.trim();
}

async function submitCreateLocation(){
  if(createLocationInFlight)return;
  const name=document.getElementById("createLocationName").value.trim();if(!name)return;
  const description=document.getElementById("createLocationDescription").value.trim();
  const button=document.getElementById("createLocationSubmit"),idleLabel=button.textContent,status=document.getElementById("createLocationStatus");
  createLocationInFlight=true;button.disabled=true;button.textContent="Создание…";status.textContent="";status.className="save-status";
  let newParticipationId=null;
  try{
    if(isCloudWorkspace()){
      const result=await runCloudMutation("createLocation",(api,revision)=>api.createLocation(cloudProjectSync.projectId,revision,{name,description}),{renderAfter:false});
      if(!result.ok){status.textContent=result.message||"Не удалось создать локацию.";status.className="save-status error";return}
      data=cloudProjectSync.confirmedProject;
      newParticipationId=result.data?.id||null;
    }else{
      const location={id:makeId("location"),name,description};
      const result=commitDataChange(next=>next.locations.push(location),{renderAfter:false});
      if(!result.ok){status.textContent=result.userMessage||"Не удалось создать локацию.";status.className="save-status error";return}
      newParticipationId=location.id;
    }
    forceCloseModal("createLocationModal");
    renderLocationGallery();
    render();
    if(newParticipationId)openLocationProfile(newParticipationId);
  }finally{
    createLocationInFlight=false;button.textContent=idleLabel;
    button.disabled=!!newParticipationId||!document.getElementById("createLocationName").value.trim();
  }
}

Object.assign(globalThis,{locationById,locationCanonicalId,locationSceneEntries,openLocationGallery,setLocationGallerySearch,renderLocationGallery,deleteLocationFromGallery,openLocationProfile,openLocationEntity,enterLocationProfileEdit,cancelLocationProfileEdit,saveLocationProfile,deleteLocationFromProfile,openCreateLocationModal,updateCreateLocationSubmitState,submitCreateLocation});
export {locationById,locationCanonicalId,locationSceneEntries,openLocationGallery,setLocationGallerySearch,renderLocationGallery,deleteLocationFromGallery,openLocationProfile,openLocationEntity,enterLocationProfileEdit,cancelLocationProfileEdit,saveLocationProfile,deleteLocationFromProfile,openCreateLocationModal,updateCreateLocationSubmitState,submitCreateLocation};
