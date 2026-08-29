import assert from "node:assert/strict";
import {buildLocalToCloudMigrationPreview} from "../js/local-to-cloud-migration.js";
import {confirmLocalToCloudMigrationPlan,executeLocalToCloudMigration,prepareLocalToCloudMigrationExecution} from "../js/local-to-cloud-migration-execution.js";

const targetProjectId="11111111-1111-4111-8111-111111111111";
const ownerId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attemptId="99999999-9999-4999-8999-999999999999";
const source=()=>({version:11,characters:[{id:"char-a",name:"Анна"},{id:"char-b",name:"Борис"}],profiles:{"char-a":{favorites:["чай"],hobbies:["бег"],photos:[{id:"photo-a",scope:"project",source:{kind:"data-url",value:"data:image/png;base64,aGVsbG8="},crop:{x:.2,y:.3,zoom:2},caption:"портрет"}],primaryPhotoId:"photo-a",initialRelations:{"char-b":"доверяет"}},"char-b":{photos:[],initialRelations:{}}},characterLinks:[{id:"link-a",fromCharacterId:"char-a",toCharacterId:"char-b",category:"other",type:"friend",reverseType:"friend",structureKind:"social",scope:"project"}],chapters:[{id:"chapter-unassigned",title:"Без главы"},{id:"chapter-a",title:"Первая"}],locations:[{id:"location-a",name:"Дом",description:""}],tags:[{id:"tag-a",name:"Тайна"}],scenes:[{id:"scene-a",chapterId:"chapter-unassigned",locationId:"location-a",tags:["tag-a"],title:"Сцена",sceneText:"Текст",date:"2026-08-29",time:"10:15",status:"fixed",writingStatus:"edit1",included:true,dateReview:true,people:{"char-a":{action:"говорит",legacyState:"legacy",relationChanges:{"char-b":""},visibleRelations:["char-b"]}}}]});
const preview=(extra={})=>buildLocalToCloudMigrationPreview({localProject:source(),sourceProjectId:"local-project",targetProjectId,targetProjectRevision:7,targetCloudState:{},characterDecisions:{"char-a":{action:"CREATE_NEW_GLOBAL_IDENTITY"},"char-b":{action:"CREATE_NEW_GLOBAL_IDENTITY"}},...extra});

assert.throws(()=>confirmLocalToCloudMigrationPlan({...preview(),ready:false},{migrationAttemptId:attemptId}),/ready/i);
assert.throws(()=>confirmLocalToCloudMigrationPlan({...preview(),blockingConflicts:[{code:"X"}]},{migrationAttemptId:attemptId}),/blocking/i);
assert.throws(()=>confirmLocalToCloudMigrationPlan(preview({characterDecisions:{}}),{migrationAttemptId:attemptId}),/ready|mapping/i);
{const unresolved=source();delete unresolved.characterLinks[0].scope;const p=buildLocalToCloudMigrationPreview({localProject:unresolved,sourceProjectId:"local-project",targetProjectId,targetProjectRevision:7,targetCloudState:{},characterDecisions:{"char-a":{action:"CREATE_NEW_GLOBAL_IDENTITY"},"char-b":{action:"CREATE_NEW_GLOBAL_IDENTITY"}}});assert.throws(()=>confirmLocalToCloudMigrationPlan(p,{migrationAttemptId:attemptId}),/ready|scope/i)}

const original=source(),before=JSON.stringify(original);
const confirmed=confirmLocalToCloudMigrationPlan(preview(),{migrationAttemptId:attemptId});
const prepared=prepareLocalToCloudMigrationExecution({confirmedPlan:confirmed,ownerId});
assert.equal(prepared.dbPayload.project_id,targetProjectId);
assert.equal(prepared.dbPayload.expected_revision,7);
assert.equal(prepared.dbPayload.migration_attempt_id,attemptId);
assert.equal(prepared.dbPayload.chapters.length,1);
assert.equal(prepared.dbPayload.scenes[0].chapter_id,null);
assert.equal(prepared.dbPayload.scenes.length,1);
assert.equal(prepared.dbPayload.scene_tags.length,1);
assert.equal(prepared.dbPayload.scene_characters[0].action,"говорит");
assert.equal(prepared.dbPayload.initial_relations[0].value,"доверяет");
assert.equal(prepared.dbPayload.scene_relation_changes[0].value_operation,"clear");
assert.equal(prepared.dbPayload.structural_links[0].project_id,targetProjectId);
assert.equal(prepared.dbPayload.character_images[0].project_character_id,confirmed.entityPlan.characters[0].projectCharacterId);
assert.equal(prepared.uploads[0].storagePath,`${ownerId}/characters/${confirmed.entityPlan.characters[0].cloudCharacterId}/${confirmed.imageUploads[0].cloudImageId}/original.png`);
assert(!JSON.stringify(prepared.dbPayload).includes("base64"));
assert(!JSON.stringify(prepared.dbPayload).includes("aGVsbG8"));

