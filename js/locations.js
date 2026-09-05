import {validateLocationMediaFile} from "./cloud-location-media-api.js";

/* Location Gallery + Location Profile.
 *
 * Identity naming contract (see Location Architecture V2 Phase 2/3 migrations):
 * `participationId` is project_locations.id — the id hydrated onto every entry in
 * data.locations[] as `.id`, and the exact value scene.locationId references. It is the
 * only identifier scene binding and this file's list/gallery iteration operate on.
 * `canonicalLocationId` is the global public.locations.id (hydrated as `.locationId`) —
 * the id every Phase B2 canonical RPC (update_location_canonical/set_location_parent) and
 * the owned-location hierarchy list (list_owned_locations) key off. Local/non-cloud
 * projects have no canonical/participation split at all: locationCanonicalId() falls back
 * to the participation id, and location.parentId is in that same single id space.
 *
 * Phase B2 core-identity fields hydrated onto each entry (cloud mode — see
 * cloud-project-sync.js; local mode stores the same field names directly, see Create/local
 * save below): officialName, aliases, parentId (canonical id), typePreset, customTypeLabel,
 * baseProfile, shortSummary, locationRevision. All are optional/defaultable — older cached
 * data or a local project created before this phase simply has them undefined/empty, and
 * every reader below falls back accordingly.
 */

function locationById(participationId){return data.locations.find(l=>l.id===participationId)}

function locationCanonicalId(location){return location?.locationId||location?.id||null}

function locationSceneEntries(participationId){
  return data.scenes.filter(scene=>scene.locationId===participationId);
}

let locationGalleryQuery="";
let locationGalleryTypeFilter="";
let locationProfileParticipationId=null;
let locationProfileMode="read";
let locationProfileOriginalParentId=null;
let locationProfileChildrenExpanded=false;
let createLocationInFlight=false;
let createLocationParentId=null;

const locationProfileSaveButton=createSaveButtonController("locationProfileSave","locationProfileModal",{statusId:"locationProfileStatus"});

/* ---------- Media (B4B) ----------
 * Canonical-only, draft-until-Profile-Save, cloud-only -- see js/location-media.js (pure draft/
 * diff logic) and js/cloud-location-media-api.js (B4A's already-live RPC/Storage adapter, backend
 * unchanged by this phase). `locationMediaOriginal` is the last-loaded persisted truth for the
 * open canonical Location (the diff baseline); `locationProfileMediaDraft` is the mutable draft
 * edit mode operates on -- both reset together on every fresh Profile open/reload.
 *
 * Full media for the open Location is fetched lazily (list_location_media, one call, only for
 * THIS Location) -- never as part of project hydration/get_project_content, preserving the B4A
 * non-N+1 read-path design. `locationMediaLoadToken` guards a slow, now-stale fetch (the user
 * closed this Profile and opened a different one, or the project reloaded) from clobbering newer
 * state when it finally resolves.
 *
 * ASYNC/DIRTY-TRACKER RACE: the Profile modal opens synchronously (existing UX: instant open); the
 * dirty-tracker's baseline is captured synchronously too (openLocationProfileNow), before media has
 * actually arrived. loadLocationMediaForProfile re-captures that baseline once media resolves --
 * but only if nothing is dirty yet, so a real in-flight edit elsewhere in the Profile (astronomically
 * unlikely inside the sub-second fetch window, but not impossible) is never silently reset to clean. */
let locationMediaOriginal=[];
let locationProfileMediaDraft=[];
const locationMediaDraftFiles=new Map(); // draft id -> File, for not-yet-uploaded items only
let locationMediaLoadToken=0;
let locationMediaAddPanelOpen=false;
let locationMediaPendingKind=null;

/* ---------- History Events (Location History H-events) ----------
 * Canonical-only, draft-until-Profile-Save, same lazy-load shape as Media (list_location_history_
 * events, one call, only for the open Location's canonical id) -- see js/location-history-events.js
 * for the pure draft/diff model. `locationHistoryEventsOriginal` is the last-loaded persisted truth
 * (the diff baseline); `locationProfileHistoryEventsDraft` is the mutable draft edit mode operates
 * on. In LOCAL mode there is no separate table at all -- both are populated synchronously from
 * location.historyEvents (see loadLocationHistoryEventsForProfile), matching how baseProfile itself
 * already works locally. `locationHistoryEventEditingId` is which single event card (if any) is
 * currently expanded for editing -- only one at a time, per the task brief ("Avoid displaying 10
 * full title/date/description forms simultaneously"). */
let locationHistoryEventsOriginal=[];
let locationProfileHistoryEventsDraft=[];
let locationHistoryEventsLoadToken=0;
let locationHistoryEventEditingId=null;

async function loadLocationHistoryEventsForProfile(location){
  const token=++locationHistoryEventsLoadToken;
  if(!isCloudWorkspace()){
    locationHistoryEventsOriginal=normalizeLocalHistoryEvents(location.historyEvents).map(item=>normalizeHistoryEventDraftItem(item))
      .sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
    resetLocationProfileHistoryEventsDraft();
    renderLocationProfileHistory(location);
    return;
  }
  const canonicalId=locationCanonicalId(location);
  const result=await cloudProjectSync.api.listLocationHistoryEvents(canonicalId);
  const tracker=trackerFor("locationProfileModal");
  // Same "only if nothing is dirty yet" guard Media's own tracker-recapture already uses (see
  // loadLocationMediaForProfile) -- but applied to the DRAFT itself, not just the tracker snapshot.
  // This lazy fetch can resolve after the author has already entered edit mode and started adding/
  // editing events against the (possibly stale-from-a-previous-Location, possibly still-empty)
  // draft the synchronous open already set up; overwriting that in-progress draft the instant the
  // network call finally lands would silently discard real edits under real latency (unlikely to
  // ever show up against local mode's synchronous "network", which is why this surfaced first
  // against real production timing, not local testing). Also decides whether History's action-row/
  // disclosure state (computed once at edit-mode entry) needs an async refresh -- see
  // planLocationHistoryEventsAsyncResolution (js/location-history-events.js) for why both decisions
  // are extracted into one pure, unit-tested function.
  const plan=planLocationHistoryEventsAsyncResolution({
    isStale:locationHistoryEventsLoadToken!==token||locationProfileParticipationId!==location.id,
    resultOk:result?.ok,resultData:result?.data,
    isDirty:!!(tracker&&tracker.isDirty()),mode:locationProfileMode
  });
  if(plan.stale)return;
  locationHistoryEventsOriginal=plan.events;
  if(plan.resetDraft)resetLocationProfileHistoryEventsDraft();
  renderLocationProfileHistory(location);
  if(plan.refreshModules)renderLocationThematicModules();
  if(plan.expandHistoryDisclosure)setLocationThematicDisclosure("history",true);
  if(plan.captureInitialState&&tracker)tracker.captureInitialState();
}
// locationMediaCropState ({id, draft:{x,y,zoom}} | null) lives in js/state.js, not as a local `let`
// here -- js/app.js's crop-modal zoom/pointer-drag bindings need to read it as a bare identifier
// (mirroring photoCropState's exact treatment for Character photos), which only resolves correctly
// across module boundaries for state registered via state.js's Object.defineProperty(globalThis,...).

function locationMediaUnavailableHtml(){return '<span class="location-media-unavailable">Недоступно</span>'}

async function loadLocationMediaForProfile(location){
  const token=++locationMediaLoadToken;
  if(!isCloudWorkspace()){
    locationMediaOriginal=[];locationProfileMediaDraft=[];locationMediaDraftFiles.clear();
    renderLocationProfileMedia();renderLocationProfileMediaEditor();
    return;
  }
  const canonicalId=locationCanonicalId(location);
  const result=await cloudState.locationMediaApi?.listMedia(canonicalId,null);
  if(locationMediaLoadToken!==token||locationProfileParticipationId!==location.id)return;
  if(!result?.ok){
    locationMediaOriginal=[];locationProfileMediaDraft=[];
    renderLocationProfileMedia();renderLocationProfileMediaEditor();
    return;
  }
  const hydrated=mapMediaRowsForLazyRead(result.data);
  const paths=[...new Set(hydrated.filter(item=>item.source.kind==="storage").map(item=>item.source.storagePath))];
  const signedPairs=await Promise.all(paths.map(async path=>{
    const signed=await cloudState.locationMediaApi.signedUrl(path);
    return [path,signed.ok?signed.url:null];
  }));
  if(locationMediaLoadToken!==token||locationProfileParticipationId!==location.id)return;
  const signedUrlByPath=Object.fromEntries(signedPairs.filter(([,url])=>url));
  const withUrls=mapSignedUrlsOntoDraft(hydrated,signedUrlByPath);
  locationMediaOriginal=withUrls;
  locationProfileMediaDraft=withUrls.map(item=>({...item}));
  locationMediaDraftFiles.clear();
  renderLocationProfileMedia();
  renderLocationProfileMediaEditor();
  const tracker=trackerFor("locationProfileModal");
  if(tracker&&!tracker.isDirty())tracker.captureInitialState();
}

/* ---- Read mode ---- */

function renderLocationProfileMedia(){
  const el=document.getElementById("locationProfileMedia");if(!el)return;
  const groups=groupMediaByKind(locationMediaOriginal);
  if(!groups.length){el.hidden=true;el.innerHTML="";return}
  el.innerHTML=groups.map(renderLocationMediaReadGroup).join("");
  el.hidden=false;
}
function renderLocationMediaReadGroup(group){
  if(group.kind==="photo"){
    const primary=group.items.find(item=>item.isPrimary)||group.items[0];
    const rest=group.items.filter(item=>item.id!==primary.id);
    const heroImg=primary.source.value?`<img src="${esc(primary.source.value)}" alt="${esc(primary.alt||"")}">`:locationMediaUnavailableHtml();
    const railHtml=rest.map(item=>`<button type="button" class="location-media-thumb" aria-label="Открыть фото" onclick="openLocationMediaLightbox('${jsq(item.id)}')">${item.source.value?`<img src="${esc(item.source.value)}" alt="${esc(item.alt||"")}">`:locationMediaUnavailableHtml()}</button>`).join("");
    const captionHtml=primary.caption?`<p class="location-media-visual-caption">${esc(primary.caption)}</p>`:"";
    return `<div class="location-media-group">
      <h3 class="location-media-group-title">${esc(group.label)}</h3>
      <div class="location-media-hero-row">
        <button type="button" class="location-media-hero" aria-label="Открыть фото" onclick="openLocationMediaLightbox('${jsq(primary.id)}')">${heroImg}</button>
        ${rest.length?`<div class="location-media-thumb-rail">${railHtml}</div>`:""}
      </div>
      ${captionHtml}
    </div>`;
  }
  const showPrimaryMark=group.items.length>1;
  const itemsHtml=group.items.map(item=>{
    const img=item.source.value?`<img src="${esc(item.source.value)}" alt="${esc(item.alt||"")}">`:locationMediaUnavailableHtml();
    const captionHtml=item.caption?`<span class="location-media-visual-caption">${esc(item.caption)}</span>`:"";
    return `<div class="location-media-visual-item">
      <button type="button" class="location-media-visual-button" aria-label="Открыть изображение" onclick="openLocationMediaLightbox('${jsq(item.id)}')">${img}${item.isPrimary&&showPrimaryMark?'<span class="location-media-primary-mark" aria-hidden="true">★</span>':""}</button>
      ${captionHtml}
    </div>`;
  }).join("");
  return `<div class="location-media-group">
    <h3 class="location-media-group-title">${esc(group.label)}</h3>
    <div class="location-media-visual-grid">${itemsHtml}</div>
  </div>`;
}

function openLocationMediaLightbox(id){
  const item=locationProfileMediaDraft.find(i=>i.id===id)||locationMediaOriginal.find(i=>i.id===id);
  if(!item)return;
  const img=document.getElementById("locationMediaLightboxImage");
  img.src=item.source.value||"";img.alt=item.alt||"";
  document.getElementById("locationMediaLightboxCaption").textContent=item.caption||"";
  showModal("locationMediaLightboxModal");
}

/* ---- Edit mode ---- */

function renderLocationProfileMediaEditor(){
  const container=document.getElementById("locationProfileMediaGroups");if(!container)return;
  const addWrapper=document.getElementById("locationMediaAddWrapper");
  const note=document.getElementById("locationMediaCloudOnlyNote");
  if(!isCloudWorkspace()){
    container.innerHTML="";
    if(addWrapper)addWrapper.hidden=true;
    if(note)note.hidden=false;
    return;
  }
  if(note)note.hidden=true;
  if(addWrapper)addWrapper.hidden=false;
  const groups=groupMediaByKind(locationProfileMediaDraft);
  container.innerHTML=groups.map(renderLocationMediaEditorGroup).join("");
}
function renderLocationMediaEditorGroup(group){
  return `<div class="location-media-editor-group">
    <h4 class="location-media-editor-group-title">${esc(group.label)}</h4>
    <div class="location-media-editor-cards">${group.items.map(renderLocationMediaEditorCard).join("")}</div>
  </div>`;
}
function renderLocationMediaEditorCard(item){
  const cropApplicable=isCropApplicableKind(item.mediaKind);
  const thumbImg=item.source.value?`<img src="${esc(item.source.value)}" alt="">`:locationMediaUnavailableHtml();
  const primaryLabel=locationMediaKindPrimaryLabel(item.mediaKind);
  return `<article class="location-media-card" data-media-id="${esc(item.id)}" data-kind="${esc(item.mediaKind)}">
    <div class="location-media-card-preview">
      <button type="button" class="location-media-card-thumb" aria-label="Просмотреть" onclick="openLocationMediaLightbox('${jsq(item.id)}')">${thumbImg}${item.isPrimary?'<span class="location-media-primary-mark" aria-hidden="true">★</span>':""}</button>
    </div>
    <div class="location-media-card-fields">
      <div class="location-media-card-top"><span class="location-type-badge">${esc(locationMediaKindLabel(item.mediaKind))}</span></div>
      <textarea class="location-media-card-caption" data-draft-id="${esc(item.id)}" placeholder="Подпись (необязательно)" rows="2" aria-label="Подпись" oninput="updateLocationMediaDraftField('${jsq(item.id)}','caption',this.value)">${esc(item.caption)}</textarea>
      <input class="location-media-card-alt" data-draft-id="${esc(item.id)}" placeholder="Альтернативный текст (необязательно)" aria-label="Альтернативный текст" value="${esc(item.alt)}" oninput="updateLocationMediaDraftField('${jsq(item.id)}','alt',this.value)">
      <div class="location-media-card-actions">
        ${cropApplicable?`<button type="button" onclick="openLocationMediaCrop('${jsq(item.id)}')">Кадрировать</button>`:""}
        <button type="button" class="${item.isPrimary?"is-primary-active":""}" ${item.isPrimary?"disabled":""} onclick="setLocationMediaDraftPrimary('${jsq(item.id)}')">${item.isPrimary?"★ "+esc(primaryLabel):esc(primaryLabel)}</button>
        <button type="button" onclick="moveLocationMediaDraftItem('${jsq(item.id)}','up')" aria-label="Переместить раньше">↑</button>
        <button type="button" onclick="moveLocationMediaDraftItem('${jsq(item.id)}','down')" aria-label="Переместить позже">↓</button>
        <button type="button" class="location-media-card-delete" onclick="removeLocationMediaDraftItem('${jsq(item.id)}')">Удалить</button>
      </div>
    </div>
  </article>`;
}

