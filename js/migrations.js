import {WRITING_STATUSES} from "./constants.js";
import {validateDateString,validateTimeString} from "./dates.js";

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
      if(seen.has(id))conflicts.push({type:"duplicate-id",collection,id,indexes:[seen.get(id),index],critical:true,resolution:"unrecoverable",message:`В коллекции «${collection}» повторяется ID ${id}. Безопасное автоматическое исправление невозможно.`});
      else seen.set(id,index);
    }
  }
  const unassigned=(value.chapters||[]).filter(x=>x?.id==="chapter-unassigned");
  if(unassigned.length!==1)conflicts.push({type:"system-chapter-count",id:"chapter-unassigned",count:unassigned.length,critical:true,resolution:"unrecoverable",message:"Системная глава «Без главы» отсутствует или повторяется. Миграция заблокирована."});
  return conflicts;
}

function referenceConflicts(value,{confirmations={},characterTargets={}}={}){
  const conflicts=[],damagedReferences=[];
  const ids=name=>new Set((value[name]||[]).map(x=>x?.id));
  const characterIds=ids("characters"),chapterIds=ids("chapters"),locationIds=ids("locations"),tagIds=ids("tags");
  const add=(path,targetType,id,resolution="unrecoverable")=>{
    const labels={chapter:"Некоторые сцены ссылаются на удалённую главу",location:"Некоторые сцены ссылаются на удалённую локацию",tag:"Некоторые сцены содержат удалённый тег",character:"Найдена ссылка на неизвестного персонажа",scene:"Выбранная сцена больше не существует"};
    const item={type:"dangling-reference",path,targetType,id,critical:true,resolution,message:`${labels[targetType]||"Найдена повреждённая ссылка"}: ${id}.`};
    conflicts.push(item);damagedReferences.push(item);
  };
  for(const [index,scene] of (value.scenes||[]).entries()){
    const chapterPath=`scenes[${index}].chapterId`;
    if(scene.chapterId&&!chapterIds.has(scene.chapterId)){if(confirmations[chapterPath]){scene.chapterId="chapter-unassigned"}else add(chapterPath,"chapter",scene.chapterId,"confirmation")}
    const locationPath=`scenes[${index}].locationId`;
    if(scene.locationId&&!locationIds.has(scene.locationId)){if(confirmations[locationPath]){scene.locationId=""}else add(locationPath,"location",scene.locationId,"confirmation")}
    for(const id of [...(scene.tags||scene.tagIds||[])])if(!tagIds.has(id)){const path=`scenes[${index}].tags.${id}`;if(confirmations[path])scene.tags=(scene.tags||[]).filter(tag=>tag!==id);else add(path,"tag",id,"confirmation")}
    for(const [from,person] of Object.entries(scene.people||{})){
      if(!characterIds.has(from)){add(`scenes[${index}].people.${from}`,"character",from,characterTargets[`scenes[${index}].people.${from}`]?"manual":"unrecoverable");continue}
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

function v10CharacterId(item,index,used){
  const preferred=typeof item==="object"&&item&&typeof item.id==="string"&&item.id.trim()?item.id.trim():`character-v10-${index+1}`;
  let id=preferred,n=2;while(used.has(id))id=`${preferred}-${n++}`;used.add(id);return id;
}

function collectAmbiguousReferences(project,names,candidatesByName){
  const groups=new Map();
  const add=(name,path,label)=>{
    const key=String(name||"").toLocaleLowerCase("ru");
    if((names.get(key)||[]).length<2)return;
    if(!groups.has(key))groups.set(key,{type:"ambiguous-character-name",name:String(name),critical:true,resolution:"manual",candidates:candidatesByName.get(key),references:[]});
    groups.get(key).references.push({path,label});
  };
  for(const [name,profile] of Object.entries(project.profiles||{})){
    add(name,`profiles.${name}`,`Анкета «${name}»`);
    Object.keys(profile?.initialRelations||{}).forEach(target=>add(target,`profiles.${name}.initialRelations.${target}`,`Анкета «${name}»: исходное отношение`));
  }
  (project.scenes||[]).forEach((scene,sceneIndex)=>Object.entries(scene.people||{}).forEach(([from,person])=>{
    add(from,`scenes[${sceneIndex}].people.${from}`,`Сцена «${scene.title||sceneIndex+1}»: участие персонажа`);
    Object.keys(person?.relationChanges||{}).forEach(to=>add(to,`scenes[${sceneIndex}].people.${from}.relationChanges.${to}`,`Сцена «${scene.title||sceneIndex+1}»: изменение отношения`));
    (person?.visibleRelations||[]).forEach((to,index)=>add(to,`scenes[${sceneIndex}].people.${from}.visibleRelations[${index}]`,`Сцена «${scene.title||sceneIndex+1}»: видимое отношение`));
  }));
  return [...groups.values()];
}

function migrateProject(value,sourceVersion,{characterResolutions={}}={}){
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
  const usedIds=new Set(),candidatesByName=new Map();
  migratedData.characters=migratedData.characters.map((item,index)=>{
    const source=typeof item==="object"&&item?safeOwnCopy(item):{};
    const name=String(typeof item==="string"?item:item?.name||`Персонаж ${index+1}`);
    const id=v10CharacterId(item,index,usedIds),key=name.toLocaleLowerCase("ru");
    const list=candidatesByName.get(key)||[];list.push({id,name,surname:source.surname||migratedData.profiles?.[name]?.surname||"",description:source.description||migratedData.profiles?.[name]?.description||""});candidatesByName.set(key,list);
    return {...source,id,name};
  });
  const ambiguous=collectAmbiguousReferences(value,names,candidatesByName);
  const unresolved=ambiguous.map(group=>({...group,references:group.references.filter(ref=>!group.candidates.some(c=>c.id===characterResolutions[ref.path]))})).filter(group=>group.references.length);
  if(unresolved.length){report.conflicts.push(...unresolved);return report}
  const byName=new Map([...candidatesByName].filter(([,items])=>items.length===1).map(([name,items])=>[name,items[0].id]));
  const resolve=(value,path)=>migratedData.characters.some(x=>x.id===value)?value:(characterResolutions[path]||byName.get(String(value||"").toLocaleLowerCase("ru")));
  const profiles={};
  for(const character of migratedData.characters){
    const namedProfile=migratedData.profiles?.[character.name],profileOwner=characterResolutions[`profiles.${character.name}`];
    const source=migratedData.profiles?.[character.id]||(!profileOwner||profileOwner===character.id?namedProfile:null)||{};
    const initialRelations={};
    for(const [target,text] of Object.entries(source.initialRelations||{})){
      const id=resolve(target,`profiles.${character.name}.initialRelations.${target}`);if(id&&id!==character.id)initialRelations[id]=text;
    }
    profiles[character.id]={...safeOwnCopy(source),id:character.id,characterId:character.id,name:source.name||character.name,initialRelations};
  }
  migratedData.profiles=profiles;
  migratedData.scenes=migratedData.scenes.map(scene=>{
    const people={};
    const sceneIndex=migratedData.scenes.indexOf(scene);
    for(const [from,p] of Object.entries(scene.people||{})){
      const base=`scenes[${sceneIndex}].people.${from}`,fromId=resolve(from,base);if(!fromId)continue;
      const relationChanges={};
      for(const [to,text] of Object.entries(p?.relationChanges||{})){const toId=resolve(to,`${base}.relationChanges.${to}`);if(toId&&toId!==fromId)relationChanges[toId]=text}
      people[fromId]={...safeOwnCopy(p),relationChanges,visibleRelations:(p?.visibleRelations||[]).map((to,index)=>resolve(to,`${base}.visibleRelations[${index}]`)).filter(Boolean)};
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
function normalizeMultiValue(value){
  const source=Array.isArray(value)?value:(typeof value==="string"?(value.includes(",")?value.split(","):[value]):[]);
  const seen=new Set(),result=[];
  for(const item of source){
    const text=String(item??"").trim();if(!text)continue;
    const key=text.toLocaleLowerCase("ru");if(seen.has(key))continue;
    seen.add(key);result.push(text);
  }
  return result;
}
function stablePhotoId(characterId,index,value){
  const text=`${characterId}|${index}|${value||""}`;let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return `photo-${(hash>>>0).toString(36)}`;
}
function normalizeCrop(value){
  const crop=value&&typeof value==="object"?value:{};
  const finite=(candidate,fallback)=>Number.isFinite(Number(candidate))?Number(candidate):fallback;
  return {x:Math.max(0,Math.min(1,finite(crop.x,.5))),y:Math.max(0,Math.min(1,finite(crop.y,.5))),zoom:Math.max(1,Math.min(4,finite(crop.zoom,1)))};
}
function normalizePhoto(value,characterId="",index=0){
  const legacy=typeof value==="string",photo=legacy?{}:safeOwnCopy(value&&typeof value==="object"?value:{});
  let source;
  if(legacy)source={kind:"data-url",value};
  else if(photo.source&&typeof photo.source==="object")source={...safeOwnCopy(photo.source),kind:String(photo.source.kind||"data-url"),value:String(photo.source.value||"")};
  else source={kind:"data-url",value:String(photo.src||photo.value||"")};
  const id=typeof photo.id==="string"&&photo.id.trim()?photo.id:stablePhotoId(characterId,index,source.value);
  const result={...photo,id,source,crop:normalizeCrop(photo.crop),alt:String(photo.alt||""),caption:String(photo.caption||"")};
  return result;
}
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
  return {id:characterId,characterId,name,surname:"",photos:[],race:"",sex:"",secondarySex:"",age:"",birthday:{year:"",month:"",day:""},zodiac:"",height:"",build:"",profession:"",orientation:"",favorites:[],hobbies:[],character:"",features:"",description:"",hidden:{},initialRelations:{}};
}
function normalizeProfile(profile,character){
  const p=safeOwnCopy(profile||{}),base=emptyProfile(character.id,character.name);
  const photos=(Array.isArray(p.photos)?p.photos:[]).map((photo,index)=>normalizePhoto(photo,character.id,index)).filter(photo=>photo.source.value);
  const primaryPhotoId=photos.some(photo=>photo.id===p.primaryPhotoId)?p.primaryPhotoId:(photos[0]?.id||"");
  return {...base,...p,id:p.id||character.id,characterId:character.id,name:p.name||character.name,photos,primaryPhotoId,favorites:normalizeMultiValue(p.favorites),hobbies:normalizeMultiValue(p.hobbies),birthday:{...base.birthday,...safeOwnCopy(p.birthday||{})},hidden:safeOwnCopy(p.hidden||{}),initialRelations:safeOwnCopy(p.initialRelations||{})};
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

function classifyReportConflicts(report){
  report.autoConflicts=report.conflicts.filter(x=>x.resolution==="automatic");
  report.confirmationConflicts=report.conflicts.filter(x=>x.resolution==="confirmation");
  report.manualConflicts=report.conflicts.filter(x=>x.resolution==="manual"||x.type==="ambiguous-character-name");
  report.unrecoverableConflicts=report.conflicts.filter(x=>x.resolution==="unrecoverable");
  return report;
}

function prepareProject(value,options={}){
  const detected=detectProjectVersion(value);
  const validation=validateProjectStructure(value,{version:detected.version});
  const report={sourceVersion:detected.version,targetVersion:11,performedSteps:[],warnings:[...validation.warnings],errors:[...validation.errors],conflicts:[],nameConflicts:[],damagedReferences:[],fixedReferences:[],unknownFieldsPreserved:true,canApply:false,migratedData:null};
  if(!validation.valid)return report;
  const migration=migrateProject(value,detected.version,options);
  Object.assign(report,{performedSteps:migration.performedSteps,warnings:[...report.warnings,...migration.warnings],errors:[...report.errors,...migration.errors],conflicts:[...migration.conflicts],migratedData:migration.migratedData});
  report.nameConflicts=report.conflicts.filter(x=>x.type==="ambiguous-character-name");
  classifyReportConflicts(report);
  if(report.errors.length||report.conflicts.some(x=>x.critical))return report;
  report.conflicts.push(...duplicateConflicts(report.migratedData));
  const references=referenceConflicts(report.migratedData,options);
  report.conflicts.push(...references.conflicts);report.damagedReferences=references.damagedReferences;
  classifyReportConflicts(report);
  if(report.conflicts.some(x=>x.critical))return report;
  report.migratedData=normalizeProject(report.migratedData);
  report.migratedData.scenes.forEach((scene,index)=>{
    if(scene.date&&!validateDateString(scene.date)){
      scene.dateReview=true;report.warnings.push({code:"invalid-scene-date",path:`scenes[${index}].date`,message:`Сцена «${scene.title||index+1}»: дата требует ручной проверки.`});
    }
    if(scene.time&&!validateTimeString(scene.time)){
      scene.dateReview=true;report.warnings.push({code:"invalid-scene-time",path:`scenes[${index}].time`,message:`Сцена «${scene.title||index+1}»: время требует ручной проверки.`});
    }
  });
  report.canApply=true;
  return report;
}

function defaultData(){
  return {version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},scenes:[]};
}

Object.assign(globalThis,{makeId,safeOwnCopy,parseProjectJson,detectProjectVersion,validateProjectStructure,migrateProject,normalizeProject,prepareProject,normalizeChapters,normalizeLocations,canonicalTagName,normalizeTags,normalizeMultiValue,normalizeCrop,normalizePhoto,defaultData,emptyProfile,normalizeProfile,normalizeData});
export {makeId,safeOwnCopy,parseProjectJson,detectProjectVersion,validateProjectStructure,migrateProject,normalizeProject,prepareProject,normalizeChapters,normalizeLocations,canonicalTagName,normalizeTags,normalizeMultiValue,normalizeCrop,normalizePhoto,defaultData,emptyProfile,normalizeProfile,normalizeData};
