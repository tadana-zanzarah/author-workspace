import assert from "node:assert/strict";
import {chronologicalWarning} from "../js/utils.js";
import {hydrateProjectFromCloudSnapshot} from "../js/cloud-project-sync.js";

function scene(id,date,time="",extra={}){return {id,date,time,...extra}}

function conflicts(scenes){
  globalThis.data={scenes};
  return scenes.map((_,i)=>chronologicalWarning(i));
}

// 1) Add a scene AFTER a reviewed scene with NO date: the earlier scene must not turn red.
{
  const [a,b]=conflicts([scene("A","2024-01-10"),scene("B","")]);
  assert.equal(a,false,"reviewed scene must not conflict when the new undated scene follows it");
  assert.equal(b,false,"an undated scene never carries a chronology conflict");
}

// 2) Add a scene AFTER with a LATER, compatible date: no warning on either scene.
{
  const [a,b]=conflicts([scene("A","2024-01-10"),scene("B","2024-01-15")]);
  assert.equal(a,false);
  assert.equal(b,false);
}

// 3) Add a scene AFTER with an EARLIER date: a real conflict must be flagged on both neighbors.
{
  const [a,b]=conflicts([scene("A","2024-01-10"),scene("B","2024-01-05")]);
  assert.equal(a,true,"a genuinely out-of-order next scene must flag the earlier scene");
  assert.equal(b,true,"the out-of-order scene itself must be flagged");
}

// 4) Insert a scene BEFORE a reviewed scene with a compatible (earlier) date: no false warning.
{
  const [inserted,a]=conflicts([scene("New","2024-01-05"),scene("A","2024-01-10")]);
  assert.equal(inserted,false);
  assert.equal(a,false);
}

// 5) Insert a scene BEFORE a reviewed scene with a date that violates order: real conflict on both.
{
  const [inserted,a]=conflicts([scene("New","2024-01-15"),scene("A","2024-01-10")]);
  assert.equal(inserted,true);
  assert.equal(a,true);
}

// 8) Undated scenes between two dated scenes never create a false conflict, including several in a row.
{
  const scenes=[scene("A","2024-01-01"),scene("U1",""),scene("U2",""),scene("U3",""),scene("C","2024-01-10")];
  const results=conflicts(scenes);
  assert.deepEqual(results,[false,false,false,false,false]);
}
{
  // Undated scenes must still surface a conflict between the two dated scenes they sit between,
  // if those dated scenes are themselves out of order.
  const scenes=[scene("A","2024-01-10"),scene("U1",""),scene("C","2024-01-01")];
  const results=conflicts(scenes);
  assert.deepEqual(results,[true,false,true],"conflict must attach to the dated scenes, never the undated one between them");
}

// First / last scene in the project: only one side is checked, never crashes, never falsely flags.
{
  const scenes=[scene("First","2024-01-01"),scene("Mid","2024-01-05"),scene("Last","2024-01-10")];
  assert.deepEqual(conflicts(scenes),[false,false,false]);
}

// Same date, no time on either side: ties are allowed (existing contract, per AGENTS.md ambiguity rule).
{
  const scenes=[scene("A","2024-01-10"),scene("B","2024-01-10")];
  assert.deepEqual(conflicts(scenes),[false,false]);
}

// Same date, only ONE side has a time: time is not compared, so this is not a conflict either.
{
  const scenes=[scene("A","2024-01-10","09:00"),scene("B","2024-01-10")];
  assert.deepEqual(conflicts(scenes),[false,false]);
}

// Same date, both have time, ascending: fine. Descending: real conflict.
{
  const scenes=[scene("A","2024-01-10","09:00"),scene("B","2024-01-10","10:00")];
  assert.deepEqual(conflicts(scenes),[false,false]);
}
{
  const scenes=[scene("A","2024-01-10","10:00"),scene("B","2024-01-10","09:00")];
  assert.deepEqual(conflicts(scenes),[true,true]);
}