function updateLocationMediaDraftField(id,field,value){
  const item=locationProfileMediaDraft.find(i=>i.id===id);if(!item)return;
  item[field]=value;
  syncBeforeUnload();
}
function setLocationMediaDraftPrimary(id){
  locationProfileMediaDraft=setDraftPrimary(locationProfileMediaDraft,id);
  renderLocationProfileMediaEditor();syncBeforeUnload();
}
function moveLocationMediaDraftItem(id,direction){
  locationProfileMediaDraft=reorderDraftItem(locationProfileMediaDraft,id,direction);
  renderLocationProfileMediaEditor();syncBeforeUnload();
}
// "Remove" here means "drop from the draft" -- never an immediate production delete (task brief
// "DELETE UX"). No confirmation prompt, mirroring the Character photo precedent (removeActiveProfilePhoto)
// exactly: draft removal is non-destructive until Profile Save, so a confirm dialog would be noise.
function removeLocationMediaDraftItem(id){
  const item=locationProfileMediaDraft.find(i=>i.id===id);
  if(item?.source?.kind==="pending"&&item.source.value)URL.revokeObjectURL(item.source.value);
  locationMediaDraftFiles.delete(id);
  locationProfileMediaDraft=removeDraftItem(locationProfileMediaDraft,id);
  renderLocationProfileMediaEditor();syncBeforeUnload();
}

function toggleLocationMediaAddPanel(){
  locationMediaAddPanelOpen=!locationMediaAddPanelOpen;
  const toggle=document.getElementById("locMediaAddToggle"),panel=document.getElementById("locMediaAddPanel");
  if(toggle)toggle.setAttribute("aria-expanded",String(locationMediaAddPanelOpen));
  if(panel)panel.hidden=!locationMediaAddPanelOpen;
}
function closeLocationMediaAddPanel(){
  locationMediaAddPanelOpen=false;
  const toggle=document.getElementById("locMediaAddToggle"),panel=document.getElementById("locMediaAddPanel");
  if(toggle)toggle.setAttribute("aria-expanded","false");
  if(panel)panel.hidden=true;
}
function startAddLocationMedia(kind){
  if(!isValidLocationMediaKind(kind))return;
  locationMediaPendingKind=kind;
  closeLocationMediaAddPanel();
  const input=document.getElementById("locMediaFileInput");
  if(input){input.value="";input.click()}
}
function handleLocationMediaFileChosen(event){
  const file=event.target.files?.[0];
  event.target.value="";
  if(!file||!locationMediaPendingKind)return;
  const kind=locationMediaPendingKind;locationMediaPendingKind=null;
  const validation=validateLocationMediaFile(file);
  if(!validation.ok){locationProfileSaveButton.showStatus(validation.message,"error");return}
  const objectUrl=URL.createObjectURL(file);
  const sameKind=locationProfileMediaDraft.filter(item=>item.mediaKind===kind);
  // A real UUID, not the pure module's placeholder-id fallback: this id becomes the actual
  // create_location_media media_id (and the Storage path segment) at Save time. The first item of
  // a kind becomes its primary automatically -- mirrors the Character precedent exactly
  // (profileDraftPrimaryPhotoId ||= photo.id on the first photo) -- so a Location with exactly one
  // photo/map/floorplan never needs an extra explicit "make primary" click before it can act as
  // that kind's cover.
  const draftItem=createDraftMediaItem({id:crypto.randomUUID(),mediaKind:kind,objectUrl,sortOrder:sameKind.length,isPrimary:!primaryOfKind(locationProfileMediaDraft,kind)});
  locationMediaDraftFiles.set(draftItem.id,file);
  locationProfileMediaDraft=[...locationProfileMediaDraft,draftItem];
  renderLocationProfileMediaEditor();
  syncBeforeUnload();
}

/* ---- Crop (photo only; reuses the Character crop math, cropImageStyle, js/characters.js) ---- */

function openLocationMediaCrop(id){
  const item=locationProfileMediaDraft.find(i=>i.id===id);
  if(!item||!isCropApplicableKind(item.mediaKind))return;
  locationMediaCropState={id,draft:{...item.crop}};
  document.getElementById("locationMediaCropImage").src=item.source.value||"";
  syncLocationMediaCropPreview();
  showModal("locationMediaCropModal",{initialFocus:"#locationMediaCropZoom"});
}
function syncLocationMediaCropPreview(){
  const crop=locationMediaCropState?.draft;if(!crop)return;
  document.getElementById("locationMediaCropImage").style.cssText=cropImageStyle(crop);
  document.getElementById("locationMediaCropZoom").value=crop.zoom;
}
function nudgeLocationMediaCrop(dx,dy){
  if(!locationMediaCropState)return;
  locationMediaCropState.draft.x=Math.max(0,Math.min(1,locationMediaCropState.draft.x-dx));
  locationMediaCropState.draft.y=Math.max(0,Math.min(1,locationMediaCropState.draft.y-dy));
  syncLocationMediaCropPreview();
}
function saveLocationMediaCrop(){
  if(!locationMediaCropState)return;
  const {id,draft}=locationMediaCropState;
  locationProfileMediaDraft=locationProfileMediaDraft.map(item=>item.id===id?{...item,crop:{...draft}}:item);
  locationMediaCropState=null;
  renderLocationProfileMediaEditor();
  forceHideModal("locationMediaCropModal");
  syncBeforeUnload();
}
function cancelLocationMediaCrop(){locationMediaCropState=null;forceHideModal("locationMediaCropModal")}

/* ---- Save reconciliation ----
 * NEW/CHANGED/REMOVED per js/location-media.js's diffLocationMediaDraft, applied in the safe order
 * planLocationMediaSaveOrder computes (delete -> update[non-primary-setting first, primary-setting
 * last] -> create). expectedRevision for create/delete is threaded from whatever the PREVIOUS
 * canonical-domain call in this same Save actually returned (never invented client-side) -- see
 * that module's header for why this ordering is what keeps every expected_revision value fresh. */
async function reconcileLocationMediaDraft(canonicalId,startingLocationRevision){
  const diff=diffLocationMediaDraft(locationMediaOriginal,locationProfileMediaDraft);
  if(!diff.toCreate.length&&!diff.toUpdate.length&&!diff.toDelete.length)return {ok:true,changed:false,locationRevision:startingLocationRevision};
  const planned=planLocationMediaSaveOrder(diff);
  const api=cloudState.locationMediaApi;
  let locationRevision=startingLocationRevision;

  for(const removed of planned.toDelete){
    const result=await api.deleteMedia(removed.id,removed.revision);
    if(!result.ok)return {ok:false,message:result.message||"Не удалось удалить медиа."};
    if(result.locationRevision!=null)locationRevision=result.locationRevision;
  }
  for(const {item,before} of planned.toUpdate){
    const result=await api.updateMedia(item.id,before.revision,buildUpdateMediaChanges(item));
    if(!result.ok)return {ok:false,message:result.message||"Не удалось обновить медиа."};
  }
  for(const item of planned.toCreate){
    const file=locationMediaDraftFiles.get(item.id);
    if(!file)continue;
    const result=await api.uploadMedia({
      locationId:canonicalId,mediaId:item.id,file,
      media:{id:item.id,mediaKind:item.mediaKind,crop:item.crop,alt:item.alt,caption:item.caption},
      expectedRevision:locationRevision,isPrimary:item.isPrimary,sortOrder:item.sortOrder
    });
    if(!result.ok)return {ok:false,message:result.orphaned?"Изображение не сохранено; загруженный объект отмечен для ручной очистки.":(result.message||"Не удалось загрузить медиа.")};
    if(result.locationRevision!=null)locationRevision=result.locationRevision;
    locationMediaDraftFiles.delete(item.id);
    URL.revokeObjectURL(item.source.value);
  }
  return {ok:true,changed:true,locationRevision};
}

// Extra-state slot for the locationProfileModal dirty-tracker (js/app.js) -- the media draft is
// custom state, not a set of native form controls serializeForm's own scan can read (see this
// file's B4B Media header comment for why caption/alt inputs are pushed into the draft directly
// rather than relying on that scan).
function currentLocationProfileMediaSnapshot(){return locationMediaDraftSnapshot(locationProfileMediaDraft)}

/* ---------- Owned-location hierarchy cache ----------
 * A single owner-scoped fetch (list_owned_locations) backs both the parent picker and the
 * breadcrumb walk — see the Phase 3 migration header ("GLOBAL PARENT/BREADCRUMB READ
 * SURFACE"). Cached per active cloud project and only refetched on explicit invalidation
 * (after a canonical create/update/parent mutation) or a project switch — never on every
 * keystroke. In local mode there is no separate canonical table, so the "owned rows" are
 * synthesized directly from data.locations on every call (cheap, always in sync, no cache
 * needed since there is nothing to fetch). */

let ownedLocationsCache=null; // {projectId, rows:Map<canonicalId,row>}

function ownedLocationRowsSync(){
  if(!isCloudWorkspace()){
    // Local mode has no canonical/participation split at all -- a local Location can only ever
    // "be in" the one local project, so participation_count is always 1 (see the contract
    // addendum's local-mode note: delete-safety UX's cross-project warning is structurally
    // unreachable in local mode, not merely rare).
    return new Map(data.locations.map(l=>[l.id,{
      id:l.id,name:l.name,official_name:l.officialName||null,aliases:l.aliases||[],
      parent_id:l.parentId||null,type_preset:l.typePreset||null,custom_type_label:l.customTypeLabel||null,
      participation_count:1
    }]));
  }
  return ownedLocationsCache?.rows||new Map();
}

async function ensureOwnedLocationsLoaded(force=false){
  if(!isCloudWorkspace())return null;
  const projectId=cloudProjectSync.projectId;
  if(!force&&ownedLocationsCache&&ownedLocationsCache.projectId===projectId)return ownedLocationsCache;
  const result=await cloudProjectSync.api.listOwnedLocations();
  if(!result.ok)return ownedLocationsCache; // keep whatever we had rather than blanking a working cache
  ownedLocationsCache={projectId,rows:new Map((result.data||[]).map(row=>[row.id,row]))};
  return ownedLocationsCache;
}

function invalidateOwnedLocationsCache(){ownedLocationsCache=null}

async function loadOwnedLocationRows(force=false){
  if(isCloudWorkspace())await ensureOwnedLocationsLoaded(force);
  return ownedLocationRowsSync();
}

// Root-first ancestor chain for `canonicalId`, walking rows.parent_id. Bounded (mirrors the
// server's own set_location_parent cycle-walk depth) and stops cleanly — never throws/hangs —
// if a parent id is missing from the fetched rows (not participating anywhere reachable) or if
// the client-side data happens to be cycle-shaped.
function locationAncestors(canonicalId,rows,maxDepth=64){
  const chain=[],visited=new Set([canonicalId]);
  let currentId=rows.get(canonicalId)?.parent_id??null;
  while(currentId&&chain.length<maxDepth){
    if(visited.has(currentId))break;
    const row=rows.get(currentId);if(!row)break;
    visited.add(currentId);chain.unshift(row);currentId=row.parent_id??null;
  }
  return chain;
}

// Descendant id set of `canonicalId` (any depth), used to keep the parent picker from offering
// a move that the server would reject as a cycle anyway — client-side convenience only; the
// server's set_location_parent walk remains the real authority (see its migration header).
function locationDescendantIds(canonicalId,rows,maxDepth=64){
  const childrenByParent=new Map();
  for(const row of rows.values()){
    if(!row.parent_id)continue;
    if(!childrenByParent.has(row.parent_id))childrenByParent.set(row.parent_id,[]);
    childrenByParent.get(row.parent_id).push(row.id);
  }
  const result=new Set(),visited=new Set([canonicalId]);
  let frontier=[canonicalId],depth=0;
  while(frontier.length&&depth<maxDepth){
    const next=[];
    for(const id of frontier)for(const childId of childrenByParent.get(id)||[]){
      if(visited.has(childId))continue;
      visited.add(childId);result.add(childId);next.push(childId);
    }
    frontier=next;depth++;
  }
  return result;
}

/* ---------- Gallery ---------- */

function openLocationGallery(){
  closeProjectMenu();
  locationGalleryQuery="";
  const searchInput=document.getElementById("locationGallerySearch");
  if(searchInput)searchInput.value="";
  renderLocationGallery();
  showModal("locationsModal");
  // Parent-context fragments on cards degrade gracefully if this hasn't resolved yet; once it
  // has, re-render picks it up. Only re-renders if the Gallery is still the open modal.
  loadOwnedLocationRows().then(()=>{if(document.getElementById("locationsModal")?.style.display==="flex")renderLocationGallery()});
}

function setLocationGallerySearch(value){
  locationGalleryQuery=value||"";
  renderLocationGallery();
}

function setLocationGalleryTypeFilter(value){
  locationGalleryTypeFilter=value||"";
  renderLocationGallery();
}

function locationMatchesGalleryQuery(location,query){
  if(!query)return true;
  const haystack=[location.name,location.officialName,...(location.aliases||[]),location.shortSummary,location.description]
    .filter(Boolean).join("\n").toLocaleLowerCase("ru");
  return haystack.includes(query);
}

function locationMatchesTypeFilter(location){
  if(!locationGalleryTypeFilter)return true;
  return location.typePreset===locationGalleryTypeFilter;
}

// Only presets actually represented among this project's participating Locations — never a
// full 12-option wall of mostly-empty filters (see Phase B2 "TYPE FILTER" guidance).
function locationTypeFilterOptions(){
  const present=new Set(data.locations.map(l=>l.typePreset).filter(Boolean));
  return LOCATION_TYPE_PRESETS.filter(p=>present.has(p.value));
}

function renderLocationGalleryTypeFilter(){
  const select=document.getElementById("locationGalleryTypeFilter");if(!select)return;
  const options=locationTypeFilterOptions();
  const wrapper=select.closest(".location-gallery-type-filter");
  if(!options.length){if(wrapper)wrapper.hidden=true;return}
  if(wrapper)wrapper.hidden=false;
  const desired=locationGalleryTypeFilter;
  select.innerHTML=`<option value="">Все типы</option>${options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}`;
  const stillValid=options.some(o=>o.value===desired);
  select.value=stillValid?desired:"";
  if(!stillValid)locationGalleryTypeFilter="";
}

