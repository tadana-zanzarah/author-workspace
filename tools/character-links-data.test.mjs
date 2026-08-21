import assert from "node:assert/strict";
import {prepareProject,normalizeProject} from "../js/migrations.js";
import {normalizeCharacterLink,characterLinkLabel,isDuplicateCharacterLink,removeCharacterLinksForCharacter} from "../js/character-links.js";

const base=()=>({version:11,characters:[{id:"character-a",name:"Анна"},{id:"character-b",name:"Борис"}],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",initialRelations:{}},"character-b":{id:"character-b",characterId:"character-b",name:"Борис",initialRelations:{}}},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]});
const motherSon={id:"character-link-1",fromCharacterId:"character-a",toCharacterId:"character-b",category:"family",type:"mother",reverseType:"son",customLabel:"",reverseCustomLabel:"",notes:"",metadata:{plugin:{keep:true}}};

assert.deepEqual(normalizeProject(base()).characterLinks,[],"old projects receive additive empty collection");
{
  const project=base();project.characterLinks=[motherSon];const normalized=normalizeProject(project);
  assert.equal(normalized.characterLinks[0].id,motherSon.id,"stable ID survives normalization");
  assert.deepEqual(normalized.characterLinks[0].metadata,{plugin:{keep:true}},"unknown safe metadata survives");
  assert.equal(characterLinkLabel(normalized.characterLinks[0],"character-a"),"mother");
  assert.equal(characterLinkLabel(normalized.characterLinks[0],"character-b"),"son");
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(normalized))).characterLinks,normalized.characterLinks,"export/import round-trip");
}
for(const [name,change] of [
  ["self",{toCharacterId:"character-a"}],
  ["dangling source",{fromCharacterId:"missing"}],
  ["dangling target",{toCharacterId:"missing"}],
  ["unknown type",{type:"invented"}],
  ["empty custom",{type:"custom",customLabel:""}],
  ["unknown category",{category:"invented"}],
  ["missing id",{id:""}]
]){
  const project=base();project.characterLinks=[{...motherSon,...change}];
  assert.equal(prepareProject(project).canApply,false,name);
}
{
  const symmetric=normalizeCharacterLink({...motherSon,type:"partner",reverseType:"partner",category:"marriage"});
  assert.equal(characterLinkLabel(symmetric,"character-a"),"partner");assert.equal(characterLinkLabel(symmetric,"character-b"),"partner");
}
{
  const custom=normalizeCharacterLink({...motherSon,type:"custom",reverseType:"custom",customLabel:"крёстный",reverseCustomLabel:"крестник",category:"other"});
  assert.equal(characterLinkLabel(custom,"character-a"),"крёстный");assert.equal(characterLinkLabel(custom,"character-b"),"крестник");
}
{
  const reversed={...motherSon,id:"character-link-2",fromCharacterId:"character-b",toCharacterId:"character-a",type:"son",reverseType:"mother"};
  assert.equal(isDuplicateCharacterLink(reversed,[motherSon]),true,"reversed semantic duplicate detected");
  const guardian={...motherSon,id:"character-link-3",category:"guardianship",type:"guardian",reverseType:"ward"};
  assert.equal(isDuplicateCharacterLink(guardian,[motherSon]),false,"different links for same pair allowed");
  const project=base();project.characterLinks=[motherSon,guardian];removeCharacterLinksForCharacter(project,"character-b");assert.deepEqual(project.characterLinks,[],"character deletion cleanup");
}
{
  const project=base();project.characterLinks=[motherSon,{...motherSon,id:"character-link-2",fromCharacterId:"character-b",toCharacterId:"character-a",type:"son",reverseType:"mother"}];
  assert.equal(prepareProject(project).canApply,false,"duplicate links blocked in validation report");
}

console.log("character links data tests: OK");
