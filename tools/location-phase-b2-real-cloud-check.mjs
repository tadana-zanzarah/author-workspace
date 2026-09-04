// Location Phase B2 -- NARROW real-cloud smoke against the REAL production Supabase project
// (already-published B1 backend), driven through the current feature-branch frontend's own API
// layer (js/cloud-content-api.js). Disposable CLOUD_TEST fixture user + one disposable project +
// three disposable canonical Locations, all named with this run's unique token. Skips gracefully
// if credentials are not configured. Mirrors tools/location-phase2-real-cloud-check.mjs exactly
// for login/cleanup conventions -- see that file's header for why (public anon key + RLS, no
// service role, cleanup via the already-authenticated browser session).
//
// Scope: this checks only the already-published B1 RPCs (create_location_canonical/
// update_location_canonical/set_location_parent/list_owned_locations/get_project_content) through
// B2's JS wrappers. No schema change, no migration, no SQL Editor, no direct manual SQL.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location phase B2 real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW loc-b2 ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

async function login(){
  const context=await browser.newContext();
  const page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(base,{waitUntil:"networkidle"});
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
  await page.waitForFunction(()=>globalThis.cloudState?.dashboardStatus==="success",null,{timeout:30000});
  return {context,page};
}

// Mirrors tools/location-phase2-real-cloud-check.mjs's cleanup() convention exactly: delete the
// disposable project (cascades project_locations/scenes), then delete every canonical location
// this account owns whose name contains this run's token -- not just the ones this script
// happened to capture an id for -- so a missed capture never orphans a canonical row (public
// .locations has no FK to any project and does not cascade-delete with it).
async function cleanup(page,projectIds,canonicalLocationIds,titles,sceneIds,token){
  return page.evaluate(async({projectIds,canonicalLocationIds,titles,sceneIds,token})=>{
    const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
    const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
    const session=await cloudState.client.auth.getSession();
    await client.auth.setSession(session.data.session);
    const owner=session.data.session.user.id;
    const found=await client.from("projects").select("id").in("title",titles);
    if(found.error)throw found.error;
    const projects=[...new Set([...projectIds,...found.data.map(x=>x.id)])];
    // Delete scenes explicitly by captured id first, rather than relying solely on an assumed
    // project_id ON DELETE CASCADE — this is a mandatory-cleanup script against production, so
    // don't trust an unverified cascade when an explicit delete is just as cheap.
    if(sceneIds.length){const d=await client.from("scenes").delete().in("id",sceneIds);if(d.error)throw d.error}
    if(projects.length){const d=await client.from("projects").delete().in("id",projects);if(d.error)throw d.error}
    const ownedLocations=await client.from("locations").select("id,name").eq("owner_id",owner);
    if(ownedLocations.error)throw ownedLocations.error;
    const tokenMatchedLocationIds=ownedLocations.data.filter(l=>l.name.includes(token)).map(l=>l.id);
    const allLocationIds=[...new Set([...canonicalLocationIds,...tokenMatchedLocationIds])];
    if(allLocationIds.length){const d=await client.from("locations").delete().in("id",allLocationIds);if(d.error)throw d.error}
    const remainingProjects=await client.from("projects").select("id").in("id",projects);
    const remainingLocations=allLocationIds.length?await client.from("locations").select("id").in("id",allLocationIds):{data:[]};
    const remainingParticipation=projects.length?await client.from("project_locations").select("id").in("project_id",projects):{data:[]};
    const remainingScenes=sceneIds.length?await client.from("scenes").select("id").in("id",sceneIds):{data:[]};
    return {
      projects:remainingProjects.data.length,locations:remainingLocations.data.length,
      participation:remainingParticipation.data.length,scenes:remainingScenes.data.length
    };
  },{projectIds,canonicalLocationIds,titles,sceneIds,token});
}