function renderLocationGallery(){
  const grid=document.getElementById("locationsGalleryGrid");if(!grid)return;
  renderLocationGalleryTypeFilter();
  const query=locationGalleryQuery.trim().toLocaleLowerCase("ru");
  const items=data.locations.filter(location=>locationMatchesGalleryQuery(location,query)&&locationMatchesTypeFilter(location));
  if(!items.length){
    grid.innerHTML=`<div class="empty-work">${data.locations.length?"Совпадений не найдено.":"В этом проекте пока нет локаций. Создайте первую, когда будете готовы."}</div>`;
    return;
  }
  const rows=ownedLocationRowsSync();
  grid.innerHTML=items.map(location=>{
    const participationId=location.id;
    const sceneCount=locationSceneEntries(participationId).length;
    const monogram=(location.name||"").trim().charAt(0).toLocaleUpperCase("ru")||"?";
    const typeLabel=locationDisplayTypeLabel(location);
    const parentRow=location.parentId?rows.get(location.parentId):null;
    const excerpt=((location.shortSummary||"").trim())||((location.description||"").trim());
    // Gallery cover (B4C): same 26px circular slot the monogram already occupies -- see the
    // "Corrective pass" comment on .location-card-monogram in css/locations.css for why this
    // deliberately stays small (a full-width image band was already tried and rejected here for
    // reading as an empty placeholder). The monogram letter is always rendered as the fallback
    // node underneath; a signed cover <img>, if one resolves, layers on top of it asynchronously
    // (renderLocationGalleryCovers below) -- so a signing failure or a Location with no primary
    // photo at all silently keeps today's exact monogram, never a broken image. Canonical primary
    // photo only (get_project_content's existing bounded primary_photo projection) -- never a
    // map/floorplan/other fallback, never project-scoped media.
    const coverInfo=locationGalleryCoverInfo(location);
    const coverHtml=coverInfo.hasCover
      ?`<span class="location-card-cover-fallback">${esc(monogram)}</span>`
      :esc(monogram);
    return `<article class="location-card" data-location-id="${esc(participationId)}">
      <button type="button" class="location-card-open" onclick="openLocationProfile('${jsq(participationId)}')" aria-label="Открыть локацию «${esc(location.name||"без названия")}»">
        <span class="location-card-identity">
          <span class="location-card-monogram" aria-hidden="true" data-cover-path="${coverInfo.hasCover?esc(coverInfo.storagePath):""}">${coverHtml}</span>
          <span class="location-card-name" title="${esc(location.name||"Без названия")}">${esc(location.name||"Без названия")}</span>
          ${typeLabel?`<span class="location-type-badge location-type-badge-sm" title="${esc(typeLabel)}">${esc(typeLabel)}</span>`:""}
        </span>
        ${parentRow?`<span class="location-card-parent">в «${esc(parentRow.name||"")}»</span>`:""}
        ${excerpt?`<span class="location-card-excerpt">${esc(excerpt)}</span>`:""}
      </button>
      <div class="location-card-footer">
        <span class="stat-pill">Сцен <strong>${sceneCount}</strong></span>
        <span class="location-card-footer-spacer" aria-hidden="true"></span>
        <button type="button" class="row-action-quiet danger-quiet" aria-label="Удалить локацию «${esc(location.name||"без названия")}»" title="Удалить" onclick="deleteLocationFromGallery('${jsq(participationId)}')">🗑</button>
      </div>
    </article>`;
  }).join("");
  renderLocationGalleryCovers();
}

