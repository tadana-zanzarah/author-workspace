import assert from "node:assert/strict";
import {createCloudContentApi} from "../js/cloud-content-api.js";

// Find/Replace Stage A: pin bulkUpdateSceneText's wire contract the same way
// cloud-content-api.test.mjs pins every other RPC adapter. This is a
// client-side contract test only -- SQL-level atomicity/no-op/duplicate/
// revision behavior is covered by
// supabase/tests/cloud_scene_text_bulk_update_rpc.sql (disposable CI), not
// here. The adapter itself does no matching/searching/deduplication -- it
// only forwards already-computed final values.

// Single-scene call: exact RPC name/argument shape, camelCase -> snake_case
// mapping, result normalization reuses the existing generic path.
{
  const calls=[];
  const api=createCloudContentApi({async rpc(name,args){calls.push({name,args});return {data:{ok:true,revision:9,changed:true,data:{results:[{sceneId:"scene-1",changed:true}]}},error:null}}});
  const result=await api.bulkUpdateSceneText("project-1",8,[
    {sceneId:"scene-1",sceneText:"Алексей вошёл.",metadata:{richText:{type:"doc"}}}
  ]);
  assert.deepEqual(calls.pop(),{name:"bulk_update_scene_text",args:{
    target_project_id:"project-1",expected_revision:8,
    replacements:[{scene_id:"scene-1",scene_text:"Алексей вошёл.",metadata:{richText:{type:"doc"}}}]
  }});
  assert.equal(result.ok,true);assert.equal(result.revision,9);assert.equal(result.changed,true);
}

// Multiple scenes in one call, in the order supplied, with sensible defaults
// for omitted sceneText/metadata -- the RPC (not this adapter) is what
// guarantees they land atomically together.
{
  const calls=[];
  const api=createCloudContentApi({async rpc(name,args){calls.push({name,args});return {data:{ok:true,revision:2,changed:true},error:null}}});
  await api.bulkUpdateSceneText("project-1",1,[
    {sceneId:"scene-a",sceneText:"A"},
    {sceneId:"scene-b",sceneText:"B",metadata:{richText:{type:"doc"}}}
  ]);
  assert.deepEqual(calls.pop().args.replacements,[
    {scene_id:"scene-a",scene_text:"A",metadata:{}},
    {scene_id:"scene-b",scene_text:"B",metadata:{richText:{type:"doc"}}}
  ],"sceneText/metadata default sensibly and preserve call order");
}

// Empty batch is forwarded as-is -- not a client-side special case, the RPC's
// own no-op contract handles it (see the SQL test).
{
  const calls=[];
  const api=createCloudContentApi({async rpc(name,args){calls.push({name,args});return {data:{ok:true,revision:5,changed:false},error:null}}});
  const result=await api.bulkUpdateSceneText("project-1",5,[]);
  assert.deepEqual(calls.pop().args.replacements,[]);
  assert.equal(result.changed,false);
}

// REVISION_CONFLICT surfaces through the exact same normalization path as
// every other content RPC -- no special-casing in this adapter, and no
// automatic retry: one bulkUpdateSceneText call must mean exactly one
// underlying rpc() invocation regardless of the result.
{
  let rpcCalls=0;
  const api=createCloudContentApi({async rpc(){rpcCalls++;return {data:{ok:false,code:"REVISION_CONFLICT",expectedRevision:5,actualRevision:6},error:null}}});
  const result=await api.bulkUpdateSceneText("project-1",5,[{sceneId:"scene-1",sceneText:"x"}]);
  assert.equal(result.ok,false);assert.equal(result.code,"REVISION_CONFLICT");assert.equal(result.actualRevision,6);
  assert.equal(rpcCalls,1,"a single bulkUpdateSceneText call must never retry on REVISION_CONFLICT by itself");
}

// DUPLICATE, NOT_FOUND and VALIDATION_ERROR (already-recognized content error
// codes) pass through unchanged -- this adapter performs no scene_id
// deduplication, existence-checking or shape validation itself; that is the
// RPC's job (see the SQL test's duplicate/cross-project/invalid-metadata
// cases).
{
  const api=createCloudContentApi({async rpc(){return {data:{ok:false,code:"DUPLICATE",entityId:"scene-1"},error:null}}});
  const result=await api.bulkUpdateSceneText("project-1",1,[{sceneId:"scene-1",sceneText:"x"},{sceneId:"scene-1",sceneText:"y"}]);
  assert.equal(result.code,"DUPLICATE");
}
{
  const api=createCloudContentApi({async rpc(){return {data:{ok:false,code:"NOT_FOUND",entityId:"scene-missing"},error:null}}});
  const result=await api.bulkUpdateSceneText("project-1",1,[{sceneId:"scene-missing",sceneText:"x"}]);
  assert.equal(result.code,"NOT_FOUND");
}
{
  const api=createCloudContentApi({async rpc(){return {data:{ok:false,code:"VALIDATION_ERROR"},error:null}}});
  const result=await api.bulkUpdateSceneText("project-1",1,[{sceneId:"scene-1",sceneText:"x",metadata:[1,2,3]}]);
  assert.equal(result.code,"VALIDATION_ERROR");
}

console.log("cloud scene text bulk api tests: OK");
