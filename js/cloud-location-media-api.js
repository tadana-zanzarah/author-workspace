// Location Media B4A: cloud API adapter for the location_media backend/storage foundation.
// No UI wiring lives here yet (see B4A scope) -- this exists so the backend contract can be
// exercised/verified from JS (unit tests, a future real-cloud script) and so B4B can build the
// Profile media editor directly on top of it without redesigning this layer.
//
// Deliberately NOT a mechanical copy of js/cloud-character-image-api.js's parameter shapes: the
// location_media RPCs dropped the redundant image_scope/idempotency_key parameters (scope is
// derived purely from projectLocationId being null or not; mediaId itself is the idempotency key --
// see the migration header). This adapter mirrors that trimmed contract exactly.

const LOCATION_MEDIA_BUCKET="location-media";
const MAX_LOCATION_MEDIA_BYTES=8*1024*1024;
const LOCATION_MEDIA_SIGNED_URL_TTL_SECONDS=900;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
const LOCATION_MEDIA_KINDS=["photo","map","floorplan","other"];
const SAFE_MEDIA_KEYS=new Set(["id","source","crop","alt","caption","revision","isPrimary","sortOrder","mediaKind","scope","projectLocationId"]);

function requiredUuid(value,label){if(!UUID.test(String(value||"")))throw new TypeError(`${label} must be a UUID`);return String(value).toLowerCase()}
function buildLocationMediaPath({ownerId,locationId,mediaId,mimeType}){
  const ext=MIME_EXTENSIONS[mimeType];if(!ext)throw new TypeError("Unsupported image MIME type");
  return `${requiredUuid(ownerId,"ownerId")}/locations/${requiredUuid(locationId,"locationId")}/${requiredUuid(mediaId,"mediaId")}/original.${ext}`;
}
function isValidMediaKind(kind){return LOCATION_MEDIA_KINDS.includes(kind)}
function safeMetadata(media){return Object.fromEntries(Object.entries(media||{}).filter(([key])=>!SAFE_MEDIA_KEYS.has(key)&&key!=="__proto__"&&key!=="prototype"&&key!=="constructor"))}
function mediaMetadataFromDraft(media,{locationId,projectLocationId=null,storagePath,mimeType,isPrimary=false,sortOrder=0}){
  if(!isValidMediaKind(media?.mediaKind))throw new TypeError("Invalid media kind");
  return {
    media_id:requiredUuid(media?.id,"mediaId"),location_id:requiredUuid(locationId,"locationId"),
    project_location_id:projectLocationId?requiredUuid(projectLocationId,"projectLocationId"):null,
    storage_path:String(storagePath),mime_type:mimeType,media_kind:media.mediaKind,
    crop:media?.crop||{x:.5,y:.5,zoom:1},alt:String(media?.alt||""),caption:String(media?.caption||""),
    sort_order:Number(sortOrder)||0,is_primary:isPrimary===true,metadata:safeMetadata(media)
  };
}
function normalizeResult(result){
  if(result?.error)return {ok:false,code:result.error.code==="42501"?"FORBIDDEN":"UNKNOWN",message:result.error.message||"Cloud media operation failed.",changed:false};
  const value=result?.data;if(value?.ok===true)return {...value,ok:true};return {ok:false,changed:false,code:value?.code||"UNKNOWN",message:value?.message||"Cloud media operation failed.",...value};
}
function validateLocationMediaFile(file){
  if(!file||!MIME_EXTENSIONS[file.type])return {ok:false,code:"VALIDATION_ERROR",message:"Неподдерживаемый формат изображения."};
  if(file.size>MAX_LOCATION_MEDIA_BYTES)return {ok:false,code:"VALIDATION_ERROR",message:"Файл больше 8 МБ."};
  return {ok:true};
}

// Gallery/Profile cover fallback (audit decision, B4A proves it as a pure function so B4C can wire
// it directly): the cover is ALWAYS the canonical primary `photo` row, never a map/floorplan/other,
// and never falls back to any other kind when no primary photo exists.
function locationCoverMedia(mediaList){
  const photo=(mediaList||[]).find(item=>item?.mediaKind==="photo"&&item?.isPrimary&&item?.scope!=="project");
  return photo||null;
}

