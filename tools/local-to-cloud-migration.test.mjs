import assert from "node:assert/strict";
import {buildLocalToCloudMigrationPreview,deterministicUuid} from "../js/local-to-cloud-migration.js";

const targetProjectId="11111111-1111-4111-8111-111111111111";
const existingId="22222222-2222-4222-8222-222222222222";
const empty=()=>({version:11,characters:[],profiles:{},characterLinks:[],chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{plugin:{keep:true}},scenes:[],pluginProject:{keep:true}});
const normal=()=>({version:11,characters:[{id:"char-a",name:"Анна",plugin:{keep:true}},{id:"char-b",name:"Борис"}],profiles:{"char-a":{id:"char-a",characterId:"char-a",name:"Анна",favorites:["чай"],hobbies:["бег"],photos:[],initialRelations:{"char-b":"доверяет"},pluginProfile:{keep:true}},"char-b":{id:"char-b",characterId:"char-b",name:"Борис",photos:[],initialRelations:{}}},characterLinks:[{id:"link-a",fromCharacterId:"char-a",toCharacterId:"char-b",category:"other",type:"friend",reverseType:"friend",structureKind:"social",metadata:{plugin:true}}],chapters:[{id:"chapter-unassigned",title:"Без главы"},{id:"chapter-a",title:"Первая",pluginChapter:true}],locations:[{id:"location-a",name:"Дом",description:"",pluginLocation:true}],tags:[{id:"tag-a",name:"Тайна",pluginTag:true}],future:{},scenes:[{id:"scene-a",chapterId:"chapter-unassigned",locationId:"location-a",tags:["tag-a"],title:"Сцена",sceneText:"Текст",date:"2026-08-29",time:"10:15",status:"fixed",writingStatus:"edit1",included:true,dateReview:true,people:{"char-a":{action:"говорит",legacyState:"legacy",relationChanges:{"char-b":""},visibleRelations:["char-b"],pluginPerson:true}},pluginScene:{keep:true}}]});
const opts=(localProject=empty(),extra={})=>({localProject,sourceProjectId:"local-project",targetProjectId,targetProjectRevision:7,targetCloudState:{},...extra});
const resolved={"char-a":{action:"CREATE_NEW_GLOBAL_IDENTITY"},"char-b":{action:"CREATE_NEW_GLOBAL_IDENTITY"}};

