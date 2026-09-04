import {safeOwnCopy} from "./migrations.js";
import {validateDateString,validateTimeString} from "./dates.js";
import {sameSemanticLink,normalizeCharacterLink} from "./character-links.js";
import {MAX_CHARACTER_IMAGE_BYTES} from "./cloud-character-image-api.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_MIMES=new Set(["image/jpeg","image/png","image/webp","image/gif"]);
const WRITING_STATUS={idea:"draft",plan:"draft",draft:"draft",edit1:"in_progress",edit2:"revised",final:"final"};
const SYSTEM_CHAPTER_ID="chapter-unassigned";

function issue(code,path,message,details={}){return {code,path,message,...details}}
function own(value){return safeOwnCopy(value&&typeof value==="object"?value:{})}
function targetHasContent(target){const snapshot=target?.data||target;return ["chapters","locations","tags","scenes","project_characters","characters","character_links"].some(key=>Array.isArray(snapshot?.[key])&&snapshot[key].length>0)}
function normalizedName(value){return String(value||"").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g," ")}
function duplicates(items,key){const found=[],seen=new Map();items.forEach((item,index)=>{const value=key(item);if(!value)return;if(seen.has(value))found.push({value,indexes:[seen.get(value),index]});else seen.set(value,index)});return found}

// Stable, synchronous UUID-shaped identifiers keep preview repeatable. They are
// provenance IDs, not security hashes; execution must persist this exact map.
function deterministicUuid(namespace,value){
  const input=`${namespace}\u0000${value}`;let a=0x811c9dc5,b=0x9e3779b9,c=0x85ebca6b,d=0xc2b2ae35;
  for(let i=0;i<input.length;i++){const x=input.charCodeAt(i);a=Math.imul(a^x,16777619);b=Math.imul(b^x,2246822507);c=Math.imul(c^x,3266489909);d=Math.imul(d^x,668265263)}
  const hex=[a,b,c,d].map(x=>(x>>>0).toString(16).padStart(8,"0")).join("").split("");hex[12]="5";hex[16]=((parseInt(hex[16],16)&3)|8).toString(16);
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
}
function plannedId(kind,localId,sourceProjectId,targetProjectId){const raw=String(localId||"");return {localId:raw,cloudId:UUID.test(raw)?raw.toLowerCase():deterministicUuid(`${sourceProjectId}:${targetProjectId}:${kind}`,raw),preserved:UUID.test(raw)}}
function dataUrlInfo(value){
  const match=/^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(value||""));if(!match)return null;
  let bytes=0;try{bytes=match[2]?Math.max(0,Math.floor(match[3].replace(/\s/g,"").length*3/4)-(match[3].endsWith("==")?2:match[3].endsWith("=")?1:0)):new TextEncoder().encode(decodeURIComponent(match[3])).length}catch{return {mimeType:match[1].toLowerCase(),bytes:null,invalid:true}}
  return {mimeType:match[1].toLowerCase(),bytes,invalid:false};
}

