import {WRITING_STATUSES} from "./constants.js";

const FORBIDDEN_KEYS=new Set(["__proto__","prototype","constructor"]);
const COLLECTIONS=["characters","profiles","chapters","locations","tags","scenes"];
const ID_COLLECTIONS=["characters","scenes","chapters","locations","tags"];

function makeId(prefix){
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

function safeOwnCopy(value){
  if(Array.isArray(value))return value.map(safeOwnCopy);
  if(!value||typeof value!=="object")return value;
  const result={};
  for(const key of Object.keys(value)){
    if(!FORBIDDEN_KEYS.has(key))result[key]=safeOwnCopy(value[key]);
  }
  return result;
}

function parseProjectJson(rawText){
  if(typeof rawText!=="string"||!rawText.trim())return {ok:false,error:{type:"syntax",message:"Файл проекта пуст."}};
  try{return {ok:true,value:JSON.parse(rawText)}}
  catch(error){return {ok:false,error:{type:"syntax",message:"JSON повреждён или имеет неверный синтаксис."}}}
}

function detectProjectVersion(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return {recognized:false,supported:false,version:null};
  if(value.version===11)return {recognized:true,supported:true,version:11};
  if(value.version===10)return {recognized:true,supported:true,version:10};
  if(Number.isFinite(value.version))return {recognized:true,supported:false,version:value.version};
  const v10Shape=Array.isArray(value.characters)&&value.characters.some(x=>typeof x==="string")&&Array.isArray(value.scenes);
  return v10Shape?{recognized:true,supported:true,version:10,inferred:true}:{recognized:false,supported:false,version:null};
}

function validateProjectStructure(value,{version}={}){
  const errors=[],warnings=[];
  const detected=detectProjectVersion(value);
  const sourceVersion=version??detected.version;
  if(!value||typeof value!=="object"||Array.isArray(value)){
    errors.push({code:"invalid-root",message:"Корень проекта должен быть объектом."});
    return {valid:false,errors,warnings,detectedVersion:sourceVersion,unknownFormat:true};
  }
  if(!detected.recognized)errors.push({code:"unknown-format",message:"Формат проекта не распознан."});
  else if(!detected.supported)errors.push({code:"unsupported-version",message:`Версия ${detected.version} не поддерживается.`});
  for(const key of COLLECTIONS){
    const expected=key==="profiles"?"object":"array";
    const valid=expected==="array"?Array.isArray(value[key]):value[key]&&typeof value[key]==="object"&&!Array.isArray(value[key]);
    if(!valid)errors.push({code:"invalid-collection",path:key,message:`Поле ${key} должно иметь тип ${expected}.`});
  }
  if(sourceVersion===11){
    for(const key of ID_COLLECTIONS){
      if(Array.isArray(value[key]))value[key].forEach((item,index)=>{
        if(!item||typeof item!=="object"||Array.isArray(item))errors.push({code:"invalid-entity",path:`${key}[${index}]`,message:"Элемент коллекции должен быть объектом."});
        else if(typeof item.id!=="string"||!item.id.trim())errors.push({code:"missing-id",path:`${key}[${index}].id`,message:"У сущности отсутствует устойчивый ID."});
      });
    }
  }
  return {valid:errors.length===0,errors,warnings,detectedVersion:sourceVersion,unknownFormat:!detected.recognized};
}

function duplicateConflicts(value){
  const conflicts=[];
  for(const collection of ID_COLLECTIONS){
    const seen=new Map();
    for(const [index,item] of (value[collection]||[]).entries()){
      const id=item?.id;
      if(!id)continue;
      if(seen.has(id))conflicts.push({type:"duplicate-id",collection,id,indexes:[seen.get(id),index],critical:true});
      else seen.set(id,index);
    }
  }
  const unassigned=(value.chapters||[]).filter(x=>x?.id==="chapter-unassigned");
  if(unassigned.length!==1)conflicts.push({type:"system-chapter-count",id:"chapter-unassigned",count:unassigned.length,critical:true});
  return conflicts;
}

function referenceConflicts(value){
  const conflicts=[],damagedReferences=[];
  const ids=name=>new Set((value[name]||[]).map(x=>x?.id));
  const characterIds=ids("characters"),chapterIds=ids("chapters"),locationIds=ids("locations"),tagIds=ids("tags");
  const add=(path,targetType,id)=>{
    const item={type:"dangling-reference",path,targetType,id,critical:true};
    conflicts.push(item);damagedReferences.push(item);
  };
  for(const [index,scene] of (value.scenes||[]).entries()){
    if(scene.chapterId&&!chapterIds.has(scene.chapterId))add(`scenes[${index}].chapterId`,"chapter",scene.chapterId);
    if(scene.locationId&&!locationIds.has(scene.locationId))add(`scenes[${index}].locationId`,"location",scene.locationId);
    for(const id of (scene.tags||scene.tagIds||[]))if(!tagIds.has(id))add(`scenes[${index}].tags`,"tag",id);
    for(const [from,person] of Object.entries(scene.people||{})){
      if(!characterIds.has(from)){add(`scenes[${index}].people.${from}`,"character",from);continue}
      for(const to of Object.keys(person?.relationChanges||{}))if(!characterIds.has(to))add(`scenes[${index}].people.${from}.relationChanges.${to}`,"character",to);
      for(const to of (person?.visibleRelations||[]))if(!characterIds.has(to))add(`scenes[${index}].people.${from}.visibleRelations`,"character",to);
    }
  }
  for(const [profileId,profile] of Object.entries(value.profiles||{})){
    if(!characterIds.has(profileId)&&!characterIds.has(profile?.characterId))add(`profiles.${profileId}`,"character",profileId);
    for(const to of Object.keys(profile?.initialRelations||{}))if(!characterIds.has(to))add(`profiles.${profileId}.initialRelations.${to}`,"character",to);
  }
  if(value.selectedSceneId&&!ids("scenes").has(value.selectedSceneId))add("selectedSceneId","scene",value.selectedSceneId);
  return {conflicts,damagedReferences};
}

function migrateProject(value,sourceVersion){
  const migratedData=safeOwnCopy(value);
  const report={migratedData,warnings:[],errors:[],performedSteps:[],conflicts:[],damagedReferences:[],fixedReferences:[]};
  if(sourceVersion===11)return report;
  if(sourceVersion!==10){
    report.errors.push({code:"unsupported-version",message:"Невозможно безопасно мигрировать эту версию."});
    return report;
  }
  const names=new Map();
  for(const [index,item] of migratedData.characters.entries()){
    const name=String(typeof item==="string"?item:item?.name||`Персонаж ${index+1}`);
    const key=name.toLocaleLowerCase("ru");
    const list=names.get(key)||[];list.push(index);names.set(key,list);
  }
  const referencedNames=new Set();
  Object.keys(migratedData.profiles||{}).forEach(x=>referencedNames.add(x.toLocaleLowerCase("ru")));
  for(const scene of migratedData.scenes){
    Object.entries(scene.people||{}).forEach(([from,p])=>{
      referencedNames.add(from.toLocaleLowerCase("ru"));
      Object.keys(p?.relationChanges||{}).forEach(x=>referencedNames.add(x.toLocaleLowerCase("ru")));
      (p?.visibleRelations||[]).forEach(x=>referencedNames.add(String(x).toLocaleLowerCase("ru")));
    });
  }
  for(const [name,indexes] of names)if(indexes.length>1&&referencedNames.has(name)){
    report.conflicts.push({type:"ambiguous-character-name",name,indexes,critical:true});
  }
  if(report.conflicts.length)return report;

  const byName=new Map();
  migratedData.characters=migratedData.characters.map((item,index)=>{
    const source=typeof item==="object"&&item?safeOwnCopy(item):{};
    const name=String(typeof item==="string"?item:item?.name||`Персонаж ${index+1}`);
    const id=source.id||makeId("character");byName.set(name.toLocaleLowerCase("ru"),id);
    return {...source,id,name};
  });
  const resolve=value=>migratedData.characters.some(x=>x.id===value)?value:byName.get(String(value||"").toLocaleLowerCase("ru"));
  const profiles={};
  for(const character of migratedData.characters){
    const source=migratedData.profiles?.[character.id]||migratedData.profiles?.[character.name]||{};
    const initialRelations={};
    for(const [target,text] of Object.entries(source.initialRelations||{})){
      const id=resolve(target);if(id&&id!==character.id)initialRelations[id]=text;
    }
    profiles[character.id]={...safeOwnCopy(source),id:character.id,characterId:character.id,name:source.name||character.name,initialRelations};
  }
  migratedData.profiles=profiles;
  migratedData.scenes=migratedData.scenes.map(scene=>{
    const people={};
    for(const [from,p] of Object.entries(scene.people||{})){
      const fromId=resolve(from);if(!fromId)continue;
      const relationChanges={};
      for(const [to,text] of Object.entries(p?.relationChanges||{})){const toId=resolve(to);if(toId&&toId!==fromId)relationChanges[toId]=text}
      people[fromId]={...safeOwnCopy(p),relationChanges,visibleRelations:(p?.visibleRelations||[]).map(resolve).filter(Boolean)};
    }
    return {...safeOwnCopy(scene),id:scene.id||makeId("scene"),people};
  });
  for(const collection of ["chapters","locations","tags"]){
    const prefix=collection.slice(0,-1);
    migratedData[collection]=migratedData[collection].map(item=>({...safeOwnCopy(item),id:item.id||makeId(prefix)}));
  }
  migratedData.version=11;
  report.performedSteps.push("V10→V11: устойчивые ID персонажей и сцен, ссылки по именам заменены ссылками по ID");
  return report;
}

function canonicalTagName(name){return String(name||"").trim().replace(/^#+/,"").replace(/\s+/g," ")}
function normalizeChapters(chapters){
  return chapters.map((c,i)=>({...safeOwnCopy(c),id:String(c.id),title:String(c.title||`Глава ${i+1}`),collapsed:!!c.collapsed}));
}
function normalizeLocations(locations){
  return locations.map(l=>({...safeOwnCopy(l),id:String(l.id),name:String(l.name||"Локация"),description:String(l.description||"")}));
}
function normalizeTags(tags){
  return tags.map(t=>({...safeOwnCopy(t),id:String(t.id),name:canonicalTagName(t.name)}));
}
function emptyProfile(characterId="",name=""){
  return {id:characterId,characterId,name,surname:"",photos:[],race:"",sex:"",secondarySex:"",age:"",birthday:{year:"",month:"",day:""},zodiac:"",height:"",build:"",profession:"",orientation:"",favorites:"",hobbies:"",character:"",features:"",description:"",hidden:{},initialRelations:{}};
}
function normalizeProfile(profile,character){
  const p=safeOwnCopy(profile||{}),base=emptyProfile(character.id,character.name);
  return {...base,...p,id:p.id||character.id,characterId:character.id,name:p.name||character.name,photos:Array.isArray(p.photos)?p.photos:[],birthday:{...base.birthday,...safeOwnCopy(p.birthday||{})},hidden:safeOwnCopy(p.hidden||{}),initialRelations:safeOwnCopy(p.initialRelations||{})};
}
function normalizeProject(value){
  const src=safeOwnCopy(value);
  const characters=src.characters.map((item,index)=>({...safeOwnCopy(item),id:String(item.id),name:String(item.name||`Персонаж ${index+1}`)}));
  const profiles={};
  for(const character of characters)profiles[character.id]=normalizeProfile(src.profiles[character.id],character);
  const scenes=src.scenes.map(scene=>({...safeOwnCopy(scene),id:String(scene.id),date:String(scene.date||""),time:String(scene.time||""),title:String(scene.title||""),chapterId:scene.chapterId||"chapter-unassigned",locationId:scene.locationId||"",tags:[...new Set(scene.tags||scene.tagIds||[])],writingStatus:WRITING_STATUSES.some(x=>x.id===scene.writingStatus)?scene.writingStatus:"idea",sceneText:String(scene.sceneText??scene.text??""),included:scene.included!==false,status:scene.status==="fixed"?"fixed":"floating",dateReview:!!scene.dateReview,people:safeOwnCopy(scene.people||{})}));
  return {...src,version:11,characters,profiles,chapters:normalizeChapters(src.chapters),locations:normalizeLocations(src.locations),tags:normalizeTags(src.tags),future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[],...safeOwnCopy(src.future||{})},scenes};
}
const normalizeData=normalizeProject;

function prepareProject(value){
  const detected=detectProjectVersion(value);
  const validation=validateProjectStructure(value,{version:detected.version});
  const report={sourceVersion:detected.version,targetVersion:11,performedSteps:[],warnings:[...validation.warnings],errors:[...validation.errors],conflicts:[],nameConflicts:[],damagedReferences:[],fixedReferences:[],unknownFieldsPreserved:true,canApply:false,migratedData:null};
  if(!validation.valid)return report;
  const migration=migrateProject(value,detected.version);
  Object.assign(report,{performedSteps:migration.performedSteps,warnings:[...report.warnings,...migration.warnings],errors:[...report.errors,...migration.errors],conflicts:[...migration.conflicts],migratedData:migration.migratedData});
  report.nameConflicts=report.conflicts.filter(x=>x.type==="ambiguous-character-name");
  if(report.errors.length||report.conflicts.some(x=>x.critical))return report;
  report.conflicts.push(...duplicateConflicts(report.migratedData));
  const references=referenceConflicts(report.migratedData);
  report.conflicts.push(...references.conflicts);report.damagedReferences=references.damagedReferences;
  if(report.conflicts.some(x=>x.critical))return report;
  report.migratedData=normalizeProject(report.migratedData);
  report.canApply=true;
  return report;
}

function defaultData(){
  return {version:11,characters:[{id:makeId("character"),name:"Рене"},{id:makeId("character"),name:"Зейн"},{id:makeId("character"),name:"Реми"},{id:makeId("character"),name:"Арман"}],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},scenes:[]};
}

Object.assign(globalThis,{makeId,safeOwnCopy,parseProjectJson,detectProjectVersion,validateProjectStructure,migrateProject,normalizeProject,prepareProject,normalizeChapters,normalizeLocations,canonicalTagName,normalizeTags,defaultData,emptyProfile,normalizeProfile,normalizeData});
export {makeId,safeOwnCopy,parseProjectJson,detectProjectVersion,validateProjectStructure,migrateProject,normalizeProject,prepareProject,normalizeChapters,normalizeLocations,canonicalTagName,normalizeTags,defaultData,emptyProfile,normalizeProfile,normalizeData};
