import assert from "node:assert/strict";
import {createCloudContentApi,normalizeContentResult} from "../js/cloud-content-api.js";

assert.deepEqual(normalizeContentResult({data:{ok:true,revision:12,changed:true,data:{id:"x"}}}),{ok:true,code:"OK",revision:12,changed:true,data:{id:"x"},normalized:false,message:""});
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

console.log("cloud content api tests: OK");
