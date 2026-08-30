import assert from "node:assert/strict";
import {hydrateProjectFromCloudSnapshot} from "../js/cloud-project-sync.js";
import "../js/state.js";
import "../js/relationships.js";
import "../js/scenes.js";
import "../js/filters.js";

// filters.js/scenes.js call these by bare global name (browser-global convention used across this
// codebase); chapters.js/characters.js can't be imported standalone in Node (they have DOM/module
// load-order side effects), so the handful of pure lookups they'd provide are stubbed here instead.
globalThis.chapterById=id=>data.chapters.find(c=>c.id===id);
globalThis.locationById=()=>undefined;
globalThis.tagById=()=>undefined;
globalThis.characterById=id=>data.characters.find(c=>c.id===id);
globalThis.characterName=id=>globalThis.characterById(id)?.name||"Неизвестный персонаж";

// A scene_characters row with an empty action ("") represents a character explicitly added to a
// scene through the participant selector but not yet given narrative text. Cloud hydration must
// still surface this as real scene membership, and search/filter must find it by participant name —
// this is the cloud-mode half of the search-by-participant fix (js/app.js builds the local half).
const projectId="22222222-2222-4222-8222-222222222222";
const snapshot={project:{id:projectId,revision:3},
  chapters:[{id:"chapter-1",title:"Глава",position:1000}],
  locations:[],tags:[],
  scenes:[
    {id:"scene-1",chapter_id:"chapter-1",location_id:"",title:"Утро",scene_text:"Обычное утро",scene_date:"",scene_time:"",placement_status:"unplaced",writing_status:"draft",included:true,date_review:false,position:1000},
    {id:"scene-2",chapter_id:"chapter-1",location_id:"",title:"Вечер",scene_text:"Обычный вечер",scene_date:"",scene_time:"",placement_status:"unplaced",writing_status:"draft",included:true,date_review:false,position:2000}
  ],
  scene_tags:[],
  characters:[{id:"char-zayn",name:"Зейн",surname:"",revision:1,base_profile:{}}],
  project_characters:[{id:"participation-zayn",character_id:"char-zayn",overrides:{},sort_order:0}],
  scene_characters:[{scene_id:"scene-1",project_character_id:"participation-zayn",action:"",sort_order:0}],
  project_character_relations:[],scene_relation_changes:[],character_links:[],global_character_links:[]};

const hydrated=hydrateProjectFromCloudSnapshot(snapshot,{version:11});
assert.ok(Object.prototype.hasOwnProperty.call(hydrated.scenes[0].people,"char-zayn"),"content-less scene_characters row must hydrate as membership");
assert.equal(hydrated.scenes[0].people["char-zayn"].action,"");

globalThis.data=hydrated;
globalThis.filters={search:"",chapter:"",character:"",location:"",tag:"",writing:"",placement:""};

// Character filter dropdown semantics.
globalThis.filters.character="char-zayn";
let visible=getVisibleSceneEntries().map(({scene})=>scene.title);
assert.deepEqual(visible,["Утро"],"character filter must find the content-less participant's scene");
globalThis.filters.character="";

// Free-text search by the character's display name.
globalThis.filters.search="Зейн";
visible=getVisibleSceneEntries().map(({scene})=>scene.title);
assert.deepEqual(visible,["Утро"],"text search by participant display name must find the content-less participant's scene");
globalThis.filters.search="";

// Non-participant scene stays excluded.
assert.equal(sceneHasParticipant(hydrated.scenes[1],"char-zayn"),false);

console.log("cloud scene participant search unit tests: OK");