// 1. Empty local project.
{
  const result=buildLocalToCloudMigrationPreview(opts());assert.equal(result.ready,true);assert.deepEqual(result.counts,{characters:0,scenes:0,chapters:0,locations:0,tags:0,structuralLinks:0,emotionalRelations:0,images:0});
}
// 2, 3, 8-11. Normal mapping, system chapter, scene/participation/relation fields.
{
  const result=buildLocalToCloudMigrationPreview(opts(normal(),{characterDecisions:resolved,structuralLinkDecisions:{"link-a":"project"}}));assert.equal(result.ready,true);assert.equal(result.entityPlan.scenes[0].chapterId,null);assert.equal(result.entityPlan.scenes[0].chapterMapping,"chapter-unassigned → NULL");assert.equal(result.entityPlan.scenes[0].sceneText,"Текст");assert.equal(result.entityPlan.scenes[0].placementStatus,"placed");assert.equal(result.entityPlan.scenes[0].writingStatus,"in_progress");assert.equal(result.entityPlan.sceneCharacters[0].action,"говорит");assert.equal(result.entityPlan.sceneCharacters[0].legacyState,"legacy");assert.equal(result.entityPlan.initialRelations[0].value,"доверяет");assert.equal(result.entityPlan.sceneRelationChanges[0].valueOperation,"clear");assert.equal(result.entityPlan.sceneRelationChanges[0].visible,true);assert.equal(result.entityPlan.structuralLinks[0].scope,"project");
}
// 4. Character mapping remains a user decision.
{
  const result=buildLocalToCloudMigrationPreview(opts(normal()));assert(result.blockingConflicts.some(x=>x.code==="UNRESOLVED_CHARACTER_MAPPING"));assert(result.characterMappings.every(x=>x.status==="pending"));
}
// 5. Same-name cloud identity is only a candidate; explicit ID resolves it.
{
  const candidate={id:existingId,name:"Анна",surname:"",revision:4};let result=buildLocalToCloudMigrationPreview(opts(normal(),{existingGlobalCharacters:[candidate]}));assert.deepEqual(result.characterMappings[0].candidates,[candidate]);assert.equal(result.characterMappings[0].action,null);result=buildLocalToCloudMigrationPreview(opts(normal(),{existingGlobalCharacters:[candidate],characterDecisions:{...resolved,"char-a":{action:"MAP_TO_EXISTING_CHARACTER",existingCharacterId:existingId}},structuralLinkDecisions:{"link-a":"project"}}));assert.equal(result.characterMappings[0].cloudCharacterId,existingId);
}
// 6. Duplicate character IDs.
{
  const data=normal();data.characters.push({...data.characters[0]});assert(buildLocalToCloudMigrationPreview(opts(data)).blockingConflicts.some(x=>x.code==="DUPLICATE_CHARACTERS_ID"));
}
// 7. Duplicate scene IDs.
{
  const data=normal();data.scenes.push({...data.scenes[0]});assert(buildLocalToCloudMigrationPreview(opts(data)).blockingConflicts.some(x=>x.code==="DUPLICATE_SCENES_ID"));
}
// 8. Dangling participant reference.
{
  const data=normal();data.scenes[0].people.ghost={action:""};assert(buildLocalToCloudMigrationPreview(opts(data)).blockingConflicts.some(x=>x.code==="DANGLING_CHARACTER_REFERENCE"&&x.path.includes("ghost")));
}
// 9. Dangling chapter reference.
{
  const data=normal();data.scenes[0].chapterId="missing";assert(buildLocalToCloudMigrationPreview(opts(data)).blockingConflicts.some(x=>x.code==="DANGLING_CHAPTER_REFERENCE"));
}
// 10. Dangling location and tag references.
{
  const data=normal();data.scenes[0].locationId="missing";data.scenes[0].tags.push("missing");const result=buildLocalToCloudMigrationPreview(opts(data));assert(result.blockingConflicts.some(x=>x.code==="DANGLING_LOCATION_REFERENCE"));assert(result.blockingConflicts.some(x=>x.code==="DANGLING_TAG_REFERENCE"));
}
// 12. Missing structural scope is an explicit decision and semantic duplicates block.
{
  const data=normal();let result=buildLocalToCloudMigrationPreview(opts(data,{characterDecisions:resolved}));assert(result.blockingConflicts.some(x=>x.code==="STRUCTURAL_LINK_SCOPE_REQUIRED"));data.characterLinks.push({id:"link-b",fromCharacterId:"char-b",toCharacterId:"char-a",category:"other",type:"friend",reverseType:"friend",structureKind:"social"});result=buildLocalToCloudMigrationPreview(opts(data));assert(result.blockingConflicts.some(x=>x.code==="DUPLICATE_STRUCTURAL_LINK"));
}
// 13. Legacy data URL detection and metadata/crop preservation.
{
  const data=normal();data.profiles["char-a"].photos=[{id:"photo-a",source:{kind:"data-url",value:"data:image/png;base64,aGVsbG8="},crop:{x:.2,y:.3,zoom:2},caption:"портрет",pluginPhoto:{keep:true}}];data.profiles["char-a"].primaryPhotoId="photo-a";const result=buildLocalToCloudMigrationPreview(opts(data));assert.equal(result.imageUploads[0].classification,"legacy-data-url");assert.equal(result.imageUploads[0].estimatedBytes,5);assert.equal(result.imageUploads[0].crop.zoom,2);assert.deepEqual(result.imageUploads[0].metadata.pluginPhoto,{keep:true});assert(result.warnings.some(x=>x.code==="LEGACY_IMAGE_UPLOAD_REQUIRED"));
}
// 14. 3 MiB image limit and unsupported type are blockers.
{
  const data=normal();data.profiles["char-a"].photos=[{id:"large",source:{kind:"data-url",value:`data:image/png;base64,${"A".repeat(4*1024*1024+8)}`}}];let result=buildLocalToCloudMigrationPreview(opts(data));assert(result.blockingConflicts.some(x=>x.code==="IMAGE_TOO_LARGE"));data.profiles["char-a"].photos=[{id:"svg",source:{kind:"data-url",value:"data:image/svg+xml;base64,PHN2Zy8+"}}];result=buildLocalToCloudMigrationPreview(opts(data));assert(result.blockingConflicts.some(x=>x.code==="UNSUPPORTED_IMAGE_TYPE"));
}
// 15. A non-empty target cannot silently merge or replace.
{
  const result=buildLocalToCloudMigrationPreview(opts(empty(),{targetCloudState:{data:{scenes:[{id:"remote"}]}}}));assert.equal(result.target.empty,false);assert(result.blockingConflicts.some(x=>x.code==="TARGET_PROJECT_NOT_EMPTY"));
}
// 16. Revision is captured exactly.
assert.equal(buildLocalToCloudMigrationPreview(opts()).expectedProjectRevision,7);
// 17. Safe unknown fields survive in the execution plan.
{
  const data=normal();data.pluginProject={keep:true};const result=buildLocalToCloudMigrationPreview(opts(data,{characterDecisions:resolved,structuralLinkDecisions:{"link-a":"project"}}));assert.deepEqual(result.entityPlan.projectSource.pluginProject,{keep:true});assert.equal(result.entityPlan.scenes[0].source.pluginScene.keep,true);assert.equal(result.entityPlan.characters[0].profile.pluginProfile.keep,true);assert.equal(result.entityPlan.chapters[0].source.pluginChapter,true);
}
// 18. Preview performs no writes and is deterministic.
{
  const data=normal(),before=JSON.stringify(data);let writes=0;const storage={setItem(){writes++},removeItem(){writes++}};const first=buildLocalToCloudMigrationPreview({...opts(data),storage}),second=buildLocalToCloudMigrationPreview({...opts(data),storage});assert.equal(writes,0);assert.equal(JSON.stringify(data),before);assert.deepEqual(first.provenance,second.provenance);assert.equal(deterministicUuid("x","y"),deterministicUuid("x","y"));
}
// Strict invalid calendar/time and duplicate normalized tag names.
{
  const data=normal();data.scenes[0].date="2026-02-30";data.scenes[0].time="25:00";data.tags.push({id:"tag-b",name:"  ТАЙНА "});const result=buildLocalToCloudMigrationPreview(opts(data));assert(result.blockingConflicts.some(x=>x.code==="INVALID_SCENE_DATE"));assert(result.blockingConflicts.some(x=>x.code==="INVALID_SCENE_TIME"));assert(result.blockingConflicts.some(x=>x.code==="DUPLICATE_NORMALIZED_TAG_NAME"));
}

