// Location Phase B3A.1 -- pure direct-children derivation (js/location-hierarchy.js).
// Covers the identity distinction the task brief calls out explicitly: children are found by
// child.parentId === parent's CANONICAL id (location.locationId), never parent's participation
// id (location.id) -- a cloud project's project_locations.id and public.locations.id are
// different UUID spaces, and using the wrong one would silently produce zero children for
// every cloud project while still passing any local-mode-only fixture (where the two id spaces
// happen to coincide).
import assert from "node:assert/strict";
import {locationDirectChildren,locationDescendantSceneStats} from "../js/location-hierarchy.js";

// Simulated cloud-shaped project Location entries: `.id` is participationId, `.locationId` is
// the canonical id parentId actually lives in -- see js/locations.js's own identity-naming
// contract comment.
const sher={id:"part-sher",locationId:"canon-sher",parentId:null,name:"Шер"};
const dvor={id:"part-dvor",locationId:"canon-dvor",parentId:"canon-sher",name:"Двор Шера"};
const kabinet={id:"part-kabinet",locationId:"canon-kabinet",parentId:"canon-sher",name:"Кабинет Армана"};
// Grandchild: parented to Двор's canonical id, not Шер's -- must never appear in Шер's direct list.
const grandchild={id:"part-grandchild",locationId:"canon-grandchild",parentId:"canon-dvor",name:"Уголок двора"};
// Unrelated Location entirely (no parent at all).
const unrelated={id:"part-unrelated",locationId:"canon-unrelated",parentId:null,name:"Совсем другое место"};
// Trap: parentId equals Шер's PARTICIPATION id (not its canonical id) -- a buggy comparison
// against location.id instead of location.locationId would incorrectly include this as a child.
const participationIdTrap={id:"part-trap",locationId:"canon-trap",parentId:"part-sher",name:"Ловушка participationId"};

const projectLocations=[sher,dvor,kabinet,grandchild,unrelated,participationIdTrap];

// 1. Direct participating children found by child.parentId === parent.locationId (canonical id).
{
  const children=locationDirectChildren(sher.locationId,projectLocations);
  const ids=children.map(c=>c.id);
  assert.ok(ids.includes(dvor.id),"Двор Шера must be found as a direct child of Шер");
  assert.ok(ids.includes(kabinet.id),"Кабинет Армана must be found as a direct child of Шер");
}

// 2. Participation id must NOT be used for parent comparison -- the trap entry (parentId ===
// Шер's participation id, not its canonical id) must be excluded.
{
  const children=locationDirectChildren(sher.locationId,projectLocations);
  assert.ok(!children.some(c=>c.id===participationIdTrap.id),"an entry parented to the PARTICIPATION id must not be treated as a direct child");
}
// Sanity check the inverse: comparing against the participation id (the bug this guards
// against) would have picked up the trap entry and missed the real children entirely.
{
  const buggyChildren=locationDirectChildren(sher.id,projectLocations);
  assert.deepEqual(buggyChildren.map(c=>c.id),[participationIdTrap.id],"comparing against participationId is expected to only match the deliberately-planted trap, proving the real derivation must use the canonical id instead");
}

// 3. Grandchild excluded from the direct child list.
{
  const children=locationDirectChildren(sher.locationId,projectLocations);
  assert.ok(!children.some(c=>c.id===grandchild.id),"a grandchild (parented to a child's canonical id) must not appear in the direct child list");
  // It IS a direct child of its own parent, though.
  const dvorChildren=locationDirectChildren(dvor.locationId,projectLocations);
  assert.ok(dvorChildren.some(c=>c.id===grandchild.id),"the grandchild must still be a direct child of ITS OWN parent");
}

// 4. Unrelated Location excluded.
{
  const children=locationDirectChildren(sher.locationId,projectLocations);
  assert.ok(!children.some(c=>c.id===unrelated.id),"an unrelated Location with no relation to the parent must not appear");
}

