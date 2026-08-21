import assert from "node:assert/strict";
import {createCloudContentApi,normalizeContentResult} from "../js/cloud-content-api.js";

assert.deepEqual(normalizeContentResult({data:{ok:true,revision:12,changed:true,data:{id:"x"}}}),{ok:true,code:"OK",revision:12,changed:true,data:{id:"x"},normalized:false,message:""});
const conflict=normalizeContentResult({data:{ok:false,code:"REVISION_CONFLICT",expectedRevision:5,actualRevision:6}});
assert.equal(conflict.code,"REVISION_CONFLICT");assert.equal(conflict.actualRevision,6);
assert.equal(normalizeContentResult({error:{code:"42501",message:"SQL internals"}}).code,"FORBIDDEN");
assert.doesNotMatch(normalizeContentResult({error:{message:"secret relation name"}}).message,/secret|relation/i);

const calls=[];
const api=createCloudContentApi({async rpc(name,args){calls.push({name,args});return {data:{ok:true,revision:8,changed:true},error:null}}});
await api.moveScene("project","scene",7,{chapterId:null,beforeSceneId:"before"});
assert.deepEqual(calls.pop(),{name:"move_scene",args:{target_project_id:"project",target_scene_id:"scene",expected_revision:7,target_chapter_id:null,before_scene_id:"before"}});
await api.setSceneTags("project","scene",8,["a","a","b"]);
assert.deepEqual(calls.pop().args.tag_ids,["a","b"]);
await api.createScene("project",8,{title:"Scene",placementStatus:"placed",writingStatus:"draft",position:1000});
const created=calls.pop();assert.equal(created.name,"create_scene");assert.equal(created.args.expected_revision,8);assert.equal(created.args.scene_position,1000);

console.log("cloud content api tests: OK");