// Async cover enhancement: bounded to the cards that actually have a canonical primary photo
// (get_project_content already supplied that metadata as part of the ONE project-content request
// -- no per-card list_location_media call, no full media load). Each signed URL goes through
// cloudState.locationMediaApi's own existing cache (js/cloud-location-media-api.js, B4A/B4B) rather
// than a second parallel cache -- repeated Gallery renders (search/filter keystrokes) therefore
// never re-sign a path that's still fresh. A signing failure leaves the fallback letter exactly as
// it already rendered synchronously above -- no broken <img>, no layout shift either way, since the
// wrapper is always the same 26px circle regardless of which child ends up visible.
async function renderLocationGalleryCovers(){
  const grid=document.getElementById("locationsGalleryGrid");if(!grid)return;
  const nodes=[...grid.querySelectorAll(".location-card-monogram[data-cover-path]")].filter(el=>el.dataset.coverPath);
  await Promise.all(nodes.map(async el=>{
    const path=el.dataset.coverPath;
    const signed=await cloudState.locationMediaApi?.signedUrl(path);
    if(resolveGalleryCoverOutcome(signed)!=="cover"||!grid.contains(el))return; // failure, or the Gallery re-rendered while awaiting
    if(el.querySelector("img"))return; // already enhanced by an earlier overlapping render
    const img=document.createElement("img");
    img.src=signed.url;img.alt="";
    // No crop offset here: get_project_content's primary_photo projection is metadata-only
    // (id/storage_path/mime_type/alt, no crop -- adding it would change an already-shipped RPC's
    // body, which B4C's scope explicitly excludes). Centered object-fit:cover is the exact
    // DEFAULT crop {x:.5,y:.5,zoom:1} every photo starts from, so this only visibly differs from
    // the Profile's own cropped rendering for a photo the author explicitly re-cropped off-center.
    img.style.cssText=cropImageStyle({x:.5,y:.5,zoom:1});
    el.replaceChildren(img);
  }));
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
    if(result.ok){data=cloudProjectSync.confirmedProject;invalidateOwnedLocationsCache()}
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

/* ---------- Profile: read-model rendering ---------- */

// The Profile opens in a read-only display (name/scene-count header, an identity intro block,
// a readable description, and the read-only "Scenes here" list) rather than immediately looking
// like an edit form. "Редактировать" is the single entry into edit mode.
function populateLocationProfileCore(participationId){
  const location=locationById(participationId);if(!location)return null;
  locationProfileParticipationId=participationId;
  document.getElementById("locationProfileTitle").textContent=location.name||"Локация";
  const sceneCount=locationSceneEntries(participationId).length;
  document.getElementById("locationProfileSceneCount").innerHTML=`Сцен <strong>${sceneCount}</strong>`;
  syncLocationProfileEditFields(location);
  renderLocationProfileSummary(location);
  renderLocationProfileIntro(location,ownedLocationRowsSync());
  locationProfileChildrenExpanded=false;
  renderLocationProfileChildren(location);
  renderLocationProfileAppearance(location);
  renderLocationProfileGeography(location);
  renderLocationProfileGovernmentSociety(location);
  renderLocationProfileEconomy(location);
  renderLocationProfilePopulationCulture(location);
  renderLocationProfileHistory(location);
  renderLocationProfileScenes(participationId);
  refreshLocationHierarchyContext(location);
  loadLocationMediaForProfile(location);
  loadLocationHistoryEventsForProfile(location);
  return location;
}

// Fire-and-forget: repaints the breadcrumb + refreshes the parent picker's candidate list once
// the owned-location fetch resolves, without blocking the Profile from opening instantly. Bails
// out quietly if the Profile has since navigated to a different Location.
async function refreshLocationHierarchyContext(location){
  const rows=await loadOwnedLocationRows();
  if(locationProfileParticipationId!==location.id)return;
  renderLocationProfileIntro(location,rows);
  const canonicalId=locationCanonicalId(location);
  const picker=ensureLocationParentPicker();
  picker.setRows(rows);
  picker.setExclude(new Set([canonicalId,...locationDescendantIds(canonicalId,rows)]));
}

function syncLocationProfileEditFields(location){
  document.getElementById("locProfileName").value=location.name||"";
  document.getElementById("locProfileOfficialName").value=location.officialName||"";
  document.getElementById("locProfileTypePreset").value=location.typePreset||"";
  document.getElementById("locProfileCustomTypeLabel").value=location.customTypeLabel||"";
  document.getElementById("locProfileShortSummary").value=location.shortSummary||"";
  document.getElementById("locProfileDescription").value=location.description||"";
  ensureLocationAliasesWidget().setValues(location.aliases||[]);
  locationProfileOriginalParentId=location.parentId||null;
  const picker=ensureLocationParentPicker();
  picker.setRows(ownedLocationRowsSync());
  picker.setSelected(locationProfileOriginalParentId);
  syncLocationProfileThematicFields(location);
  resetLocationProfileMediaDraft();
  resetLocationProfileHistoryEventsDraft();
}

// Reverts the history-events draft back to the last-loaded persisted truth
// (locationHistoryEventsOriginal) -- called on every fresh entry into edit mode AND on Cancel (both
// funnel through syncLocationProfileEditFields), mirroring resetLocationProfileMediaDraft exactly.
function resetLocationProfileHistoryEventsDraft(){
  locationProfileHistoryEventsDraft=locationHistoryEventsOriginal.map(item=>({...item}));
  locationHistoryEventEditingId=null;
  renderLocationHistoryEventsEditor();
}

// Reverts the media draft back to the last-loaded persisted truth (locationMediaOriginal) --
// called on every fresh entry into edit mode AND on Cancel (both funnel through
// syncLocationProfileEditFields, same as every other field), so Cancel discards media edits with
// zero Storage/DB side effects, exactly like every other draft field.
function resetLocationProfileMediaDraft(){
  for(const url of collectPendingObjectUrls(locationProfileMediaDraft))URL.revokeObjectURL(url);
  locationMediaDraftFiles.clear();
  locationProfileMediaDraft=locationMediaOriginal.map(item=>({...item}));
  closeLocationMediaAddPanel();
  renderLocationProfileMediaEditor();
}

function renderLocationProfileSummary(location){
  const el=document.getElementById("locationProfileSummary");if(!el)return;
  const description=(location.description||"").trim();
  el.innerHTML=description
    ?`<p class="location-profile-description">${esc(description)}</p>`
    :`<button type="button" class="location-profile-description-empty" onclick="enterLocationProfileEdit()">Описание пока не добавлено</button>`;
}

function renderLocationProfileIntro(location,rows){
  const el=document.getElementById("locationProfileIntro");if(!el)return;
  const typeLabel=locationDisplayTypeLabel(location);
  const canonicalId=locationCanonicalId(location);
  const ancestors=rows.size?locationAncestors(canonicalId,rows):[];
  const participatingByCanonical=new Map(data.locations.map(l=>[locationCanonicalId(l),l.id]));
  // Ancestors are Locations from the user's global canonical universe — they don't necessarily
  // participate in the CURRENT project (see Phase B2 "HIERARCHY" audit). Only a participating
  // ancestor opens as a Profile; a non-participating one renders as plain, non-clickable text.
  const breadcrumbHtml=ancestors.length?`<nav class="location-breadcrumb" aria-label="Иерархия локации">${
    ancestors.map(row=>{
      const pid=participatingByCanonical.get(row.id);
      const segment=pid
        ?`<button type="button" class="location-breadcrumb-link" onclick="openLocationProfile('${jsq(pid)}')">${esc(row.name||"Без названия")}</button>`
        :`<span class="location-breadcrumb-plain">${esc(row.name||"Без названия")}</span>`;
      return `${segment}<span class="location-breadcrumb-sep" aria-hidden="true">›</span>`;
    }).join("")
  }<span class="location-breadcrumb-current">${esc(location.name||"")}</span></nav>`:"";
  const aliases=location.aliases||[];
  const aliasesHtml=aliases.length?`<div class="location-profile-aliases">${aliases.map(a=>`<span class="location-alias-chip">${esc(a)}</span>`).join("")}</div>`:"";
  const summary=(location.shortSummary||"").trim();
  const summaryHtml=summary?`<p class="location-profile-short-summary">${esc(summary)}</p>`:"";
  const officialName=(location.officialName||"").trim();
  const officialNameHtml=officialName&&officialName!==location.name?`<p class="location-profile-official-name">${esc(officialName)}</p>`:"";
  el.innerHTML=`${typeLabel?`<span class="location-type-badge">${esc(typeLabel)}</span>`:""}${breadcrumbHtml}${officialNameHtml}${summaryHtml}${aliasesHtml}`;
  el.hidden=!el.innerHTML.trim();
}

/* ---------- Profile: B3A.1 child locations ("Внутри") ----------
 * Direct project-participating children only -- see js/location-hierarchy.js for the derivation
 * (canonical-id comparison, not participation-id) and the task brief's "WHICH CHILDREN TO SHOW" /
 * "DIRECT CHILDREN ONLY" sections. Hidden entirely (no placeholder) when the Location is a leaf,
 * same contract as the B3A thematic modules. Large child counts stay usable via a local
 * show-more/collapse toggle (reset whenever the Profile opens a different Location), mirroring the
 * sidebar's own "Показать ещё" pattern (js/render.js) rather than an inner scrollbar or pagination. */
const LOCATION_CHILDREN_VISIBLE_COUNT=6;

function renderLocationChildRow(child){
  const name=child.name||"Без названия";
  const typeLabel=locationDisplayTypeLabel(child);
  const sceneCount=locationSceneEntries(child.id).length;
  const metaParts=[typeLabel,sceneCount?`Сцен ${sceneCount}`:null].filter(Boolean);
  const excerpt=((child.shortSummary||"").trim())||((child.description||"").trim());
  return `<button type="button" class="location-profile-child-row" onclick="openLocationProfile('${jsq(child.id)}')" aria-label="Открыть локацию «${esc(name)}»">
    <span class="location-profile-child-title" title="${esc(name)}">${esc(name)}</span>
    ${metaParts.length?`<span class="location-profile-child-meta">${esc(metaParts.join(" · "))}</span>`:""}
    ${excerpt?`<span class="location-profile-child-excerpt">${esc(excerpt)}</span>`:""}
  </button>`;
}

function renderLocationProfileChildren(location){
  const el=document.getElementById("locationProfileChildren");if(!el)return;
  const children=locationDirectChildren(locationCanonicalId(location),data.locations);
  if(!children.length){el.hidden=true;el.innerHTML="";return}
  const visible=locationProfileChildrenExpanded?children:children.slice(0,LOCATION_CHILDREN_VISIBLE_COUNT);
  const remaining=children.length-visible.length;
  let moreHtml="";
  if(remaining>0)moreHtml=`<button type="button" class="location-profile-children-more" onclick="toggleLocationProfileChildrenExpanded()">Показать ещё (${remaining})</button>`;
  else if(locationProfileChildrenExpanded&&children.length>LOCATION_CHILDREN_VISIBLE_COUNT)moreHtml=`<button type="button" class="location-profile-children-more" onclick="toggleLocationProfileChildrenExpanded()">Свернуть</button>`;
  el.innerHTML=`<h3 class="location-profile-thematic-title">Внутри</h3><div class="location-profile-children-list">${visible.map(renderLocationChildRow).join("")}</div>${moreHtml}`;
  el.hidden=false;
}

function toggleLocationProfileChildrenExpanded(){
  locationProfileChildrenExpanded=!locationProfileChildrenExpanded;
  const location=locationById(locationProfileParticipationId);
  if(location)renderLocationProfileChildren(location);
}

/* ---------- Profile: B3A thematic modules (Appearance & Atmosphere / Geography) ----------
 * Read-mode rendering, edit-mode field sync/read, disclosure state, and Clear-section actions.
 * Normalization/patch-building logic itself lives in js/location-base-profile.js (pure, unit-
 * tested); this file only wires that logic to the DOM. See that file's header for the three-state
 * patch contract this mirrors from update_location_canonical. */

// entries: [[label,value], ...] already filtered to non-empty values.
function renderLocationThematicFacts(entries){
  if(!entries.length)return "";
  return `<dl class="location-profile-facts">${entries.map(([label,value])=>
    `<div class="location-profile-fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`
  ).join("")}</dl>`;
}
function renderLocationThematicChips(label,values){
  if(!values.length)return "";
  return `<div class="location-profile-thematic-chips"><span class="location-profile-thematic-chips-label">${esc(label)}</span><div class="location-profile-aliases">${values.map(v=>`<span class="location-alias-chip">${esc(v)}</span>`).join("")}</div></div>`;
}

function renderLocationProfileAppearance(location){
  const el=document.getElementById("locationProfileAppearance");if(!el)return;
  if(!locationModuleReadVisible(location,location.moduleSelection,"appearanceAtmosphere")){el.hidden=true;el.innerHTML="";return}
  const m=normalizeAppearanceAtmosphere(location.baseProfile?.appearanceAtmosphere);
  if(isModuleEmpty(m)){el.hidden=true;el.innerHTML="";return}
  const proseHtml=[
    m.visualDescription?`<p class="location-profile-thematic-prose">${esc(m.visualDescription)}</p>`:"",
    m.atmosphere?`<p class="location-profile-thematic-prose location-profile-thematic-prose-secondary">${esc(m.atmosphere)}</p>`:""
  ].join("");
  const factsHtml=renderLocationThematicFacts([
    ["Звуки",m.sounds],["Запахи",m.smells],["Освещение",m.lighting],["Ощущение климата",m.climateFeel]
  ].filter(([,value])=>value));
  const chipsHtml=renderLocationThematicChips("Характерные детали",m.notableFeatures||[]);
  el.innerHTML=`<h3 class="location-profile-thematic-title">Внешний вид и атмосфера</h3>${proseHtml}${factsHtml}${chipsHtml}`;
  el.hidden=false;
}

// Рельеф/климат/вода/растительность/доступ (Geography) and, from B3B, politicalSituation/
// lawsAndRules (Government & Society) and economicCharacter (Economy) read as prose once they run
// past a short phrase (a long sentence in a label:value fact row wraps awkwardly); short values
// stay compact facts. See task brief "GEOGRAPHY" / B3B spec section 10 -- one shared threshold,
// reused rather than duplicated per module.
const LOCATION_THEMATIC_PROSE_THRESHOLD=80;
const LOCATION_GEOGRAPHY_VARIABLE_LABELS={terrain:"Рельеф",climate:"Климат",water:"Вода",vegetation:"Растительность",access:"Доступ"};

function renderLocationProfileGeography(location){
  const el=document.getElementById("locationProfileGeography");if(!el)return;
  if(!locationModuleReadVisible(location,location.moduleSelection,"geography")){el.hidden=true;el.innerHTML="";return}
  const m=normalizeGeography(location.baseProfile?.geography);
  if(isModuleEmpty(m)){el.hidden=true;el.innerHTML="";return}
  const proseParts=[],factEntries=[];
  for(const key of ["terrain","climate","water","vegetation","access"]){
    const value=m[key];if(!value)continue;
    if(value.length>LOCATION_THEMATIC_PROSE_THRESHOLD)proseParts.push(`<p class="location-profile-thematic-prose"><strong>${esc(LOCATION_GEOGRAPHY_VARIABLE_LABELS[key])}:</strong> ${esc(value)}</p>`);
    else factEntries.push([LOCATION_GEOGRAPHY_VARIABLE_LABELS[key],value]);
  }
  factEntries.push(...[["Координаты",m.coordinates],["Площадь",m.area],["Высота",m.elevation]].filter(([,value])=>value));
  const factsHtml=renderLocationThematicFacts(factEntries);
  const chipsHtml=renderLocationThematicChips("Природные особенности",m.naturalFeatures||[]);
  el.innerHTML=`<h3 class="location-profile-thematic-title">География и природа</h3>${proseParts.join("")}${factsHtml}${chipsHtml}`;
  el.hidden=false;
}

// B3B read order (spec section 10): politicalSituation, lawsAndRules (prose-or-fact by length) ->
// governmentForm, leadership (always-compact facts) -> securityForces, notableInstitutions (chips).
const LOCATION_GOVERNMENT_SOCIETY_PROSE_LABELS={politicalSituation:"Политическая обстановка",lawsAndRules:"Законы и порядки"};

function renderLocationProfileGovernmentSociety(location){
  const el=document.getElementById("locationProfileGovernmentSociety");if(!el)return;
  if(!locationModuleReadVisible(location,location.moduleSelection,"governmentSociety")){el.hidden=true;el.innerHTML="";return}
  const m=normalizeGovernmentSociety(location.baseProfile?.governmentSociety);
  if(isModuleEmpty(m)){el.hidden=true;el.innerHTML="";return}
  const proseParts=[],factEntries=[];
  for(const key of ["politicalSituation","lawsAndRules"]){
    const value=m[key];if(!value)continue;
    if(value.length>LOCATION_THEMATIC_PROSE_THRESHOLD)proseParts.push(`<p class="location-profile-thematic-prose"><strong>${esc(LOCATION_GOVERNMENT_SOCIETY_PROSE_LABELS[key])}:</strong> ${esc(value)}</p>`);
    else factEntries.push([LOCATION_GOVERNMENT_SOCIETY_PROSE_LABELS[key],value]);
  }
  factEntries.push(...[["Форма правления",m.governmentForm],["Кто управляет",m.leadership]].filter(([,value])=>value));
  const factsHtml=renderLocationThematicFacts(factEntries);
  const chipsHtml=renderLocationThematicChips("Силы порядка",m.securityForces||[])+renderLocationThematicChips("Учреждения и организации",m.notableInstitutions||[]);
  el.innerHTML=`<h3 class="location-profile-thematic-title">Государство и общество</h3>${proseParts.join("")}${factsHtml}${chipsHtml}`;
  el.hidden=false;
}

// B3B read order (spec section 10): economicCharacter (prose-or-fact by length) -> currency,
// costOfLiving (always-compact facts) -> industries, scarcity, tradeConnections (chips).
function renderLocationProfileEconomy(location){
  const el=document.getElementById("locationProfileEconomy");if(!el)return;
  if(!locationModuleReadVisible(location,location.moduleSelection,"economy")){el.hidden=true;el.innerHTML="";return}
  const m=normalizeEconomy(location.baseProfile?.economy);
  if(isModuleEmpty(m)){el.hidden=true;el.innerHTML="";return}
  const proseParts=[],factEntries=[];
  if(m.economicCharacter){
    if(m.economicCharacter.length>LOCATION_THEMATIC_PROSE_THRESHOLD)proseParts.push(`<p class="location-profile-thematic-prose">${esc(m.economicCharacter)}</p>`);
    else factEntries.push(["Экономическая жизнь",m.economicCharacter]);
  }
  factEntries.push(...[["Валюта",m.currency],["Стоимость жизни",m.costOfLiving]].filter(([,value])=>value));
  const factsHtml=renderLocationThematicFacts(factEntries);
  const chipsHtml=renderLocationThematicChips("Основные отрасли и источники дохода",m.industries||[])
    +renderLocationThematicChips("В дефиците",m.scarcity||[])
    +renderLocationThematicChips("Торговые связи",m.tradeConnections||[]);
  el.innerHTML=`<h3 class="location-profile-thematic-title">Экономика</h3>${proseParts.join("")}${factsHtml}${chipsHtml}`;
  el.hidden=false;
}

// B3C read order (spec): populationCharacter, customsAndTraditions, socialNorms (always prose --
// unlike Geography/Government/Economy's ambiguous fields, all three are declared free-prose
// textareas in the field contract, so there is no length threshold to apply here, same treatment
// as Appearance's visualDescription/atmosphere) -> peoplesAndGroups, languages, beliefs, holidays
// (chips, in that fixed order).
function renderLocationProfilePopulationCulture(location){
  const el=document.getElementById("locationProfilePopulationCulture");if(!el)return;
  if(!locationModuleReadVisible(location,location.moduleSelection,"populationCulture")){el.hidden=true;el.innerHTML="";return}
  const m=normalizePopulationCulture(location.baseProfile?.populationCulture);
  if(isModuleEmpty(m)){el.hidden=true;el.innerHTML="";return}
  const proseHtml=[
    m.populationCharacter?`<p class="location-profile-thematic-prose">${esc(m.populationCharacter)}</p>`:"",
    m.customsAndTraditions?`<p class="location-profile-thematic-prose location-profile-thematic-prose-secondary">${esc(m.customsAndTraditions)}</p>`:"",
    m.socialNorms?`<p class="location-profile-thematic-prose location-profile-thematic-prose-secondary">${esc(m.socialNorms)}</p>`:""
  ].join("");
  const chipsHtml=renderLocationThematicChips("Народы и сообщества",m.peoplesAndGroups||[])
    +renderLocationThematicChips("Языки",m.languages||[])
    +renderLocationThematicChips("Религии и верования",m.beliefs||[])
    +renderLocationThematicChips("Праздники и важные даты",m.holidays||[]);
  el.innerHTML=`<h3 class="location-profile-thematic-title">Население и культура</h3>${proseHtml}${chipsHtml}`;
  el.hidden=false;
}

// History (Location History -- HYBRID IMPLEMENTATION). Read order per the task brief: Происхождение
// -> Историческая справка -> События -> Легенды и мифы; each subsection renders only if it has
// content. hasData spans BOTH base_profile.history prose AND the separately-loaded event list -- the
// ad-hoc `locationLike` object below merges the real location's baseProfile/moduleSelection with
// whatever locationHistoryEventsOriginal currently holds (synchronous for local mode, filled in
// asynchronously for cloud mode by loadLocationHistoryEventsForProfile, which re-calls this
// function once it resolves) so locationModuleReadVisible's existing "hidden hides everything, no
// data hides everything" rule applies uniformly -- no bespoke visibility logic needed here at all.
function renderLocationProfileHistory(location){
  const el=document.getElementById("locationProfileHistory");if(!el)return;
  const locationLike={baseProfile:location.baseProfile,historyEvents:locationHistoryEventsOriginal};
  if(!locationModuleReadVisible(locationLike,location.moduleSelection,"history")){el.hidden=true;el.innerHTML="";return}
  const m=normalizeHistory(location.baseProfile?.history);
  const originHtml=m.origin?`<p class="location-profile-thematic-prose">${esc(m.origin)}</p>`:"";
  const overviewHtml=m.historicalOverview?`<p class="location-profile-thematic-prose location-profile-thematic-prose-secondary">${esc(m.historicalOverview)}</p>`:"";
  const eventsHtml=renderLocationProfileHistoryEventsRead(locationHistoryEventsOriginal);
  const legendsHtml=m.legends?`<p class="location-profile-history-legends">${esc(m.legends)}</p>`:"";
  el.innerHTML=`<h3 class="location-profile-thematic-title">История</h3>${originHtml}${overviewHtml}${eventsHtml}${legendsHtml}`;
  el.hidden=false;
}

// Compact vertical list, oldest-first (already the stored sort_order), date label visually
// secondary, title primary -- no decorative timeline, description shown inline in full (see task
// brief "do not require clicks just to read every 1-line event"; long text simply wraps, checked
// in visual review).
function renderLocationProfileHistoryEventsRead(events){
  if(!events.length)return "";
  const rows=events.map(event=>`<li class="location-profile-history-event">
    ${event.dateLabel?`<span class="location-profile-history-event-date">${esc(event.dateLabel)}</span>`:""}
    <span class="location-profile-history-event-title">${esc(event.title||"Без названия")}</span>
    ${event.description?`<p class="location-profile-history-event-description">${esc(event.description)}</p>`:""}
  </li>`).join("");
  return `<ul class="location-profile-history-events">${rows}</ul>`;
}

function ensureLocationNotableFeaturesWidget(){
  if(multiValueInputs.locationNotableFeatures)return multiValueInputs.locationNotableFeatures;
  const host=document.getElementById("locProfileNotableFeatures");
  multiValueInputs.locationNotableFeatures=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить деталь…",label:"Характерные детали",onChange:syncBeforeUnload});
  return multiValueInputs.locationNotableFeatures;
}
function ensureLocationNaturalFeaturesWidget(){
  if(multiValueInputs.locationNaturalFeatures)return multiValueInputs.locationNaturalFeatures;
  const host=document.getElementById("locProfileNaturalFeatures");
  multiValueInputs.locationNaturalFeatures=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить особенность…",label:"Природные особенности",onChange:syncBeforeUnload});
  return multiValueInputs.locationNaturalFeatures;
}
function ensureLocationSecurityForcesWidget(){
  if(multiValueInputs.locationSecurityForces)return multiValueInputs.locationSecurityForces;
  const host=document.getElementById("locProfileSecurityForces");
  multiValueInputs.locationSecurityForces=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Силы порядка",onChange:syncBeforeUnload});
  return multiValueInputs.locationSecurityForces;
}
function ensureLocationNotableInstitutionsWidget(){
  if(multiValueInputs.locationNotableInstitutions)return multiValueInputs.locationNotableInstitutions;
  const host=document.getElementById("locProfileNotableInstitutions");
  multiValueInputs.locationNotableInstitutions=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Учреждения и организации",onChange:syncBeforeUnload});
  return multiValueInputs.locationNotableInstitutions;
}
function ensureLocationIndustriesWidget(){
  if(multiValueInputs.locationIndustries)return multiValueInputs.locationIndustries;
  const host=document.getElementById("locProfileIndustries");
  multiValueInputs.locationIndustries=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Основные отрасли и источники дохода",onChange:syncBeforeUnload});
  return multiValueInputs.locationIndustries;
}
function ensureLocationScarcityWidget(){
  if(multiValueInputs.locationScarcity)return multiValueInputs.locationScarcity;
  const host=document.getElementById("locProfileScarcity");
  multiValueInputs.locationScarcity=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"В дефиците",onChange:syncBeforeUnload});
  return multiValueInputs.locationScarcity;
}
function ensureLocationTradeConnectionsWidget(){
  if(multiValueInputs.locationTradeConnections)return multiValueInputs.locationTradeConnections;
  const host=document.getElementById("locProfileTradeConnections");
  multiValueInputs.locationTradeConnections=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Торговые связи",onChange:syncBeforeUnload});
  return multiValueInputs.locationTradeConnections;
}
function ensureLocationPeoplesAndGroupsWidget(){
  if(multiValueInputs.locationPeoplesAndGroups)return multiValueInputs.locationPeoplesAndGroups;
  const host=document.getElementById("locProfilePeoplesAndGroups");
  multiValueInputs.locationPeoplesAndGroups=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Народы и сообщества",onChange:syncBeforeUnload});
  return multiValueInputs.locationPeoplesAndGroups;
}
function ensureLocationLanguagesWidget(){
  if(multiValueInputs.locationLanguages)return multiValueInputs.locationLanguages;
  const host=document.getElementById("locProfileLanguages");
  multiValueInputs.locationLanguages=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Языки",onChange:syncBeforeUnload});
  return multiValueInputs.locationLanguages;
}
function ensureLocationHolidaysWidget(){
  if(multiValueInputs.locationHolidays)return multiValueInputs.locationHolidays;
  const host=document.getElementById("locProfileHolidays");
  multiValueInputs.locationHolidays=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Праздники и важные даты",onChange:syncBeforeUnload});
  return multiValueInputs.locationHolidays;
}
function ensureLocationBeliefsWidget(){
  if(multiValueInputs.locationBeliefs)return multiValueInputs.locationBeliefs;
  const host=document.getElementById("locProfileBeliefs");
  multiValueInputs.locationBeliefs=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить…",label:"Религии и верования",onChange:syncBeforeUnload});
  return multiValueInputs.locationBeliefs;
}

const LOCATION_THEMATIC_DISCLOSURE_IDS={
  appearanceAtmosphere:{toggle:"locProfileAppearanceToggle",body:"locProfileAppearanceBody"},
  geography:{toggle:"locProfileGeographyToggle",body:"locProfileGeographyBody"},
  governmentSociety:{toggle:"locProfileGovernmentSocietyToggle",body:"locProfileGovernmentSocietyBody"},
  economy:{toggle:"locProfileEconomyToggle",body:"locProfileEconomyBody"},
  populationCulture:{toggle:"locProfilePopulationCultureToggle",body:"locProfilePopulationCultureBody"},
  history:{toggle:"locProfileHistoryToggle",body:"locProfileHistoryBody"}
};

// Presentation only: never clears values, saves, or resets dirty state -- see task brief
// "DISCLOSURE RULE". Collapsing a populated module leaves its fields exactly as they were,
// just hidden (serializeForm still scans them, see js/app.js's locationProfileModal tracker).
function setLocationThematicDisclosure(moduleKey,expanded){
  const ids=LOCATION_THEMATIC_DISCLOSURE_IDS[moduleKey];if(!ids)return;
  const toggle=document.getElementById(ids.toggle),body=document.getElementById(ids.body);
  if(!toggle||!body)return;
  toggle.setAttribute("aria-expanded",String(expanded));
  body.hidden=!expanded;
}
function toggleLocationThematicDisclosure(moduleKey){
  const ids=LOCATION_THEMATIC_DISCLOSURE_IDS[moduleKey];if(!ids)return;
  const expanded=document.getElementById(ids.toggle)?.getAttribute("aria-expanded")==="true";
  setLocationThematicDisclosure(moduleKey,!expanded);
}

/* ---------- Profile: Adaptive Module Selection (Phase 1) ----------
 * Project-specific presentation state for the two existing thematic modules -- shown/hidden,
 * layered on top of the always-derivable hasData signal. See js/location-module-selection.js for
 * the pure state model this wires to the DOM; this section only handles rendering and the six
 * user actions (Добавить/Показать/Скрыть/Убрать/Удалить данные раздела/Cancel-implicit).
 *
 * `locationProfileModuleSelectionDraft` is the ONLY piece of new draft state this phase adds --
 * initialized from location.moduleSelection on every entry into edit mode (fresh open OR Cancel,
 * both already funnel through syncLocationProfileEditFields -> syncLocationProfileThematicFields),
 * and discarded (never independently persisted) on Cancel exactly like every other draft field.
 * Module WRAPPER visibility and the add-panel's candidate list are always recomputed from this
 * plus the current DOM field values via the pure visibility formula -- never tracked as a second,
 * independently-mutated list that could drift out of sync with it. */
let locationProfileModuleSelectionDraft={shown:[],hidden:[]};
let locationProfileModuleAddPanelOpen=false;

const LOCATION_THEMATIC_MODULE_IDS={
  appearanceAtmosphere:{module:"locProfileAppearanceModule",hide:"locProfileAppearanceHide",remove:"locProfileAppearanceRemove",deleteStart:"locProfileAppearanceDeleteStart",deleteConfirm:"locProfileAppearanceDeleteConfirm",deleteWarning:"locProfileAppearanceDeleteWarning",firstField:"locProfileVisualDescription"},
  geography:{module:"locProfileGeographyModule",hide:"locProfileGeographyHide",remove:"locProfileGeographyRemove",deleteStart:"locProfileGeographyDeleteStart",deleteConfirm:"locProfileGeographyDeleteConfirm",deleteWarning:"locProfileGeographyDeleteWarning",firstField:"locProfileTerrain"},
  governmentSociety:{module:"locProfileGovernmentSocietyModule",hide:"locProfileGovernmentSocietyHide",remove:"locProfileGovernmentSocietyRemove",deleteStart:"locProfileGovernmentSocietyDeleteStart",deleteConfirm:"locProfileGovernmentSocietyDeleteConfirm",deleteWarning:"locProfileGovernmentSocietyDeleteWarning",firstField:"locProfileGovernmentForm"},
  economy:{module:"locProfileEconomyModule",hide:"locProfileEconomyHide",remove:"locProfileEconomyRemove",deleteStart:"locProfileEconomyDeleteStart",deleteConfirm:"locProfileEconomyDeleteConfirm",deleteWarning:"locProfileEconomyDeleteWarning",firstField:"locProfileCurrency"},
  populationCulture:{module:"locProfilePopulationCultureModule",hide:"locProfilePopulationCultureHide",remove:"locProfilePopulationCultureRemove",deleteStart:"locProfilePopulationCultureDeleteStart",deleteConfirm:"locProfilePopulationCultureDeleteConfirm",deleteWarning:"locProfilePopulationCultureDeleteWarning",firstField:"locProfilePopulationCharacter"},
  history:{module:"locProfileHistoryModule",hide:"locProfileHistoryHide",remove:"locProfileHistoryRemove",deleteStart:"locProfileHistoryDeleteStart",deleteConfirm:"locProfileHistoryDeleteConfirm",deleteWarning:"locProfileHistoryDeleteWarning",firstField:"locProfileOrigin"}
};

// A location-shaped object reflecting the CURRENT unsaved draft fields (not the original saved
// location) -- hasData checks against this so the add-panel/hide-vs-delete affordances react to
// what is actually typed right now. Deliberately only read at explicit action points (Add/Show/
// Hide/Remove/Delete-confirm, plus edit-entry/Cancel), never on every keystroke -- an accordion
// must never visually vanish out from under someone still typing into it.
function locationThematicDraftLocationLike(){
  const draft=readLocationThematicDraftFields();
  return {
    baseProfile:{
      appearanceAtmosphere:draft.appearanceAtmosphere,geography:draft.geography,
      governmentSociety:draft.governmentSociety,economy:draft.economy,populationCulture:draft.populationCulture,
      history:draft.history
    },
    // History's hasData also spans the live events draft (see locationModuleHasData's own comment)
    // -- reacting to the current unsaved add/remove/reorder state, same draft-reflects-live-state
    // principle as every other field this function exposes.
    historyEvents:locationProfileHistoryEventsDraft,
    // Recommendation hints (see locationThematicPickerCandidates) react to the type the author is
    // CURRENTLY choosing in the still-open edit form, not the last-saved type -- same
    // draft-reflects-live-state principle as every other field this function exposes.
    typePreset:document.getElementById("locProfileTypePreset")?.value||null
  };
}

function renderLocationThematicModuleActions(moduleKey,locationLike){
  const ids=LOCATION_THEMATIC_MODULE_IDS[moduleKey];if(!ids)return;
  const hasData=locationModuleHasData(locationLike,moduleKey);
  document.getElementById(ids.hide).hidden=!hasData;
  document.getElementById(ids.remove).hidden=hasData;
  document.getElementById(ids.deleteStart).hidden=!hasData;
  document.getElementById(ids.deleteConfirm).hidden=true;
}

function locationThematicPickerCandidates(locationLike,visibleSet){
  return LOCATION_MODULE_KEYS.filter(key=>!visibleSet.has(key)).map(key=>({
    key,label:locationModuleLabel(key),hasData:locationModuleHasData(locationLike,key),
    recommendation:locationModuleRecommendation(key,locationLike?.typePreset)
  }));
}

// Recommendation hint is a restrained TEXT tag ("Рекомендуется"), never color alone (see task
// brief accessibility requirement) -- "strong" and "recommend" render identically on purpose
// (avoiding a second visual tier the spec explicitly said isn't worth the complexity) while
// staying distinct values in locationModuleRecommendation for possible future use.
function renderLocationModuleAddPanel(locationLike,visibleSet){
  const panel=document.getElementById("locProfileAddSectionPanel");if(!panel)return;
  const candidates=locationThematicPickerCandidates(locationLike,visibleSet);
  panel.innerHTML=candidates.map(c=>{
    const tags=[
      c.hasData?'<span class="location-thematic-add-chip-restore-tag">есть данные</span>':"",
      c.recommendation!=="none"?'<span class="location-thematic-add-chip-recommend-tag">Рекомендуется</span>':""
    ].join("");
    return `<button type="button" class="location-thematic-add-chip" onclick="${c.hasData?"showLocationThematicModule":"addEmptyLocationThematicModule"}('${jsq(c.key)}')">${esc(c.label)}${tags}</button>`;
  }).join("");
}

function closeLocationModuleAddPanel(){
  locationProfileModuleAddPanelOpen=false;
  const toggle=document.getElementById("locProfileAddSectionToggle"),panel=document.getElementById("locProfileAddSectionPanel");
  if(toggle)toggle.setAttribute("aria-expanded","false");
  if(panel)panel.hidden=true;
}

function toggleLocationModuleAddPanel(){
  locationProfileModuleAddPanelOpen=!locationProfileModuleAddPanelOpen;
  const toggle=document.getElementById("locProfileAddSectionToggle"),panel=document.getElementById("locProfileAddSectionPanel");
  if(toggle)toggle.setAttribute("aria-expanded",String(locationProfileModuleAddPanelOpen));
  if(panel)panel.hidden=!locationProfileModuleAddPanelOpen;
  if(locationProfileModuleAddPanelOpen)renderLocationThematicModules();
}

// Re-renders which modules are accordions right now (edit visibility: (hasData OR shown) AND NOT
// hidden), each visible module's action-row state, and the add-panel's candidate list/visibility
// (hidden entirely once every catalog module is already visible -- nothing left to add or
// restore). Called after every explicit action below, never on every keystroke.
function renderLocationThematicModules(){
  const locationLike=locationThematicDraftLocationLike();
  const visible=new Set(locationVisibleModules(locationLike,locationProfileModuleSelectionDraft,{mode:"edit"}));
  for(const moduleKey of LOCATION_MODULE_KEYS){
    const ids=LOCATION_THEMATIC_MODULE_IDS[moduleKey];
    const isVisible=visible.has(moduleKey);
    document.getElementById(ids.module).hidden=!isVisible;
    if(isVisible)renderLocationThematicModuleActions(moduleKey,locationLike);
  }
  const addWrapper=document.getElementById("locationProfileThematicAdd");
  const hasCandidates=LOCATION_MODULE_KEYS.some(key=>!visible.has(key));
  if(addWrapper)addWrapper.hidden=!hasCandidates;
  if(!hasCandidates)closeLocationModuleAddPanel();
  else if(locationProfileModuleAddPanelOpen)renderLocationModuleAddPanel(locationLike,visible);
}

function addEmptyLocationThematicModule(moduleKey){
  locationProfileModuleSelectionDraft=addEmptyLocationModule(locationProfileModuleSelectionDraft,moduleKey);
  closeLocationModuleAddPanel();
  renderLocationThematicModules();
  setLocationThematicDisclosure(moduleKey,true);
  syncBeforeUnload();
  document.getElementById(LOCATION_THEMATIC_MODULE_IDS[moduleKey]?.firstField)?.focus();
}
function showLocationThematicModule(moduleKey){
  locationProfileModuleSelectionDraft=showLocationModule(locationProfileModuleSelectionDraft,moduleKey);
  closeLocationModuleAddPanel();
  renderLocationThematicModules();
  setLocationThematicDisclosure(moduleKey,true);
  syncBeforeUnload();
}
function removeEmptyLocationThematicModule(moduleKey){
  locationProfileModuleSelectionDraft=removeEmptyLocationModule(locationProfileModuleSelectionDraft,moduleKey);
  renderLocationThematicModules();
  syncBeforeUnload();
}
function hideLocationThematicModule(moduleKey){
  locationProfileModuleSelectionDraft=hideLocationModule(locationProfileModuleSelectionDraft,moduleKey);
  renderLocationThematicModules();
  syncBeforeUnload();
}

// Correct Russian prepositional-case agreement for "используется в N проектах": singular
// ("проекте") only when the count ends in 1 and is not 11; plural ("проектах") in every other
// case -- prepositional plural is invariant across 2-4 vs 5+ (unlike nominative/genitive counting
// phrases), so only this one split matters here.
function locationParticipationCountPhrase(count){
  const mod100=count%100,mod10=count%10;
  const word=(mod10===1&&mod100!==11)?"проекте":"проектах";
  return `${count} ${word}`;
}

// null = genuinely unknown (owned-location rows not loaded yet / fetch failed) -- callers must
// treat this as the fail-safe ">1" case, never assume 1 (see confirmDeleteLocationThematicModule).
function locationThematicParticipationCount(){
  if(!isCloudWorkspace())return 1;
  const location=locationById(locationProfileParticipationId);if(!location)return null;
  const row=ownedLocationRowsSync().get(locationCanonicalId(location));
  return row&&Number.isFinite(row.participation_count)?row.participation_count:null;
}

function locationThematicDeleteWarningText(moduleKey){
  const label=locationModuleLabel(moduleKey),count=locationThematicParticipationCount();
  if(count===1)return `Данные раздела «${label}» будут удалены из локации.`;
  if(count==null)return `Не удалось определить, сколько проектов используют эту локацию. На всякий случай считайте, что данные раздела «${label}» — общие для локации — исчезнут из нескольких проектов.`;
  return `Эта локация используется в ${locationParticipationCountPhrase(count)}. Данные раздела «${label}» общие для локации и будут удалены во всех этих проектах.`;
}

// Удалить данные раздела: a two-step inline confirm, not a modal -- swaps the action row for a
// warning + Да/Отмена pair. Nothing is actually deleted yet; confirming only prepares the deletion
// in the draft (see confirmDeleteLocationThematicModule) -- the real canonical write happens at
// Save, same as every other field.
function startDeleteLocationThematicModule(moduleKey){
  const ids=LOCATION_THEMATIC_MODULE_IDS[moduleKey];if(!ids)return;
  document.getElementById(ids.hide).hidden=true;
  document.getElementById(ids.deleteStart).hidden=true;
  document.getElementById(ids.deleteWarning).textContent=locationThematicDeleteWarningText(moduleKey);
  document.getElementById(ids.deleteConfirm).hidden=false;
}
function cancelDeleteLocationThematicModule(moduleKey){
  renderLocationThematicModuleActions(moduleKey,locationThematicDraftLocationLike());
}
function confirmDeleteLocationThematicModule(moduleKey){
  clearLocationThematicModule(moduleKey);
  locationProfileModuleSelectionDraft=deleteLocationModuleSelectionEntry(locationProfileModuleSelectionDraft,moduleKey);
  renderLocationThematicModules();
}

// Prefills every B3A field from the Location's stored modules and sets each module's initial
// disclosure state for this edit session (expanded iff it has meaningful data) -- called from
// syncLocationProfileEditFields, so this also naturally re-runs (and re-derives disclosure state
// from the untouched original) on Cancel and on every fresh entry into edit mode.
function syncLocationProfileThematicFields(location){
  const appearance=hydrateAppearanceAtmosphere(location.baseProfile?.appearanceAtmosphere);
  document.getElementById("locProfileVisualDescription").value=appearance.visualDescription;
  document.getElementById("locProfileAtmosphere").value=appearance.atmosphere;
  document.getElementById("locProfileSounds").value=appearance.sounds;
  document.getElementById("locProfileSmells").value=appearance.smells;
  document.getElementById("locProfileLighting").value=appearance.lighting;
  document.getElementById("locProfileClimateFeel").value=appearance.climateFeel;
  ensureLocationNotableFeaturesWidget().setValues(appearance.notableFeatures);

  const geography=hydrateGeography(location.baseProfile?.geography);
  document.getElementById("locProfileTerrain").value=geography.terrain;
  document.getElementById("locProfileClimate").value=geography.climate;
  document.getElementById("locProfileWater").value=geography.water;
  document.getElementById("locProfileVegetation").value=geography.vegetation;
  document.getElementById("locProfileAccess").value=geography.access;
  document.getElementById("locProfileCoordinates").value=geography.coordinates;
  document.getElementById("locProfileArea").value=geography.area;
  document.getElementById("locProfileElevation").value=geography.elevation;
  ensureLocationNaturalFeaturesWidget().setValues(geography.naturalFeatures);

  const governmentSociety=hydrateGovernmentSociety(location.baseProfile?.governmentSociety);
  document.getElementById("locProfileGovernmentForm").value=governmentSociety.governmentForm;
  document.getElementById("locProfileLeadership").value=governmentSociety.leadership;
  document.getElementById("locProfilePoliticalSituation").value=governmentSociety.politicalSituation;
  document.getElementById("locProfileLawsAndRules").value=governmentSociety.lawsAndRules;
  ensureLocationSecurityForcesWidget().setValues(governmentSociety.securityForces);
  ensureLocationNotableInstitutionsWidget().setValues(governmentSociety.notableInstitutions);

  const economy=hydrateEconomy(location.baseProfile?.economy);
  document.getElementById("locProfileCurrency").value=economy.currency;
  document.getElementById("locProfileEconomicCharacter").value=economy.economicCharacter;
  ensureLocationIndustriesWidget().setValues(economy.industries);
  document.getElementById("locProfileCostOfLiving").value=economy.costOfLiving;
  ensureLocationScarcityWidget().setValues(economy.scarcity);
  ensureLocationTradeConnectionsWidget().setValues(economy.tradeConnections);

  const populationCulture=hydratePopulationCulture(location.baseProfile?.populationCulture);
  document.getElementById("locProfilePopulationCharacter").value=populationCulture.populationCharacter;
  ensureLocationPeoplesAndGroupsWidget().setValues(populationCulture.peoplesAndGroups);
  ensureLocationLanguagesWidget().setValues(populationCulture.languages);
  document.getElementById("locProfileCustomsAndTraditions").value=populationCulture.customsAndTraditions;
  ensureLocationHolidaysWidget().setValues(populationCulture.holidays);
  ensureLocationBeliefsWidget().setValues(populationCulture.beliefs);
  document.getElementById("locProfileSocialNorms").value=populationCulture.socialNorms;

  const history=hydrateHistory(location.baseProfile?.history);
  document.getElementById("locProfileOrigin").value=history.origin;
  document.getElementById("locProfileHistoricalOverview").value=history.historicalOverview;
  document.getElementById("locProfileLegends").value=history.legends;

  setLocationThematicDisclosure("appearanceAtmosphere",!isModuleEmpty(normalizeAppearanceAtmosphere(appearance)));
  setLocationThematicDisclosure("geography",!isModuleEmpty(normalizeGeography(geography)));
  setLocationThematicDisclosure("governmentSociety",!isModuleEmpty(normalizeGovernmentSociety(governmentSociety)));
  setLocationThematicDisclosure("economy",!isModuleEmpty(normalizeEconomy(economy)));
  setLocationThematicDisclosure("populationCulture",!isModuleEmpty(normalizePopulationCulture(populationCulture)));
  setLocationThematicDisclosure("history",!isModuleEmpty(normalizeHistory(history))||locationHistoryEventsOriginal.length>0);

  locationProfileModuleSelectionDraft=normalizeModuleSelection(location.moduleSelection);
  closeLocationModuleAddPanel();
  renderLocationThematicModules();
}

function readLocationThematicDraftFields(){
  return {
    appearanceAtmosphere:{
      visualDescription:document.getElementById("locProfileVisualDescription").value,
      atmosphere:document.getElementById("locProfileAtmosphere").value,
      sounds:document.getElementById("locProfileSounds").value,
      smells:document.getElementById("locProfileSmells").value,
      lighting:document.getElementById("locProfileLighting").value,
      climateFeel:document.getElementById("locProfileClimateFeel").value,
      notableFeatures:ensureLocationNotableFeaturesWidget().getValues()
    },
    geography:{
      terrain:document.getElementById("locProfileTerrain").value,
      climate:document.getElementById("locProfileClimate").value,
      water:document.getElementById("locProfileWater").value,
      vegetation:document.getElementById("locProfileVegetation").value,
      access:document.getElementById("locProfileAccess").value,
      coordinates:document.getElementById("locProfileCoordinates").value,
      area:document.getElementById("locProfileArea").value,
      elevation:document.getElementById("locProfileElevation").value,
      naturalFeatures:ensureLocationNaturalFeaturesWidget().getValues()
    },
    governmentSociety:{
      governmentForm:document.getElementById("locProfileGovernmentForm").value,
      leadership:document.getElementById("locProfileLeadership").value,
      politicalSituation:document.getElementById("locProfilePoliticalSituation").value,
      lawsAndRules:document.getElementById("locProfileLawsAndRules").value,
      securityForces:ensureLocationSecurityForcesWidget().getValues(),
      notableInstitutions:ensureLocationNotableInstitutionsWidget().getValues()
    },
    economy:{
      currency:document.getElementById("locProfileCurrency").value,
      economicCharacter:document.getElementById("locProfileEconomicCharacter").value,
      industries:ensureLocationIndustriesWidget().getValues(),
      costOfLiving:document.getElementById("locProfileCostOfLiving").value,
      scarcity:ensureLocationScarcityWidget().getValues(),
      tradeConnections:ensureLocationTradeConnectionsWidget().getValues()
    },
    populationCulture:{
      populationCharacter:document.getElementById("locProfilePopulationCharacter").value,
      peoplesAndGroups:ensureLocationPeoplesAndGroupsWidget().getValues(),
      languages:ensureLocationLanguagesWidget().getValues(),
      customsAndTraditions:document.getElementById("locProfileCustomsAndTraditions").value,
      holidays:ensureLocationHolidaysWidget().getValues(),
      beliefs:ensureLocationBeliefsWidget().getValues(),
      socialNorms:document.getElementById("locProfileSocialNorms").value
    },
    history:{
      origin:document.getElementById("locProfileOrigin").value,
      historicalOverview:document.getElementById("locProfileHistoricalOverview").value,
      legends:document.getElementById("locProfileLegends").value
    }
  };
}

const LOCATION_THEMATIC_FIELD_IDS={
  appearanceAtmosphere:["locProfileVisualDescription","locProfileAtmosphere","locProfileSounds","locProfileSmells","locProfileLighting","locProfileClimateFeel"],
  geography:["locProfileTerrain","locProfileClimate","locProfileWater","locProfileVegetation","locProfileAccess","locProfileCoordinates","locProfileArea","locProfileElevation"],
  governmentSociety:["locProfileGovernmentForm","locProfileLeadership","locProfilePoliticalSituation","locProfileLawsAndRules"],
  economy:["locProfileCurrency","locProfileEconomicCharacter","locProfileCostOfLiving"],
  populationCulture:["locProfilePopulationCharacter","locProfileCustomsAndTraditions","locProfileSocialNorms"],
  history:["locProfileOrigin","locProfileHistoricalOverview","locProfileLegends"]
};

// governmentSociety/economy (B3B) each have more than one multi-value field, unlike
// appearanceAtmosphere/geography (exactly one each) -- so unlike the old hardcoded
// appearanceAtmosphere-vs-geography ternary this replaces, module-to-widgets is a real list.
const LOCATION_THEMATIC_ARRAY_WIDGETS_BY_MODULE={
  appearanceAtmosphere:[ensureLocationNotableFeaturesWidget],
  geography:[ensureLocationNaturalFeaturesWidget],
  governmentSociety:[ensureLocationSecurityForcesWidget,ensureLocationNotableInstitutionsWidget],
  economy:[ensureLocationIndustriesWidget,ensureLocationScarcityWidget,ensureLocationTradeConnectionsWidget],
  populationCulture:[ensureLocationPeoplesAndGroupsWidget,ensureLocationLanguagesWidget,ensureLocationHolidaysWidget,ensureLocationBeliefsWidget]
};

// Clears one module's fields in the DRAFT only (plain DOM state, nothing committed to
// location.baseProfile) -- keeps edit mode open and marks the form dirty; harmless to call on an
// already-empty module. Reversible with Cancel until Save, so no destructive-confirmation modal
// (see task brief "FULL MODULE CLEARING UX").
function clearLocationThematicModule(moduleKey){
  (LOCATION_THEMATIC_FIELD_IDS[moduleKey]||[]).forEach(id=>{const el=document.getElementById(id);if(el)el.value=""});
  (LOCATION_THEMATIC_ARRAY_WIDGETS_BY_MODULE[moduleKey]||[]).forEach(ensureWidget=>ensureWidget().setValues([]));
  // history's hasData spans events too (see locationModuleHasData) -- "Удалить данные раздела" must
  // clear both halves together, or the module would immediately reappear as populated via its
  // events alone the instant the prose fields are wiped.
  if(moduleKey==="history"){
    locationProfileHistoryEventsDraft=[];
    locationHistoryEventEditingId=null;
    renderLocationHistoryEventsEditor();
  }
  syncBeforeUnload();
}

/* ---------- Profile: History Events editor ----------
 * Compact rows, one event expanded for editing at a time (locationHistoryEventEditingId) -- see
 * task brief "PROFILE EDIT -- EVENTS". Every mutation here is draft-only (js/location-history-
 * events.js's pure add/remove/reorder helpers); no RPC fires until Save (see
 * reconcileLocationHistoryEventsDraft below). */

function renderLocationHistoryEventsEditor(){
  const container=document.getElementById("locProfileHistoryEventsList");if(!container)return;
  const items=[...locationProfileHistoryEventsDraft].sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
  container.innerHTML=items.length
    ?items.map((item,index)=>renderLocationHistoryEventCard(item,index,items.length)).join("")
    :'<p class="location-history-events-empty">Событий пока нет.</p>';
}

function renderLocationHistoryEventCard(item,index,total){
  if(locationHistoryEventEditingId!==item.id){
    return `<article class="location-history-event-card" data-event-id="${esc(item.id)}">
      <div class="location-history-event-card-summary">
        ${item.dateLabel?`<span class="location-history-event-date">${esc(item.dateLabel)}</span>`:""}
        <span class="location-history-event-title">${esc(item.title||"Без названия")}</span>
      </div>
      <div class="location-media-card-actions">
        <button type="button" onclick="moveLocationHistoryEventDraftItem('${jsq(item.id)}','up')" ${index===0?"disabled":""} aria-label="Переместить раньше">↑</button>
        <button type="button" onclick="moveLocationHistoryEventDraftItem('${jsq(item.id)}','down')" ${index===total-1?"disabled":""} aria-label="Переместить позже">↓</button>
        <button type="button" onclick="startEditLocationHistoryEventDraft('${jsq(item.id)}')">Изменить</button>
        <button type="button" class="location-media-card-delete" onclick="removeLocationHistoryEventDraftItem('${jsq(item.id)}')">Удалить</button>
      </div>
    </article>`;
  }
  return `<article class="location-history-event-card location-history-event-card-editing" data-event-id="${esc(item.id)}">
    <label class="profile-field full">
      <span class="field-caption">Название события</span>
      <input value="${esc(item.title)}" oninput="updateLocationHistoryEventDraftField('${jsq(item.id)}','title',this.value)" placeholder="Например: Пожар уничтожил северное крыло">
    </label>
    <label class="profile-field full">
      <span class="field-caption">Когда (в свободной форме, необязательно)</span>
      <input value="${esc(item.dateLabel)}" oninput="updateLocationHistoryEventDraftField('${jsq(item.id)}','dateLabel',this.value)" placeholder="Например: около 1240 года, за три века до войны">
    </label>
    <label class="profile-field full">
      <span class="field-caption">Описание (необязательно)</span>
      <textarea rows="3" oninput="updateLocationHistoryEventDraftField('${jsq(item.id)}','description',this.value)" placeholder="Что произошло">${esc(item.description)}</textarea>
    </label>
    <div class="location-history-event-card-actions">
      <button type="button" class="primary" onclick="finishEditLocationHistoryEventDraft()">Готово</button>
      <button type="button" class="location-media-card-delete" onclick="removeLocationHistoryEventDraftItem('${jsq(item.id)}')">Удалить</button>
    </div>
  </article>`;
}

function addLocationHistoryEventDraft(){
  const item=createDraftHistoryEvent({id:crypto.randomUUID(),sortOrder:locationProfileHistoryEventsDraft.length});
  locationProfileHistoryEventsDraft=[...locationProfileHistoryEventsDraft,item];
  locationHistoryEventEditingId=item.id;
  renderLocationHistoryEventsEditor();
  renderLocationThematicModules();
  syncBeforeUnload();
  document.querySelector(`#locProfileHistoryEventsList [data-event-id="${item.id}"] input`)?.focus();
}
function startEditLocationHistoryEventDraft(id){
  locationHistoryEventEditingId=id;
  renderLocationHistoryEventsEditor();
}
function finishEditLocationHistoryEventDraft(){
  locationHistoryEventEditingId=null;
  renderLocationHistoryEventsEditor();
}
function updateLocationHistoryEventDraftField(id,field,value){
  locationProfileHistoryEventsDraft=locationProfileHistoryEventsDraft.map(item=>item.id===id?{...item,[field]:value}:item);
  syncBeforeUnload();
}
function moveLocationHistoryEventDraftItem(id,direction){
  locationProfileHistoryEventsDraft=reorderHistoryEventDraftItem(locationProfileHistoryEventsDraft,id,direction);
  renderLocationHistoryEventsEditor();
  syncBeforeUnload();
}
function removeLocationHistoryEventDraftItem(id){
  if(locationHistoryEventEditingId===id)locationHistoryEventEditingId=null;
  locationProfileHistoryEventsDraft=removeHistoryEventDraftItem(locationProfileHistoryEventsDraft,id);
  renderLocationHistoryEventsEditor();
  renderLocationThematicModules();
  syncBeforeUnload();
}

