import assert from "node:assert/strict";
import {
  parseProjectJson,
  detectProjectVersion,
  validateProjectStructure,
  prepareProject,
  normalizeProject
} from "../js/migrations.js";
import {persistProject} from "../js/storage.js";

const baseV11=()=>({
  version:11,
  characters:[{id:"character-a",name:"Анна"}],
  profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",initialRelations:{}}},
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[{id:"location-a",name:"Дом"}],
  tags:[{id:"tag-a",name:"тест"}],
  future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
  scenes:[{id:"scene-a",title:"Сцена",date:"",time:"",chapterId:"chapter-unassigned",locationId:"location-a",tags:["tag-a"],people:{"character-a":{action:"",relationChanges:{},visibleRelations:[]}}}]
});

const invalidRoots=["", "null", "[]", "{}", '"text"', "42"];
for(const raw of invalidRoots){
  const parsed=parseProjectJson(raw);
  if(parsed.ok) assert.equal(validateProjectStructure(parsed.value).valid,false,`accepted ${raw}`);
}
assert.equal(parseProjectJson("{broken").ok,false);
assert.equal(detectProjectVersion({...baseV11(),version:99}).supported,false);

for(const collection of ["characters","scenes","chapters","locations","tags"]){
  const value=baseV11(); value[collection]={};
  assert.equal(validateProjectStructure(value).valid,false,`${collection} type`);
}

for(const collection of ["characters","scenes","chapters","locations","tags"]){
  const value=baseV11();
  value[collection]=[...value[collection],{...value[collection][0]}];
  const report=prepareProject(value);
  assert.equal(report.canApply,false,`duplicate ${collection} id`);
  assert.ok(report.conflicts.some(x=>x.type==="duplicate-id"));
}

{
  const value=baseV11();
  value.chapters.push({...value.chapters[0]});
  assert.equal(prepareProject(value).canApply,false);
}
for(const [field,bad] of [["chapterId","missing"],["locationId","missing"]]){
  const value=baseV11(); value.scenes[0][field]=bad;
  assert.equal(prepareProject(value).canApply,false,`dangling ${field}`);
}
{
  const value=baseV11(); value.scenes[0].tags=["missing"];
  assert.equal(prepareProject(value).canApply,false);
}
{
  const value=baseV11(); value.scenes[0].people={"missing":{action:"x"}};
  assert.equal(prepareProject(value).canApply,false);
}
{
  const value=baseV11();
  value.extraRoot={keep:true}; value.scenes[0].pluginScene=7; value.characters[0].pluginCharacter="yes";
  const roundTrip=normalizeProject(structuredClone(value));
  assert.deepEqual(roundTrip.extraRoot,{keep:true});
  assert.equal(roundTrip.scenes[0].pluginScene,7);
  assert.equal(roundTrip.characters[0].pluginCharacter,"yes");
}
{
  const v10={...baseV11(),version:10,characters:["Аня","Аня"],profiles:{},scenes:[{title:"x",people:{"Аня":{action:"x"}}}]};
  const report=prepareProject(v10);
  assert.equal(report.canApply,false);
  assert.ok(report.conflicts.some(x=>x.type==="ambiguous-character-name"));
}
{
  let stored=null;
  const storage={setItem(_key,value){stored=value}};
  const result=persistProject(baseV11(),{storage,key:"x"});
  assert.equal(result.ok,true); assert.ok(stored);
}
for(const name of ["QuotaExceededError","SecurityError"]){
  const storage={setItem(){const error=new Error("technical");error.name=name;throw error}};
  const result=persistProject(baseV11(),{storage,key:"x"});
  assert.equal(result.ok,false); assert.ok(result.userMessage); assert.equal(result.error.name,name);
}
{
  const cyclic=baseV11(); cyclic.self=cyclic;
  assert.equal(persistProject(cyclic,{storage:{setItem(){}},key:"x"}).ok,false);
}

console.log("data-safety unit tests: OK");
