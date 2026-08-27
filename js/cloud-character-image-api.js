const CHARACTER_IMAGE_BUCKET="character-images";
const MAX_CHARACTER_IMAGE_BYTES=3*1024*1024;
const SIGNED_URL_TTL_SECONDS=900;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
const SAFE_PHOTO_KEYS=new Set(["id","source","crop","alt","caption","revision","isPrimary","sortOrder","scope","projectCharacterId"]);

function requiredUuid(value,label){if(!UUID.test(String(value||"")))throw new TypeError(`${label} must be a UUID`);return String(value).toLowerCase()}
function buildCharacterImagePath({ownerId,characterId,photoId,mimeType}){
  const ext=MIME_EXTENSIONS[mimeType];if(!ext)throw new TypeError("Unsupported image MIME type");
  return `${requiredUuid(ownerId,"ownerId")}/characters/${requiredUuid(characterId,"characterId")}/${requiredUuid(photoId,"photoId")}/original.${ext}`;
}
function isLegacyDataUrlPhoto(photo){return photo?.source?.kind==="data-url"&&String(photo.source.value||"").startsWith("data:image/")}
function safeMetadata(photo){return Object.fromEntries(Object.entries(photo||{}).filter(([key])=>!SAFE_PHOTO_KEYS.has(key)&&key!=="__proto__"&&key!=="prototype"&&key!=="constructor"))}
function imageMetadataFromPhoto(photo,{characterId,projectCharacterId=null,storagePath,mimeType,isPrimary=false,sortOrder=0}){return {
  image_id:requiredUuid(photo?.id,"photoId"),character_id:requiredUuid(characterId,"characterId"),project_character_id:projectCharacterId?requiredUuid(projectCharacterId,"projectCharacterId"):null,
  storage_path:String(storagePath),mime_type:mimeType,crop:photo?.crop||{x:.5,y:.5,zoom:1},alt:String(photo?.alt||""),caption:String(photo?.caption||""),
  sort_order:Number(sortOrder)||0,is_primary:isPrimary===true,metadata:safeMetadata(photo)
}}
function normalizeResult(result){
  if(result?.error)return {ok:false,code:result.error.code==="42501"?"FORBIDDEN":"UNKNOWN",message:result.error.message||"Cloud image operation failed.",changed:false};
  const value=result?.data;if(value?.ok===true)return {...value,ok:true};return {ok:false,changed:false,code:value?.code||"UNKNOWN",message:value?.message||"Cloud image operation failed.",...value};
}
function validateFile(file){
  if(!file||!MIME_EXTENSIONS[file.type])return {ok:false,code:"VALIDATION_ERROR",message:"Неподдерживаемый формат изображения."};
  if(file.size>MAX_CHARACTER_IMAGE_BYTES)return {ok:false,code:"VALIDATION_ERROR",message:"Файл больше 3 МБ."};return {ok:true};
}
function createCloudCharacterImageApi(client,{getUserId,signedUrlTtl=SIGNED_URL_TTL_SECONDS,now=()=>Date.now()}={}){
  if(!client?.storage?.from||!client?.rpc)throw new TypeError("Supabase client with Storage and rpc() is required");
  const bucket=client.storage.from(CHARACTER_IMAGE_BUCKET),signedCache=new Map();
  const userId=async()=>requiredUuid(await getUserId?.(),"ownerId");
  const call=async(name,args)=>normalizeResult(await client.rpc(name,args));
  return {
    listImages:(characterId,projectCharacterId=null)=>call("list_character_images",{target_character_id:characterId,target_project_character_id:projectCharacterId}),
    async signedUrl(storagePath){const cached=signedCache.get(storagePath);if(cached&&cached.expiresAt>now()+30000)return {ok:true,url:cached.url};const result=await bucket.createSignedUrl(storagePath,signedUrlTtl);if(result.error)return {ok:false,code:"IMAGE_UNAVAILABLE",message:result.error.message};const url=result.data?.signedUrl;signedCache.set(storagePath,{url,expiresAt:now()+signedUrlTtl*1000});return {ok:true,url}},
    async uploadImage({characterId,projectCharacterId=null,photoId,file,photo,scope="global",expectedRevision,isPrimary=false,sortOrder=0}){
      const valid=validateFile(file);if(!valid.ok)return valid;const ownerId=await userId(),storagePath=buildCharacterImagePath({ownerId,characterId,photoId,mimeType:file.type});
      const uploaded=await bucket.upload(storagePath,file,{contentType:file.type,upsert:false,cacheControl:"3600"});if(uploaded.error)return {ok:false,code:"UPLOAD_FAILED",message:uploaded.error.message,changed:false};
      const payload=imageMetadataFromPhoto({...photo,id:photoId},{characterId,projectCharacterId,storagePath,mimeType:file.type,isPrimary,sortOrder});
      const saved=await call("create_character_image",{...payload,image_scope:scope,expected_revision:expectedRevision,idempotency_key:photoId});
      if(saved.ok)return {...saved,storagePath};
      const cleanup=await bucket.remove([storagePath]);return {...saved,compensated:!cleanup.error,orphaned:!!cleanup.error,cleanupError:cleanup.error?.message,storagePath};
    },
    updateImage:(imageId,expectedRevision,changes)=>call("update_character_image",{target_image_id:imageId,expected_revision:expectedRevision,image_crop:changes.crop,image_alt:changes.alt,image_caption:changes.caption,image_is_primary:changes.isPrimary,image_sort_order:changes.sortOrder,image_metadata:changes.metadata}),
    async deleteImage(imageId,expectedRevision){const removed=await call("delete_character_image",{target_image_id:imageId,expected_revision:expectedRevision});if(!removed.ok)return removed;const storagePath=removed.storagePath||removed.storage_path||removed.data?.storage_path;if(!storagePath)return {...removed,ok:false,code:"INVALID_STORAGE_PATH",recoverable:true};const cleanup=await bucket.remove([storagePath]);if(cleanup.error)return {...removed,ok:false,code:"STORAGE_CLEANUP_REQUIRED",message:"Метаданные удалены, но объект требует повторной очистки.",recoverable:true,cleanupError:cleanup.error.message};signedCache.delete(storagePath);return {...removed,storageDeleted:true}},
    validateFile,clearSignedUrlCache:()=>signedCache.clear()
  };
}

export {CHARACTER_IMAGE_BUCKET,MAX_CHARACTER_IMAGE_BYTES,SIGNED_URL_TTL_SECONDS,buildCharacterImagePath,createCloudCharacterImageApi,imageMetadataFromPhoto,isLegacyDataUrlPhoto,validateFile};
