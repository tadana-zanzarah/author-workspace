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
import {createCloudApi,getVerifiedSession} from "../js/cloud-api.js";

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

const authUser={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"owner@example.invalid"};
let getUserCalls=0,queryCalls=0;
const query=data=>{
  const api={select(){queryCalls++;return api},is(){return api},order(){return api},single(){return Promise.resolve({data,error:null})},then(resolve){resolve({data,error:null})}};
  return api;
};
const verifiedClient={
  auth:{
    async getSession(){return {data:{session:{user:authUser}},error:null}},
    async getUser(){getUserCalls++;return {data:{user:authUser},error:null}},
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}
  },
  from(table){
    if(table==="profiles")return query({user_id:authUser.id});
    return query([]);
  }
};
assert.equal((await getVerifiedSession(verifiedClient)).user.id,authUser.id,"bootstrap validates the persisted session with getUser");
const account=await createCloudApi(verifiedClient).loadAccount();
assert.equal(account.profile.user_id,authUser.id);
assert.deepEqual(account.series,[]);
assert.deepEqual(account.projects,[]);
assert.ok(getUserCalls>=2,"getUser validates bootstrap and account hydration");
assert.equal(queryCalls,3,"the production profile/series/projects selects still run unchanged");

let signUpPayload=null;
const signupClient={auth:{
  async signUp(payload){signUpPayload=payload;return {data:{user:authUser,session:null},error:null}},
  onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}
}};
const signupResult=await createCloudApi(signupClient).signUp({email:"owner@example.invalid",password:"password",displayName:"Автор",emailRedirectTo:"https://tadana-zanzarah.github.io/author-workspace/"});
assert.equal(signupResult.session,null,"email-confirmation signup may succeed without a session");
assert.equal(signUpPayload.options.emailRedirectTo,"https://tadana-zanzarah.github.io/author-workspace/");
assert.deepEqual(signUpPayload.options.data,{display_name:"Автор"});

let blockedQueries=0;
const expiredClient={
  auth:{
    async getSession(){return {data:{session:{user:authUser}},error:null}},
    async getUser(){return {data:{user:null},error:{status:403,code:"bad_jwt",message:"token is expired"}}},
    onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}
  },
  from(){blockedQueries++;return query([])}
};
await assert.rejects(()=>createCloudApi(expiredClient).loadAccount(),error=>error?.code==="bad_jwt"&&error?.message==="token is expired");
assert.equal(blockedQueries,0,"an invalid JWT is rejected before concurrent account queries start");

console.log("cloud foundation tests: OK");