function fakeClient({preflight={ok:true,code:"OK"},importResult={ok:true,code:"OK",previousRevision:7,revision:8,created:{}},rpcError=null,uploadError=null,removeError=null,snapshot=null,attempt=null}={}){
  const calls=[];
  return {calls,client:{
    async rpc(name,args){calls.push({kind:"rpc",name,args});if(name==="preflight_local_project_import")return {data:preflight,error:null};if(name==="get_local_project_import_attempt")return {data:attempt,error:null};if(name==="import_local_project_content")return rpcError?{data:null,error:rpcError}:{data:importResult,error:null};if(name==="get_local_project_import_snapshot")return {data:{ok:true,revision:8,data:snapshot||prepared.expectedSnapshot},error:null};throw new Error(name)},
    storage:{from(){return {async upload(path){calls.push({kind:"upload",path});return uploadError?{error:uploadError}:{data:{path},error:null}},async remove(paths){calls.push({kind:"remove",paths});return removeError?{error:removeError}:{data:paths,error:null}},async download(path){calls.push({kind:"download",path});return {data:new Blob(["hello"],{type:"image/png"}),error:null}}}}}
  }};
}

{
  const f=fakeClient();const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId,localSource:original});
  assert.equal(result.ok,true);assert.equal(result.revision,8);assert.equal(result.uploadedImages.length,1);assert.equal(result.verification.ok,true);assert.equal(JSON.stringify(original),before);assert.equal(f.calls.filter(x=>x.kind==="rpc"&&x.name==="import_local_project_content").length,1);
}
{
  const f=fakeClient({preflight:{ok:false,code:"REVISION_CONFLICT",expectedRevision:7,actualRevision:8}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId,localSource:original});assert.equal(result.code,"REVISION_CONFLICT");assert.equal(f.calls.some(x=>x.kind==="upload"),false);
}
{
  const f=fakeClient({preflight:{ok:false,code:"TARGET_NOT_EMPTY"}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId});assert.equal(result.code,"TARGET_NOT_EMPTY");assert.equal(f.calls.some(x=>x.kind==="upload"),false);
}
{
  const f=fakeClient({uploadError:{message:"nope"}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId});assert.equal(result.code,"STORAGE_UPLOAD_FAILED");assert.equal(f.calls.some(x=>x.name==="import_local_project_content"),false);
}
{
  const f=fakeClient({importResult:{ok:false,code:"DB_IMPORT_FAILED"}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId});assert.equal(result.code,"DB_IMPORT_FAILED");assert.equal(result.cleanupFailures.length,0);assert.equal(f.calls.filter(x=>x.kind==="remove").length,1);
}
{
  const f=fakeClient({importResult:{ok:false,code:"DB_IMPORT_FAILED"},removeError:{message:"cleanup failed"}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId});assert.equal(result.code,"CLEANUP_INCOMPLETE");assert.equal(result.cleanupFailures.length,1);
}
{
  const f=fakeClient({rpcError:{message:"network timeout"},attempt:{ok:true,status:"committed",result:{ok:true,code:"OK",previousRevision:7,revision:8,created:{}}}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId});assert.equal(result.ok,true);assert.equal(result.recoveredFromUnknownResult,true);assert.equal(f.calls.filter(x=>x.name==="import_local_project_content").length,1);
}
{
  const f=fakeClient({rpcError:{message:"network timeout"},attempt:{ok:false,code:"NOT_FOUND"}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId});assert.equal(result.code,"UNKNOWN_IMPORT_RESULT");
}
{
  const f=fakeClient({snapshot:{...prepared.expectedSnapshot,scenes:[]}});const result=await executeLocalToCloudMigration({confirmedPlan:confirmed,client:f.client,ownerId});assert.equal(result.code,"VERIFICATION_FAILED");
}

console.log("local to cloud migration execution tests passed");