// Extra-state slot for the locationProfileModal dirty-tracker (js/app.js) -- the events draft is
// custom state (add/reorder/delete are button actions; title/dateLabel/description ARE native
// controls but only exist in the DOM for whichever ONE event is currently expanded, so
// serializeForm's own scan cannot see the rest), mirroring currentLocationProfileMediaSnapshot.
function currentLocationProfileHistoryEventsSnapshot(){return locationHistoryEventsDraftSnapshot(locationProfileHistoryEventsDraft)}

/* ---- Save reconciliation (History Events) ----
 * NEW/CHANGED/REMOVED per js/location-history-events.js's diffHistoryEventsDraft, applied
 * delete -> update -> create (planLocationHistoryEventsSaveOrder -- no primary-demotion complexity
 * to sequence around, unlike Media). expectedRevision for create is threaded from whatever the
 * PREVIOUS canonical-domain call in this same Save actually returned (never invented client-side),
 * exactly like reconcileLocationMediaDraft. */
async function reconcileLocationHistoryEventsDraft(canonicalId,startingLocationRevision){
  const diff=diffHistoryEventsDraft(locationHistoryEventsOriginal,locationProfileHistoryEventsDraft);
  if(!diff.toCreate.length&&!diff.toUpdate.length&&!diff.toDelete.length)return {ok:true,changed:false,locationRevision:startingLocationRevision};
  const planned=planLocationHistoryEventsSaveOrder(diff);
  const api=cloudProjectSync.api;
  let locationRevision=startingLocationRevision;

  for(const removed of planned.toDelete){
    const result=await api.deleteLocationHistoryEvent(removed.id,removed.revision);
    if(!result.ok)return {ok:false,message:result.message||"Не удалось удалить событие."};
    if(result.locationRevision!=null)locationRevision=result.locationRevision;
  }
  for(const {item,before} of planned.toUpdate){
    const result=await api.updateLocationHistoryEvent(item.id,before.revision,buildUpdateHistoryEventChanges(item));
    if(!result.ok)return {ok:false,message:result.message||"Не удалось обновить событие."};
  }
  for(const item of planned.toCreate){
    const payload=buildCreateHistoryEventPayload(item,{locationId:canonicalId,expectedRevision:locationRevision});
    const result=await api.createLocationHistoryEvent(canonicalId,locationRevision,{eventId:payload.eventId,title:payload.title,dateLabel:payload.dateLabel,description:payload.description,sortOrder:payload.sortOrder});
    if(!result.ok)return {ok:false,message:result.message||"Не удалось создать событие."};
    if(result.locationRevision!=null)locationRevision=result.locationRevision;
  }
  return {ok:true,changed:true,locationRevision};
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
  if(!populateLocationProfileCore(participationId))return;
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

/* ---------- Profile: edit-mode field widgets (aliases, type, parent) ---------- */

function ensureLocationAliasesWidget(){
  if(multiValueInputs.locationAliases)return multiValueInputs.locationAliases;
  const host=document.getElementById("locProfileAliases");
  multiValueInputs.locationAliases=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить альтернативное название…",label:"Альтернативные названия",onChange:syncBeforeUnload});
  return multiValueInputs.locationAliases;
}

function renderLocationParentOptionParts(row,rows){
  const parts=[row.name||"Без названия"];
  const typeLabel=locationDisplayTypeLabel({typePreset:row.type_preset,customTypeLabel:row.custom_type_label});
  if(typeLabel)parts.push(typeLabel);
  const parentRow=row.parent_id?rows.get(row.parent_id):null;
  if(parentRow)parts.push(`в «${parentRow.name||""}»`);
  return parts;
}

// Searchable single-select parent picker: value (a canonical location id, or null) and display
// text are decoupled, unlike createSingleValueCombobox — so this is a small dedicated control
// rather than a reuse of that one. Keyboard/ARIA/open-close mechanics mirror it closely.
function createLocationParentPicker({host,input,toggle,list}){
  let rows=new Map(),excludeIds=new Set(),selectedId=null,combined=[],active=-1,open=false,typedQuery=null;
  const clearLabel="Без родительской локации";
  const key=v=>String(v).toLocaleLowerCase("ru");
  function labelFor(id){if(id==null)return "";return rows.get(id)?.name||""}
  function computeCombined(){
    const q=(typedQuery==null?"":typedQuery).trim();
    const matches=[...rows.values()].filter(row=>{
      if(excludeIds.has(row.id))return false;
      if(!q)return true;
      const hay=[row.name,row.official_name,...(row.aliases||[])].filter(Boolean).join("\n");
      return key(hay).includes(key(q));
    }).sort((a,b)=>(a.name||"").localeCompare(b.name||"","ru"));
    return [{id:null,row:null},...matches.map(row=>({id:row.id,row}))];
  }
  function close(){open=false;active=-1;typedQuery=null;list.hidden=true;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant")}
  function render(){
    combined=computeCombined();
    list.innerHTML=combined.map((item,index)=>{
      const selected=item.id===selectedId;
      if(item.id===null)return `<div id="locParentOpt-${index}" role="option" aria-selected="${selected}" data-index="${index}" class="location-parent-clear-option${index===active?" active":""}">${esc(clearLabel)}</div>`;
      const parts=renderLocationParentOptionParts(item.row,rows);
      return `<div id="locParentOpt-${index}" role="option" aria-selected="${selected}" data-index="${index}" class="${index===active?"active":""}"><span class="location-parent-option-name">${esc(parts[0])}</span>${parts.length>1?`<span class="location-parent-option-meta">${esc(parts.slice(1).join(" · "))}</span>`:""}</div>`;
    }).join("");
    list.hidden=!open;input.setAttribute("aria-expanded",String(open));
    if(active>=0)input.setAttribute("aria-activedescendant",`locParentOpt-${active}`);else input.removeAttribute("aria-activedescendant");
  }
  function show(){open=true;if(typedQuery==null)typedQuery="";active=-1;render()}
  function select(item){
    // No trailing input.focus() here (unlike createSingleValueCombobox, which this otherwise
    // mirrors): the option row's own mousedown handler above already preventDefault()s, so the
    // input never actually loses focus during a click-to-select — an explicit re-focus call
    // re-opens the just-closed list instead of being the inert no-op it would be if focus had
    // genuinely moved, which was blocking the very button a user clicks right after selecting a
    // parent (Create/Save). Keyboard selection (Enter) never blurs the input either.
    selectedId=item.id;input.value=labelFor(selectedId);close();
    input.dispatchEvent(new Event("change",{bubbles:true}));
  }
  input.addEventListener("focus",()=>{typedQuery="";show()});
  input.addEventListener("click",()=>{if(!open){typedQuery="";show()}});
  input.addEventListener("input",()=>{typedQuery=input.value;active=-1;open=true;render()});
  input.addEventListener("multi-value-close",close);
  toggle?.addEventListener("click",()=>{if(open){close()}else{typedQuery="";show()}input.focus()});
  list.addEventListener("mousedown",event=>event.preventDefault());
  list.addEventListener("click",event=>{const option=event.target.closest("[data-index]");if(option)select(combined[Number(option.dataset.index)])});
  input.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&open){event.preventDefault();event.stopImmediatePropagation();input.value=labelFor(selectedId);close();return}
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();if(!open){typedQuery="";show()}if(!combined.length)return;
      active=(active+(event.key==="ArrowDown"?1:-1)+combined.length)%combined.length;render();return;
    }
    if(event.key==="Enter"){
      if(!open){event.preventDefault();typedQuery="";show();return}
      const item=active>=0?combined[active]:combined[0];
      if(item){event.preventDefault();select(item)}
    }
  });
  host.addEventListener("focusout",event=>{if(!host.contains(event.relatedTarget)){input.value=labelFor(selectedId);close()}});
  close();
  return {
    setRows(nextRows){rows=nextRows;if(open)render()},
    setExclude(ids){excludeIds=ids;if(open)render()},
    setSelected(id){selectedId=id??null;input.value=labelFor(selectedId);typedQuery=null},
    getSelected(){return selectedId}
  };
}

