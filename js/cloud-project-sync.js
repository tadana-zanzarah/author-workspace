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
function hydrateProjectFromCloudSnapshot(snapshot,localProject={}){
  const payload=snapshot?.data||snapshot||{};
  const adjunct=localAdjunctByScene(localProject);
  const tagIdsByScene={};
  for(const join of payload.scene_tags||[])(tagIdsByScene[join.scene_id]||=[]).push(join.tag_id);
  const cloudChapters=(payload.chapters||[]).map(row=>({id:row.id,title:row.title,position:Number(row.position),collapsed:false}));
  const scenes=(payload.scenes||[]).map(row=>({
    ...(adjunct[row.id]||{}),id:row.id,date:row.scene_date||"",time:String(row.scene_time||"").slice(0,5),title:row.title||"",
    chapterId:row.chapter_id||UNASSIGNED_CHAPTER_ID,locationId:row.location_id||"",tags:tagIdsByScene[row.id]||[],
    writingStatus:CLOUD_TO_LOCAL_WRITING[row.writing_status]||"draft",sceneText:row.scene_text||"",included:row.included!==false,
    status:row.placement_status==="placed"?"fixed":"floating",dateReview:row.date_review===true,position:Number(row.position),people:adjunct[row.id]?.people||{}
  }));
  return {
    ...localProject,version:11,
    characters:Array.isArray(localProject.characters)?localProject.characters:[],profiles:localProject.profiles||{},
    characterLinks:Array.isArray(localProject.characterLinks)?localProject.characterLinks:[],
    future:localProject.future||{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
    chapters:[...cloudChapters,{id:UNASSIGNED_CHAPTER_ID,title:"Без главы",collapsed:false}],
    locations:(payload.locations||[]).map(row=>({id:row.id,name:row.name,description:row.description||""})),
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
  let tail=Promise.resolve(),failed=false;
  const enqueue=(name,operation)=>{
    const run=async()=>{
      if(failed)throw Object.assign(new Error("Очередь остановлена после ошибки."),{code:"QUEUE_STOPPED"});
      const result=await operation(getRevision());
      if(!result?.ok){failed=true;onFailure?.(result,name);throw Object.assign(new Error(result?.message||"Cloud mutation failed"),result)}
      setRevision(result.revision);await onConfirmed?.(result,name);return result;
    };
    const pending=tail.then(run);tail=pending.catch(()=>{});return pending;
  };
  return {projectId,enqueue,reset(){failed=false},idle(){return tail}};
}
function createCloudProjectSync({projectId,api,storage=globalThis.localStorage,onState,onConflict}){
  let revision=null,confirmedProject=null;
  const sync={projectId,api,get revision(){return revision},get confirmedProject(){return confirmedProject}};
  const cache=()=>writeConfirmedCache(projectId,revision,confirmedProject,storage);
  const load=async({allowLegacyChoice=false}={})=>{
    onState?.("loading");const local=readLocalProject(projectId,storage);const result=await api.loadProjectContent(projectId);
    if(!result.ok){onState?.("error",result);throw Object.assign(new Error(result.message),result)}
    const remoteEmpty=!hasProjectContent(result.data),localHas=hasProjectContent(local);
    if(remoteEmpty&&localHas&&!allowLegacyChoice){onState?.("legacy-blocked",{local,result});return {ok:false,code:"LOCAL_CONTENT_CLOUD_EMPTY",local,result}}
    revision=result.revision;confirmedProject=hydrateProjectFromCloudSnapshot(result.data,local||{});cache();onState?.("ready");return {ok:true,revision,data:confirmedProject};
  };
  const queue=createProjectMutationQueue({projectId,api,getRevision:()=>revision,setRevision:value=>{revision=value},onConfirmed:async()=>{const fresh=await api.loadProjectContent(projectId);if(!fresh.ok)throw Object.assign(new Error(fresh.message),fresh);revision=fresh.revision;const adjunctSource=globalThis.cloudProjectSync===sync&&globalThis.data?globalThis.data:confirmedProject;confirmedProject=hydrateProjectFromCloudSnapshot(fresh.data,adjunctSource);cache();onState?.("saved",confirmedProject)},onFailure:(result)=>{onState?.(result.code==="REVISION_CONFLICT"?"conflict":"save-error",result);if(result.code==="REVISION_CONFLICT")onConflict?.(result)}});
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
export {UNASSIGNED_CHAPTER_ID,cacheMetadataKey,createCloudProjectSync,createProjectMutationQueue,hasProjectContent,hydrateProjectFromCloudSnapshot,isCloudWorkspace,localAdjunctByScene,readLocalProject,runCloudMutation,sceneToCloud,writeConfirmedCache};