// 5. Non-participating canonical child never fabricated: the function only ever looks at the
// `locations` array passed in (the current project's participation list). A canonical
// descendant that exists globally but was never included in that array must never appear,
// because there is no separate global lookup inside the derivation at all.
{
  const projectLocationsWithoutKabinet=projectLocations.filter(l=>l.id!==kabinet.id);
  const children=locationDirectChildren(sher.locationId,projectLocationsWithoutKabinet);
  assert.ok(!children.some(c=>c.id===kabinet.id),"a canonical child absent from the project's participation array must never be fabricated into the direct list");
}

// 6. Deterministic locale-aware name sorting (no meaningful sort_order source for locations --
// see FINAL REPORT "chosen sort source").
{
  const a={id:"a",locationId:"canon-a",parentId:"canon-root",name:"Яблоко"};
  const b={id:"b",locationId:"canon-b",parentId:"canon-root",name:"Абрикос"};
  const c={id:"c",locationId:"canon-c",parentId:"canon-root",name:"Ежевика"};
  const children=locationDirectChildren("canon-root",[a,b,c]);
  assert.deepEqual(children.map(x=>x.name),["Абрикос","Ежевика","Яблоко"],"children must sort locale-aware by name regardless of input order");
}

// 7. No mutation of Location data during derivation.
{
  const before=JSON.parse(JSON.stringify(projectLocations));
  const result=locationDirectChildren(sher.locationId,projectLocations);
  assert.deepEqual(projectLocations,before,"derivation must never mutate the source Location array/objects");
  assert.notEqual(result,projectLocations,"derivation must return a new array, not the source array by reference");
}

// Empty/absent canonical id -> empty result, never throws.
assert.deepEqual(locationDirectChildren(null,projectLocations),[]);
assert.deepEqual(locationDirectChildren(undefined,projectLocations),[]);
assert.deepEqual(locationDirectChildren("canon-sher",undefined),[]);

// ---------------------------------------------------------------------------
// Location Manual UX Batch B, B5 -- locationDescendantSceneStats: "Сцен внутри" (scenes on ANY
// descendant Location's participation, any depth, in the CURRENT project) -- excludes THIS
// Location's own direct scenes (that's the separate, unchanged "Сцен здесь", see
// locationSceneEntries in js/locations.js).
// ---------------------------------------------------------------------------

// Task brief's own worked example: Шер -> Кабинет Рене (7 direct scenes) -> Ванная (3 direct
// scenes). Шер itself has 0 direct scenes. Expected: Шер "Сцен внутри" = 10 (7+3), NEVER including
// Шер's own (here irrelevant) direct count.
{
  const ownedRows=new Map([
    ["canon-sher",{id:"canon-sher",parent_id:null}],
    ["canon-kabinet",{id:"canon-kabinet",parent_id:"canon-sher"}],
    ["canon-vannaya",{id:"canon-vannaya",parent_id:"canon-kabinet"}]
  ]);
  const projectLocations=[
    {id:"part-sher",locationId:"canon-sher"},
    {id:"part-kabinet",locationId:"canon-kabinet"},
    {id:"part-vannaya",locationId:"canon-vannaya"}
  ];
  const scenes=[
    ...Array.from({length:7},(_,i)=>({id:`k${i}`,locationId:"part-kabinet"})),
    ...Array.from({length:3},(_,i)=>({id:`v${i}`,locationId:"part-vannaya"}))
  ];
  const sherStats=locationDescendantSceneStats("canon-sher",ownedRows,projectLocations,scenes);
  assert.deepEqual(sherStats,{count:10,hasParticipatingDescendants:true},"Шер: 7 (Кабинет) + 3 (Ванная) = 10, excluding Шер's own direct scenes");

  // 1. Direct child alone (Кабинет's own subtree: just Ванная under it) -- 3.
  const kabinetStats=locationDescendantSceneStats("canon-kabinet",ownedRows,projectLocations,scenes);
  assert.deepEqual(kabinetStats,{count:3,hasParticipatingDescendants:true},"Кабинет: only Ванная (3) is inside it, its own 7 direct scenes are excluded");

  // 2. No descendants at all (Ванная is a leaf) -- count 0, hasParticipatingDescendants false, so
  // the UI knows to hide "Сцен внутри: 0" entirely rather than show an awkward zero.
  const vannayaStats=locationDescendantSceneStats("canon-vannaya",ownedRows,projectLocations,scenes);
  assert.deepEqual(vannayaStats,{count:0,hasParticipatingDescendants:false},"a leaf Location has no descendants at all");
}

