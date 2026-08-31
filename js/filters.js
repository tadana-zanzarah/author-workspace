// Multi-value filter keys: the UI lets the user pick several characters and/or
// several tags at once, and a matching scene must satisfy EVERY selected value
// within each of those groups (AND), while every other filter group still
// combines with them via AND too — see sceneMatches below. Single-value keys
// keep the original "exactly one active value, or none" behavior.
const MULTI_FILTER_KEYS=["character","tag"];

function isMultiFilterKey(key){return MULTI_FILTER_KEYS.includes(key)}

function filterValues(key){
  const v=filters[key];
  return Array.isArray(v)?v:(v?[v]:[]);
}

function sceneMatches(scene){
  if(filters.chapter&&scene.chapterId!==filters.chapter)return false;
  if(filters.location&&scene.locationId!==filters.location)return false;
  if(filterValues("tag").length&&!filterValues("tag").every(id=>scene.tags.includes(id)))return false;
  if(filters.writing&&scene.writingStatus!==filters.writing)return false;
  if(filters.placement&&scene.status!==filters.placement)return false;
  if(filterValues("character").length&&!filterValues("character").every(id=>sceneHasParticipant(scene,id)))return false;
  const q=filters.search.trim().toLocaleLowerCase("ru");
  if(q){
    const chapter=chapterById(scene.chapterId)?.title||"";
    const location=locationById(scene.locationId)?.name||"";
    const tagNames=scene.tags.map(id=>tagById(id)?.name||"").join(" ");
    const chars=sceneCharacters(scene).join(" ");
    const hay=[scene.title,scene.sceneText,chapter,location,tagNames,chars].join("\n").toLocaleLowerCase("ru");
    if(!hay.includes(q))return false;
  }
  return true;
}

// Single "jump to this value" action used by entity links throughout the app
// (scene info chips, character/tag chips, matrix headers, sidebar…). For a
// multi-value key this replaces the whole selection with just this one value
// (clicking the same lone value again clears it) — the existing toggle
// semantics, extended to arrays instead of scalars.
function setFilter(key,value){
  if(isMultiFilterKey(key)){
    const current=filterValues(key);
    filters[key]=(current.length===1&&current[0]===value)?[]:[value];
  }else{
    filters[key]=filters[key]===value?"":value;
  }
  scheduleRender();
}

// Used by the multi-select filter dropdown itself: add/remove one value from
// the selection without touching the rest of it.
function toggleFilterValue(key,value){
  const current=filterValues(key);
  filters[key]=current.includes(value)?current.filter(v=>v!==value):[...current,value];
  scheduleRender();
}

function clearFilterKey(key){
  filters[key]=isMultiFilterKey(key)?[]:"";
  scheduleRender();
}

function getVisibleSceneEntries(){
  return data.scenes.map((scene,index)=>({scene,index})).filter(x=>sceneMatches(x.scene));
}

function hasActiveFilters(){
  return Object.entries(filters).some(([key,value])=>Array.isArray(value)?value.length>0:Boolean(value));
}

Object.assign(globalThis,{isMultiFilterKey,filterValues,sceneMatches,setFilter,toggleFilterValue,clearFilterKey,getVisibleSceneEntries,hasActiveFilters});
export {isMultiFilterKey,filterValues,sceneMatches,setFilter,toggleFilterValue,clearFilterKey,getVisibleSceneEntries,hasActiveFilters};
