/* Location Phase B3A/B3B -- base_profile thematic modules (appearanceAtmosphere, geography,
 * governmentSociety, economy).
 *
 * Pure frontend counterpart to the backend three-state patch contract published in
 * supabase/migrations/20260904130000_location_base_profile_modules.sql:
 *   - a module key ABSENT from a patch  -> that module left untouched
 *   - a module key present, value null  -> that module deleted
 *   - a module key present, value {}    -> ALSO normalizes to deletion (never store an empty
 *     module object)
 *   - a module key present, non-empty object -> that module replaced wholesale
 *
 * Field lists here are the single source of truth for what each module contains -- read-mode
 * rendering, edit-mode field wiring, and patch-building in js/locations.js all iterate these
 * instead of repeating the key lists.
 */
import {normalizeMultiValue} from "./migrations.js";

const APPEARANCE_ATMOSPHERE_TEXT_FIELDS=["visualDescription","atmosphere","sounds","smells","lighting","climateFeel"];
const APPEARANCE_ATMOSPHERE_ARRAY_FIELDS=["notableFeatures"];
const GEOGRAPHY_TEXT_FIELDS=["terrain","climate","water","vegetation","coordinates","area","elevation","access"];
const GEOGRAPHY_ARRAY_FIELDS=["naturalFeatures"];
// B3B (governmentSociety/economy) -- see "Location Adaptive Modules -- B3B Product Specification"
// for why exactly these fields and not e.g. a dedicated `capital` field (deferred to a future
// Location<->Location relation model) or a split of geography.access (deferred, see that field's
// own unchanged treatment below -- this migration touches zero Geography semantics).
const GOVERNMENT_SOCIETY_TEXT_FIELDS=["governmentForm","leadership","politicalSituation","lawsAndRules"];
const GOVERNMENT_SOCIETY_ARRAY_FIELDS=["securityForces","notableInstitutions"];
const ECONOMY_TEXT_FIELDS=["currency","economicCharacter","costOfLiving"];
const ECONOMY_ARRAY_FIELDS=["industries","scarcity","tradeConnections"];

// Full-shape hydration: every field present with a safe empty default (string or []), regardless
// of what the stored module actually contains -- used to prefill the edit-mode draft (the DOM
// inputs themselves ARE the draft, see js/locations.js) and to evaluate initial disclosure state.
// Never mutates the source object.
function hydrateThematicModule(raw,textFields,arrayFields){
  const source=raw&&typeof raw==="object"?raw:{};
  const result={};
  for(const key of textFields)result[key]=typeof source[key]==="string"?source[key]:"";
  for(const key of arrayFields)result[key]=Array.isArray(source[key])?source[key].filter(value=>typeof value==="string"):[];
  return result;
}
function hydrateAppearanceAtmosphere(raw){return hydrateThematicModule(raw,APPEARANCE_ATMOSPHERE_TEXT_FIELDS,APPEARANCE_ATMOSPHERE_ARRAY_FIELDS)}
function hydrateGeography(raw){return hydrateThematicModule(raw,GEOGRAPHY_TEXT_FIELDS,GEOGRAPHY_ARRAY_FIELDS)}
function hydrateGovernmentSociety(raw){return hydrateThematicModule(raw,GOVERNMENT_SOCIETY_TEXT_FIELDS,GOVERNMENT_SOCIETY_ARRAY_FIELDS)}
function hydrateEconomy(raw){return hydrateThematicModule(raw,ECONOMY_TEXT_FIELDS,ECONOMY_ARRAY_FIELDS)}

// Clean-shape normalization for comparison/patch/display: trims strings, drops blank/duplicate
// array entries (normalizeMultiValue -- the same dedup/order rule the multi-value widgets already
// apply), and OMITS every empty field/array entirely rather than keeping it as "". Accepts either
// a raw stored module or an already-hydrated draft -- both shapes work since only typeof/Array
// checks are made per field. Field iteration order is fixed (the arrays above), so two semantically
// equal normalized modules always serialize identically regardless of source key order.
function normalizeThematicModule(draft,textFields,arrayFields){
  const source=draft&&typeof draft==="object"?draft:{};
  const result={};
  for(const key of textFields){
    const value=typeof source[key]==="string"?source[key].trim():"";
    if(value)result[key]=value;
  }
  for(const key of arrayFields){
    const values=normalizeMultiValue(source[key]);
    if(values.length)result[key]=values;
  }
  return result;
}
function normalizeAppearanceAtmosphere(draft){return normalizeThematicModule(draft,APPEARANCE_ATMOSPHERE_TEXT_FIELDS,APPEARANCE_ATMOSPHERE_ARRAY_FIELDS)}
function normalizeGeography(draft){return normalizeThematicModule(draft,GEOGRAPHY_TEXT_FIELDS,GEOGRAPHY_ARRAY_FIELDS)}
function normalizeGovernmentSociety(draft){return normalizeThematicModule(draft,GOVERNMENT_SOCIETY_TEXT_FIELDS,GOVERNMENT_SOCIETY_ARRAY_FIELDS)}
function normalizeEconomy(draft){return normalizeThematicModule(draft,ECONOMY_TEXT_FIELDS,ECONOMY_ARRAY_FIELDS)}