// 3. Non-participating intermediate canonical ancestor must not break traversal to a deeper
// participating descendant. Canonical chain: root -> middle (NOT in this project) -> leaf (IS in
// this project, with 4 scenes). root's "Сцен внутри" must still find leaf's scenes through middle.
{
  const ownedRows=new Map([
    ["canon-root",{id:"canon-root",parent_id:null}],
    ["canon-middle",{id:"canon-middle",parent_id:"canon-root"}], // not participating in this project
    ["canon-leaf",{id:"canon-leaf",parent_id:"canon-middle"}]
  ]);
  const projectLocations=[
    {id:"part-root",locationId:"canon-root"},
    // NOTE: no entry for canon-middle -- it exists in the owned canonical hierarchy but does not
    // participate in the current project.
    {id:"part-leaf",locationId:"canon-leaf"}
  ];
  const scenes=Array.from({length:4},(_,i)=>({id:`leaf-scene-${i}`,locationId:"part-leaf"}));
  const stats=locationDescendantSceneStats("canon-root",ownedRows,projectLocations,scenes);
  assert.deepEqual(stats,{count:4,hasParticipatingDescendants:true},"a non-participating intermediate ancestor must not break traversal to a deeper participating descendant");
}

// 4. scene.location_id participation semantics: a scene whose locationId happens to equal a
// descendant's CANONICAL id (never a valid real shape, but guards the comparison itself) must NOT
// be counted -- only a real PARTICIPATION id match counts. This is the exact bug class the task
// brief warns about ("Do not compare scene.location_id to canonical ids").
{
  const ownedRows=new Map([
    ["canon-parent",{id:"canon-parent",parent_id:null}],
    ["canon-child",{id:"canon-child",parent_id:"canon-parent"}]
  ]);
  const projectLocations=[
    {id:"part-parent",locationId:"canon-parent"},
    {id:"part-child",locationId:"canon-child"}
  ];
  // Trap: a scene's locationId is the descendant's CANONICAL id, not its participation id.
  const trapScenes=[{id:"trap",locationId:"canon-child"}];
  const trapStats=locationDescendantSceneStats("canon-parent",ownedRows,projectLocations,trapScenes);
  assert.deepEqual(trapStats,{count:0,hasParticipatingDescendants:true},"a scene keyed by a descendant's CANONICAL id (not its participation id) must never be counted");
  // Sanity: the same scene correctly counts once its locationId is the real participation id.
  const realScenes=[{id:"real",locationId:"part-child"}];
  const realStats=locationDescendantSceneStats("canon-parent",ownedRows,projectLocations,realScenes);
  assert.deepEqual(realStats,{count:1,hasParticipatingDescendants:true});
}

// Empty/absent canonical id, and malformed input, never throw.
assert.deepEqual(locationDescendantSceneStats(null,new Map(),[],[]),{count:0,hasParticipatingDescendants:false});
assert.deepEqual(locationDescendantSceneStats(undefined,new Map(),[],[]),{count:0,hasParticipatingDescendants:false});
assert.deepEqual(locationDescendantSceneStats("canon-x",undefined,[],[]),{count:0,hasParticipatingDescendants:false});
assert.deepEqual(locationDescendantSceneStats("canon-x",new Map(),undefined,undefined),{count:0,hasParticipatingDescendants:false});

console.log("location Phase B3A.1 children-derivation unit tests: OK");