function buildLocalToCloudMigrationPreview({
  localProject,sourceProjectId,targetProjectId,targetProjectRevision,targetCloudState={},existingGlobalCharacters=[],characterDecisions={},structuralLinkDecisions={},imageScopeDecisions={}
}={}){
  const source=own(localProject),warnings=[],blockingConflicts=[];
  const addBlock=(code,path,message,details)=>blockingConflicts.push(issue(code,path,message,details));
  const addWarning=(code,path,message,details)=>warnings.push(issue(code,path,message,details));
  if(!sourceProjectId)addBlock("SOURCE_PROJECT_ID_REQUIRED","sourceProjectId","Source project ID is required.");
  if(!targetProjectId)addBlock("TARGET_PROJECT_ID_REQUIRED","targetProjectId","Cloud target project ID is required.");
  if(!Number.isSafeInteger(targetProjectRevision)||targetProjectRevision<0)addBlock("TARGET_REVISION_REQUIRED","targetProjectRevision","A non-negative target project revision is required.");
  if(!localProject||typeof localProject!=="object"||Array.isArray(localProject))addBlock("INVALID_LOCAL_PROJECT","localProject","Local project must be an object.");
  if(source.version!==11)addBlock("UNSUPPORTED_LOCAL_SCHEMA","version",`Local schema version ${String(source.version)} is not supported by this checkpoint; prepare it through the existing migration pipeline first.`);
  const collections={characters:Array.isArray(source.characters)?source.characters:[],chapters:Array.isArray(source.chapters)?source.chapters:[],locations:Array.isArray(source.locations)?source.locations:[],tags:Array.isArray(source.tags)?source.tags:[],scenes:Array.isArray(source.scenes)?source.scenes:[],links:Array.isArray(source.characterLinks)?source.characterLinks:[]};
  for(const [key,value] of Object.entries({characters:source.characters,chapters:source.chapters,locations:source.locations,tags:source.tags,scenes:source.scenes,characterLinks:source.characterLinks}))if(value!==undefined&&!Array.isArray(value))addBlock("INVALID_COLLECTION",key,`${key} must be an array.`);
  for(const [key,items] of Object.entries(collections))items.forEach((item,index)=>{if(!item||typeof item!=="object"||Array.isArray(item))addBlock("INVALID_ENTITY",`${key}[${index}]`,`${key} item must be an object.`);else if(typeof item.id!=="string"||!item.id.trim())addBlock("MISSING_STABLE_ID",`${key}[${index}].id`,`${key} item requires a stable ID.`)});
  const systemChapters=collections.chapters.filter(x=>x?.id===SYSTEM_CHAPTER_ID);if(systemChapters.length!==1)addBlock("SYSTEM_CHAPTER_COUNT","chapters",`Expected exactly one ${SYSTEM_CHAPTER_ID} system chapter.`,{count:systemChapters.length});
  for(const [key,items] of Object.entries(collections))for(const duplicate of duplicates(items,item=>String(item?.id||"")))addBlock(`DUPLICATE_${key.toUpperCase()}_ID`,key,`Duplicate ${key} ID: ${duplicate.value}.`,duplicate);
  for(const duplicate of duplicates(collections.characters,item=>normalizedName(`${item?.name||""} ${item?.surname||""}`)))addWarning("DUPLICATE_CHARACTER_NAME","characters",`Characters share the normalized name “${duplicate.value}”; identity will not be inferred from the name.`,duplicate);
  for(const duplicate of duplicates(collections.tags,item=>normalizedName(item?.name)))addBlock("DUPLICATE_NORMALIZED_TAG_NAME","tags",`Duplicate normalized tag name: ${duplicate.value}.`,duplicate);
  for(const [key,items] of Object.entries({chapters:collections.chapters.filter(x=>x?.id!==SYSTEM_CHAPTER_ID),locations:collections.locations}))for(const duplicate of duplicates(items,item=>normalizedName(item?.title??item?.name)))addWarning(`DUPLICATE_${key.toUpperCase()}_NAME`,key,`Duplicate normalized ${key} name: ${duplicate.value}.`,duplicate);
  const characterIds=new Set(collections.characters.map(x=>String(x?.id||""))),chapterIds=new Set(collections.chapters.map(x=>String(x?.id||""))),locationIds=new Set(collections.locations.map(x=>String(x?.id||""))),tagIds=new Set(collections.tags.map(x=>String(x?.id||"")));
  const provenance={characters:{},projectCharacters:{},chapters:{[SYSTEM_CHAPTER_ID]:null},locations:{},tags:{},scenes:{},structuralLinks:{},images:{}};
  const mapEntities=(kind,items)=>items.forEach(item=>{if(item?.id&&item.id!==SYSTEM_CHAPTER_ID)provenance[kind][item.id]=plannedId(kind,item.id,sourceProjectId,targetProjectId)});
  mapEntities("chapters",collections.chapters);mapEntities("locations",collections.locations);mapEntities("tags",collections.tags);mapEntities("scenes",collections.scenes);mapEntities("structuralLinks",collections.links);
  const globalById=new Map(existingGlobalCharacters.map(x=>[String(x.id),x]));
  const characterMappings=collections.characters.map((character,index)=>{
    const localId=String(character?.id||""),profile=own(source.profiles?.[localId]),decision=characterDecisions[localId],candidates=existingGlobalCharacters.filter(x=>normalizedName(`${x.name||""} ${x.surname||""}`)===normalizedName(`${character?.name||""} ${character?.surname||""}`)).map(x=>({id:x.id,name:x.name||"",surname:x.surname||"",revision:x.revision??null}));
    let action=null,cloudCharacterId=null;
    if(decision?.action==="CREATE_NEW_GLOBAL_IDENTITY"){action=decision.action;cloudCharacterId=plannedId("character",localId,sourceProjectId,targetProjectId).cloudId;if(globalById.has(cloudCharacterId))addBlock("CHARACTER_ID_COLLISION",`characters[${index}].id`,`Planned new global identity ID already exists; map explicitly or choose a different execution mapping.`,{localCharacterId:localId,cloudCharacterId})}
    else if(decision?.action==="MAP_TO_EXISTING_CHARACTER"&&globalById.has(String(decision.existingCharacterId))){action=decision.action;cloudCharacterId=String(decision.existingCharacterId)}
    else if(decision)addBlock("INVALID_CHARACTER_MAPPING",`characters[${index}]`,`Invalid character mapping decision for ${localId}.`);
    if(!action)addBlock("UNRESOLVED_CHARACTER_MAPPING",`characters[${index}]`,`Character ${localId} requires an explicit identity decision.`,{localCharacterId:localId});
    const projectCharacterId=plannedId("project-character",localId,sourceProjectId,targetProjectId).cloudId;
    provenance.characters[localId]={localId,cloudId:cloudCharacterId,preserved:cloudCharacterId===localId,action};provenance.projectCharacters[localId]={localId,cloudId:projectCharacterId,preserved:false};
    return {localCharacterId:localId,localName:character?.name||"",localSurname:character?.surname||"",action,status:action?"resolved":"pending",allowedActions:["CREATE_NEW_GLOBAL_IDENTITY","MAP_TO_EXISTING_CHARACTER"],cloudCharacterId,projectCharacterId,candidates,character:own(character),profile};
  });
  const projectCharacterId=id=>provenance.projectCharacters[id]?.cloudId||null;
  const chapters=collections.chapters.filter(x=>x?.id!==SYSTEM_CHAPTER_ID).map((chapter,index)=>({id:provenance.chapters[chapter.id]?.cloudId,localId:chapter.id,title:String(chapter.title||""),position:(index+1)*1000,source:own(chapter)}));
  // shortSummary + baseProfile: local Locations already mirror these B2/B3A field names directly
  // (js/locations.js), forwarded here so import_local_project_content can carry them into the
  // canonical row's base_profile -- see the base_profile thematic-module migration
  // (20260904130000_location_base_profile_modules.sql) for the server-side allowlist/sanitization
  // that actually decides what survives. This plan layer does no filtering itself, only a safe
  // own-properties copy (own()), matching how character profiles are carried through above.
  // moduleSelection: Adaptive Module Selection Phase 1 -- local Locations carry this flat, same
  // as baseProfile above (js/locations.js, contract addendum §9), forwarded here unfiltered; the
  // backend's private.sanitize_imported_module_selection is the actual sanitizer.
  const locations=collections.locations.map(location=>({id:provenance.locations[location.id]?.cloudId,localId:location.id,name:String(location.name||""),description:String(location.description||""),shortSummary:String(location.shortSummary||""),baseProfile:own(location.baseProfile||{}),moduleSelection:own(location.moduleSelection||{}),source:own(location)}));
  const tags=collections.tags.map(tag=>({id:provenance.tags[tag.id]?.cloudId,localId:tag.id,name:String(tag.name||""),normalizedName:normalizedName(tag.name),source:own(tag)}));
  const sceneCharacters=[],sceneRelationChanges=[];
  const scenes=collections.scenes.map((scene,index)=>{
    const path=`scenes[${index}]`,chapter=String(scene?.chapterId||SYSTEM_CHAPTER_ID),location=String(scene?.locationId||""),sceneTags=Array.isArray(scene?.tags)?scene.tags:Array.isArray(scene?.tagIds)?scene.tagIds:[];
    if(chapter!==SYSTEM_CHAPTER_ID&&!chapterIds.has(chapter))addBlock("DANGLING_CHAPTER_REFERENCE",`${path}.chapterId`,`Scene references missing chapter ${chapter}.`);
    if(location&&!locationIds.has(location))addBlock("DANGLING_LOCATION_REFERENCE",`${path}.locationId`,`Scene references missing location ${location}.`);
    sceneTags.forEach((tag,i)=>{if(!tagIds.has(String(tag)))addBlock("DANGLING_TAG_REFERENCE",`${path}.tags[${i}]`,`Scene references missing tag ${tag}.`)});
    if(scene?.date&&!validateDateString(scene.date))addBlock("INVALID_SCENE_DATE",`${path}.date`,`Invalid strict calendar date: ${scene.date}.`);
    if(scene?.time&&!validateTimeString(scene.time))addBlock("INVALID_SCENE_TIME",`${path}.time`,`Invalid strict time: ${scene.time}.`);
    if(scene?.status!==undefined&&!['fixed','floating'].includes(scene.status))addWarning("UNSUPPORTED_PLACEMENT_STATUS",`${path}.status`,`Unsupported placement status ${scene.status}; preview maps it to unplaced.`);
    if(scene?.writingStatus!==undefined&&!Object.hasOwn(WRITING_STATUS,scene.writingStatus))addWarning("UNSUPPORTED_WRITING_STATUS",`${path}.writingStatus`,`Unsupported writing status ${scene.writingStatus}; preview maps it to draft.`);
    for(const [order,[fromId,person]] of Object.entries(scene?.people||{}).entries()){
      if(!characterIds.has(fromId)){addBlock("DANGLING_CHARACTER_REFERENCE",`${path}.people.${fromId}`,`Scene participant references missing character ${fromId}.`);continue}
      sceneCharacters.push({sceneId:provenance.scenes[scene.id]?.cloudId,localSceneId:scene.id,localCharacterId:fromId,projectCharacterId:projectCharacterId(fromId),resolved:!!characterMappings.find(x=>x.localCharacterId===fromId)?.action,action:String(person?.action||""),legacyState:person?.legacyState??null,sortOrder:order,source:own(person)});
      const visible=new Set(Array.isArray(person?.visibleRelations)?person.visibleRelations.map(String):[]),targets=new Set([...Object.keys(person?.relationChanges||{}),...visible]);
      for(const toId of targets){if(!characterIds.has(toId)){addBlock("DANGLING_CHARACTER_REFERENCE",`${path}.people.${fromId}.relationChanges.${toId}`,`Relation references missing character ${toId}.`);continue}const explicit=Object.prototype.hasOwnProperty.call(person?.relationChanges||{},toId),value=person?.relationChanges?.[toId];sceneRelationChanges.push({sceneId:provenance.scenes[scene.id]?.cloudId,localSceneId:scene.id,fromLocalCharacterId:fromId,toLocalCharacterId:toId,fromProjectCharacterId:projectCharacterId(fromId),toProjectCharacterId:projectCharacterId(toId),valueOperation:explicit?(value===""?"clear":"set"):null,value:explicit&&value!==""?String(value):null,visible:visible.has(toId)?true:null,metadata:{}})}
    }
    return {id:provenance.scenes[scene.id]?.cloudId,localId:scene.id,chapterId:chapter===SYSTEM_CHAPTER_ID?null:provenance.chapters[chapter]?.cloudId||null,chapterMapping:chapter===SYSTEM_CHAPTER_ID?"chapter-unassigned → NULL":null,locationId:location?provenance.locations[location]?.cloudId||null:null,tagIds:sceneTags.map(id=>provenance.tags[id]?.cloudId).filter(Boolean),position:Number.isFinite(scene?.position)?Number(scene.position):(index+1)*1000,title:String(scene?.title||""),sceneText:String(scene?.sceneText??scene?.text??""),sceneDate:scene?.date||null,sceneTime:scene?.time||null,placementStatus:scene?.status==="fixed"?"placed":"unplaced",writingStatus:WRITING_STATUS[scene?.writingStatus]||"draft",included:scene?.included!==false,dateReview:scene?.dateReview===true,source:own(scene)};
  });
  const initialRelations=[];
  for(const mapping of characterMappings)for(const [toId,value] of Object.entries(mapping.profile?.initialRelations||{})){if(!characterIds.has(toId)){addBlock("DANGLING_CHARACTER_REFERENCE",`profiles.${mapping.localCharacterId}.initialRelations.${toId}`,`Initial relation references missing character ${toId}.`);continue}initialRelations.push({fromLocalCharacterId:mapping.localCharacterId,toLocalCharacterId:toId,fromProjectCharacterId:mapping.projectCharacterId,toProjectCharacterId:projectCharacterId(toId),valueOperation:value===""?"clear":"set",value:value===""?null:String(value),visible:null,metadata:{}})}
  const structuralLinks=collections.links.map((raw,index)=>{const link=normalizeCharacterLink(raw),path=`characterLinks[${index}]`;if(!characterIds.has(link.fromCharacterId))addBlock("DANGLING_CHARACTER_REFERENCE",`${path}.fromCharacterId`,`Structural link references missing character ${link.fromCharacterId}.`);if(!characterIds.has(link.toCharacterId))addBlock("DANGLING_CHARACTER_REFERENCE",`${path}.toCharacterId`,`Structural link references missing character ${link.toCharacterId}.`);if(link.fromCharacterId===link.toCharacterId)addBlock("SELF_STRUCTURAL_LINK",path,"Structural self-links are not supported.");const scope=link.scope==="global"||link.scope==="project"?link.scope:structuralLinkDecisions[link.id]||null;if(!scope)addBlock("STRUCTURAL_LINK_SCOPE_REQUIRED",`${path}.scope`,`Structural link scope requires an explicit migration decision.`,{linkId:link.id});return {id:provenance.structuralLinks[link.id]?.cloudId,localId:link.id,scope,scopeStatus:scope?"resolved":"requires-user-decision",projectId:scope==="project"?targetProjectId:null,fromCharacterId:provenance.characters[link.fromCharacterId]?.cloudId||null,toCharacterId:provenance.characters[link.toCharacterId]?.cloudId||null,category:link.category,type:link.type,reverseType:link.reverseType,customLabel:link.customLabel||null,reverseCustomLabel:link.reverseCustomLabel||null,notes:link.notes,structureKind:link.structureKind,metadata:own(link.metadata),source:own(raw)}});
  collections.links.forEach((raw,index)=>{for(let previous=0;previous<index;previous++)if(sameSemanticLink(normalizeCharacterLink(raw),normalizeCharacterLink(collections.links[previous])))addBlock("DUPLICATE_STRUCTURAL_LINK",`characterLinks[${index}]`,`Equivalent structural link already exists at index ${previous}.`)});
  const imageUploads=[];
  for(const mapping of characterMappings){const photos=Array.isArray(mapping.profile?.photos)?mapping.profile.photos:[];photos.forEach((photo,index)=>{const path=`profiles.${mapping.localCharacterId}.photos[${index}]`,value=String(photo?.source?.value||""),storagePath=photo?.source?.storagePath||photo?.storagePath||"",id=String(photo?.id||"");if(id)provenance.images[id]=plannedId("image",id,sourceProjectId,targetProjectId);let classification="invalid-or-missing",requirement="resolve-image";const info=dataUrlInfo(value),scope=["global","project"].includes(photo?.scope)?photo.scope:imageScopeDecisions[id]||null;if(!scope)addBlock("IMAGE_SCOPE_REQUIRED",`${path}.scope`,"Character image scope requires an explicit migration decision.",{photoId:id});if(storagePath){classification="cloud-compatible-storage";requirement="reuse-metadata"}else if(info){classification="legacy-data-url";requirement="explicit-upload";if(info.invalid)addBlock("INVALID_IMAGE_DATA_URL",path,"Legacy image data URL cannot be decoded.");else if(!IMAGE_MIMES.has(info.mimeType))addBlock("UNSUPPORTED_IMAGE_TYPE",path,`Unsupported image MIME type ${info.mimeType}.`);else if(info.bytes>MAX_CHARACTER_IMAGE_BYTES)addBlock("IMAGE_TOO_LARGE",path,`Legacy image is larger than the 3 MiB upload limit.`,{bytes:info.bytes,limit:MAX_CHARACTER_IMAGE_BYTES});else addWarning("LEGACY_IMAGE_UPLOAD_REQUIRED",path,"Legacy image requires an explicit future Storage upload.",{bytes:info.bytes,mimeType:info.mimeType})}else addBlock("INVALID_OR_MISSING_IMAGE",path,"Image has neither canonical storage metadata nor a valid legacy data URL.");imageUploads.push({localPhotoId:id,cloudImageId:provenance.images[id]?.cloudId||null,localCharacterId:mapping.localCharacterId,cloudCharacterId:mapping.cloudCharacterId,projectCharacterId:mapping.projectCharacterId,scope,scopeStatus:scope?"resolved":"requires-user-decision",classification,requirement,mimeType:info?.mimeType||photo?.mimeType||null,estimatedBytes:info?.bytes??null,withinLimit:info?.bytes==null?null:info.bytes<=MAX_CHARACTER_IMAGE_BYTES,isPrimary:mapping.profile.primaryPhotoId===id||photo?.isPrimary===true,sortOrder:Number(photo?.sortOrder??index),crop:own(photo?.crop),alt:String(photo?.alt||""),caption:String(photo?.caption||""),storagePath:storagePath||null,metadata:own(Object.fromEntries(Object.entries(photo||{}).filter(([key])=>!["id","source","crop","alt","caption","sortOrder","isPrimary"].includes(key)))),source:own(photo)})})}
  const targetNonEmpty=targetHasContent(targetCloudState);if(targetNonEmpty)addBlock("TARGET_PROJECT_NOT_EMPTY","targetCloudState","Target cloud project is non-empty; merge is unsupported and replacement requires a future explicit confirmation.",{options:["choose-another-project","explicit-future-replace"],mergeSupported:false});
  const counts={characters:collections.characters.length,scenes:collections.scenes.length,chapters:chapters.length,locations:collections.locations.length,tags:collections.tags.length,structuralLinks:structuralLinks.length,emotionalRelations:initialRelations.length+sceneRelationChanges.length,images:imageUploads.length};
  const entityPlan={characters:characterMappings,chapters,locations,tags,scenes,sceneCharacters,initialRelations,sceneRelationChanges,structuralLinks,images:imageUploads,projectSource:source};
  return {ready:blockingConflicts.length===0,sourceProjectId,targetProjectId,localSchemaVersion:source.version??null,expectedProjectRevision:targetProjectRevision,counts,warnings,blockingConflicts,characterMappings,imageUploads,provenance,chapterMappings:[{localId:SYSTEM_CHAPTER_ID,cloudId:null}],target:{empty:!targetNonEmpty,mergeSupported:false},entityPlan};
}

export {SYSTEM_CHAPTER_ID,buildLocalToCloudMigrationPreview,deterministicUuid};
