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
let createLocationInFlight=false;
let createLocationParentId=null;

const locationProfileSaveButton=createSaveButtonController("locationProfileSave","locationProfileModal",{statusId:"locationProfileStatus"});

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
    return new Map(data.locations.map(l=>[l.id,{
      id:l.id,name:l.name,official_name:l.officialName||null,aliases:l.aliases||[],
      parent_id:l.parentId||null,type_preset:l.typePreset||null,custom_type_label:l.customTypeLabel||null
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
    return `<article class="location-card" data-location-id="${esc(participationId)}">
      <button type="button" class="location-card-open" onclick="openLocationProfile('${jsq(participationId)}')" aria-label="Открыть локацию «${esc(location.name||"без названия")}»">
        <span class="location-card-identity">
          <span class="location-card-monogram" aria-hidden="true">${esc(monogram)}</span>
          <span class="location-card-name">${esc(location.name||"Без названия")}</span>
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
  renderLocationProfileScenes(participationId);
  refreshLocationHierarchyContext(location);
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
  locationProfileSaveButton.beginSaving();
  try{
    if(isCloudWorkspace()){
      const canonicalId=locationCanonicalId(location);
      const coreResult=await cloudProjectSync.api.updateLocationCanonical(canonicalId,location.locationRevision,{
        name:fields.name,officialName:fields.officialName||null,aliases:fields.aliases,
        typePreset:fields.typePreset||null,customTypeLabel:fields.customTypeLabel||null,
        description:fields.description,shortSummary:fields.shortSummary||null
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
    }else{
      const result=commitDataChange(next=>{
        const target=next.locations.find(l=>l.id===participationId);
        if(target)Object.assign(target,{
          name:fields.name,officialName:fields.officialName,aliases:fields.aliases,
          typePreset:fields.typePreset,customTypeLabel:fields.customTypeLabel,
          shortSummary:fields.shortSummary,description:fields.description,parentId:fields.parentId
        });
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
  ownedLocationRowsSync,loadOwnedLocationRows,invalidateOwnedLocationsCache,currentLocationProfileParentSelection,
  openLocationGallery,setLocationGallerySearch,setLocationGalleryTypeFilter,renderLocationGallery,deleteLocationFromGallery,
  openLocationProfile,openLocationEntity,enterLocationProfileEdit,cancelLocationProfileEdit,saveLocationProfile,deleteLocationFromProfile,
  openCreateLocationModal,updateCreateLocationSubmitState,submitCreateLocation,populateLocationTypePresetSelect});
export {locationById,locationCanonicalId,locationSceneEntries,locationAncestors,locationDescendantIds,
  ownedLocationRowsSync,loadOwnedLocationRows,invalidateOwnedLocationsCache,currentLocationProfileParentSelection,
  openLocationGallery,setLocationGallerySearch,setLocationGalleryTypeFilter,renderLocationGallery,deleteLocationFromGallery,
  openLocationProfile,openLocationEntity,enterLocationProfileEdit,cancelLocationProfileEdit,saveLocationProfile,deleteLocationFromProfile,
  openCreateLocationModal,updateCreateLocationSubmitState,submitCreateLocation,populateLocationTypePresetSelect};