let locationParentPickerInstance=null,createLocationParentPickerInstance=null;

// Exposed for the locationProfileModal dirty tracker (js/app.js) — the parent picker's
// selection is custom state, not a native form control serializeForm() can read.
function currentLocationProfileParentSelection(){return locationParentPickerInstance?.getSelected()??null}

// Same reasoning as above, for Adaptive Module Selection: add/show/hide/remove/delete-confirm
// change locationProfileModuleSelectionDraft (and, for delete, the draft field VALUES, which
// serializeForm already covers) without necessarily changing any other native control the form
// scan would see -- e.g. hiding a populated module changes nothing serializeForm reads at all.
// Without this, Save would stay disabled after a pure selection-only change.
function currentLocationProfileModuleSelectionSnapshot(){return normalizeModuleSelection(locationProfileModuleSelectionDraft)}

function ensureLocationParentPicker(){
  if(locationParentPickerInstance)return locationParentPickerInstance;
  locationParentPickerInstance=createLocationParentPicker({
    host:document.getElementById("locProfileParentHost"),input:document.getElementById("locProfileParent"),
    toggle:document.querySelector("#locProfileParentHost .combobox-toggle"),list:document.getElementById("locProfileParentListbox")
  });
  return locationParentPickerInstance;
}

function ensureCreateLocationParentPicker(){
  if(createLocationParentPickerInstance)return createLocationParentPickerInstance;
  createLocationParentPickerInstance=createLocationParentPicker({
    host:document.getElementById("createLocationParentHost"),input:document.getElementById("createLocationParent"),
    toggle:document.querySelector("#createLocationParentHost .combobox-toggle"),list:document.getElementById("createLocationParentListbox")
  });
  return createLocationParentPickerInstance;
}