let session,report={},projectIds=[],canonicalLocationIds=[],sceneIds=[];
try{
  session=await login();
  const {page}=session;

  // ---- Fixture project ----
  const project=await page.evaluate(async title=>{
    const owner=cloudState.session.user.id;
    return cloudState.api.createProject({ownerId:owner,title});
  },projectTitle);
  projectIds.push(project.id);
  const pa=project.id;
  let rev=0;

  // ---- TEST 1: create canonical Parent Location ----
  const parentCreate=await page.evaluate(async({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`Parent Location ${token}`,officialName:`Official Parent ${token}`,aliases:["Old Parent Name"],
    typePreset:"country",description:"",shortSummary:"A disposable parent for the B2 real-cloud smoke."
  }),{pa,rev,token});
  assert(parentCreate.ok,`create_location_canonical (Parent) must succeed: ${JSON.stringify(parentCreate)}`);
  rev=parentCreate.revision;
  const parentParticipationId=parentCreate.data.id,parentCanonicalId=parentCreate.data.location_id;
  assert(parentParticipationId&&parentCanonicalId,"create must return both a participation id and a canonical location_id");
  assert(parentParticipationId!==parentCanonicalId,"participation id and canonical id must be distinct");
  assert(parentCreate.data.type_preset==="country","typePreset must persist on the create response");
  assert(typeof parentCreate.data.location_revision==="number","location_revision must be present on the create response");
  canonicalLocationIds.push(parentCanonicalId);

  const afterParent=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  rev=afterParent.revision;
  const parentRow=(afterParent.data.locations||[]).find(l=>l.id===parentParticipationId);
  assert(parentRow,"Parent must be readable via get_project_content after create");
  assert(parentRow.official_name===`Official Parent ${token}`,"officialName must persist");
  assert(JSON.stringify(parentRow.aliases)===JSON.stringify(["Old Parent Name"]),"aliases must persist");
  assert(parentRow.type_preset==="country","typePreset must persist across reload");
  report.test1_createParent={
    participationId:!!parentParticipationId,canonicalId:!!parentCanonicalId,idsDistinct:true,
    typePresetPersisted:true,locationRevisionPresent:true,identityFieldsPersisted:true
  };

  // ---- TEST 2: create canonical Child with parent set at create time ----
  const childCreate=await page.evaluate(async({pa,rev,token,parentCanonicalId})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`Child Location ${token}`,typePreset:"settlement",customTypeLabel:"Capital",description:"",parentId:parentCanonicalId
  }),{pa,rev,token,parentCanonicalId});
  assert(childCreate.ok,`create_location_canonical (Child, with parent) must succeed: ${JSON.stringify(childCreate)}`);
  rev=childCreate.revision;
  const childParticipationId=childCreate.data.id,childCanonicalId=childCreate.data.location_id;
  assert(childParticipationId!==childCanonicalId,"Child participation/canonical ids must be distinct");
  assert(childCreate.data.parent_id===parentCanonicalId,"create-with-parent must set parent_id to the PARENT's canonical id");
  canonicalLocationIds.push(childCanonicalId);

  const afterChild=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  rev=afterChild.revision;
  assert((afterChild.data.locations||[]).length===2,`create-with-parent must not create side-effect rows beyond Parent+Child, got ${afterChild.data.locations.length} locations`);
  const childRowAfterCreate=(afterChild.data.locations||[]).find(l=>l.id===childParticipationId);
  assert(childRowAfterCreate.parent_id===parentCanonicalId,"Child's parent_id must persist across reload");
  report.test2_createChildWithParent={
    participationId:!!childParticipationId,canonicalId:!!childCanonicalId,parentIdMatchesParentCanonical:true,noExtraRows:true
  };

  // ---- Sibling (third Location: needed both as TEST 4's new-parent target and TEST 6's
  //      non-participating-ancestor fixture) ----
  const siblingCreate=await page.evaluate(async({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`Sibling Location ${token}`,typePreset:"country",description:""
  }),{pa,rev,token});
  assert(siblingCreate.ok,`create_location_canonical (Sibling) must succeed: ${JSON.stringify(siblingCreate)}`);
  rev=siblingCreate.revision;
  const siblingParticipationId=siblingCreate.data.id,siblingCanonicalId=siblingCreate.data.location_id;
  canonicalLocationIds.push(siblingCanonicalId);

  // ---- TEST 3 + TEST 5: canonical update on Child (identity fields + aliases normalization) ----
  const childRevBeforeUpdate=(await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa)).data.locations.find(l=>l.id===childParticipationId).location_revision;
  const rawAliases=["  Old Pier  ","old pier","   ","New Pier Name","new pier name"];
  const update1=await page.evaluate(async({childCanonicalId,childRevBeforeUpdate,token,rawAliases})=>cloudState.contentApi.updateLocationCanonical(childCanonicalId,childRevBeforeUpdate,{
    name:`Child Location ${token} (renamed)`,officialName:`Official Child ${token}`,aliases:rawAliases,
    typePreset:"settlement",customTypeLabel:"Capital City",description:`Longer description for the child fixture ${token}.`,
    shortSummary:`Short summary ${token}.`
  }),{childCanonicalId,childRevBeforeUpdate,token,rawAliases});
  assert(update1.ok,`update_location_canonical must succeed: ${JSON.stringify(update1)}`);
  assert(update1.locationRevision===childRevBeforeUpdate+1,`revision must advance by exactly 1 on a real change (before=${childRevBeforeUpdate}, after=${update1.locationRevision})`);
  rev=update1.revision??rev;

  const afterUpdate1=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const childRowAfterUpdate1=afterUpdate1.data.locations.find(l=>l.id===childParticipationId);
  assert(childRowAfterUpdate1.name===`Child Location ${token} (renamed)`,"renamed name must persist across reload");
  assert(childRowAfterUpdate1.official_name===`Official Child ${token}`,"officialName must persist across reload");
  assert(childRowAfterUpdate1.custom_type_label==="Capital City","customTypeLabel must persist across reload");
  assert(childRowAfterUpdate1.description===`Longer description for the child fixture ${token}.`,"description must persist across reload");
  assert(childRowAfterUpdate1.base_profile?.shortSummary===`Short summary ${token}.`,"shortSummary must persist across reload");
  const normalizedAliases=childRowAfterUpdate1.aliases;
  assert(JSON.stringify(normalizedAliases)===JSON.stringify(["Old Pier","New Pier Name"]),`aliases must be server-normalized (trim, drop blanks, case-insensitive dedupe keeping first occurrence), got: ${JSON.stringify(normalizedAliases)}`);
  report.test3_canonicalUpdate={
    revisionProgression:`${childRevBeforeUpdate} -> ${update1.locationRevision}`,identityFieldsPersisted:true,
    unknownBaseProfileKeyPreservation:"NOT EXERCISED — no supported B2 write path creates an unknown base_profile key in this phase (thematic modules are Phase B3); skipped rather than inject one via manual SQL, per task instructions"
  };
  report.test5_aliasesNormalization={input:rawAliases,output:normalizedAliases,expected:["Old Pier","New Pier Name"]};

  // ---- TEST 4: parent change through the real two-step save path + revision chaining proof ----
  const childRevBeforeParentStep=update1.locationRevision;
  const update2=await page.evaluate(async({childCanonicalId,childRevBeforeParentStep,token})=>cloudState.contentApi.updateLocationCanonical(childCanonicalId,childRevBeforeParentStep,{
    name:`Child Location ${token} (renamed)`,officialName:`Official Child ${token}`,aliases:["Old Pier","New Pier Name"],
    typePreset:"settlement",customTypeLabel:"Capital City",description:`Longer description for the child fixture ${token}.`,
    shortSummary:`Short summary ${token} -- step 2 marker.`
  }),{childCanonicalId,childRevBeforeParentStep,token});
  assert(update2.ok&&update2.locationRevision===childRevBeforeParentStep+1,`core-identity step of the two-step save must advance revision by 1: ${JSON.stringify(update2)}`);
  const freshRevisionAfterCore=update2.locationRevision;

  // Prove the parent RPC is NOT safe to send with the STALE pre-core-update revision.
  const staleParentAttempt=await page.evaluate(async({childCanonicalId,childRevBeforeParentStep,siblingCanonicalId})=>cloudState.contentApi.setLocationParent(childCanonicalId,childRevBeforeParentStep,siblingCanonicalId),{childCanonicalId,childRevBeforeParentStep,siblingCanonicalId});
  assert(!staleParentAttempt.ok&&staleParentAttempt.code==="LOCATION_REVISION_CONFLICT",`set_location_parent with the STALE pre-core-update revision must be rejected as LOCATION_REVISION_CONFLICT, got: ${JSON.stringify(staleParentAttempt)}`);

  // The real B2 save path: use the FRESH revision update_location_canonical just returned.
  const freshParentAttempt=await page.evaluate(async({childCanonicalId,freshRevisionAfterCore,siblingCanonicalId})=>cloudState.contentApi.setLocationParent(childCanonicalId,freshRevisionAfterCore,siblingCanonicalId),{childCanonicalId,freshRevisionAfterCore,siblingCanonicalId});
  assert(freshParentAttempt.ok,`set_location_parent with the FRESH post-core-update revision must succeed: ${JSON.stringify(freshParentAttempt)}`);
  assert(freshParentAttempt.locationRevision===freshRevisionAfterCore+1,`parent mutation must advance revision by exactly 1 again (from=${freshRevisionAfterCore}, got=${freshParentAttempt.locationRevision})`);
  rev=(await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa)).revision;

  const afterParentMove=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const childRowAfterParentMove=afterParentMove.data.locations.find(l=>l.id===childParticipationId);
  assert(childRowAfterParentMove.parent_id===siblingCanonicalId,`reload must show the new parent (Sibling), got parent_id=${childRowAfterParentMove.parent_id}`);
  report.test4_parentChangeRevisionChain={
    staleRevisionRejected:true,staleCode:staleParentAttempt.code,
    freshRevisionUsedAndAccepted:true,
    revisionChain:`core:${childRevBeforeParentStep}->${freshRevisionAfterCore}, parent:${freshRevisionAfterCore}->${freshParentAttempt.locationRevision}`,
    reloadShowsNewParent:true
  };

  // ---- TEST 7: Scene participation invariant ----
  rev=afterParentMove.revision;
  const sceneCreate=await page.evaluate(async({pa,rev,locId,token})=>cloudState.contentApi.createScene(pa,rev,{title:`B2 Scene ${token}`,locationId:locId,placementStatus:"unplaced",writingStatus:"draft",included:true,dateReview:false,position:1000}),{pa,rev,locId:childParticipationId,token});
  assert(sceneCreate.ok,`createScene bound to Child must succeed: ${JSON.stringify(sceneCreate)}`);
  rev=sceneCreate.revision;
  const sceneId=sceneCreate.data.id;
  sceneIds.push(sceneId);
  const afterSceneCreate=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  let boundScene=afterSceneCreate.data.scenes.find(s=>s.id===sceneId);
  assert(boundScene.location_id===childParticipationId,"scene.location_id must equal Child's PARTICIPATION id");
  assert(boundScene.location_id!==childCanonicalId,"scene.location_id must NOT be Child's canonical id");

  // Perform a canonical Child update and confirm the scene binding is untouched by it.
  rev=afterSceneCreate.revision;
  const childRevBeforeSceneCheck=afterSceneCreate.data.locations.find(l=>l.id===childParticipationId).location_revision;
  const update3=await page.evaluate(async({childCanonicalId,childRevBeforeSceneCheck,token})=>cloudState.contentApi.updateLocationCanonical(childCanonicalId,childRevBeforeSceneCheck,{
    name:`Child Location ${token} (renamed)`,officialName:`Official Child ${token}`,aliases:["Old Pier","New Pier Name"],
    typePreset:"settlement",customTypeLabel:"Capital City, post-scene-check",description:`Longer description for the child fixture ${token}.`,
    shortSummary:`Short summary ${token} -- step 2 marker.`
  }),{childCanonicalId,childRevBeforeSceneCheck,token});
  assert(update3.ok,`update_location_canonical (post-scene-bind identity update) must succeed: ${JSON.stringify(update3)}`);
  const afterSceneBindUpdate=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  rev=afterSceneBindUpdate.revision;
  boundScene=afterSceneBindUpdate.data.scenes.find(s=>s.id===sceneId);
  assert(boundScene.location_id===childParticipationId,"scene binding must remain the SAME participation id after a canonical Child identity update");
  report.test7_sceneInvariant={tested:true,participationIdPreserved:true,canonicalIdNotUsedAsSceneFk:true,unaffectedByCanonicalUpdate:true};

  // ---- TEST 6: global parent list + non-participating-ancestor visibility ----
  const ownedBeforeUnbind=await page.evaluate(()=>cloudState.contentApi.listOwnedLocations());
  assert(ownedBeforeUnbind.ok,`list_owned_locations must succeed: ${JSON.stringify(ownedBeforeUnbind)}`);
  const ownedIdsBeforeUnbind=new Set(ownedBeforeUnbind.data.map(l=>l.id));
  assert(ownedIdsBeforeUnbind.has(parentCanonicalId)&&ownedIdsBeforeUnbind.has(childCanonicalId)&&ownedIdsBeforeUnbind.has(siblingCanonicalId),"list_owned_locations must include all three canonical fixtures (owner-scoped, not just this project's participation rows)");

  // Unbind Sibling's OWN participation from the project (soft-remove project_locations only --
  // the canonical `locations` row is untouched) while it still serves as Child's parent_id. This
  // reproduces the exact "ancestor doesn't participate in the current project" case the B2 audit
  // flagged: a parent doesn't need to participate for the hierarchy to remain valid.
  const unbindSibling=await page.evaluate(async({pa,rev,siblingParticipationId})=>cloudState.contentApi.deleteLocation(pa,siblingParticipationId,rev),{pa,rev,siblingParticipationId});
  assert(unbindSibling.ok,`unbinding Sibling's participation must succeed: ${JSON.stringify(unbindSibling)}`);
  rev=unbindSibling.revision;

  const afterUnbind=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  assert(!afterUnbind.data.locations.some(l=>l.id===siblingParticipationId),"Sibling must no longer hydrate as a participating Location after unbind");
  assert(afterUnbind.data.locations.find(l=>l.id===childParticipationId)?.parent_id===siblingCanonicalId,"Child's parent_id must still point at Sibling's canonical id after Sibling's OWN participation is removed");

  const ownedAfterUnbind=await page.evaluate(()=>cloudState.contentApi.listOwnedLocations());
  assert(ownedAfterUnbind.ok,`list_owned_locations (post-unbind) must succeed: ${JSON.stringify(ownedAfterUnbind)}`);
  const stillListed=ownedAfterUnbind.data.some(l=>l.id===siblingCanonicalId);
  assert(stillListed,"a canonical Location that no longer participates in ANY project must still appear in the global owned-location list (parent picker / breadcrumb source)");
  report.test6_globalParentList={
    parentListedGlobally:true,childListedGlobally:true,
    nonParticipatingAncestorStillListed:true,parentIdOnNonParticipatingAncestorPreserved:true
  };

  // ---- TEST 8: stale revision on canonical update must be rejected ----
  const parentRevR=(await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa)).data.locations.find(l=>l.id===parentParticipationId).location_revision;
  const firstParentUpdate=await page.evaluate(async({parentCanonicalId,parentRevR,token})=>cloudState.contentApi.updateLocationCanonical(parentCanonicalId,parentRevR,{
    name:`Parent Location ${token}`,officialName:`Official Parent ${token}`,aliases:["Old Parent Name"],
    typePreset:"country",description:"",shortSummary:`Updated once ${token}.`
  }),{parentCanonicalId,parentRevR,token});
  assert(firstParentUpdate.ok&&firstParentUpdate.locationRevision===parentRevR+1,`first Parent update must succeed and advance revision: ${JSON.stringify(firstParentUpdate)}`);

  const staleParentUpdate=await page.evaluate(async({parentCanonicalId,parentRevR,token})=>cloudState.contentApi.updateLocationCanonical(parentCanonicalId,parentRevR,{
    name:`Parent Location ${token}`,officialName:`Official Parent ${token}`,aliases:["Old Parent Name"],
    typePreset:"country",description:"",shortSummary:`STALE OVERWRITE ATTEMPT ${token} -- must be rejected.`
  }),{parentCanonicalId,parentRevR,token});
  assert(!staleParentUpdate.ok&&staleParentUpdate.code==="LOCATION_REVISION_CONFLICT",`update_location_canonical with a stale expected_location_revision must be rejected as LOCATION_REVISION_CONFLICT, got: ${JSON.stringify(staleParentUpdate)}`);

  const afterStaleAttempt=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  rev=afterStaleAttempt.revision;
  const parentRowAfterStale=afterStaleAttempt.data.locations.find(l=>l.id===parentParticipationId);
  assert(parentRowAfterStale.base_profile?.shortSummary===`Updated once ${token}.`,"the newer (first) update's value must remain intact -- the stale attempt must not have silently overwritten it");
  assert(parentRowAfterStale.base_profile?.shortSummary!==`STALE OVERWRITE ATTEMPT ${token} -- must be rejected.`,"the stale attempt's value must NOT be present anywhere");
  report.test8_staleRevision={staleWriteRejected:true,code:staleParentUpdate.code,newerValuePreserved:true,noSilentOverwrite:true};

  // ---- TEST 9: reload/hydration shape ----
  // Go through the REAL production hydration path (openCloudProject -> createCloudProjectSync
  // .load() -> hydrateProjectFromCloudSnapshot), exactly what the UI itself does, and read the
  // resulting globalThis.data -- rather than calling hydrateProjectFromCloudSnapshot directly,
  // which turned out not to be exposed on globalThis (only runCloudMutation/sceneToCloud/
  // isCloudWorkspace are, per cloud-project-sync.js's own Object.assign list; the hydration
  // function is a named ES export used internally by that module, not part of the app's global
  // surface). That was a bug in this test script, not in the product — fixed here, not silently.
  const opened=await page.evaluate(async({pa,title})=>{await openCloudProject({id:pa,title});return globalThis.cloudProjectSync?.projectId===pa},{pa,title:projectTitle});
  assert(opened,"openCloudProject must load the disposable project into the workspace for the hydration check");
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const hydrationCheck=await page.evaluate(()=>globalThis.data.locations.map(l=>({id:l.id,keys:Object.keys(l).sort(),locationId:l.locationId})));
  const expectedKeys=["aliases","baseProfile","customTypeLabel","description","id","locationId","locationRevision","name","officialName","parentId","shortSummary","typePreset"].sort();
  const parentHydrated=hydrationCheck.find(l=>l.id===parentParticipationId);
  const childHydrated=hydrationCheck.find(l=>l.id===childParticipationId);
  assert(parentHydrated&&childHydrated,"both Parent and Child must hydrate from the final reload");
  assert(JSON.stringify(parentHydrated.keys)===JSON.stringify(expectedKeys),`hydrated shape missing/extra keys (Parent): ${JSON.stringify(parentHydrated.keys)}`);
  assert(JSON.stringify(childHydrated.keys)===JSON.stringify(expectedKeys),`hydrated shape missing/extra keys (Child): ${JSON.stringify(childHydrated.keys)}`);
  assert(parentHydrated.id===parentParticipationId&&parentHydrated.locationId===parentCanonicalId,"Parent: id must be the participation id, locationId must be the canonical id");
  assert(childHydrated.id===childParticipationId&&childHydrated.locationId===childCanonicalId,"Child: id must be the participation id, locationId must be the canonical id");
  report.test9_hydration={shapeKeys:expectedKeys,participationCanonicalSemanticsCorrect:true};

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectTitle],sceneIds,token);
    console.log(JSON.stringify({cleanup:counts}));
    if(!(counts.projects===0&&counts.locations===0&&counts.participation===0&&counts.scenes===0)){
      console.log(JSON.stringify({cleanupIncomplete:true,counts}));
      process.exitCode=1;
    }
  }catch(cleanupError){
    console.log(JSON.stringify({cleanupError:cleanupError.message}));
    process.exitCode=1;
  }
  if(session)await session.context.close();
  await browser.close();
}
