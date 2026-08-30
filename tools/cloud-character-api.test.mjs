import assert from "node:assert/strict";
import {createCloudCharacterApi,normalizeCharacterResult} from "../js/cloud-character-api.js";

assert.equal(normalizeCharacterResult({data:{ok:false,code:"CHARACTER_REVISION_CONFLICT",expectedRevision:2,actualRevision:3,entityId:"c"}}).code,"CHARACTER_REVISION_CONFLICT");
assert.doesNotMatch(normalizeCharacterResult({error:{message:"private sql detail"}}).message,/sql|private/i);
const calls=[];
const api=createCloudCharacterApi({async rpc(name,args){calls.push({name,args});return {data:{ok:true,revision:4,changed:true,data:{}},error:null}}});
await api.createCharacter({name:"Ada",surname:"L",baseProfile:{favorites:["x"],hobbies:["y"]}});
assert.deepEqual(calls.pop(),{name:"create_character",args:{character_name:"Ada",character_surname:"L",base_profile:{favorites:["x"],hobbies:["y"]}}});
await api.setSceneCharacters("p","s",3,[{projectCharacterId:"pc",action:"A",legacyState:null,sortOrder:1}]);
assert.equal(calls.pop().args.participants[0].project_character_id,"pc");
await api.removeProjectCharacter("p","pc",4,{cleanupDependencies:true});
assert.equal(calls.pop().args.cleanup_dependencies,true);

// Character-order regression: attach/create must forward an explicit sortOrder end-of-list
// value. Omitting it silently defaults to 0 server-side, which collapses every project
// character onto the same sort_order and leaves display order to fall back on row UUID.
await api.attachProjectCharacter("p","char-1",5,{sortOrder:3500});
assert.equal(calls.pop().args.character_sort_order,3500,"attachProjectCharacter forwards the computed end-of-list sortOrder");
await api.attachProjectCharacter("p","char-1",5,{});
assert.equal(calls.pop().args.character_sort_order,0,"omitting sortOrder still defaults to 0 (caller is responsible for always passing one)");
await api.createCharacterAndAttach("p",5,{name:"Ada",surname:"",baseProfile:{}},{sortOrder:1000});
assert.equal(calls.pop().args.character_sort_order,1000,"createCharacterAndAttach forwards the computed end-of-list sortOrder");

console.log("cloud character api tests: OK");
