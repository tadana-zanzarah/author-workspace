import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright"),base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("cloud characters real-browser test skipped: credentials are not configured");process.exit(0)}
const token=crypto.randomBytes(7).toString("hex"),titles=[`AW chars A ${token}`,`AW chars B ${token}`];
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}),contexts=[],projectIds=[],characterIds=[];
const assert=(value,message)=>{if(!value)throw new Error(message)},must=(result,label)=>{assert(result?.ok,`${label}: ${result?.code}`);return result};
async function login(){const context=await browser.newContext();contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(20000);await page.goto(base,{waitUntil:"networkidle"});await page.waitForSelector("#authScreen:not([hidden])");await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");await page.waitForSelector("#projectsScreen:not([hidden])");return page}
async function setup(page){return page.evaluate(async titles=>{const owner=cloudState.session.user.id,a=await cloudState.api.createProject({ownerId:owner,title:titles[0]}),b=await cloudState.api.createProject({ownerId:owner,title:titles[1]});return {a,b}},titles)}
async function cleanup(page){return page.evaluate(async({projectIds,characterIds,titles})=>{const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm"),client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");const found=await client.from("projects").select("id").in("title",titles);if(found.error)throw found.error;const projects=[...new Set([...projectIds,...found.data.map(x=>x.id)])];let chars=[...characterIds];if(projects.length){const memberships=await client.from("project_characters").select("character_id").in("project_id",projects);if(memberships.error)throw memberships.error;chars=[...new Set([...chars,...memberships.data.map(x=>x.character_id)])];let links=client.from("character_links").delete();links=chars.length?links.or(`project_id.in.(${projects.join(",")}),from_character_id.in.(${chars.join(",")}),to_character_id.in.(${chars.join(",")})`):links.in("project_id",projects);const ld=await links;if(ld.error)throw ld.error;const d=await client.from("projects").delete().in("id",projects);if(d.error)throw d.error}if(chars.length){const d=await client.from("characters").delete().in("id",chars);if(d.error)throw d.error}const counts={};for(const table of ["projects","chapters","locations","tags","scenes","scene_tags","project_characters","scene_characters","project_character_relations","scene_relation_changes","character_links"]){let q=client.from(table).select("*");if(table==="projects")q=q.in("id",projects);else if(table==="character_links")q=chars.length?q.or(`project_id.in.(${projects.join(",")}),from_character_id.in.(${chars.join(",")}),to_character_id.in.(${chars.join(",")})`):q.in("project_id",projects);else q=q.in("project_id",projects);const r=await q;if(r.error)throw r.error;counts[table]=r.data.length}const remaining=chars.length?await client.from("characters").select("id").in("id",chars):{data:[],error:null};if(remaining.error)throw remaining.error;counts.characters=remaining.data.length;return counts},{projectIds,characterIds,titles})}
let a,b,report;
try{
  a=await login();const projects=await setup(a);projectIds.push(projects.a.id,projects.b.id);
  const created=await a.evaluate(async({pa,pb})=>{const ca=cloudState.characterApi,content=cloudState.contentApi;let ra=0,rb=0;
    let x=await ca.createCharacterAndAttach(pa,ra,{name:"Character A",baseProfile:{age:"20",favorites:["чай"],hobbies:["бег"],plugin:{keep:true}}});if(!x.ok)return {error:x};ra=x.revision;const A=x.data.character,pcA=x.data.project_character;
    x=await ca.createCharacterAndAttach(pa,ra,{name:"Character B",baseProfile:{age:"30"}});if(!x.ok)return {error:x};ra=x.revision;const B=x.data.character,pcB=x.data.project_character;
    x=await content.createScene(pa,ra,{title:"Scene A",sceneText:"",sceneDate:null,sceneTime:null,placementStatus:"unplaced",writingStatus:"draft",included:true,dateReview:false,position:1000});if(!x.ok)return {error:x};ra=x.revision;const scene=x.data;
    x=await ca.setSceneCharacters(pa,scene.id,ra,[{projectCharacterId:pcA.id,action:"входит",sortOrder:0},{projectCharacterId:pcB.id,action:"ждёт",sortOrder:1}]);if(!x.ok)return {error:x};ra=x.revision;
    x=await ca.setInitialRelations(pa,ra,[{fromProjectCharacterId:pcA.id,toProjectCharacterId:pcB.id,valueOperation:"set",value:"доверяет",visible:true}]);if(!x.ok)return {error:x};ra=x.revision;
    x=await ca.setSceneRelationChanges(pa,scene.id,ra,[{fromProjectCharacterId:pcA.id,toProjectCharacterId:pcB.id,valueOperation:"set",value:"сомневается",visible:false}]);if(!x.ok)return {error:x};ra=x.revision;
    x=await ca.createLink(null,null,{fromCharacterId:A.id,toCharacterId:B.id,category:"family",type:"sister",reverseType:"brother",structureKind:"biological",metadata:{keep:true}});if(!x.ok)return {error:x};const globalLink=x.data;
    x=await ca.createLink(pa,ra,{fromCharacterId:A.id,toCharacterId:B.id,category:"other",type:"custom",reverseType:"custom",customLabel:"адвокат",reverseCustomLabel:"клиент",structureKind:"legal",metadata:{uiCategory:"legal"}});if(!x.ok)return {error:x};ra=x.revision;const projectLink=x.data;
    x=await ca.attachProjectCharacter(pb,A.id,rb,{});if(!x.ok)return {error:x};rb=x.revision;const pcAB=x.data;
    x=await ca.updateProjectCharacter(pb,pcAB.id,rb,{overrides:{age:"27",favorites:null},role:null,sortOrder:0});if(!x.ok)return {error:x};rb=x.revision;
    return {A,B,pcA,pcB,pcAB,scene,globalLink,projectLink,ra,rb};},{pa:projects.a.id,pb:projects.b.id});
  if(created.error)throw new Error(`setup RPC failed: ${created.error.code}`);characterIds.push(created.A.id,created.B.id);
  b=await login();const proof=await b.evaluate(async({pa,pb,A})=>{const ca=cloudState.characterApi,content=cloudState.contentApi,[chars,sa,sb,links]=await Promise.all([ca.listCharacters(),content.loadProjectContent(pa),content.loadProjectContent(pb),ca.listGlobalLinks()]);const identity=chars.data.filter(x=>x.id===A.id);return {identityCount:identity.length,base:identity[0]?.base_profile,a:sa.data,b:sb.data,links:links.data}}, {pa:projects.a.id,pb:projects.b.id,A:created.A});
  assert(proof.identityCount===1,"global identity duplicated");assert(proof.base.age==="20"&&proof.base.favorites[0]==="чай","base profile mismatch");assert(proof.b.project_characters[0].overrides.age==="27"&&proof.b.project_characters[0].overrides.favorites===null,"Project B override mismatch");assert(Object.keys(proof.a.project_characters[0].overrides).length===0,"Project A inherited profile changed");assert(proof.a.scene_characters.length===2&&proof.a.project_character_relations.length===1&&proof.a.scene_relation_changes.length===1,"participation or relations missing");assert(proof.links.some(x=>x.id===created.globalLink.id)&&proof.a.character_links.some(x=>x.id===created.projectLink.id),"link scopes missing");
  const conflicts=await b.evaluate(async state=>{const ca=cloudState.characterApi,r={};let x=await ca.updateCharacter(state.A.id,state.A.revision,{name:"Remote A",baseProfile:state.A.base_profile});r.global=(await ca.updateCharacter(state.A.id,state.A.revision,{name:"Stale A",baseProfile:state.A.base_profile})).code;
    x=await ca.updateProjectCharacter(state.pa,state.pcA.id,state.ra,{overrides:{age:"21"},role:null,sortOrder:0});r.override=(await ca.updateProjectCharacter(state.pa,state.pcA.id,state.ra,{overrides:{age:"22"},role:null,sortOrder:0})).code;let rev=x.revision;
    x=await ca.setSceneCharacters(state.pa,state.scene.id,rev,[{projectCharacterId:state.pcA.id,action:"remote",sortOrder:0}]);r.participation=(await ca.setSceneCharacters(state.pa,state.scene.id,rev,[])).code;rev=x.revision;
    x=await ca.setInitialRelations(state.pa,rev,[{fromProjectCharacterId:state.pcA.id,toProjectCharacterId:state.pcB.id,valueOperation:"set",value:"remote",visible:true}]);r.relation=(await ca.setInitialRelations(state.pa,rev,[])).code;
    x=await ca.updateLink(state.globalLink.id,{expectedLinkRevision:state.globalLink.revision},{fromCharacterId:state.A.id,toCharacterId:state.B.id,category:"family",type:"mother",reverseType:"child",structureKind:"biological",metadata:{keep:true}});r.link=(await ca.updateLink(state.globalLink.id,{expectedLinkRevision:state.globalLink.revision},{fromCharacterId:state.A.id,toCharacterId:state.B.id,category:"family",type:"father",reverseType:"child",structureKind:"biological",metadata:{}})).code;return r},{...created,pa:projects.a.id});
  assert(conflicts.global==="CHARACTER_REVISION_CONFLICT"&&conflicts.override==="REVISION_CONFLICT"&&conflicts.participation==="REVISION_CONFLICT"&&conflicts.relation==="REVISION_CONFLICT"&&conflicts.link==="GLOBAL_LINK_REVISION_CONFLICT",`conflict matrix failed: ${JSON.stringify(conflicts)}`);
  const removal=await b.evaluate(async({pa,pc})=>{const ca=cloudState.characterApi,s=await cloudState.contentApi.loadProjectContent(pa),blocked=await ca.removeProjectCharacter(pa,pc.id,s.revision),cleaned=await ca.removeProjectCharacter(pa,pc.id,s.revision,{cleanupDependencies:true}),chars=await ca.listCharacters();return {blocked,cleaned,stillGlobal:chars.data.some(x=>x.id===pc.character_id)}},{pa:projects.a.id,pc:created.pcA});
  assert(removal.blocked.code==="DEPENDENCIES_EXIST"&&removal.cleaned.ok&&removal.stillGlobal,"dependency cleanup contract failed");

  // fix/project-character-reattach acceptance: the character removed above (with dependency
  // cleanup) must be re-attachable to the same project by reactivating the same row, not blocked
  // as DUPLICATE forever and not creating a second row.
  const reattach=await b.evaluate(async({pa,pb,characterId})=>{
    const ca=cloudState.characterApi,content=cloudState.contentApi;
    const before=await content.loadProjectContent(pa);
    const stale=await ca.attachProjectCharacter(pa,characterId,before.revision-1,{role:"newrole",sortOrder:5000,overrides:{age:"99"}});
    const fresh=await ca.attachProjectCharacter(pa,characterId,before.revision,{role:"newrole",sortOrder:5000,overrides:{age:"99"}});
    const dup=await ca.attachProjectCharacter(pa,characterId,fresh.revision,{});
    const afterFirst=await content.loadProjectContent(pa);
    const removedAgain=await ca.removeProjectCharacter(pa,fresh.data.id,dup.revision);
    const [race1,race2]=await Promise.all([
      ca.attachProjectCharacter(pa,characterId,removedAgain.revision,{sortOrder:1}),
      ca.attachProjectCharacter(pa,characterId,removedAgain.revision,{sortOrder:2})
    ]);
    const finalA=await content.loadProjectContent(pa),finalB=await content.loadProjectContent(pb);
    return {stale,fresh,dup,afterFirst,removedAgain,race1,race2,finalA,finalB};
  },{pa:projects.a.id,pb:projects.b.id,characterId:created.A.id});
  assert(reattach.stale.code==="REVISION_CONFLICT"&&!reattach.stale.ok,"stale expected_revision on attach_project_character must return REVISION_CONFLICT");
  assert(reattach.fresh.ok&&reattach.fresh.code==="OK",`reattach after cleanup-remove must succeed: ${JSON.stringify(reattach.fresh)}`);
  const reactivated=reattach.fresh.data;
  assert(reactivated.id===created.pcA.id,"reattach must reactivate the same project_characters row, not insert a new one");
  assert(reactivated.removed_at===null,"reactivated row must have removed_at cleared");
  assert(reactivated.role==="newrole"&&Number(reactivated.sort_order)===5000&&reactivated.overrides.age==="99","reattach must apply the fresh call arguments, replacing the dormant pre-removal overrides/role/sort_order");
  assert(reattach.dup.code==="DUPLICATE"&&reattach.dup.revision===reattach.fresh.revision,"attaching the now-active character again must be a true no-mutation duplicate");
  const pcRowsAfterFirst=reattach.afterFirst.data.project_characters.filter(x=>x.character_id===created.A.id);
  assert(pcRowsAfterFirst.length===1,"exactly one participation row must exist for the project/character pair after reattach");
  assert(!reattach.afterFirst.data.scene_characters.some(x=>x.project_character_id===reactivated.id),"reattach must not resurrect cleaned-up scene_characters");
  assert(!reattach.afterFirst.data.project_character_relations.some(x=>x.from_project_character_id===reactivated.id||x.to_project_character_id===reactivated.id),"reattach must not resurrect cleaned-up relations");
  assert(!reattach.afterFirst.data.scene_relation_changes.some(x=>x.from_project_character_id===reactivated.id||x.to_project_character_id===reactivated.id),"reattach must not resurrect cleaned-up scene relation changes");
  assert(reattach.removedAgain.ok,"second remove (no lingering dependencies expected after cleanup) must succeed");
  const raceResults=[reattach.race1,reattach.race2],winners=raceResults.filter(x=>x.ok&&x.code==="OK"),losers=raceResults.filter(x=>!(x.ok&&x.code==="OK"));
  assert(winners.length===1&&losers.length===1&&losers[0].code==="REVISION_CONFLICT",`concurrent reattach with the same expected_revision must let exactly one succeed and reject the other with REVISION_CONFLICT: ${JSON.stringify(raceResults)}`);
  const finalPcRows=reattach.finalA.data.project_characters.filter(x=>x.character_id===created.A.id);
  assert(finalPcRows.length===1&&finalPcRows[0].removed_at===null,"exactly one active participation row must remain after concurrent reattach");
  const pbRow=reattach.finalB.data.project_characters.find(x=>x.character_id===created.A.id);
  assert(pbRow&&pbRow.overrides.age==="27","project B's own participation/overrides for the shared character must be unaffected by project A's remove/reattach churn");

  report={browserA:true,browserB:true,oneIdentity:true,projectOverrideIsolation:true,sceneParticipation:true,emotionalRelations:true,linkScopes:true,conflicts,dependencyCleanup:true,reattachStaleRevisionConflict:true,reattachReactivatesSameRow:true,reattachAppliesFreshState:true,reattachActiveDuplicateNoOp:true,reattachNoDependencyResurrection:true,concurrentReattachSingleWinner:true,reattachProjectBIsolation:true};
}finally{try{const page=b||a;if(page){const counts=await cleanup(page);assert(Object.values(counts).every(x=>x===0),`fixture cleanup incomplete: ${JSON.stringify(counts)}`)}}finally{for(const context of contexts)await context.close();await browser.close()}}
console.log(JSON.stringify({ok:true,...report,fixtures:0,orphans:0}));
