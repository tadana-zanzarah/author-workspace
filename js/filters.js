function sceneMatches(scene){
  if(filters.chapter&&scene.chapterId!==filters.chapter)return false;
  if(filters.location&&scene.locationId!==filters.location)return false;
  if(filters.tag&&!scene.tags.includes(filters.tag))return false;
  if(filters.writing&&scene.writingStatus!==filters.writing)return false;
  if(filters.placement&&scene.status!==filters.placement)return false;
  if(filters.character&&!sceneHasParticipant(scene,filters.character))return false;
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

function setFilter(key,value){filters[key]=filters[key]===value?"":value;scheduleRender()}

function getVisibleSceneEntries(){
  return data.scenes.map((scene,index)=>({scene,index})).filter(x=>sceneMatches(x.scene));
}

function hasActiveFilters(){return Object.values(filters).some(Boolean)}

Object.assign(globalThis,{sceneMatches,setFilter,getVisibleSceneEntries,hasActiveFilters});
export {sceneMatches,setFilter,getVisibleSceneEntries,hasActiveFilters};
