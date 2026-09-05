import assert from "node:assert/strict";
import {
  LOCATION_MEDIA_BUCKET,MAX_LOCATION_MEDIA_BYTES,LOCATION_MEDIA_KINDS,
  buildLocationMediaPath,createCloudLocationMediaApi,isValidMediaKind,locationCoverMedia,
  mediaMetadataFromDraft,validateLocationMediaFile
} from "../js/cloud-location-media-api.js";

const owner="11111111-1111-4111-8111-111111111111",location="22222222-2222-4222-8222-222222222222",media="33333333-3333-4333-8333-333333333333";

// --- pure helpers -----------------------------------------------------------
assert.equal(LOCATION_MEDIA_BUCKET,"location-media");
assert.equal(MAX_LOCATION_MEDIA_BYTES,8*1024*1024);
assert.deepEqual(LOCATION_MEDIA_KINDS,["photo","map","floorplan","other"]);

assert.equal(buildLocationMediaPath({ownerId:owner,locationId:location,mediaId:media,mimeType:"image/jpeg"}),`${owner}/locations/${location}/${media}/original.jpg`);
assert.equal(buildLocationMediaPath({ownerId:owner,locationId:location,mediaId:media,mimeType:"image/gif"}),`${owner}/locations/${location}/${media}/original.gif`);
assert.throws(()=>buildLocationMediaPath({ownerId:"../foreign",locationId:location,mediaId:media,mimeType:"image/png"}),/UUID/);
assert.throws(()=>buildLocationMediaPath({ownerId:owner,locationId:location,mediaId:media,mimeType:"application/pdf"}),/MIME/);

assert.equal(isValidMediaKind("photo"),true);
assert.equal(isValidMediaKind("map"),true);
assert.equal(isValidMediaKind("floorplan"),true);
assert.equal(isValidMediaKind("other"),true);
assert.equal(isValidMediaKind("document"),false);
assert.equal(isValidMediaKind("video"),false);
assert.equal(isValidMediaKind(""),false);

// --- file validation: MIME allowlist + 8 MiB size limit ---------------------
assert.equal(validateLocationMediaFile({type:"image/jpeg",size:1024}).ok,true);
assert.equal(validateLocationMediaFile({type:"image/png",size:1024}).ok,true);
assert.equal(validateLocationMediaFile({type:"image/webp",size:1024}).ok,true);
assert.equal(validateLocationMediaFile({type:"image/gif",size:1024}).ok,true);
assert.equal(validateLocationMediaFile({type:"image/svg+xml",size:1024}).ok,false);
assert.equal(validateLocationMediaFile({type:"application/pdf",size:1024}).ok,false);
assert.equal(validateLocationMediaFile(null).ok,false);
assert.equal(validateLocationMediaFile({type:"image/png",size:MAX_LOCATION_MEDIA_BYTES}).ok,true);
assert.equal(validateLocationMediaFile({type:"image/png",size:MAX_LOCATION_MEDIA_BYTES+1}).ok,false);

// --- mediaMetadataFromDraft: unknown-key stripping + invalid kind rejection -
{
  const draft={id:media,mediaKind:"photo",crop:{x:.3,y:.7,zoom:1.2},alt:"a",caption:"c",future:{keep:true}};
  const metadata=mediaMetadataFromDraft(draft,{locationId:location,projectLocationId:null,storagePath:`${owner}/locations/${location}/${media}/original.png`,mimeType:"image/png"});
  assert.equal(metadata.media_kind,"photo");
  assert.equal(metadata.location_id,location);
  assert.equal(metadata.project_location_id,null);
  assert.deepEqual(metadata.crop,draft.crop);
  assert.deepEqual(metadata.metadata,{future:{keep:true}});
  assert.equal("mediaKind" in metadata.metadata,false);
  assert.throws(()=>mediaMetadataFromDraft({...draft,mediaKind:"poster"},{locationId:location,storagePath:"x",mimeType:"image/png"}),/media kind/i);
}

