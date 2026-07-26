function makeId(prefix){
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

function normalizeChapters(chapters){
  const list=Array.isArray(chapters)&&chapters.length?chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}];
  const result=list.map((c,i)=>({
    id:c.id||makeId("chapter"),
    title:String(c.title||`Глава ${i+1}`),
    collapsed:!!c.collapsed
  }));
  if(!result.some(c=>c.id==="chapter-unassigned"))result.unshift({id:"chapter-unassigned",title:"Без главы",collapsed:false});
  return result;
}

function normalizeLocations(locations){
  return (Array.isArray(locations)?locations:[]).map(l=>({
    id:l.id||makeId("location"),name:String(l.name||"Локация"),description:String(l.description||"")
  }));
}

function canonicalTagName(name){
  return String(name||"").trim().replace(/^#+/,"").replace(/\s+/g," ");
}

function normalizeTags(tags,scenes){
  const result=[];
  const seen=new Set();
  (Array.isArray(tags)?tags:[]).forEach(t=>{
    const name=canonicalTagName(typeof t==="string"?t:t.name);
    const key=name.toLocaleLowerCase("ru");
    if(name&&!seen.has(key)){seen.add(key);result.push({id:(typeof t==="object"&&t.id)||makeId("tag"),name})}
  });
  return result;
}

function defaultData(){
  return {
    version:11,
    characters:[
      {id:makeId("character"),name:"Рене"},
      {id:makeId("character"),name:"Зейн"},
      {id:makeId("character"),name:"Реми"},
      {id:makeId("character"),name:"Арман"}
    ],
    profiles:{},
    chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
    locations:[],
    tags:[],
    future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
    scenes:[]
  };
}

function emptyProfile(characterId="",name=""){
  return {
    id:characterId,
    characterId,
    name,
    surname:"",
    photos:[],
    race:"",
    sex:"",
    secondarySex:"",
    age:"",
    birthday:{year:"",month:"",day:""},
    zodiac:"",
    height:"",
    build:"",
    profession:"",
    orientation:"",
    favorites:"",
    hobbies:"",
    character:"",
    features:"",
    description:"",
    hidden:{},
    initialRelations:{}
  };
}

function normalizeProfile(profile,character){
  const base=emptyProfile(character.id,character.name);
  const p=profile||{};
  return {
    ...base,
    ...p,
    id:p.id||character.id,
    characterId:character.id,
    name:p.name||character.name,
    photos:Array.isArray(p.photos)?p.photos:[],
    birthday:{...base.birthday,...(p.birthday||{})},
    hidden:{...(p.hidden||{})},
    initialRelations:{...(p.initialRelations||{})}
  };
}

function normalizeData(raw){
  const src=raw&&Array.isArray(raw.characters)&&Array.isArray(raw.scenes)?raw:defaultData();

  const usedCharacterIds=new Set();
  const characters=(src.characters||[]).map((item,index)=>{
    const oldName=typeof item==="string"?item:String(item?.name||`Персонаж ${index+1}`);
    let id=typeof item==="object"&&item?.id?String(item.id):makeId("character");
    while(usedCharacterIds.has(id))id=makeId("character");
    usedCharacterIds.add(id);
    return {id,name:oldName};
  });
  if(!characters.length){
    const c={id:makeId("character"),name:"Новый персонаж"};
    characters.push(c);
  }

  const characterIdSet=new Set(characters.map(c=>c.id));
  const nameToId=new Map();
  characters.forEach(c=>nameToId.set(c.name.toLocaleLowerCase("ru"),c.id));
  const resolveCharacterId=value=>{
    if(characterIdSet.has(value))return value;
    return nameToId.get(String(value||"").toLocaleLowerCase("ru"))||null;
  };

  const sourceProfiles=src.profiles||{};
  const profiles={};
  characters.forEach(character=>{
    const oldProfile=sourceProfiles[character.id]||sourceProfiles[character.name]||
      Object.values(sourceProfiles).find(p=>p?.characterId===character.id||p?.name===character.name);
    const profile=normalizeProfile(oldProfile,character);
    const initial={};
    for(const [rawTarget,value] of Object.entries(oldProfile?.initialRelations||{})){
      const targetId=resolveCharacterId(rawTarget);
      if(targetId&&targetId!==character.id)initial[targetId]=value;
    }
    profile.initialRelations=initial;
    profiles[character.id]=profile;
  });

  const chapters=normalizeChapters(src.chapters);
  const locations=normalizeLocations(src.locations);
  const tags=normalizeTags(src.tags,src.scenes);
  const tagByName=new Map(tags.map(t=>[t.name.toLocaleLowerCase("ru"),t.id]));
  const chapterIds=new Set(chapters.map(c=>c.id));
  const locationIds=new Set(locations.map(l=>l.id));

  const scenes=src.scenes.map(scene=>{
    const normalizedTags=[];
    for(const rawTag of (Array.isArray(scene.tags)?scene.tags:[])){
      const existingById=tags.find(t=>t.id===rawTag);
      if(existingById){normalizedTags.push(existingById.id);continue}
      const name=canonicalTagName(rawTag);
      if(!name)continue;
      const key=name.toLocaleLowerCase("ru");
      let id=tagByName.get(key);
      if(!id){id=makeId("tag");tags.push({id,name});tagByName.set(key,id)}
      normalizedTags.push(id);
    }

    const people={};
    for(const [rawFrom,p] of Object.entries(scene.people||{})){
      const fromId=resolveCharacterId(rawFrom);
      if(!fromId)continue;
      const changes={};
      for(const [rawTo,value] of Object.entries(p?.relationChanges||{})){
        const toId=resolveCharacterId(rawTo);
        if(toId&&toId!==fromId)changes[toId]=value;
      }
      const visible=(Array.isArray(p?.visibleRelations)?p.visibleRelations:[])
        .map(resolveCharacterId).filter(id=>id&&id!==fromId);
      people[fromId]={
        action:p?.action||"",
        relationChanges:changes,
        visibleRelations:[...new Set(visible)],
        legacyState:p?.legacyState||((p?.state||p?.feelings||"").trim())
      };
    }

    return {
      id:scene.id||makeId("scene"),
      date:scene.date||"",
      time:scene.time||"",
      title:scene.title||"",
      chapterId:chapterIds.has(scene.chapterId)?scene.chapterId:"chapter-unassigned",
      locationId:locationIds.has(scene.locationId)?scene.locationId:"",
      tags:[...new Set(normalizedTags)],
      writingStatus:WRITING_STATUSES.some(x=>x.id===scene.writingStatus)?scene.writingStatus:"idea",
      sceneText:scene.sceneText||scene.text||"",
      included:scene.included!==false,
      status:scene.status==="fixed"?"fixed":"floating",
      dateReview:!!scene.dateReview,
      people
    };
  });

  return {
    version:11,
    characters,
    profiles,
    chapters,locations,tags,
    future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[],...(src.future||{})},
    scenes
  };
}

Object.assign(globalThis,{makeId,normalizeChapters,normalizeLocations,canonicalTagName,normalizeTags,defaultData,emptyProfile,normalizeProfile,normalizeData});
export {makeId,normalizeChapters,normalizeLocations,canonicalTagName,normalizeTags,defaultData,emptyProfile,normalizeProfile,normalizeData};
