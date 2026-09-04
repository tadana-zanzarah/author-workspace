/* Location Phase Adaptive Module Selection -- pure state model (js/location-module-selection.js).
 *
 * Companion to js/location-base-profile.js: that file owns module DATA (hydrate/normalize/patch
 * for base_profile.<moduleKey>); this file owns module SELECTION -- the project-specific
 * shown/hidden state stored at project_locations.metadata.locationProfile.moduleSelection
 * (Adaptive Module Selection -- Final Contract Addendum, accepted). Mirrors the backend's own
 * normalization (private.normalize_location_module_keys / update_project_location_module_
 * selection, 20260904140000_location_adaptive_module_selection.sql) closely enough that a
 * client-computed no-op never disagrees with the server's, but is NOT a security boundary -- the
 * server independently validates and normalizes every write.
 *
 * Phase 1 catalog is deliberately just the two modules that already exist. Adding a future module
 * (populationCulture, governmentSociety, economy, historyNotes) is meant to be a one-line catalog
 * entry here plus the matching backend allowlist line -- see the original audit's "Extensibility
 * strategy" -- not a redesign of anything in this file.
 */
import {normalizeAppearanceAtmosphere,normalizeGeography,isModuleEmpty} from "./location-base-profile.js";

const LOCATION_MODULE_CATALOG=[
  {key:"appearanceAtmosphere",label:"Внешний вид и атмосфера"},
  {key:"geography",label:"География и природа"}
];
const LOCATION_MODULE_KEYS=LOCATION_MODULE_CATALOG.map(m=>m.key);
const LOCATION_MODULE_LABELS=Object.fromEntries(LOCATION_MODULE_CATALOG.map(m=>[m.key,m.label]));

function locationModuleLabel(moduleKey){return LOCATION_MODULE_LABELS[moduleKey]||moduleKey}

function locationModuleHasData(location,moduleKey){
  const baseProfile=(location&&location.baseProfile)||{};
  if(moduleKey==="appearanceAtmosphere")return !isModuleEmpty(normalizeAppearanceAtmosphere(baseProfile.appearanceAtmosphere));
  if(moduleKey==="geography")return !isModuleEmpty(normalizeGeography(baseProfile.geography));
  return false;
}

function normalizeModuleKeyList(raw){
  if(!Array.isArray(raw))return [];
  const seen=new Set();
  return LOCATION_MODULE_KEYS.filter(key=>raw.includes(key)&&!seen.has(key)&&seen.add(key));
}

// Dedupe/canonical-order each array, then resolve any shown/hidden overlap (hidden wins) -- the
// SAME "degrade untrusted input safely" rule the backend's import sanitizer uses, applied here to
// any locally-hydrated or legacy-shaped selection object before it ever reaches a transition
// helper below. Never throws; always returns a well-shaped {shown:[],hidden:[]}.
function normalizeModuleSelection(raw){
  const hidden=normalizeModuleKeyList(raw&&raw.hidden);
  const shown=normalizeModuleKeyList(raw&&raw.shown).filter(key=>!hidden.includes(key));
  return {shown,hidden};
}

function moduleSelectionsEqual(a,b){
  const na=normalizeModuleSelection(a),nb=normalizeModuleSelection(b);
  return JSON.stringify(na)===JSON.stringify(nb);
}

// null when both arrays are empty -- mirrors the server's empty-selection collapse (no stored
// moduleSelection key at all), so a caller can use the SAME rule to decide "send an RPC call" vs
// "this is a genuine no-op, skip it" that the RPC itself uses to decide "write" vs "changed:false".
function moduleSelectionEffective(raw){
  const n=normalizeModuleSelection(raw);
  return (n.shown.length||n.hidden.length)?n:null;
}

function locationModuleEditVisible(location,selection,moduleKey){
  const n=normalizeModuleSelection(selection);
  if(n.hidden.includes(moduleKey))return false;
  return locationModuleHasData(location,moduleKey)||n.shown.includes(moduleKey);
}
function locationModuleReadVisible(location,selection,moduleKey){
  const n=normalizeModuleSelection(selection);
  if(n.hidden.includes(moduleKey))return false;
  return locationModuleHasData(location,moduleKey);
}
function locationVisibleModules(location,selection,{mode="edit"}={}){
  const test=mode==="read"?locationModuleReadVisible:locationModuleEditVisible;
  return LOCATION_MODULE_KEYS.filter(key=>test(location,selection,key));
}

