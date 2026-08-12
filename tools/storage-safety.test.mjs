import assert from "node:assert/strict";
import {loadProjectFromStorage,commitProjectChange} from "../js/storage.js";

const good={version:11,characters:[{id:"c",name:"C"}],profiles:{c:{id:"c",characterId:"c",name:"C",initialRelations:{}}},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]};
const memoryStorage=entries=>({
  values:new Map(Object.entries(entries)),
  getItem(key){return this.values.has(key)?this.values.get(key):null},
  setItem(key,value){this.values.set(key,value)}
});

{
  const storage=memoryStorage({});
  const loaded=loadProjectFromStorage({storage});
  assert.equal(loaded.ok,true);
  assert.equal(loaded.fresh,true);
  assert.deepEqual(loaded.data.characters,[]);
  assert.deepEqual(loaded.data.scenes,[]);
}
{
  const storage=memoryStorage({novelTimelineV11:JSON.stringify(good)});
  const loaded=loadProjectFromStorage({storage});
  assert.equal(loaded.ok,true);
  assert.equal(loaded.source,"novelTimelineV11");
  assert.deepEqual(loaded.data.characters,good.characters);
}
{
  const storage=memoryStorage({novelTimelineV10:JSON.stringify({...good,version:10,characters:["C"],profiles:{}})});
  const loaded=loadProjectFromStorage({storage});
  assert.equal(loaded.ok,false);
  assert.equal(loaded.recoveryRequired,true);
  assert.equal(loaded.candidates[0].version,10);
}
{
  const storage=memoryStorage({novelTimelineV11:"{}"});
  const before=storage.getItem("novelTimelineV11");
  const loaded=loadProjectFromStorage({storage});
  assert.equal(loaded.ok,false);
  assert.equal(storage.getItem("novelTimelineV11"),before);
}
{
  const storage=memoryStorage({novelTimelineV11:"{broken",novelTimelineV10:JSON.stringify({...good,version:10,characters:["C"],profiles:{}})});
  const before=storage.getItem("novelTimelineV11");
  const loaded=loadProjectFromStorage({storage});
  assert.equal(loaded.ok,false);
  assert.ok(loaded.candidates.length);
  assert.equal(storage.getItem("novelTimelineV11"),before);
}
{
  const storage=memoryStorage({});
  storage.setItem=()=>{const error=new Error("quota");error.name="QuotaExceededError";throw error};
  const current=good;
  const result=commitProjectChange(current,next=>next.scenes.push({id:"new"}),{storage});
  assert.equal(result.ok,false);
  assert.equal(current.scenes.length,0);
}

console.log("storage-safety integration tests: OK");
