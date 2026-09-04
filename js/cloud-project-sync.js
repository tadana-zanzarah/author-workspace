import {projectWorkspaceKey} from "./workspace-storage.js";

const UNASSIGNED_CHAPTER_ID="chapter-unassigned";
const CACHE_META_SUFFIX=":cloud-cache-meta";
const LOCAL_TO_CLOUD_WRITING={idea:"draft",plan:"draft",draft:"draft",edit1:"in_progress",edit2:"revised",final:"final"};
const CLOUD_TO_LOCAL_WRITING={draft:"draft",in_progress:"edit1",revised:"edit2",final:"final"};

function cacheMetadataKey(projectId){return `${projectWorkspaceKey(projectId)}${CACHE_META_SUFFIX}`}
function isCloudWorkspace(){return !!globalThis.cloudProjectSync?.projectId}
function hasProjectContent(project){
  return (project?.chapters||[]).some(item=>item?.id!==UNASSIGNED_CHAPTER_ID)||
    ["scenes","locations","tags","characters"].some(key=>Array.isArray(project?.[key])&&project[key].length>0);
}
function localAdjunctByScene(project){
  return Object.fromEntries((project?.scenes||[]).map(scene=>[scene.id,{
    people:scene.people||{},relationChanges:scene.relationChanges||{},
    ...Object.fromEntries(Object.entries(scene).filter(([key])=>!new Set(["id","chapterId","locationId","title","sceneText","date","time","status","writingStatus","included","dateReview","tags"]).has(key)))
  }]));
}
function effectiveProfile(base,overrides){return {...(base||{}),...(overrides||{})}}
function hydrateCloudCharacters(payload,localProject={}){
  const identities=new Map((payload.characters||[]).map(row=>[row.id,row]));
  const localProfiles=localProject.profiles||{},characters=[],profiles={},globalIdByParticipation={};
  for(const pc of payload.project_characters||[]){
    const identity=identities.get(pc.character_id);if(!identity)continue;
    globalIdByParticipation[pc.id]=identity.id;
    const base=identity.base_profile||{},overrides=pc.overrides||{},effective=effectiveProfile(base,overrides);
    const cloudPhotos=(payload.character_images||[]).filter(image=>image.character_id===identity.id&&(image.project_character_id===null||image.project_character_id===pc.id)).map(image=>({
      id:image.id,source:{kind:"storage",value:image.signedUrl||"",storagePath:image.storage_path},crop:image.crop||{x:.5,y:.5,zoom:1},alt:image.alt||"",caption:image.caption||"",
      revision:Number(image.revision),isPrimary:image.is_primary===true,sortOrder:Number(image.sort_order||0),projectCharacterId:image.project_character_id,scope:image.project_character_id?"project":"global",...(image.metadata||{})
    }));
    const localPhotos=(localProfiles[identity.id]?.photos||[]).filter(photo=>String(photo?.source?.value||"").startsWith("data:"));
    const photos=cloudPhotos.length?cloudPhotos:localPhotos;
    characters.push({id:identity.id,name:identity.name||"",surname:identity.surname||"",projectCharacterId:pc.id,
      characterRevision:Number(identity.revision),projectOverrides:overrides,role:pc.role??null,sortOrder:Number(pc.sort_order||0)});
    profiles[identity.id]={...effective,id:identity.id,characterId:identity.id,name:identity.name||"",surname:identity.surname||"",
      photos,primaryPhotoId:cloudPhotos.find(photo=>photo.isPrimary)?.id||cloudPhotos[0]?.id||localProfiles[identity.id]?.primaryPhotoId||localPhotos[0]?.id||"",initialRelations:{},
      _legacyLocalPhotosPending:cloudPhotos.length===0&&localPhotos.length>0,
      _cloud:{baseProfile:base,overrides,characterRevision:Number(identity.revision),projectCharacterId:pc.id}};
  }
  for(const row of payload.project_character_relations||[]){
    const from=globalIdByParticipation[row.from_project_character_id],to=globalIdByParticipation[row.to_project_character_id];
    if(from&&to&&profiles[from])profiles[from].initialRelations[to]=row.value??"";
  }
  return {characters,profiles,globalIdByParticipation};
}
function hydrateProjectFromCloudSnapshot(snapshot,localProject={}){
  const payload=snapshot?.data||snapshot||{};
  const adjunct=localAdjunctByScene(localProject);
  const cloudCharacters=hydrateCloudCharacters(payload,localProject);
  const tagIdsByScene={};
  for(const join of payload.scene_tags||[])(tagIdsByScene[join.scene_id]||=[]).push(join.tag_id);
  const cloudChapters=(payload.chapters||[]).map(row=>({id:row.id,title:row.title,position:Number(row.position),collapsed:false}));
  const participantsByScene={};
  for(const item of payload.scene_characters||[]){const characterId=cloudCharacters.globalIdByParticipation[item.project_character_id];if(characterId)(participantsByScene[item.scene_id]||={})[characterId]={action:item.action||"",legacyState:item.legacy_state??null,relationChanges:{},visibleRelations:[]}}
  for(const item of payload.scene_relation_changes||[]){
    const from=cloudCharacters.globalIdByParticipation[item.from_project_character_id],to=cloudCharacters.globalIdByParticipation[item.to_project_character_id],person=participantsByScene[item.scene_id]?.[from];if(!person||!to)continue;
    if(item.value_operation==="set")person.relationChanges[to]=item.value??"";else if(item.value_operation==="clear")person.relationChanges[to]="";
    if(item.visible===true)person.visibleRelations.push(to);
    (person._cloudRelationChanges||=[]).push({toCharacterId:to,valueOperation:item.value_operation??null,value:item.value??null,visible:item.visible??null,metadata:item.metadata||{}});
  }
  const scenes=(payload.scenes||[]).map(row=>({
    ...Object.fromEntries(Object.entries(adjunct[row.id]||{}).filter(([key])=>key!=="people")),id:row.id,date:row.scene_date||"",time:String(row.scene_time||"").slice(0,5),title:row.title||"",
    chapterId:row.chapter_id||UNASSIGNED_CHAPTER_ID,locationId:row.location_id||"",tags:tagIdsByScene[row.id]||[],
    writingStatus:CLOUD_TO_LOCAL_WRITING[row.writing_status]||"draft",sceneText:row.scene_text||"",included:row.included!==false,
    status:row.placement_status==="placed"?"fixed":"floating",dateReview:row.date_review===true,position:Number(row.position),people:participantsByScene[row.id]||{}
  }));
  // scenes.position — единственный canonical порядок на сервере и не группируется по главе
  // (chapter_id — атрибут группировки, см. docs/cloud-content-architecture.md). Но список глав
  // и табличный вид всегда группируют сцены по главе, и хронология должна сравнивать сцену
  // только с тем, что реально соседствует с ней в этом отображаемом порядке — так же, как в
  // local-режиме, где data.scenes всегда физически сгруппирован по главам. Поэтому здесь сцены
  // пересортировываются в главо-группированный порядок (позиция остаётся тай-брейкером внутри
  // главы); сам position на сервере не меняется.
  const chapterOrder=new Map([...cloudChapters,{id:UNASSIGNED_CHAPTER_ID}].map((chapter,index)=>[chapter.id,index]));
  scenes.sort((a,b)=>(chapterOrder.get(a.chapterId)??Infinity)-(chapterOrder.get(b.chapterId)??Infinity)||a.position-b.position);
  return {
    ...localProject,version:11,
    characters:cloudCharacters.characters,profiles:cloudCharacters.profiles,
    characterLinks:(payload.character_links||[]).concat(payload.global_character_links||[]).map(row=>({id:row.id,fromCharacterId:row.from_character_id,toCharacterId:row.to_character_id,
      category:row.metadata?.uiCategory||row.category,type:row.type,reverseType:row.reverse_type,customLabel:row.custom_label,reverseCustomLabel:row.reverse_custom_label,
      notes:row.notes||"",structureKind:row.metadata?.uiStructureKind||row.structure_kind||"other",metadata:row.metadata||{},scope:row.project_id?"project":"global",revision:Number(row.revision)})),
    future:localProject.future||{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
    chapters:[...cloudChapters,{id:UNASSIGNED_CHAPTER_ID,title:"Без главы",collapsed:false}],
    // Phase B2: extend the flat {id,name,description,locationId} shape (Phase A/2) with explicit
    // normalized core-identity fields so components read location.officialName/aliases/parentId/
    // typePreset/customTypeLabel/shortSummary/locationRevision directly instead of raw snake_case.
    // Every new field defaults safely when absent (old cached snapshot / pre-B1 payload shape),
    // per the Phase B2 hydration contract -- no field here can throw on a missing key.
    locations:(payload.locations||[]).map(row=>({
      id:row.id,name:row.name,description:row.description||"",locationId:row.location_id||row.id,
      officialName:row.official_name||"",aliases:Array.isArray(row.aliases)?row.aliases:[],
      parentId:row.parent_id||null,typePreset:row.type_preset||null,customTypeLabel:row.custom_type_label||null,
      baseProfile:row.base_profile||{},shortSummary:row.base_profile?.shortSummary||"",
      locationRevision:row.location_revision==null?0:Number(row.location_revision),
      // Adaptive Module Selection (Phase 1): project-specific presentation state, hydrated raw
      // (like baseProfile above) -- js/location-module-selection.js's normalizeModuleSelection is
      // the single place that turns this into a safe {shown:[],hidden:[]} shape on read.
      moduleSelection:row.metadata?.locationProfile?.moduleSelection||{}
    })),
    tags:(payload.tags||[]).map(row=>({id:row.id,name:row.name})),scenes
  };
}
function sceneToCloud(scene,position=null){return {
  chapterId:scene.chapterId===UNASSIGNED_CHAPTER_ID?null:scene.chapterId||null,locationId:scene.locationId||null,
  title:scene.title||"",sceneText:scene.sceneText||"",sceneDate:scene.date||null,sceneTime:scene.time||null,
  placementStatus:scene.status==="fixed"?"placed":"unplaced",writingStatus:LOCAL_TO_CLOUD_WRITING[scene.writingStatus]||"draft",
  included:scene.included!==false,dateReview:scene.dateReview===true,position
}}
function readLocalProject(projectId,storage=globalThis.localStorage){
  try{const raw=storage.getItem(projectWorkspaceKey(projectId));return raw?JSON.parse(raw):null}catch{return null}
}
function writeConfirmedCache(projectId,revision,project,storage=globalThis.localStorage,now=new Date()){
  const serialized=JSON.stringify(project),metadata=JSON.stringify({schema:1,projectId,cloudRevision:Number(revision),cachedAt:now.toISOString()});
  storage.setItem(projectWorkspaceKey(projectId),serialized);storage.setItem(cacheMetadataKey(projectId),metadata);
  return {project,metadata:JSON.parse(metadata)};
}
function createProjectMutationQueue({projectId,api,getRevision,setRevision,onConfirmed,onFailure}){
  let tail=Promise.resolve(),blocked=false;
  // Only REVISION_CONFLICT latches the queue: the cached revision is now known-stale and any
  // further mutation needs an explicit reload (see the interactive onConflict prompt) before it
  // can safely carry a real expected_revision again. Every other failure (network error, fetch
  // failure, unknown backend error, validation, etc.) leaves the last-confirmed revision intact,
  // so the queue must stay usable for the next explicit mutation instead of rejecting it outright.
  const enqueue=(name,operation)=>{
    const run=async()=>{
      if(blocked)throw Object.assign(new Error("Проект изменён в другом сеансе. Перезагрузите данные перед сохранением."),{code:"QUEUE_STOPPED"});
      const result=await operation(getRevision());
      if(!result?.ok){if(result?.code==="REVISION_CONFLICT")blocked=true;onFailure?.(result,name);throw Object.assign(new Error(result?.message||"Cloud mutation failed"),result)}
      setRevision(result.revision);await onConfirmed?.(result,name);return result;
    };
    const pending=tail.then(run);tail=pending.catch(()=>{});return pending;
  };
  return {projectId,enqueue,reset(){blocked=false},idle(){return tail}};
}
async function loadImageRows(imageApi,characters,projectCharacters){
  if(!imageApi)return [];
  const byCharacter=new Map(projectCharacters.map(pc=>[pc.character_id,pc.id]));
  const results=await Promise.all(characters.filter(c=>byCharacter.has(c.id)).map(c=>imageApi.listImages(c.id,byCharacter.get(c.id))));
  const rows=results.flatMap(result=>result.ok?(result.data||[]):[]),unique=[...new Map(rows.map(row=>[row.id,row])).values()];
  await Promise.all(unique.map(async row=>{const signed=await imageApi.signedUrl(row.storage_path);if(signed.ok)row.signedUrl=signed.url}));return unique;
}
function createCloudProjectSync({projectId,api,characterApi=null,imageApi=null,storage=globalThis.localStorage,onState,onConflict}){
  let revision=null,confirmedProject=null;
  const sync={projectId,api,get revision(){return revision},get confirmedProject(){return confirmedProject}};
  const cache=()=>writeConfirmedCache(projectId,revision,confirmedProject,storage);
  const load=async({allowLegacyChoice=false}={})=>{
    onState?.("loading");const local=readLocalProject(projectId,storage);const [result,identities,globalLinks]=await Promise.all([api.loadProjectContent(projectId),characterApi?.listCharacters(),characterApi?.listGlobalLinks()]);
    if(!result.ok){onState?.("error",result);throw Object.assign(new Error(result.message),result)}
    if(characterApi&&(!identities?.ok||!globalLinks?.ok)){const failure=!identities?.ok?identities:globalLinks;onState?.("error",failure);throw Object.assign(new Error(failure?.message||"Character snapshot failed"),failure)}
    result.data.characters=identities?.data||[];result.data.global_character_links=globalLinks?.data||[];result.data.character_images=await loadImageRows(imageApi,result.data.characters,result.data.project_characters||[]);
    const remoteEmpty=!hasProjectContent(result.data),localHas=hasProjectContent(local);
    if(remoteEmpty&&localHas&&!allowLegacyChoice){onState?.("legacy-blocked",{local,result});return {ok:false,code:"LOCAL_CONTENT_CLOUD_EMPTY",local,result}}
    revision=result.revision;confirmedProject=hydrateProjectFromCloudSnapshot(result.data,local||{});cache();onState?.("ready");return {ok:true,revision,data:confirmedProject};
  };
  const queue=createProjectMutationQueue({projectId,api,getRevision:()=>revision,setRevision:value=>{revision=value},onConfirmed:async()=>{const [fresh,identities,globalLinks]=await Promise.all([api.loadProjectContent(projectId),characterApi?.listCharacters(),characterApi?.listGlobalLinks()]);if(!fresh.ok)throw Object.assign(new Error(fresh.message),fresh);if(characterApi&&(!identities?.ok||!globalLinks?.ok))throw Object.assign(new Error("Character snapshot failed"),!identities?.ok?identities:globalLinks);fresh.data.characters=identities?.data||[];fresh.data.global_character_links=globalLinks?.data||[];fresh.data.character_images=await loadImageRows(imageApi,fresh.data.characters,fresh.data.project_characters||[]);revision=fresh.revision;const adjunctSource=globalThis.cloudProjectSync===sync&&globalThis.data?globalThis.data:confirmedProject;confirmedProject=hydrateProjectFromCloudSnapshot(fresh.data,adjunctSource);cache();onState?.("saved",confirmedProject)},onFailure:(result)=>{onState?.(result.code==="REVISION_CONFLICT"?"conflict":"save-error",result);if(result.code==="REVISION_CONFLICT")onConflict?.(result)}});
  return Object.assign(sync,{load,cache,queue,mutate:(name,operation)=>queue.enqueue(name,operation),reload:async()=>{queue.reset();return load({allowLegacyChoice:true})}});
}

async function runCloudMutation(name,operation,{renderAfter=true}={}){
  const sync=globalThis.cloudProjectSync;
  if(!sync)throw new Error("Cloud project is not active");
  try{
    const result=await sync.mutate(name,revision=>operation(sync.api,revision));
    globalThis.data=sync.confirmedProject;if(renderAfter)globalThis.render?.();return result;
  }catch(error){return {ok:false,code:error.code||"UNKNOWN",message:error.message,error}}
}

Object.assign(globalThis,{runCloudMutation,sceneToCloud,isCloudWorkspace});
export {UNASSIGNED_CHAPTER_ID,cacheMetadataKey,createCloudProjectSync,createProjectMutationQueue,effectiveProfile,hasProjectContent,hydrateCloudCharacters,hydrateProjectFromCloudSnapshot,isCloudWorkspace,localAdjunctByScene,readLocalProject,runCloudMutation,sceneToCloud,writeConfirmedCache};
