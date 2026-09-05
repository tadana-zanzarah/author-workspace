const CONTENT_ERROR_CODES=new Set([
  "REVISION_CONFLICT","LOCATION_REVISION_CONFLICT","LOCATION_HISTORY_EVENT_REVISION_CONFLICT","NOT_FOUND","FORBIDDEN","VALIDATION_ERROR","DUPLICATE","POSITION_ERROR","DEPENDENCIES_EXIST","UNKNOWN"
]);

const SAFE_MESSAGES={
  REVISION_CONFLICT:"Проект изменён в другом сеансе. Перезагрузите данные перед сохранением.",
  LOCATION_REVISION_CONFLICT:"Локация изменена в другом сеансе. Перезагрузите её перед сохранением.",
  LOCATION_HISTORY_EVENT_REVISION_CONFLICT:"Событие истории изменено в другом сеансе. Перезагрузите локацию перед сохранением.",
  NOT_FOUND:"Объект не найден или больше недоступен.",
  FORBIDDEN:"Недостаточно прав для этой операции.",
  VALIDATION_ERROR:"Проверьте введённые данные.",
  DUPLICATE:"Такой объект уже существует.",
  POSITION_ERROR:"Не удалось безопасно определить позицию.",
  DEPENDENCIES_EXIST:"Локация используется в сценах этого проекта. Сначала уберите её из этих сцен.",
  UNKNOWN:"Не удалось выполнить облачную операцию."
};

function normalizeContentResult(result){
  if(result?.error){
    const code=result.error?.code==="42501"?"FORBIDDEN":"UNKNOWN";
    return {ok:false,code,message:SAFE_MESSAGES[code]};
  }
  const value=result?.data;
  if(!value||typeof value!=="object")return {ok:false,code:"UNKNOWN",message:SAFE_MESSAGES.UNKNOWN};
  if(value.ok===true)return {
    ok:true,code:"OK",revision:value.revision==null?undefined:Number(value.revision),
    locationRevision:value.locationRevision==null?undefined:Number(value.locationRevision),
    changed:value.changed===true,data:value.data??null,normalized:value.normalized===true,message:String(value.message||"")
  };
  const code=CONTENT_ERROR_CODES.has(value.code)?value.code:"UNKNOWN";
  return {
    ok:false,code,message:SAFE_MESSAGES[code],entityId:value.entityId,
    expectedRevision:value.expectedRevision==null?undefined:Number(value.expectedRevision),
    actualRevision:value.actualRevision==null?undefined:Number(value.actualRevision),
    revision:value.revision==null?undefined:Number(value.revision),
    locationRevision:value.locationRevision==null?undefined:Number(value.locationRevision),changed:false
  };
}

