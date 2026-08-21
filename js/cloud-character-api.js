const CHARACTER_ERROR_CODES=new Set([
  "REVISION_CONFLICT","CHARACTER_REVISION_CONFLICT","GLOBAL_LINK_REVISION_CONFLICT",
  "NOT_FOUND","FORBIDDEN","VALIDATION_ERROR","DUPLICATE","DEPENDENCIES_EXIST","UNKNOWN"
]);

const SAFE_MESSAGES={
  REVISION_CONFLICT:"Проект изменён в другом сеансе. Перезагрузите данные перед сохранением.",
  CHARACTER_REVISION_CONFLICT:"Профиль персонажа изменён в другом сеансе. Перезагрузите его перед сохранением.",
  GLOBAL_LINK_REVISION_CONFLICT:"Связь персонажей изменена в другом сеансе. Перезагрузите её перед сохранением.",
  NOT_FOUND:"Объект не найден или больше недоступен.",FORBIDDEN:"Недостаточно прав для этой операции.",
  VALIDATION_ERROR:"Проверьте введённые данные.",DUPLICATE:"Такой объект уже существует.",
  DEPENDENCIES_EXIST:"Персонаж используется в проекте. Подтвердите явное удаление зависимостей.",
  UNKNOWN:"Не удалось выполнить облачную операцию с персонажем."
};

function normalizeCharacterResult(result){
  if(result?.error){const code=result.error?.code==="42501"?"FORBIDDEN":"UNKNOWN";return {ok:false,code,message:SAFE_MESSAGES[code],changed:false};}
  const value=result?.data;
  if(!value||typeof value!=="object")return {ok:false,code:"UNKNOWN",message:SAFE_MESSAGES.UNKNOWN,changed:false};
  if(value.ok===true)return {
    ok:true,code:"OK",revision:numberOrUndefined(value.revision),characterRevision:numberOrUndefined(value.characterRevision),
    linkRevision:numberOrUndefined(value.linkRevision),changed:value.changed===true,data:value.data??null,
    dependenciesRemoved:value.dependenciesRemoved,message:String(value.message||"")
  };
  const code=CHARACTER_ERROR_CODES.has(value.code)?value.code:"UNKNOWN";
  return {ok:false,code,message:SAFE_MESSAGES[code],changed:false,entityId:value.entityId,
    expectedRevision:numberOrUndefined(value.expectedRevision),actualRevision:numberOrUndefined(value.actualRevision),
    revision:numberOrUndefined(value.revision),dependencies:value.dependencies};
}

const numberOrUndefined=value=>value==null?undefined:Number(value);
const relationItem=item=>({
  from_project_character_id:item.fromProjectCharacterId,to_project_character_id:item.toProjectCharacterId,
  value_operation:item.valueOperation??null,value:item.value??null,visible:item.visible??null,metadata:item.metadata??{}
});
const linkArgs=link=>({from_character_id:link.fromCharacterId,to_character_id:link.toCharacterId,link_category:link.category,
  link_type:link.type,link_reverse_type:link.reverseType,link_custom_label:link.customLabel??null,
  link_reverse_custom_label:link.reverseCustomLabel??null,link_notes:link.notes??"",link_structure_kind:link.structureKind??"other",link_metadata:link.metadata??{}});

function createCloudCharacterApi(client){
  if(!client?.rpc)throw new TypeError("Supabase client with rpc() is required");
  const call=async(name,args={})=>normalizeCharacterResult(await client.rpc(name,args));
  return {
    listCharacters:()=>call("list_characters"),
    listGlobalLinks:()=>call("list_global_character_links"),
    createCharacter:character=>call("create_character",{character_name:character.name,character_surname:character.surname??"",base_profile:character.baseProfile??{}}),
    updateCharacter:(characterId,expectedRevision,character)=>call("update_character",{target_character_id:characterId,expected_revision:expectedRevision,character_name:character.name,character_surname:character.surname??"",base_profile:character.baseProfile??{}}),
    archiveCharacter:(characterId,expectedRevision,archive=true)=>call("archive_character",{target_character_id:characterId,expected_revision:expectedRevision,archive}),
    attachProjectCharacter:(projectId,characterId,expectedRevision,state={})=>call("attach_project_character",{target_project_id:projectId,target_character_id:characterId,expected_revision:expectedRevision,character_role:state.role??null,character_sort_order:state.sortOrder??0,character_overrides:state.overrides??{}}),
    createCharacterAndAttach:(projectId,expectedRevision,character,state={})=>call("create_character_and_attach",{target_project_id:projectId,expected_revision:expectedRevision,character_name:character.name,character_surname:character.surname??"",base_profile:character.baseProfile??{},character_role:state.role??null,character_sort_order:state.sortOrder??0,character_overrides:state.overrides??{}}),
    updateProjectCharacter:(projectId,projectCharacterId,expectedRevision,state)=>call("update_project_character",{target_project_id:projectId,target_project_character_id:projectCharacterId,expected_revision:expectedRevision,character_overrides:state.overrides??{},character_role:state.role??null,character_sort_order:state.sortOrder??0}),
    removeProjectCharacter:(projectId,projectCharacterId,expectedRevision,{cleanupDependencies=false}={})=>call("remove_project_character",{target_project_id:projectId,target_project_character_id:projectCharacterId,expected_revision:expectedRevision,cleanup_dependencies:cleanupDependencies}),
    setSceneCharacters:(projectId,sceneId,expectedRevision,participants)=>call("set_scene_characters",{target_project_id:projectId,target_scene_id:sceneId,expected_revision:expectedRevision,participants:(participants||[]).map(x=>({project_character_id:x.projectCharacterId,action:x.action??"",legacy_state:x.legacyState??null,sort_order:x.sortOrder??0}))}),
    setInitialRelations:(projectId,expectedRevision,relations)=>call("set_project_character_relations",{target_project_id:projectId,expected_revision:expectedRevision,relations:(relations||[]).map(relationItem)}),
    setSceneRelationChanges:(projectId,sceneId,expectedRevision,changes)=>call("set_scene_relation_changes",{target_project_id:projectId,target_scene_id:sceneId,expected_revision:expectedRevision,changes:(changes||[]).map(relationItem)}),
    createLink:(projectId,expectedProjectRevision,link)=>call("create_character_link",{target_project_id:projectId??null,expected_project_revision:expectedProjectRevision??null,...linkArgs(link)}),
    updateLink:(linkId,{expectedProjectRevision=null,expectedLinkRevision=null},link)=>call("update_character_link",{target_link_id:linkId,expected_project_revision:expectedProjectRevision,expected_link_revision:expectedLinkRevision,...linkArgs(link)}),
    deleteLink:(linkId,{expectedProjectRevision=null,expectedLinkRevision=null}={})=>call("delete_character_link",{target_link_id:linkId,expected_project_revision:expectedProjectRevision,expected_link_revision:expectedLinkRevision})
  };
}

export {CHARACTER_ERROR_CODES,createCloudCharacterApi,normalizeCharacterResult};