function createCloudLocationMediaApi(client,{getUserId,signedUrlTtl=LOCATION_MEDIA_SIGNED_URL_TTL_SECONDS,now=()=>Date.now()}={}){
  if(!client?.storage?.from||!client?.rpc)throw new TypeError("Supabase client with Storage and rpc() is required");
  const bucket=client.storage.from(LOCATION_MEDIA_BUCKET),signedCache=new Map();
  const userId=async()=>requiredUuid(await getUserId?.(),"ownerId");
  const call=async(name,args)=>normalizeResult(await client.rpc(name,args));
  return {
    listMedia:(locationId,projectLocationId=null)=>call("list_location_media",{target_location_id:locationId,target_project_location_id:projectLocationId}),
    async signedUrl(storagePath){
      const cached=signedCache.get(storagePath);if(cached&&cached.expiresAt>now()+30000)return {ok:true,url:cached.url};
      const result=await bucket.createSignedUrl(storagePath,signedUrlTtl);
      if(result.error)return {ok:false,code:"MEDIA_UNAVAILABLE",message:result.error.message};
      const url=result.data?.signedUrl;signedCache.set(storagePath,{url,expiresAt:now()+signedUrlTtl*1000});return {ok:true,url};
    },
    async uploadMedia({locationId,projectLocationId=null,mediaId,file,media,expectedRevision,isPrimary=false,sortOrder=0}){
      const valid=validateLocationMediaFile(file);if(!valid.ok)return valid;
      const ownerId=await userId(),storagePath=buildLocationMediaPath({ownerId,locationId,mediaId,mimeType:file.type});
      const uploaded=await bucket.upload(storagePath,file,{contentType:file.type,upsert:false,cacheControl:"3600"});
      if(uploaded.error)return {ok:false,code:"UPLOAD_FAILED",message:uploaded.error.message,changed:false};
      let payload;
      try{payload=mediaMetadataFromDraft({...media,id:mediaId},{locationId,projectLocationId,storagePath,mimeType:file.type,isPrimary,sortOrder})}
      catch(error){const cleanup=await bucket.remove([storagePath]);return {ok:false,code:"VALIDATION_ERROR",message:error.message,changed:false,orphaned:!!cleanup.error,cleanupError:cleanup.error?.message,storagePath}}
      const saved=await call("create_location_media",{
        media_id:payload.media_id,location_id:payload.location_id,project_location_id:payload.project_location_id,
        storage_path:payload.storage_path,mime_type:payload.mime_type,media_kind:payload.media_kind,
        crop:payload.crop,alt:payload.alt,caption:payload.caption,sort_order:payload.sort_order,is_primary:payload.is_primary,
        metadata:payload.metadata,expected_revision:expectedRevision
      });
      if(saved.ok)return {...saved,storagePath};
      const cleanup=await bucket.remove([storagePath]);
      return {...saved,compensated:!cleanup.error,orphaned:!!cleanup.error,cleanupError:cleanup.error?.message,storagePath};
    },
    updateMedia:(mediaId,expectedRevision,changes)=>call("update_location_media",{
      target_media_id:mediaId,expected_revision:expectedRevision,media_crop:changes.crop,media_alt:changes.alt,
      media_caption:changes.caption,media_is_primary:changes.isPrimary,media_sort_order:changes.sortOrder,media_metadata:changes.metadata
    }),
    async deleteMedia(mediaId,expectedRevision){
      const removed=await call("delete_location_media",{target_media_id:mediaId,expected_revision:expectedRevision});
      if(!removed.ok)return removed;
      const storagePath=removed.storagePath||removed.storage_path||removed.data?.storage_path;
      if(!storagePath)return {...removed,ok:false,code:"INVALID_STORAGE_PATH",recoverable:true};
      const cleanup=await bucket.remove([storagePath]);
      if(cleanup.error)return {...removed,ok:false,code:"STORAGE_CLEANUP_REQUIRED",message:"Метаданные удалены, но объект требует повторной очистки.",recoverable:true,cleanupError:cleanup.error.message};
      signedCache.delete(storagePath);
      return {...removed,storageDeleted:true};
    },
    validateLocationMediaFile,clearSignedUrlCache:()=>signedCache.clear()
  };
}

export {
  LOCATION_MEDIA_BUCKET,MAX_LOCATION_MEDIA_BYTES,LOCATION_MEDIA_SIGNED_URL_TTL_SECONDS,LOCATION_MEDIA_KINDS,
  buildLocationMediaPath,createCloudLocationMediaApi,isValidMediaKind,locationCoverMedia,
  mediaMetadataFromDraft,validateLocationMediaFile
};
