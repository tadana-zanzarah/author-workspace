import assert from "node:assert/strict";
import {getLastOpenProjectId,setLastOpenProjectId} from "../js/workspace-storage.js";

// Last-opened-project is a UI navigation preference (not canonical project data),
// so it lives in localStorage keyed by user id — never Supabase schema, and never
// shared across accounts in the same browser.

function memoryStorage(){
  const map=new Map();
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key),_map:map};
}

const userA="11111111-1111-4111-8111-111111111111";
const userB="22222222-2222-4222-8222-222222222222";
const projectA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

{
  const storage=memoryStorage();
  assert.equal(getLastOpenProjectId(userA,storage),null,"no preference stored yet");
  setLastOpenProjectId(userA,projectA,storage);
  assert.equal(getLastOpenProjectId(userA,storage),projectA);
  // A different user must never read A's preference key.
  assert.equal(getLastOpenProjectId(userB,storage),null,"different user does not inherit the preference");
}

{
  const storage=memoryStorage();
  setLastOpenProjectId(userA,projectA,storage);
  setLastOpenProjectId(userB,projectB,storage);
  assert.equal(getLastOpenProjectId(userA,storage),projectA);
  assert.equal(getLastOpenProjectId(userB,storage),projectB,"two accounts in the same browser keep isolated preferences");
}

{
  const storage=memoryStorage();
  setLastOpenProjectId(userA,projectA,storage);
  setLastOpenProjectId(userA,null,storage);
  assert.equal(getLastOpenProjectId(userA,storage),null,"clearing the preference removes the stored key");
  assert.equal(storage._map.has(`authorWorkspace:last-project:${userA}`),false);
}

{
  const storage=memoryStorage();
  // No user id (e.g. call site racing session teardown) must not throw and must not write.
  setLastOpenProjectId(null,projectA,storage);
  assert.equal(storage._map.size,0);
  assert.equal(getLastOpenProjectId(null,storage),null);
  assert.equal(getLastOpenProjectId(undefined,storage),null);
}

{
  // A storage read/write failure (private mode, quota, disabled storage) degrades to "no preference"
  // instead of throwing and breaking auth bootstrap.
  const throwingStorage={getItem(){throw new Error("blocked")},setItem(){throw new Error("blocked")}};
  assert.equal(getLastOpenProjectId(userA,throwingStorage),null);
  assert.doesNotThrow(()=>setLastOpenProjectId(userA,projectA,throwingStorage));
}

console.log("last-open-project preference unit tests: OK");
