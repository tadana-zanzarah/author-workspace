import assert from "node:assert/strict";
import fs from "node:fs";
import {
  projectWorkspaceKey,
  projectUiKey,
  activateCloudWorkspace,
  activateLegacyWorkspace,
  activeWorkspaceContext,
  hasLegacyWorkspace
} from "../js/workspace-storage.js";
import {loadProjectFromStorage,persistProject} from "../js/storage.js";

const projectA="11111111-1111-4111-8111-111111111111";
const projectB="22222222-2222-4222-8222-222222222222";
assert.notEqual(projectWorkspaceKey(projectA),projectWorkspaceKey(projectB),"проекты имеют разные localStorage namespace");
assert.match(projectWorkspaceKey(projectA),/^authorWorkspace:project:/);
assert.notEqual(projectUiKey(projectA),projectUiKey(projectB));
assert.throws(()=>projectWorkspaceKey("../bad"));

const storage={
  values:new Map(),
  get length(){return this.values.size},
  key(index){return [...this.values.keys()][index]??null},
  getItem(key){return this.values.has(key)?this.values.get(key):null},
  setItem(key,value){this.values.set(key,value)}
};
const localProject={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]};
storage.setItem("novelTimelineV11",JSON.stringify({...localProject,legacyMarker:true}));
assert.equal(hasLegacyWorkspace(storage),true);

activateCloudWorkspace(projectA);
assert.equal(activeWorkspaceContext().storageKey,projectWorkspaceKey(projectA));
persistProject({...localProject,marker:"A"},{storage,key:activeWorkspaceContext().storageKey});
activateCloudWorkspace(projectB);
persistProject({...localProject,marker:"B"},{storage,key:activeWorkspaceContext().storageKey});
assert.equal(loadProjectFromStorage({storage,key:projectWorkspaceKey(projectA),oldKeys:[]}).data.marker,"A");
assert.equal(loadProjectFromStorage({storage,key:projectWorkspaceKey(projectB),oldKeys:[]}).data.marker,"B");
assert.equal(JSON.parse(storage.getItem("novelTimelineV11")).legacyMarker,true,"legacy storage не изменён");
activateLegacyWorkspace();

const migration=fs.readFileSync(new URL("../supabase/migrations/20260812193655_cloud_foundation.sql",import.meta.url),"utf8");
for(const table of ["profiles","series","projects"])assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`,"i"));
for(const policy of ["projects_select_own","projects_update_own","series_select_own","profiles_select_own"])assert.match(migration,new RegExp(`create policy ${policy}`,"i"));
assert.doesNotMatch(migration,/service[_-]?role\s*[:=]/i);

console.log("cloud foundation tests: OK");