function isModuleEmpty(normalizedModule){return Object.keys(normalizedModule||{}).length===0}

function thematicModulesEqual(normalizedA,normalizedB){return JSON.stringify(normalizedA)===JSON.stringify(normalizedB)}

// One module's patch entry: {changed:false} when the normalized original and draft are
// semantically identical (so a no-op edit -- e.g. only whitespace/order differences -- never
// produces a patch); otherwise {changed:true,value:null|object} per the three-state contract.
function buildThematicModulePatchEntry(normalizedOriginal,normalizedDraft){
  if(thematicModulesEqual(normalizedOriginal,normalizedDraft))return {changed:false};
  return {changed:true,value:isModuleEmpty(normalizedDraft)?null:normalizedDraft};
}

// Builds the location_base_profile_patch object for update_location_canonical (cloud) or the
// equivalent local-mode merge (see applyLocationBaseProfilePatch). Returns null when NO module
// actually changed -- callers must send that null through as-is ("no thematic module
// changes this call"), never an empty object. Accepts raw-or-hydrated module shapes for both
// original and draft (normalization happens here). governmentSociety/economy (B3B) are optional --
// an omitted original/draft pair normalizes to {} (unchanged, omitted from the patch), so every
// call site written before B3B keeps working unmodified.
function buildLocationBaseProfilePatch({
  originalAppearance,originalGeography,originalGovernmentSociety,originalEconomy,
  draftAppearance,draftGeography,draftGovernmentSociety,draftEconomy
}){
  const appearanceEntry=buildThematicModulePatchEntry(normalizeAppearanceAtmosphere(originalAppearance),normalizeAppearanceAtmosphere(draftAppearance));
  const geographyEntry=buildThematicModulePatchEntry(normalizeGeography(originalGeography),normalizeGeography(draftGeography));
  const governmentSocietyEntry=buildThematicModulePatchEntry(normalizeGovernmentSociety(originalGovernmentSociety),normalizeGovernmentSociety(draftGovernmentSociety));
  const economyEntry=buildThematicModulePatchEntry(normalizeEconomy(originalEconomy),normalizeEconomy(draftEconomy));
  if(!appearanceEntry.changed&&!geographyEntry.changed&&!governmentSocietyEntry.changed&&!economyEntry.changed)return null;
  const patch={};
  if(appearanceEntry.changed)patch.appearanceAtmosphere=appearanceEntry.value;
  if(geographyEntry.changed)patch.geography=geographyEntry.value;
  if(governmentSocietyEntry.changed)patch.governmentSociety=governmentSocietyEntry.value;
  if(economyEntry.changed)patch.economy=economyEntry.value;
  return patch;
}

// Local-mode equivalent of the server's patch-application loop (update_location_canonical, same
// migration): a patch key with value null deletes that key from base_profile, any other value
// replaces it wholesale, and a key simply absent from the patch is left untouched. Never mutates
// the source base_profile -- returns a new object.
function applyLocationBaseProfilePatch(baseProfile,patch){
  const result={...(baseProfile&&typeof baseProfile==="object"?baseProfile:{})};
  if(!patch)return result;
  for(const key of Object.keys(patch)){
    if(patch[key]===null)delete result[key];
    else result[key]=patch[key];
  }
  return result;
}

Object.assign(globalThis,{
  hydrateAppearanceAtmosphere,hydrateGeography,hydrateGovernmentSociety,hydrateEconomy,
  normalizeAppearanceAtmosphere,normalizeGeography,normalizeGovernmentSociety,normalizeEconomy,
  isModuleEmpty,buildLocationBaseProfilePatch,applyLocationBaseProfilePatch
});
export {
  APPEARANCE_ATMOSPHERE_TEXT_FIELDS,APPEARANCE_ATMOSPHERE_ARRAY_FIELDS,GEOGRAPHY_TEXT_FIELDS,GEOGRAPHY_ARRAY_FIELDS,
  GOVERNMENT_SOCIETY_TEXT_FIELDS,GOVERNMENT_SOCIETY_ARRAY_FIELDS,ECONOMY_TEXT_FIELDS,ECONOMY_ARRAY_FIELDS,
  hydrateAppearanceAtmosphere,hydrateGeography,hydrateGovernmentSociety,hydrateEconomy,
  normalizeAppearanceAtmosphere,normalizeGeography,normalizeGovernmentSociety,normalizeEconomy,
  isModuleEmpty,thematicModulesEqual,buildLocationBaseProfilePatch,applyLocationBaseProfilePatch
};