function ensureCreateLocationAliasesWidget(){
  if(multiValueInputs.createLocationAliases)return multiValueInputs.createLocationAliases;
  const host=document.getElementById("createLocationAliases");
  multiValueInputs.createLocationAliases=createMultiValueCombobox({host,suggestions:[],values:[],placeholder:"Добавить альтернативное название…",label:"Альтернативные названия",onChange:()=>{}});
  return multiValueInputs.createLocationAliases;
}

function readLocationEditFormFields(){
  return {
    name:document.getElementById("locProfileName").value.trim(),
    officialName:document.getElementById("locProfileOfficialName").value.trim(),
    typePreset:document.getElementById("locProfileTypePreset").value||null,
    customTypeLabel:document.getElementById("locProfileCustomTypeLabel").value.trim(),
    aliases:ensureLocationAliasesWidget().getValues(),
    shortSummary:document.getElementById("locProfileShortSummary").value.trim(),
    description:document.getElementById("locProfileDescription").value.trim(),
    parentId:ensureLocationParentPicker().getSelected()
  };
}

/* ---------- Save ----------
 * Cloud core-identity fields (name/officialName/aliases/typePreset/customTypeLabel/description/
 * shortSummary) go through update_location_canonical, gated on the canonical Location's OWN
 * revision — a pure global-identity mutation, never routed through the project mutation queue
 * (mirrors updateCharacter's global-identity save path exactly, see js/app.js's
 * profileSaveScopeValue()==="global" branch). A parent change is a SEPARATE set_location_parent
 * call using the revision update_location_canonical just returned.
 *
 * Partial-success handling (Phase B2 "SAVE MODEL" audit): update_location_canonical succeeding
 * while set_location_parent then fails is a real possible outcome and must never be reported as
 * one atomic save. If that happens, the already-saved core fields are kept (reload picks them
 * up), the Profile stays in edit mode with a status message naming exactly what did and didn't
 * save, and the parent field reverts to the server's actual current value so a retry starts from
 * truth, not from the failed attempt. */