// 9) Editing an existing scene's date recomputes against its CURRENT neighbors, not stale ones.
{
  const scenes=[scene("A","2024-01-01"),scene("B","2024-01-10"),scene("C","2024-01-20")];
  assert.deepEqual(conflicts(scenes),[false,false,false]);
  scenes[1].date="2024-01-25"; // B now later than C: a real, localized conflict.
  assert.deepEqual(conflicts(scenes),[false,true,true]);
  scenes[1].date="2024-01-15"; // back in range: conflict clears without touching A or C.
  assert.deepEqual(conflicts(scenes),[false,false,false]);
}

// 10) Unrelated reviewed scenes elsewhere in the project are never invalidated by a distant edit.
{
  const scenes=[scene("A","2024-01-01",""),scene("B","2024-06-01",""),scene("C","2024-06-05",""),scene("D","2024-12-01","")];
  assert.deepEqual(conflicts(scenes),[false,false,false,false]);
  scenes[1].date="2024-06-10"; // B/C now swapped in order — localized to B/C only.
  const results=conflicts(scenes);
  assert.deepEqual(results,[false,true,true,false],"A and D are unaffected by a conflict between B and C");
}

// 12) Cloud hydration: scenes.position is one flat, chapter-agnostic canonical order server-side
// (docs/cloud-content-architecture.md), but the table view always groups scenes by chapter and
// chronologicalWarning walks the flat data.scenes array. If chapter A's and chapter B's positions
// interleave, an ungrouped array would compare a scene against a scene from a DIFFERENT chapter
// that a user never sees as adjacent — a false conflict. Hydration must re-group scenes by chapter
// (position as the in-chapter tie-breaker) so cloud matches local's chapter-grouped invariant.
{
  const payload={
    chapters:[{id:"ch1",position:1,title:"Ch1"},{id:"ch2",position:2,title:"Ch2"}],
    scenes:[
      {id:"A",chapter_id:"ch1",scene_date:"2024-01-01",scene_time:null,position:1000,title:"A",placement_status:"unplaced",writing_status:"draft",included:true,date_review:false},
      {id:"X",chapter_id:"ch2",scene_date:"2024-06-01",scene_time:null,position:2000,title:"X",placement_status:"unplaced",writing_status:"draft",included:true,date_review:false},
      {id:"B",chapter_id:"ch1",scene_date:"2024-01-05",scene_time:null,position:3000,title:"B",placement_status:"unplaced",writing_status:"draft",included:true,date_review:false}
    ],
    scene_tags:[],scene_characters:[],scene_relation_changes:[],characters:[],project_characters:[],project_character_relations:[],character_links:[],global_character_links:[],locations:[],tags:[]
  };
  const project=hydrateProjectFromCloudSnapshot(payload,{});
  assert.deepEqual(project.scenes.map(s=>s.id),["A","B","X"],"scenes must be grouped by chapter order, position breaking ties within a chapter");
  globalThis.data=project;
  assert.equal(chronologicalWarning(project.scenes.findIndex(s=>s.id==="A")),false);
  assert.equal(chronologicalWarning(project.scenes.findIndex(s=>s.id==="B")),false,"B must not be compared against chapter 2's X just because X's server position sits between A and B");
  assert.equal(chronologicalWarning(project.scenes.findIndex(s=>s.id==="X")),false);
}

// Position ties within the same chapter keep server order stable (id as implicit tie-breaker, matching
// the (position,id) order the SQL RPC already returns them in).
{
  const payload={
    chapters:[{id:"ch1",position:1,title:"Ch1"}],
    scenes:[
      {id:"A",chapter_id:"ch1",scene_date:"2024-01-01",scene_time:null,position:1000,title:"A",placement_status:"unplaced",writing_status:"draft",included:true,date_review:false},
      {id:"B",chapter_id:"ch1",scene_date:"2024-01-02",scene_time:null,position:1000,title:"B",placement_status:"unplaced",writing_status:"draft",included:true,date_review:false}
    ],
    scene_tags:[],scene_characters:[],scene_relation_changes:[],characters:[],project_characters:[],project_character_relations:[],character_links:[],global_character_links:[],locations:[],tags:[]
  };
  const project=hydrateProjectFromCloudSnapshot(payload,{});
  assert.deepEqual(project.scenes.map(s=>s.id),["A","B"]);
}

console.log("scene chronology unit tests: OK");
