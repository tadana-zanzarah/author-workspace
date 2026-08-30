import assert from "node:assert/strict";
import {
  cacheMetadataKey,createCloudProjectSync,createProjectMutationQueue,hasProjectContent,hydrateProjectFromCloudSnapshot,
  sceneToCloud,writeConfirmedCache
} from "../js/cloud-project-sync.js";

const projectId="11111111-1111-4111-8111-111111111111";
const local={version:11,characters:[{id:"character-1",name:"А"}],profiles:{"character-1":{photos:[{id:"photo-1",source:{kind:"embedded",value:"data:image/png;base64,x"}}]}},characterLinks:[{id:"link-1"}],chapters:[{id:"chapter-unassigned"}],locations:[],tags:[],scenes:[{id:"scene-1",people:{"character-1":{action:"идёт"}},relationChanges:{x:"y"}}]};
const snapshot={project:{id:projectId,revision:7},chapters:[{id:"chapter-1",title:"Первая",position:1000}],locations:[{id:"location-1",name:"Дом",description:""}],tags:[{id:"tag-1",name:"Тайна"}],scenes:[{id:"scene-1",chapter_id:"chapter-1",location_id:"location-1",title:"Сцена",scene_text:"Текст",scene_date:"2026-08-22",scene_time:"10:15:00",placement_status:"placed",writing_status:"draft",included:true,date_review:false,position:1000}],scene_tags:[{scene_id:"scene-1",tag_id:"tag-1"}],characters:[{id:"character-1",name:"А",surname:"",revision:2,base_profile:{age:"20",favorites:["чай"],unknown:{keep:true}}}],project_characters:[{id:"participation-1",character_id:"character-1",overrides:{age:"27",hobbies:["бег"]},sort_order:0}],scene_characters:[{scene_id:"scene-1",project_character_id:"participation-1",action:"идёт",sort_order:0}],project_character_relations:[],scene_relation_changes:[],character_links:[],global_character_links:[]};

const hydrated=hydrateProjectFromCloudSnapshot(snapshot,local);
assert.deepEqual(hydrated.chapters.map(x=>x.id),["chapter-1","chapter-unassigned"]);
assert.equal(hydrated.scenes[0].chapterId,"chapter-1");assert.equal(hydrated.scenes[0].writingStatus,"draft");
assert.deepEqual(hydrated.scenes[0].tags,["tag-1"]);assert.equal(hydrated.scenes[0].people["character-1"].action,"идёт");
assert.equal(hydrated.profiles["character-1"].photos[0].id,"photo-1");assert.equal(hydrated.characterLinks.length,0,"local links are not authoritative in cloud mode");
assert.equal(hydrated.profiles["character-1"].age,"27");assert.deepEqual(hydrated.profiles["character-1"].favorites,["чай"]);assert.deepEqual(hydrated.profiles["character-1"].unknown,{keep:true});
assert.equal(hydrated.characters[0].sortOrder,0,"project_characters.sort_order is exposed on the hydrated character entry");

// Character order: the JS layer trusts and preserves the RPC's `order by sort_order,id`
// row order rather than re-deriving it from name or insertion order of the payload.
const orderSnapshot={...snapshot,characters:[...snapshot.characters,{id:"character-2",name:"Б",surname:"",revision:0,base_profile:{}}],
  project_characters:[{id:"participation-2",character_id:"character-2",overrides:{},sort_order:500},{id:"participation-1",character_id:"character-1",overrides:{age:"27",hobbies:["бег"]},sort_order:1000}]};
const orderHydrated=hydrateProjectFromCloudSnapshot(orderSnapshot,local);
assert.deepEqual(orderHydrated.characters.map(c=>c.id),["character-2","character-1"],"hydration preserves the RPC-provided sort_order row order, not payload/name order");
assert.deepEqual(orderHydrated.characters.map(c=>c.sortOrder),[500,1000]);
assert.equal(hasProjectContent({chapters:[{id:"chapter-unassigned"}],scenes:[],locations:[],tags:[],characters:[]}),false);
assert.equal(sceneToCloud(hydrated.scenes[0]).chapterId,"chapter-1");
assert.equal(sceneToCloud({...hydrated.scenes[0],chapterId:"chapter-unassigned"}).chapterId,null);

