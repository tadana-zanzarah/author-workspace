import assert from "node:assert/strict";
import {CHARACTER_IMAGE_BUCKET,buildCharacterImagePath,createCloudCharacterImageApi,imageMetadataFromPhoto,isLegacyDataUrlPhoto} from "../js/cloud-character-image-api.js";

const owner="11111111-1111-4111-8111-111111111111",character="22222222-2222-4222-8222-222222222222",photo="33333333-3333-4333-8333-333333333333";
assert.equal(CHARACTER_IMAGE_BUCKET,"character-images");
assert.equal(buildCharacterImagePath({ownerId:owner,characterId:character,photoId:photo,mimeType:"image/jpeg"}),`${owner}/characters/${character}/${photo}/original.jpg`);
assert.throws(()=>buildCharacterImagePath({ownerId:"../foreign",characterId:character,photoId:photo,mimeType:"image/png"}),/UUID/);
assert.throws(()=>buildCharacterImagePath({ownerId:owner,characterId:character,photoId:photo,mimeType:"text/html"}),/MIME/);
const local={id:photo,source:{kind:"data-url",value:"data:image/png;base64,AAAA"},crop:{x:.2,y:.8,zoom:1.5},alt:"a",caption:"c",future:{keep:true}};
assert.equal(isLegacyDataUrlPhoto(local),true);
const metadata=imageMetadataFromPhoto(local,{characterId:character,projectCharacterId:null,storagePath:`${owner}/characters/${character}/${photo}/original.png`,mimeType:"image/png"});
assert.equal(JSON.stringify(metadata).includes("base64"),false);assert.deepEqual(metadata.crop,local.crop);assert.deepEqual(metadata.metadata.future,{keep:true});

function fixture({uploadError=null,rpcResult={data:{ok:true,changed:true,imageRevision:0,data:{id:photo}},error:null},removeError=null}={}){const calls=[];return {calls,storage:{from(bucket){assert.equal(bucket,CHARACTER_IMAGE_BUCKET);return {async upload(path,_file,options){calls.push(["upload",path,options]);return {data:uploadError?null:{path},error:uploadError}},async remove(paths){calls.push(["remove",paths]);return {data:removeError?null:paths,error:removeError}},async createSignedUrl(path,seconds){calls.push(["signed",path,seconds]);return {data:{signedUrl:`signed:${path}`},error:null}}}}},async rpc(name,args){calls.push(["rpc",name,args]);return rpcResult}}}
{
  const client=fixture(),api=createCloudCharacterImageApi(client,{getUserId:async()=>owner});
  const result=await api.uploadImage({characterId:character,photoId:photo,file:new Blob(["ok"],{type:"image/png"}),photo:local,scope:"global",expectedRevision:0});
  assert.equal(result.ok,true);assert.deepEqual(client.calls.map(x=>x[0]),["upload","rpc"]);assert.equal(JSON.stringify(client.calls[1]).includes("data:image"),false);
}
{
  const client=fixture({rpcResult:{data:{ok:false,code:"CHARACTER_IMAGE_REVISION_CONFLICT"},error:null}}),api=createCloudCharacterImageApi(client,{getUserId:async()=>owner});
  const result=await api.uploadImage({characterId:character,photoId:photo,file:new Blob(["ok"],{type:"image/png"}),photo:local,scope:"global",expectedRevision:0});
  assert.equal(result.ok,false);assert.equal(result.compensated,true);assert.deepEqual(client.calls.map(x=>x[0]),["upload","rpc","remove"]);
}
{
  const client=fixture({uploadError:{message:"network"}}),api=createCloudCharacterImageApi(client,{getUserId:async()=>owner});
  const result=await api.uploadImage({characterId:character,photoId:photo,file:new Blob(["no"],{type:"image/png"}),photo:local,scope:"global",expectedRevision:0});
  assert.equal(result.ok,false);assert.deepEqual(client.calls.map(x=>x[0]),["upload"]);
}
{
  const client=fixture({rpcResult:{data:{ok:true,changed:true,storagePath:`${owner}/characters/${character}/${photo}/original.png`},error:null},removeError:{message:"offline"}}),api=createCloudCharacterImageApi(client,{getUserId:async()=>owner});
  const result=await api.deleteImage(photo,0);assert.equal(result.ok,false);assert.equal(result.code,"STORAGE_CLEANUP_REQUIRED");assert.equal(result.recoverable,true);
}
console.log("cloud character image API tests passed");
