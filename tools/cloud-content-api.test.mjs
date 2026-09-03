import assert from "node:assert/strict";
import {createCloudContentApi,normalizeContentResult} from "../js/cloud-content-api.js";

assert.deepEqual(normalizeContentResult({data:{ok:true,revision:12,changed:true,data:{id:"x"}}}),{ok:true,code:"OK",revision:12,locationRevision:undefined,changed:true,data:{id:"x"},normalized:false,message:""});
const conflict=normalizeContentResult({data:{ok:false,code:"REVISION_CONFLICT",expectedRevision:5,actualRevision:6}});
assert.equal(conflict.code,"REVISION_CONFLICT");assert.equal(conflict.actualRevision,6);
assert.equal(normalizeContentResult({error:{code:"42501",message:"SQL internals"}}).code,"FORBIDDEN");
assert.doesNotMatch(normalizeContentResult({error:{message:"secret relation name"}}).message,/secret|relation/i);

// Location Architecture V2 Phase 2: delete_location's DEPENDENCIES_EXIST domain error must
// survive normalization with a real, safe message — not silently collapse to UNKNOWN (which
// would happen if the code were missing from CONTENT_ERROR_CODES/SAFE_MESSAGES).
const dependencies=normalizeContentResult({data:{ok:false,code:"DEPENDENCIES_EXIST",revision:3,dependencies:{scenes:2}}});
assert.equal(dependencies.code,"DEPENDENCIES_EXIST");
assert.notEqual(dependencies.message,"");assert.doesNotMatch(dependencies.message,/UNKNOWN|Не удалось выполнить/i);

const calls=[];
const api=createCloudContentApi({async rpc(name,args){calls.push({name,args});return {data:{ok:true,revision:8,changed:true},error:null}}});
await api.moveScene("project","scene",7,{chapterId:null,beforeSceneId:"before"});
assert.deepEqual(calls.pop(),{name:"move_scene",args:{target_project_id:"project",target_scene_id:"scene",expected_revision:7,target_chapter_id:null,before_scene_id:"before"}});
await api.setSceneTags("project","scene",8,["a","a","b"]);
assert.deepEqual(calls.pop().args.tag_ids,["a","b"]);
await api.createScene("project",8,{title:"Scene",placementStatus:"placed",writingStatus:"draft",position:1000});
const created=calls.pop();assert.equal(created.name,"create_scene");assert.equal(created.args.expected_revision,8);assert.equal(created.args.scene_position,1000);

// Location RPC argument shapes: no Phase 2 SQL cutover should require touching this adapter, so
// pin the exact wire contract (create_location/update_location/delete_location, target_* names)
// as a regression guard.
await api.createLocation("project",3,{name:"Tavern",description:"Loud."});
assert.deepEqual(calls.pop(),{name:"create_location",args:{target_project_id:"project",expected_revision:3,location_name:"Tavern",location_description:"Loud."}});
await api.createLocation("project",3,{name:"Tavern"});
assert.equal(calls.pop().args.location_description,"","description defaults to an empty string when omitted");
await api.updateLocation("project","loc-1",4,{name:"Tavern",description:"Quiet now."});
assert.deepEqual(calls.pop(),{name:"update_location",args:{target_project_id:"project",target_location_id:"loc-1",expected_revision:4,location_name:"Tavern",location_description:"Quiet now."}});
await api.deleteLocation("project","loc-1",5);
assert.deepEqual(calls.pop(),{name:"delete_location",args:{target_project_id:"project",target_location_id:"loc-1",expected_revision:5}});

// Location Architecture V2 Phase 3: the canonical-identity path uses distinct RPC names and a
// distinct revision axis (location-level, not project-level) from the legacy trio above -- pin
// both the exact wire shape and that update/setParent never send a project id.
await api.createLocationCanonical("project",3,{name:"  Tavern  ",officialName:"The Rusty Tavern",aliases:["North Gate","north gate","Old Quarter"],typePreset:"settlement",customTypeLabel:"Capital",description:"Loud.",shortSummary:"Where it all began.",parentId:"parent-1"});
assert.deepEqual(calls.pop(),{name:"create_location_canonical",args:{target_project_id:"project",expected_revision:3,location_name:"  Tavern  ",location_official_name:"The Rusty Tavern",location_aliases:["North Gate","north gate","Old Quarter"],location_type_preset:"settlement",location_custom_type_label:"Capital",location_description:"Loud.",location_short_summary:"Where it all began.",target_parent_id:"parent-1"}});
await api.createLocationCanonical("project",3,{name:"Unclassified"});
{
  const created=calls.pop();
  assert.equal(created.args.location_official_name,null,"officialName defaults to null when omitted");
  assert.equal(created.args.location_type_preset,null,"typePreset defaults to null (not 'other') when omitted");
  assert.equal(created.args.target_parent_id,null,"parentId defaults to null when omitted");
  assert.deepEqual(created.args.location_aliases,[],"aliases defaults to an empty array when omitted");
}
await api.updateLocationCanonical("loc-canonical-1",7,{name:"Tavern",aliases:["a","a","b"]});
{
  const updated=calls.pop();
  assert.equal(updated.name,"update_location_canonical");
  assert.equal(updated.args.target_location_id,"loc-canonical-1");
  assert.equal(updated.args.expected_location_revision,7,"canonical update is gated on the LOCATION's own revision, not the project's");
  assert.ok(!("target_project_id" in updated.args),"updateLocationCanonical must never send a project id -- it is a pure global-identity mutation");
  assert.deepEqual(updated.args.location_aliases,["a","b"],"duplicate aliases are collapsed before the RPC call");
}
await api.setLocationParent("loc-canonical-1",8,"loc-canonical-2");
assert.deepEqual(calls.pop(),{name:"set_location_parent",args:{target_location_id:"loc-canonical-1",expected_location_revision:8,target_parent_id:"loc-canonical-2"}});
await api.setLocationParent("loc-canonical-1",9);
assert.equal(calls.pop().args.target_parent_id,null,"omitting parentId means clear the parent, not leave it unspecified");
await api.listOwnedLocations();
assert.deepEqual(calls.pop(),{name:"list_owned_locations",args:undefined});

// LOCATION_REVISION_CONFLICT must survive normalization with the same shape as the established
// CHARACTER_REVISION_CONFLICT pattern (entityId + expected/actual revision), not collapse to
// UNKNOWN.
const locationConflict=normalizeContentResult({data:{ok:false,code:"LOCATION_REVISION_CONFLICT",entityId:"loc-1",expectedRevision:2,actualRevision:3}});
assert.equal(locationConflict.code,"LOCATION_REVISION_CONFLICT");
assert.equal(locationConflict.entityId,"loc-1");
assert.equal(locationConflict.actualRevision,3);
assert.notEqual(locationConflict.message,"");assert.doesNotMatch(locationConflict.message,/UNKNOWN|Не удалось выполнить облачную операцию\./);

// A successful canonical mutation's top-level locationRevision must round-trip (mirrors
// characterRevision in normalizeCharacterResult).
const locationSuccess=normalizeContentResult({data:{ok:true,locationRevision:4,changed:true,data:{location_id:"loc-1"}}});
assert.equal(locationSuccess.locationRevision,4);

console.log("cloud content api tests: OK");