const memory=new Map(),storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
writeConfirmedCache(projectId,7,hydrated,storage,new Date("2026-08-22T00:00:00Z"));
assert.equal(JSON.parse(memory.get(cacheMetadataKey(projectId))).cloudRevision,7);

let revision=3;const used=[];
const queue=createProjectMutationQueue({projectId,api:{},getRevision:()=>revision,setRevision:value=>{revision=value}});
await Promise.all([
  queue.enqueue("one",async expected=>{used.push(expected);return {ok:true,revision:4}}),
  queue.enqueue("two",async expected=>{used.push(expected);return {ok:true,revision:5}})
]);
assert.deepEqual(used,[3,4]);assert.equal(revision,5);

const legacyStorage=new Map([[`authorWorkspace:project:${projectId}`,JSON.stringify({...local,scenes:[{id:"legacy-scene",title:"Не потерять",people:{}}]})]]);
const legacyAdapter={getItem:key=>legacyStorage.get(key)??null,setItem:(key,value)=>legacyStorage.set(key,value)};
const emptySync=createCloudProjectSync({projectId,storage:legacyAdapter,api:{loadProjectContent:async()=>({ok:true,revision:0,data:{project:{id:projectId,revision:0},chapters:[],locations:[],tags:[],scenes:[],scene_tags:[]}})}});
const blocked=await emptySync.load();assert.equal(blocked.code,"LOCAL_CONTENT_CLOUD_EMPTY");
assert.equal(JSON.parse(legacyStorage.get(`authorWorkspace:project:${projectId}`)).scenes[0].title,"Не потерять");
assert.equal(legacyStorage.has(cacheMetadataKey(projectId)),false);

const staleStorage=new Map([[`authorWorkspace:project:${projectId}`,JSON.stringify({...local,scenes:[]})]]);
const staleAdapter={getItem:key=>staleStorage.get(key)??null,setItem:(key,value)=>staleStorage.set(key,value)};
const cloudSync=createCloudProjectSync({projectId,storage:staleAdapter,api:{loadProjectContent:async()=>({ok:true,revision:7,data:snapshot})}});
const loaded=await cloudSync.load();assert.equal(loaded.revision,7);assert.equal(loaded.data.scenes[0].title,"Сцена");
assert.equal(JSON.parse(staleStorage.get(cacheMetadataKey(projectId))).cloudRevision,7);

// --- mutation queue recovery after a non-conflict (network/unknown) failure ---
// A single failed mutation (fetch failure, offline, unknown backend error — anything that is
// NOT REVISION_CONFLICT) must not permanently latch the queue. The confirmed revision must stay
// at its last-known-good value, and the next enqueued mutation must actually reach the operation
// callback (not be short-circuited) once queued.
{
  let rev=10;const calls=[];
  const q=createProjectMutationQueue({projectId,api:{},getRevision:()=>rev,setRevision:v=>{rev=v}});
  const failing=async expected=>{calls.push(["A",expected]);return {ok:false,code:"UNKNOWN",message:"network error"}};
  await assert.rejects(q.enqueue("A",failing),/network error/);
  assert.equal(rev,10,"a failed mutation must not advance the confirmed revision");
  const succeeding=async expected=>{calls.push(["B",expected]);return {ok:true,revision:11}};
  const result=await q.enqueue("B",succeeding);
  assert.equal(result.ok,true,"mutation B, enqueued after A's non-conflict failure, must actually execute");
  assert.equal(rev,11);
  assert.deepEqual(calls,[["A",10],["B",10]],"B must run with the last confirmed revision (10), unaffected by A's failure");
}