// --- Gallery cover fallback: primary photo -> photo; no primary photo/map-only/floorplan-only -> none
{
  const primaryPhoto={id:"p1",mediaKind:"photo",isPrimary:true,scope:"global"};
  const nonPrimaryPhoto={id:"p2",mediaKind:"photo",isPrimary:false,scope:"global"};
  const primaryMap={id:"m1",mediaKind:"map",isPrimary:true,scope:"global"};
  const primaryFloorplan={id:"f1",mediaKind:"floorplan",isPrimary:true,scope:"global"};
  const projectScopedPrimaryPhoto={id:"p3",mediaKind:"photo",isPrimary:true,scope:"project"};

  assert.equal(locationCoverMedia([primaryPhoto,primaryMap]),primaryPhoto);
  assert.equal(locationCoverMedia([]),null);
  assert.equal(locationCoverMedia([nonPrimaryPhoto]),null);
  assert.equal(locationCoverMedia([primaryMap]),null,"a map-only Location must never fall back to a map cover");
  assert.equal(locationCoverMedia([primaryFloorplan]),null,"a floorplan-only Location must never fall back to a floorplan cover");
  assert.equal(locationCoverMedia([primaryMap,primaryFloorplan]),null,"map+floorplan with no photo must still yield no cover");
  assert.equal(locationCoverMedia([projectScopedPrimaryPhoto]),null,"v1 cover must be canonical-scope only, never a project-scoped primary");
}

// --- upload/delete lifecycle (mockable Storage + rpc) -----------------------
function fixture({uploadError=null,rpcResult={data:{ok:true,changed:true,mediaRevision:0,locationRevision:1,data:{id:media}},error:null},removeError=null}={}){
  const calls=[];
  return {calls,storage:{from(bucket){assert.equal(bucket,LOCATION_MEDIA_BUCKET);return {
    async upload(path,_file,options){calls.push(["upload",path,options]);return {data:uploadError?null:{path},error:uploadError}},
    async remove(paths){calls.push(["remove",paths]);return {data:removeError?null:paths,error:removeError}},
    async createSignedUrl(path,seconds){calls.push(["signed",path,seconds]);return {data:{signedUrl:`signed:${path}`},error:null}}
  }}},async rpc(name,args){calls.push(["rpc",name,args]);return rpcResult}};
}
const draftMedia={id:media,mediaKind:"photo",crop:{x:.5,y:.5,zoom:1},alt:"",caption:""};

{
  const client=fixture(),api=createCloudLocationMediaApi(client,{getUserId:async()=>owner});
  const result=await api.uploadMedia({locationId:location,mediaId:media,file:new Blob(["ok"],{type:"image/png"}),media:draftMedia,expectedRevision:0});
  assert.equal(result.ok,true);
  assert.deepEqual(client.calls.map(x=>x[0]),["upload","rpc"]);
  assert.equal(client.calls[1][1],"create_location_media");
  assert.equal(client.calls[1][2].media_kind,"photo");
  assert.equal(JSON.stringify(client.calls[1]).includes("data:image"),false);
}
{
  // A rejected DB create must remove the just-uploaded object (compensation), never leave an orphan silently.
  const client=fixture({rpcResult:{data:{ok:false,code:"LOCATION_REVISION_CONFLICT"},error:null}}),api=createCloudLocationMediaApi(client,{getUserId:async()=>owner});
  const result=await api.uploadMedia({locationId:location,mediaId:media,file:new Blob(["ok"],{type:"image/png"}),media:draftMedia,expectedRevision:0});
  assert.equal(result.ok,false);assert.equal(result.compensated,true);
  assert.deepEqual(client.calls.map(x=>x[0]),["upload","rpc","remove"]);
}
{
  // Upload failure must never reach the RPC at all.
  const client=fixture({uploadError:{message:"network"}}),api=createCloudLocationMediaApi(client,{getUserId:async()=>owner});
  const result=await api.uploadMedia({locationId:location,mediaId:media,file:new Blob(["no"],{type:"image/png"}),media:draftMedia,expectedRevision:0});
  assert.equal(result.ok,false);assert.deepEqual(client.calls.map(x=>x[0]),["upload"]);
}
{
  // Delete: DB soft-delete succeeds but Storage removal fails -> STORAGE_CLEANUP_REQUIRED, recoverable.
  const client=fixture({rpcResult:{data:{ok:true,changed:true,storagePath:`${owner}/locations/${location}/${media}/original.png`},error:null},removeError:{message:"offline"}}),api=createCloudLocationMediaApi(client,{getUserId:async()=>owner});
  const result=await api.deleteMedia(media,0);
  assert.equal(result.ok,false);assert.equal(result.code,"STORAGE_CLEANUP_REQUIRED");assert.equal(result.recoverable,true);
}
{
  // Delete: both DB and Storage succeed.
  const client=fixture({rpcResult:{data:{ok:true,changed:true,storagePath:`${owner}/locations/${location}/${media}/original.png`},error:null}}),api=createCloudLocationMediaApi(client,{getUserId:async()=>owner});
  const result=await api.deleteMedia(media,0);
  assert.equal(result.ok,true);assert.equal(result.storageDeleted,true);
}

console.log("cloud location media API tests passed");
