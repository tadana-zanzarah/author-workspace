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

console.log("cloud project sync tests passed");