// --- the queue stays strictly serial even when the first mutation fails ---
{
  let rev=1;const order=[];
  const q=createProjectMutationQueue({projectId,api:{},getRevision:()=>rev,setRevision:v=>{rev=v}});
  const slowFailing=async()=>{order.push("A-start");await new Promise(r=>setTimeout(r,30));order.push("A-end");return {ok:false,code:"UNKNOWN"}};
  const fastSucceeding=async()=>{order.push("B-start");return {ok:true,revision:2}};
  const pA=q.enqueue("A",slowFailing),pB=q.enqueue("B",fastSucceeding);
  await Promise.allSettled([pA,pB]);
  assert.deepEqual(order,["A-start","A-end","B-start"],"B must not start until A has fully settled — no overlapping writes");
}

// --- REVISION_CONFLICT keeps its own contract: latch the queue, never blind-retry a stale revision ---
{
  let rev=5;const calls=[];let conflictSeen=null;
  const q=createProjectMutationQueue({
    projectId,api:{},getRevision:()=>rev,setRevision:v=>{rev=v},
    onFailure:result=>{if(result.code==="REVISION_CONFLICT")conflictSeen=result}
  });
  const conflicting=async expected=>{calls.push(expected);return {ok:false,code:"REVISION_CONFLICT",actualRevision:9}};
  await assert.rejects(q.enqueue("A",conflicting));
  assert.ok(conflictSeen,"onFailure must still be told about REVISION_CONFLICT so the existing interactive reload prompt keeps firing");
  const shouldNotRun=async()=>{calls.push("SHOULD_NOT_RUN");return {ok:true,revision:99}};
  await assert.rejects(q.enqueue("B",shouldNotRun),{code:"QUEUE_STOPPED"});
  assert.deepEqual(calls,[5],"a mutation queued after a conflict must never reach the server with a known-stale revision");
  assert.equal(rev,5,"revision must stay at the last confirmed value, not the conflicting attempt's stale expectation");
  q.reset(); // what cloudProjectSync.reload() does after the interactive prompt is confirmed
  rev=9; // simulates reload() picking up the authoritative server revision
  const afterReset=async expected=>{calls.push(expected);return {ok:true,revision:10}};
  const resumed=await q.enqueue("C",afterReset);
  assert.equal(resumed.ok,true);assert.equal(rev,10);
  assert.deepEqual(calls,[5,9],"after reset(), the next mutation must use the freshly reloaded revision");
}

// --- end-to-end through createCloudProjectSync: no silently-dead cloud UI after a save error ---
{
  let rev=0,shouldFail=true;const states=[];
  const contentSnapshot={project:{id:projectId,revision:0},chapters:[],locations:[],tags:[],scenes:[],scene_tags:[]};
  const api={
    loadProjectContent:async()=>({ok:true,revision:rev,data:contentSnapshot}),
    updateThing:async expected=>{if(shouldFail)return {ok:false,code:"UNKNOWN",message:"network error"};rev+=1;return {ok:true,revision:rev}}
  };
  const memoryStorage=new Map(),storageAdapter={getItem:key=>memoryStorage.get(key)??null,setItem:(key,value)=>memoryStorage.set(key,value)};
  const sync=createCloudProjectSync({projectId,api,storage:storageAdapter,onState:status=>states.push(status)});
  await sync.load();
  const first=await sync.mutate("update",revision=>api.updateThing(revision)).catch(error=>({ok:false,code:error.code}));
  assert.equal(first.ok,false);assert.ok(states.includes("save-error"),"a non-conflict failure must surface as save-error, not vanish silently");
  shouldFail=false;
  // The very next mutation attempt, with no reload() call in between, must actually reach the
  // server and succeed — this is the "cloud UI no longer goes silently-dead" contract.
  const second=await sync.mutate("update",revision=>api.updateThing(revision));
  assert.equal(second.ok,true,"repeated Save after a transient failure must go through without an intervening reload()");
  assert.ok(states.includes("saved"),"a successful retry must report 'saved' so the UI can clear the stale error banner");
}

console.log("cloud project sync tests passed");