// "+ Добавить раздел" picker candidates: every module NOT currently edit-visible, each tagged
// with whether it already has canonical data -- a hidden, populated module is offered as
// action:"show" ("Показать раздел"), a truly absent one as action:"add" ("Добавить раздел"). A
// module that's already edit-visible is never a candidate (nothing to add/restore).
function locationModulePickerCandidates(location,selection){
  return LOCATION_MODULE_KEYS.filter(key=>!locationModuleEditVisible(location,selection,key)).map(key=>{
    const hasData=locationModuleHasData(location,key);
    return {key,label:locationModuleLabel(key),hasData,action:hasData?"show":"add"};
  });
}

/* ---- Draft transition helpers -----------------------------------------------------------------
 * Each takes a (possibly unnormalized) selection and returns a freshly normalized one; none
 * mutates its input. These implement the state-transition table from the contract addendum
 * exactly -- see each function's one-line invariant. */

// Добавить раздел: empty module only (callers gate this on !hasData before offering the action).
function addEmptyLocationModule(selection,moduleKey){
  const n=normalizeModuleSelection(selection);
  return normalizeModuleSelection({shown:[...n.shown,moduleKey],hidden:n.hidden.filter(k=>k!==moduleKey)});
}
// Убрать раздел: drop from shown only -- never touches hidden. Safe whether the key was a
// same-session draft addition or a previously-persisted shown entry; Save always compares
// normalized original vs. normalized draft (see saveNeedsModuleSelectionWrite below), so a
// removal that was never persisted produces no write, and one that WAS persisted produces one --
// with no separate event log needed either way.
function removeEmptyLocationModule(selection,moduleKey){
  const n=normalizeModuleSelection(selection);
  return {shown:n.shown.filter(k=>k!==moduleKey),hidden:n.hidden};
}
// Скрыть раздел: only valid on a populated module (callers gate this on hasData). Adds to hidden,
// drops from shown if present there for any reason (defensive; normalizeModuleSelection would
// already resolve the conflict, this just keeps the intent explicit at the call site).
function hideLocationModule(selection,moduleKey){
  const n=normalizeModuleSelection(selection);
  return normalizeModuleSelection({shown:n.shown.filter(k=>k!==moduleKey),hidden:[...n.hidden,moduleKey]});
}
// Показать раздел: removes from hidden. Never adds to shown -- hasData already implies visible,
// so shown would be redundant the instant it's computed (see dropRedundantShownEntries).
function showLocationModule(selection,moduleKey){
  const n=normalizeModuleSelection(selection);
  return {shown:n.shown,hidden:n.hidden.filter(k=>k!==moduleKey)};
}
// Удалить данные раздела: strips the key from BOTH arrays -- nothing left to track once the data,
// and any hide/show preference protecting it, is gone.
function deleteLocationModuleSelectionEntry(selection,moduleKey){
  const n=normalizeModuleSelection(selection);
  return {shown:n.shown.filter(k=>k!==moduleKey),hidden:n.hidden.filter(k=>k!==moduleKey)};
}

// Post-edit normalization: a module that gained data while sitting in `shown` becomes redundant
// there. `locationLike` only needs a `.baseProfile` shaped like the DRAFT's resulting base_profile
// (post-save), not necessarily a full location object -- keeps this testable without a fixture.
function dropRedundantShownEntries(selection,locationLike){
  const n=normalizeModuleSelection(selection);
  return {shown:n.shown.filter(key=>!locationModuleHasData(locationLike,key)),hidden:n.hidden};
}

// True iff the normalized draft selection differs from the normalized original -- the single rule
// that decides whether a Save needs to call the module-selection RPC at all (contract addendum
// §3/§8: compare normalized original vs. normalized draft, no separate event log).
function saveNeedsModuleSelectionWrite(originalSelection,draftSelection){
  return !moduleSelectionsEqual(originalSelection,draftSelection);
}

Object.assign(globalThis,{
  LOCATION_MODULE_CATALOG,LOCATION_MODULE_KEYS,locationModuleLabel,locationModuleHasData,
  normalizeModuleSelection,moduleSelectionsEqual,moduleSelectionEffective,
  locationModuleEditVisible,locationModuleReadVisible,locationVisibleModules,locationModulePickerCandidates,
  addEmptyLocationModule,removeEmptyLocationModule,hideLocationModule,showLocationModule,
  deleteLocationModuleSelectionEntry,dropRedundantShownEntries,saveNeedsModuleSelectionWrite
});
export {
  LOCATION_MODULE_CATALOG,LOCATION_MODULE_KEYS,locationModuleLabel,locationModuleHasData,
  normalizeModuleSelection,moduleSelectionsEqual,moduleSelectionEffective,
  locationModuleEditVisible,locationModuleReadVisible,locationVisibleModules,locationModulePickerCandidates,
  addEmptyLocationModule,removeEmptyLocationModule,hideLocationModule,showLocationModule,
  deleteLocationModuleSelectionEntry,dropRedundantShownEntries,saveNeedsModuleSelectionWrite
};