// 19. Location shortSummary/baseProfile survive into the entity plan (Location base_profile
// thematic-module contract, 20260904130000_location_base_profile_modules.sql) -- this plan layer
// does no allowlist filtering itself (that lives server-side in import_local_project_content), it
// only must not drop or rename these fields on the way through.
{
  const data=normal();
  data.locations[0].shortSummary="Founded after the war.";
  data.locations[0].baseProfile={appearanceAtmosphere:{visualDescription:"Stone walls"},geography:{terrain:"Hills"}};
  const result=buildLocalToCloudMigrationPreview(opts(data,{characterDecisions:resolved,structuralLinkDecisions:{"link-a":"project"}}));
  assert.equal(result.entityPlan.locations[0].shortSummary,"Founded after the war.");
  assert.deepEqual(result.entityPlan.locations[0].baseProfile,{appearanceAtmosphere:{visualDescription:"Stone walls"},geography:{terrain:"Hills"}});
}
// 20. A location with neither shortSummary nor baseProfile (every pre-B3A local snapshot) must
// still produce a well-formed entity (empty string / empty object, never throw/undefined).
{
  const result=buildLocalToCloudMigrationPreview(opts(normal(),{characterDecisions:resolved,structuralLinkDecisions:{"link-a":"project"}}));
  assert.equal(result.entityPlan.locations[0].shortSummary,"");
  assert.deepEqual(result.entityPlan.locations[0].baseProfile,{});
}

console.log("local to cloud migration preview tests passed");