async function saveLocationProfile(){
  if(locationProfileSaveButton.saving)return;
  const participationId=locationProfileParticipationId;
  const location=locationById(participationId);
  if(!location)return;
  const fields=readLocationEditFormFields();
  if(!fields.name){locationProfileSaveButton.showStatus("Название локации не может быть пустым.","error");return}
  // Every History event needs a title (same rule the RPC/local model both enforce) -- checked here,
  // before anything is sent, exactly like the Location's own name field just above.
  if(locationProfileHistoryEventsDraft.some(item=>!item.title.trim())){
    locationProfileSaveButton.showStatus("Название события истории не может быть пустым.","error");return;
  }
  const thematicDraft=readLocationThematicDraftFields();
  const baseProfilePatch=buildLocationBaseProfilePatch({
    originalAppearance:location.baseProfile?.appearanceAtmosphere,originalGeography:location.baseProfile?.geography,
    originalGovernmentSociety:location.baseProfile?.governmentSociety,originalEconomy:location.baseProfile?.economy,
    originalPopulationCulture:location.baseProfile?.populationCulture,originalHistory:location.baseProfile?.history,
    draftAppearance:thematicDraft.appearanceAtmosphere,draftGeography:thematicDraft.geography,
    draftGovernmentSociety:thematicDraft.governmentSociety,draftEconomy:thematicDraft.economy,
    draftPopulationCulture:thematicDraft.populationCulture,draftHistory:thematicDraft.history
  });
  // Adaptive Module Selection: normalize the draft selection against what base_profile will
  // ACTUALLY look like after this save (a module that just gained data drops out of `shown` as
  // redundant -- contract addendum's own worked example) before comparing it to the original
  // selection loaded at edit-entry. moduleSelection and baseProfilePatch are two independent
  // revision domains (project vs. canonical location -- see Save sequencing below) but this one
  // comparison is what decides whether the project-scoped write is needed at all.
  const resultingBaseProfile=baseProfilePatch?applyLocationBaseProfilePatch(location.baseProfile,baseProfilePatch):location.baseProfile;
  const finalModuleSelection=dropRedundantShownEntries(locationProfileModuleSelectionDraft,{baseProfile:resultingBaseProfile});
  const moduleSelectionChanged=saveNeedsModuleSelectionWrite(location.moduleSelection,finalModuleSelection);
  locationProfileSaveButton.beginSaving();
  try{
    if(isCloudWorkspace()){
      const canonicalId=locationCanonicalId(location);
      const coreResult=await cloudProjectSync.api.updateLocationCanonical(canonicalId,location.locationRevision,{
        name:fields.name,officialName:fields.officialName||null,aliases:fields.aliases,
        typePreset:fields.typePreset||null,customTypeLabel:fields.customTypeLabel||null,
        description:fields.description,shortSummary:fields.shortSummary||null,baseProfilePatch
      });
      if(!coreResult.ok){locationProfileSaveButton.showStatus(coreResult.message||"Не удалось сохранить локацию.","error");return}
      const parentChanged=fields.parentId!==locationProfileOriginalParentId;
      let parentResult=null;
      if(parentChanged)parentResult=await cloudProjectSync.api.setLocationParent(canonicalId,coreResult.locationRevision,fields.parentId);
      const reloaded=await cloudProjectSync.reload();
      invalidateOwnedLocationsCache();
      if(!reloaded.ok){locationProfileSaveButton.showStatus(reloaded.message||"Не удалось обновить данные после сохранения.","error");return}
      data=reloaded.data;
      if(parentChanged&&parentResult&&!parentResult.ok){
        locationProfileSaveButton.showStatus(`Основные поля сохранены. Не удалось изменить родителя: ${parentResult.message||"неизвестная ошибка"}`,"error");
        populateLocationProfileCore(participationId);
        trackerFor("locationProfileModal").captureInitialState();
        return;
      }
      // Media next, still the canonical (locations.revision) domain -- chained from whatever the
      // core/parent calls above actually returned, via the just-reloaded location's own revision
      // (never invented client-side). A failure here is reported the same partial-success way as
      // parent/module-selection: core fields already saved and kept, Profile stays in edit mode.
      {
        const currentLocationRevision=data.locations.find(l=>l.id===participationId)?.locationRevision??coreResult.locationRevision;
        const mediaResult=await reconcileLocationMediaDraft(canonicalId,currentLocationRevision);
        if(!mediaResult.ok){
          locationProfileSaveButton.showStatus(`Основные поля сохранены. Не удалось сохранить медиа: ${mediaResult.message||"неизвестная ошибка"}`,"error");
          const refreshedAfterMediaFailure=await cloudProjectSync.reload();
          if(refreshedAfterMediaFailure.ok)data=refreshedAfterMediaFailure.data;
          populateLocationProfileCore(participationId);
          trackerFor("locationProfileModal").captureInitialState();
          return;
        }
        if(mediaResult.changed){
          const refreshedAfterMedia=await cloudProjectSync.reload();
          if(!refreshedAfterMedia.ok){locationProfileSaveButton.showStatus(refreshedAfterMedia.message||"Не удалось обновить данные после сохранения медиа.","error");return}
          data=refreshedAfterMedia.data;
        }
      }
      // History Events next, same canonical (locations.revision) domain -- chained from whatever
      // Media just above actually left locations.revision at (never invented client-side), same
      // partial-success reporting contract as Media/parent/module-selection.
      {
        const currentLocationRevision=data.locations.find(l=>l.id===participationId)?.locationRevision??coreResult.locationRevision;
        const historyEventsResult=await reconcileLocationHistoryEventsDraft(canonicalId,currentLocationRevision);
        if(!historyEventsResult.ok){
          locationProfileSaveButton.showStatus(`Основные поля сохранены. Не удалось сохранить события истории: ${historyEventsResult.message||"неизвестная ошибка"}`,"error");
          const refreshedAfterHistoryFailure=await cloudProjectSync.reload();
          if(refreshedAfterHistoryFailure.ok)data=refreshedAfterHistoryFailure.data;
          populateLocationProfileCore(participationId);
          trackerFor("locationProfileModal").captureInitialState();
          return;
        }
        if(historyEventsResult.changed){
          const refreshedAfterHistory=await cloudProjectSync.reload();
          if(!refreshedAfterHistory.ok){locationProfileSaveButton.showStatus(refreshedAfterHistory.message||"Не удалось обновить данные после сохранения событий истории.","error");return}
          data=refreshedAfterHistory.data;
        }
      }
      // Module selection last, and only if it actually changed: a genuinely different revision
      // domain (projects.revision, via the existing project mutation queue -- update_
      // locationCanonical/setLocationParent above never touch it) -- canonical fields land first
      // so a validation failure there never leaves a project-scoped selection write stranded for
      // data that didn't actually save.
      if(moduleSelectionChanged){
        const selectionResult=await runCloudMutation("updateLocationModuleSelection",(api,revision)=>api.updateLocationModuleSelection(cloudProjectSync.projectId,participationId,revision,normalizeModuleSelection(finalModuleSelection)),{renderAfter:false});
        if(!selectionResult.ok){
          locationProfileSaveButton.showStatus(`Основные поля сохранены. Не удалось сохранить выбор разделов: ${selectionResult.message||"неизвестная ошибка"}`,"error");
          populateLocationProfileCore(participationId);
          trackerFor("locationProfileModal").captureInitialState();
          return;
        }
        data=cloudProjectSync.confirmedProject;
      }
    }else{
      const result=commitDataChange(next=>{
        const target=next.locations.find(l=>l.id===participationId);
        if(!target)return;
        Object.assign(target,{
          name:fields.name,officialName:fields.officialName,aliases:fields.aliases,
          typePreset:fields.typePreset,customTypeLabel:fields.customTypeLabel,
          shortSummary:fields.shortSummary,description:fields.description,parentId:fields.parentId
        });
        if(baseProfilePatch)target.baseProfile=applyLocationBaseProfilePatch(target.baseProfile,baseProfilePatch);
        target.historyEvents=buildLocalHistoryEventsForSave(locationProfileHistoryEventsDraft);
        if(moduleSelectionChanged){
          const effective=moduleSelectionEffective(finalModuleSelection);
          if(effective)target.moduleSelection=effective;else delete target.moduleSelection;
        }
      },{renderAfter:false});
      if(!result.ok){locationProfileSaveButton.showStatus(result.userMessage||"Не удалось сохранить локацию.","error");return}
    }
    // Success is a real, visible state (not skipped straight through) before returning to
    // read mode with the refreshed data, per the corrective-pass save-state contract.
    locationProfileSaveButton.showStatus("Локация сохранена.","success");
    await new Promise(resolve=>setTimeout(resolve,700));
    populateLocationProfileCore(participationId);
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

function populateLocationTypePresetSelect(select){
  if(!select||select.dataset.populated==="1")return;
  select.innerHTML=`<option value="">Не указан</option>${LOCATION_TYPE_PRESETS.map(p=>`<option value="${esc(p.value)}">${esc(p.label)}</option>`).join("")}`;
  select.dataset.populated="1";
}

function openCreateLocationModal(){
  closeProjectMenu();
  const nameInput=document.getElementById("createLocationName");
  const typeSelect=document.getElementById("createLocationTypePreset");
  const customLabelInput=document.getElementById("createLocationCustomTypeLabel");
  const summaryInput=document.getElementById("createLocationShortSummary");
  const submitBtn=document.getElementById("createLocationSubmit"),status=document.getElementById("createLocationStatus");
  populateLocationTypePresetSelect(typeSelect);
  nameInput.value="";typeSelect.value="";customLabelInput.value="";summaryInput.value="";
  submitBtn.disabled=true;status.textContent="";status.className="save-status";
  ensureCreateLocationAliasesWidget().setValues([]);
  const picker=ensureCreateLocationParentPicker();
  picker.setRows(new Map());picker.setExclude(new Set());picker.setSelected(null);
  loadOwnedLocationRows().then(rows=>{picker.setRows(rows);picker.setExclude(new Set())});
  openModal("createLocationModal",{initialFocus:"#createLocationName"});
}

function updateCreateLocationSubmitState(){
  document.getElementById("createLocationSubmit").disabled=!document.getElementById("createLocationName").value.trim();
}

async function submitCreateLocation(){
  if(createLocationInFlight)return;
  const name=document.getElementById("createLocationName").value.trim();if(!name)return;
  const typePreset=document.getElementById("createLocationTypePreset").value||null;
  const customTypeLabel=document.getElementById("createLocationCustomTypeLabel").value.trim();
  const shortSummary=document.getElementById("createLocationShortSummary").value.trim();
  const aliases=ensureCreateLocationAliasesWidget().getValues();
  const parentId=ensureCreateLocationParentPicker().getSelected();
  const button=document.getElementById("createLocationSubmit"),idleLabel=button.textContent,status=document.getElementById("createLocationStatus");
  createLocationInFlight=true;button.disabled=true;button.textContent="Создание…";status.textContent="";status.className="save-status";
  let newParticipationId=null;
  try{
    if(isCloudWorkspace()){
      // create_location_canonical accepts a parent inline: a not-yet-existing Location cannot
      // already be anyone's ancestor, so attaching a parent at creation time is structurally
      // cycle-free (see the Phase 3 migration header) — no separate set_location_parent needed.
      const result=await runCloudMutation("createLocationCanonical",(api,revision)=>api.createLocationCanonical(cloudProjectSync.projectId,revision,{
        name,officialName:null,aliases,typePreset,customTypeLabel:customTypeLabel||null,description:"",shortSummary:shortSummary||null,parentId
      }),{renderAfter:false});
      if(!result.ok){status.textContent=result.message||"Не удалось создать локацию.";status.className="save-status error";return}
      data=cloudProjectSync.confirmedProject;
      invalidateOwnedLocationsCache();
      newParticipationId=result.data?.id||null;
    }else{
      const location={id:makeId("location"),name,description:"",officialName:"",aliases,parentId,typePreset,customTypeLabel,shortSummary};
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

Object.assign(globalThis,{locationById,locationCanonicalId,locationSceneEntries,locationAncestors,locationDescendantIds,
  ownedLocationRowsSync,loadOwnedLocationRows,invalidateOwnedLocationsCache,currentLocationProfileParentSelection,currentLocationProfileModuleSelectionSnapshot,
  openLocationGallery,setLocationGallerySearch,setLocationGalleryTypeFilter,renderLocationGallery,deleteLocationFromGallery,
  openLocationProfile,openLocationEntity,enterLocationProfileEdit,cancelLocationProfileEdit,saveLocationProfile,deleteLocationFromProfile,
  openCreateLocationModal,updateCreateLocationSubmitState,submitCreateLocation,populateLocationTypePresetSelect,
  toggleLocationThematicDisclosure,clearLocationThematicModule,toggleLocationProfileChildrenExpanded,
  toggleLocationModuleAddPanel,addEmptyLocationThematicModule,showLocationThematicModule,removeEmptyLocationThematicModule,
  hideLocationThematicModule,startDeleteLocationThematicModule,cancelDeleteLocationThematicModule,confirmDeleteLocationThematicModule,
  currentLocationProfileMediaSnapshot,openLocationMediaLightbox,toggleLocationMediaAddPanel,startAddLocationMedia,handleLocationMediaFileChosen,
  updateLocationMediaDraftField,setLocationMediaDraftPrimary,moveLocationMediaDraftItem,removeLocationMediaDraftItem,
  openLocationMediaCrop,nudgeLocationMediaCrop,syncLocationMediaCropPreview,saveLocationMediaCrop,cancelLocationMediaCrop,
  currentLocationProfileHistoryEventsSnapshot,addLocationHistoryEventDraft,startEditLocationHistoryEventDraft,finishEditLocationHistoryEventDraft,
  updateLocationHistoryEventDraftField,moveLocationHistoryEventDraftItem,removeLocationHistoryEventDraftItem});
export {locationById,locationCanonicalId,locationSceneEntries,locationAncestors,locationDescendantIds,
  ownedLocationRowsSync,loadOwnedLocationRows,invalidateOwnedLocationsCache,currentLocationProfileParentSelection,currentLocationProfileModuleSelectionSnapshot,
  openLocationGallery,setLocationGallerySearch,setLocationGalleryTypeFilter,renderLocationGallery,deleteLocationFromGallery,
  openLocationProfile,openLocationEntity,enterLocationProfileEdit,cancelLocationProfileEdit,saveLocationProfile,deleteLocationFromProfile,
  openCreateLocationModal,updateCreateLocationSubmitState,submitCreateLocation,populateLocationTypePresetSelect,
  toggleLocationThematicDisclosure,clearLocationThematicModule,toggleLocationProfileChildrenExpanded,
  toggleLocationModuleAddPanel,addEmptyLocationThematicModule,showLocationThematicModule,removeEmptyLocationThematicModule,
  hideLocationThematicModule,startDeleteLocationThematicModule,cancelDeleteLocationThematicModule,confirmDeleteLocationThematicModule,
  currentLocationProfileMediaSnapshot,openLocationMediaLightbox,toggleLocationMediaAddPanel,startAddLocationMedia,handleLocationMediaFileChosen,
  updateLocationMediaDraftField,setLocationMediaDraftPrimary,moveLocationMediaDraftItem,removeLocationMediaDraftItem,
  openLocationMediaCrop,nudgeLocationMediaCrop,syncLocationMediaCropPreview,saveLocationMediaCrop,cancelLocationMediaCrop,
  currentLocationProfileHistoryEventsSnapshot,addLocationHistoryEventDraft,startEditLocationHistoryEventDraft,finishEditLocationHistoryEventDraft,
  updateLocationHistoryEventDraftField,moveLocationHistoryEventDraftItem,removeLocationHistoryEventDraftItem};