function createCloudContentApi(client){
  if(!client?.rpc)throw new TypeError("Supabase client with rpc() is required");
  const call=async(name,args)=>normalizeContentResult(await client.rpc(name,args));
  return {
    loadProjectContent:projectId=>call("get_project_content",{target_project_id:projectId}),
    createChapter:(projectId,expectedRevision,{title,position})=>call("create_chapter",{target_project_id:projectId,expected_revision:expectedRevision,chapter_title:title,chapter_position:position}),
    updateChapter:(projectId,chapterId,expectedRevision,{title})=>call("update_chapter",{target_project_id:projectId,target_chapter_id:chapterId,expected_revision:expectedRevision,chapter_title:title}),
    deleteChapter:(projectId,chapterId,expectedRevision)=>call("delete_chapter",{target_project_id:projectId,target_chapter_id:chapterId,expected_revision:expectedRevision}),
    reorderChapter:(projectId,chapterId,expectedRevision,position)=>call("reorder_chapter",{target_project_id:projectId,target_chapter_id:chapterId,expected_revision:expectedRevision,chapter_position:position}),
    createLocation:(projectId,expectedRevision,{name,description=""})=>call("create_location",{target_project_id:projectId,expected_revision:expectedRevision,location_name:name,location_description:description}),
    updateLocation:(projectId,locationId,expectedRevision,{name,description=""})=>call("update_location",{target_project_id:projectId,target_location_id:locationId,expected_revision:expectedRevision,location_name:name,location_description:description}),
    deleteLocation:(projectId,locationId,expectedRevision)=>call("delete_location",{target_project_id:projectId,target_location_id:locationId,expected_revision:expectedRevision}),
    // Phase B canonical-identity path (Location Architecture V2 Phase 3). Distinct RPC names from
    // the legacy trio above by design -- see the migration header in
    // 20260904120000_location_phase3_core_identity.sql for why overloading update_location with
    // an optional expected_location_revision was rejected. createLocationCanonical is still
    // project-scoped (creates the canonical row + this project's participation together, like
    // createLocation); updateLocationCanonical/setLocationParent are pure global-identity
    // mutations gated on the canonical location's OWN revision, not any project's.
    createLocationCanonical:(projectId,expectedRevision,{name,officialName=null,aliases=[],typePreset=null,customTypeLabel=null,description="",shortSummary=null,parentId=null})=>call("create_location_canonical",{
      target_project_id:projectId,expected_revision:expectedRevision,location_name:name,location_official_name:officialName,
      location_aliases:[...new Set(aliases||[])],location_type_preset:typePreset,location_custom_type_label:customTypeLabel,
      location_description:description,location_short_summary:shortSummary,target_parent_id:parentId
    }),
    // location_base_profile_patch (Location base_profile thematic-module contract,
    // 20260904130000_location_base_profile_modules.sql): a generic, allowlisted patch for
    // thematic module keys (B3A: appearanceAtmosphere/geography), forwarded verbatim -- this
    // adapter does no interpretation of the three-state contract (absent/JSON null/object) itself,
    // that lives entirely server-side. baseProfilePatch defaults to null so every existing B2
    // caller (which never passes it) sends exactly the same RPC args as before this contract
    // existed.
    updateLocationCanonical:(locationId,expectedLocationRevision,{name,officialName=null,aliases=[],typePreset=null,customTypeLabel=null,description="",shortSummary=null,baseProfilePatch=null})=>call("update_location_canonical",{
      target_location_id:locationId,expected_location_revision:expectedLocationRevision,location_name:name,location_official_name:officialName,
      location_aliases:[...new Set(aliases||[])],location_type_preset:typePreset,location_custom_type_label:customTypeLabel,
      location_description:description,location_short_summary:shortSummary,location_base_profile_patch:baseProfilePatch
    }),
    setLocationParent:(locationId,expectedLocationRevision,parentId=null)=>call("set_location_parent",{target_location_id:locationId,expected_location_revision:expectedLocationRevision,target_parent_id:parentId}),
    listOwnedLocations:()=>call("list_owned_locations"),
    // Adaptive Module Selection (Phase 1, 20260904140000_location_adaptive_module_selection.sql):
    // a pure project-participation mutation, gated on the PROJECT's own revision (unlike
    // updateLocationCanonical/setLocationParent above, which use the canonical Location's own
    // revision) -- see the Final Contract Addendum §7/§8. moduleSelection is the full new
    // {shown:[...],hidden:[...]} value, never a partial patch. locationId here is the
    // project_locations.id (participation id), matching updateLocation/deleteLocation's own
    // target_location_id naming convention.
    updateLocationModuleSelection:(projectId,locationId,expectedRevision,moduleSelection)=>call("update_project_location_module_selection",{
      target_project_id:projectId,target_location_id:locationId,expected_revision:expectedRevision,module_selection:moduleSelection
    }),
    // Location History H-events (20260908100000_location_history_events_foundation.sql):
    // canonical-only, gated on the Location's own revision domain exactly like updateLocationCanonical/
    // setLocationParent above -- never a project revision, so these live here (not behind
    // runCloudMutation's project-scoped queue) and are called directly, same as
    // js/locations.js's Media reconciliation calls cloudState.locationMediaApi directly. CREATE/
    // DELETE bump locations.revision (returned as `locationRevision`, already generically passed
    // through by normalizeContentResult above); UPDATE bumps only the event's own revision, read
    // back from `data.revision` on the returned row (no separate top-level field needed).
    listLocationHistoryEvents:locationId=>call("list_location_history_events",{target_location_id:locationId}),
    createLocationHistoryEvent:(locationId,expectedRevision,{eventId,title,dateLabel="",description="",sortOrder=0})=>call("create_location_history_event",{
      event_id:eventId,target_location_id:locationId,event_title:title,event_date_label:dateLabel,
      event_description:description,event_sort_order:sortOrder,event_metadata:{},expected_revision:expectedRevision
    }),
    updateLocationHistoryEvent:(eventId,expectedRevision,{title,dateLabel,description,sortOrder})=>call("update_location_history_event",{
      target_event_id:eventId,expected_revision:expectedRevision,event_title:title,event_date_label:dateLabel,
      event_description:description,event_sort_order:sortOrder
    }),
    deleteLocationHistoryEvent:(eventId,expectedRevision)=>call("delete_location_history_event",{target_event_id:eventId,expected_revision:expectedRevision}),
    createTag:(projectId,expectedRevision,{name})=>call("create_tag",{target_project_id:projectId,expected_revision:expectedRevision,tag_name:name}),
    updateTag:(projectId,tagId,expectedRevision,{name})=>call("update_tag",{target_project_id:projectId,target_tag_id:tagId,expected_revision:expectedRevision,tag_name:name}),
    deleteTag:(projectId,tagId,expectedRevision)=>call("delete_tag",{target_project_id:projectId,target_tag_id:tagId,expected_revision:expectedRevision}),
    createScene:(projectId,expectedRevision,scene)=>call("create_scene",sceneArgs(projectId,expectedRevision,scene)),
    updateScene:(projectId,sceneId,expectedRevision,scene)=>call("update_scene",{target_scene_id:sceneId,...sceneArgs(projectId,expectedRevision,scene, false)}),
    deleteScene:(projectId,sceneId,expectedRevision)=>call("delete_scene",{target_project_id:projectId,target_scene_id:sceneId,expected_revision:expectedRevision}),
    moveScene:(projectId,sceneId,expectedRevision,{chapterId=null,beforeSceneId=null})=>call("move_scene",{target_project_id:projectId,target_scene_id:sceneId,expected_revision:expectedRevision,target_chapter_id:chapterId,before_scene_id:beforeSceneId}),
    setSceneTags:(projectId,sceneId,expectedRevision,tagIds)=>call("set_scene_tags",{target_project_id:projectId,target_scene_id:sceneId,expected_revision:expectedRevision,tag_ids:[...new Set(tagIds||[])]})
  };
}

function sceneArgs(projectId,expectedRevision,scene,includePosition=true){
  const args={
    target_project_id:projectId,expected_revision:expectedRevision,target_chapter_id:scene.chapterId??null,
    target_location_id:scene.locationId??null,scene_title:scene.title??"",scene_text_value:scene.sceneText??"",
    scene_date_value:scene.sceneDate??null,scene_time_value:scene.sceneTime??null,
    placement_status_value:scene.placementStatus,writing_status_value:scene.writingStatus,
    included_value:scene.included!==false,date_review_value:scene.dateReview===true
  };
  if(includePosition)args.scene_position=scene.position??null;
  return args;
}

export {CONTENT_ERROR_CODES,createCloudContentApi,normalizeContentResult};
