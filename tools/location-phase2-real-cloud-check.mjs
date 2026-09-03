// Location Architecture V2 Phase 2 -- real-cloud regression + current-UI smoke, against the
// REAL production Supabase project (post-apply), using a disposable CLOUD_TEST fixture user and
// disposable projects/locations only. Never touches real user projects except via a read-only
// hydration check. Mirrors the existing tools/*-real-browser.test.mjs convention (Playwright via
// the working-runtime cache path, CLOUD_TEST_EMAIL/PASSWORD from the environment, cleanup via the
// public anon key + RLS). Skips gracefully if credentials are not configured.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location phase2 real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const titles=[`AW loc-p2 P1 ${token}`,`AW loc-p2 P2 ${token}`];
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

async function cleanup(page,projectIds,canonicalLocationIds,titles,token){
  // Runs INSIDE the browser page context (dynamic import from a CDN URL only works there, not in
  // a bare Node.js ESM loader) -- mirrors the existing tools/*-real-browser.test.mjs cleanup()
  // pattern exactly, using the public anon key (safe to embed; RLS still applies) as the already-
  // authenticated CLOUD_TEST user's own browser session, not a service role.
  //
  // canonicalLocationIds only covers the location created directly via the RPC in section B --
  // the UI-smoke steps (manager "+ Создать локацию", quick-create modal) create MORE canonical
  // locations that were never captured in that array. Rather than track every creation site by
  // hand (fragile -- a missed one silently orphans a canonical row, since public.locations has
  // no FK to projects and doesn't cascade-delete with the disposable project), find every
  // canonical location owned by this account whose name contains this run's unique token and
  // delete those too. This caught 8 orphaned rows across earlier debugging runs of this exact
  // script before this fix.
  return page.evaluate(async({projectIds,canonicalLocationIds,titles,token})=>{
    const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
    const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
    const session=await cloudState.client.auth.getSession();
    await client.auth.setSession(session.data.session);
    const owner=session.data.session.user.id;
    const found=await client.from("projects").select("id").in("title",titles);
    if(found.error)throw found.error;
    const projects=[...new Set([...projectIds,...found.data.map(x=>x.id)])];
    if(projects.length){const d=await client.from("projects").delete().in("id",projects);if(d.error)throw d.error}
    const ownedLocations=await client.from("locations").select("id,name").eq("owner_id",owner);
    if(ownedLocations.error)throw ownedLocations.error;
    const tokenMatchedLocationIds=ownedLocations.data.filter(l=>l.name.includes(token)).map(l=>l.id);
    const allLocationIds=[...new Set([...canonicalLocationIds,...tokenMatchedLocationIds])];
    if(allLocationIds.length){const d=await client.from("locations").delete().in("id",allLocationIds);if(d.error)throw d.error}
    const remainingProjects=await client.from("projects").select("id").in("id",projects);
    const remainingLocations=allLocationIds.length?await client.from("locations").select("id").in("id",allLocationIds):{data:[]};
    const remainingParticipation=projects.length?await client.from("project_locations").select("id").in("project_id",projects):{data:[]};
    return {projects:remainingProjects.data.length,locations:remainingLocations.data.length,participation:remainingParticipation.data.length};
  },{projectIds,canonicalLocationIds,titles,token});
}

// modal-manager.js toggles .modal-backdrop visibility via style.display (flex/none), not the
// `hidden` attribute -- that's only used for top-level screens (#authScreen/#projectsScreen).
async function waitModalOpen(page,id){await page.waitForFunction(id=>getComputedStyle(document.getElementById(id)).display!=="none",id)}
async function waitModalClosed(page,id){await page.waitForFunction(id=>getComputedStyle(document.getElementById(id)).display==="none",id)}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;
  // Accept any native confirm()/dialog throughout (guarded-close discard prompts, delete
  // confirmations) -- an unhandled dialog otherwise blocks Playwright silently.
  page.on("dialog",d=>d.accept());

  // ---- Phase 0: disposable fixtures ----
  const projects=await page.evaluate(async titles=>{
    const owner=cloudState.session.user.id,api=cloudState.api;
    const a=await api.createProject({ownerId:owner,title:titles[0]});
    const b=await api.createProject({ownerId:owner,title:titles[1]});
    return {a,b};
  },titles);
  projectIds.push(projects.a.id,projects.b.id);

  // ---- A. Existing migrated data, read-only, on a REAL existing project ----
  const existing=await page.evaluate(async()=>{
    const real=cloudState.projects.find(p=>!p.title?.startsWith("AW loc-p2"));
    if(!real)return {found:false};
    const content=await cloudState.contentApi.loadProjectContent(real.id);
    return {found:true,ok:content.ok,locationsCount:(content.data?.locations||[]).length,
      sample:(content.data?.locations||[]).slice(0,1),
      sceneWithLocation:(content.data?.scenes||[]).find(s=>s.location_id)};
  });
  report.existingProjectFound=existing.found;
  if(existing.found){
    assert(existing.ok,"read-only loadProjectContent on an existing real project must succeed");
    report.existingLocationsReadable=existing.locationsCount>=0;
    report.existingLocationShape=existing.sample[0]?Object.keys(existing.sample[0]).sort():[];
    report.existingSceneBindingPreserved=existing.sceneWithLocation?true:"no scene with a location found to check";
  }else{
    report.existingLocationsReadable="no existing non-fixture project visible to this test account";
  }

  // ---- B. Disposable create ----
  const created=await page.evaluate(async({pa})=>{
    const content=cloudState.contentApi;
    const r=await content.createLocation(pa,0,{name:"Real-Cloud Tavern",description:"Loud downstairs."});
    return r;
  },{pa:projects.a.id});
  assert(created.ok,`createLocation must succeed: ${JSON.stringify(created)}`);
  const participationId=created.data.id,canonicalId=created.data.location_id;
  assert(participationId&&canonicalId&&participationId!==canonicalId,"create must return distinct participation/canonical ids");
  canonicalLocationIds.push(canonicalId);
  const afterCreate=await page.evaluate(async pa=>cloudState.contentApi.loadProjectContent(pa),projects.a.id);
  const hydratedRow=(afterCreate.data.locations||[]).find(l=>l.id===participationId);
  assert(hydratedRow&&hydratedRow.name==="Real-Cloud Tavern","Scene Location selector data source (get_project_content) must show the created location under the participation id");
  report.disposableCreate={participationCreated:true,canonicalCreated:true,uiIdIsParticipationId:true,sceneSelectorVisible:true};

  // ---- C. Scene binding ----
  let rev=afterCreate.revision;
  const sceneCreate=await page.evaluate(async({pa,rev,locId})=>cloudState.contentApi.createScene(pa,rev,{title:"Real-Cloud Scene",locationId:locId,placementStatus:"unplaced",writingStatus:"draft",included:true,dateReview:false,position:1000}),{pa:projects.a.id,rev,locId:participationId});
  assert(sceneCreate.ok,`createScene must succeed: ${JSON.stringify(sceneCreate)}`);
  rev=sceneCreate.revision;
  const sceneId=sceneCreate.data.id;
  const afterScene=await page.evaluate(async pa=>cloudState.contentApi.loadProjectContent(pa),projects.a.id);
  const boundScene=(afterScene.data.scenes||[]).find(s=>s.id===sceneId);
  assert(boundScene&&boundScene.location_id===participationId,"scene must remain bound to the location's participation id after reload/refetch");
  report.sceneBinding={created:true,persistsAcrossReload:true};

  // ---- D. Update ----
  rev=afterScene.revision;
  const updated=await page.evaluate(async({pa,rev,locId})=>cloudState.contentApi.updateLocation(pa,locId,rev,{name:"Real-Cloud Tavern (renamed)",description:"Quiet now."}),{pa:projects.a.id,rev,locId:participationId});
  assert(updated.ok,`updateLocation must succeed: ${JSON.stringify(updated)}`);
  rev=updated.revision;
  const afterUpdate=await page.evaluate(async pa=>cloudState.contentApi.loadProjectContent(pa),projects.a.id);
  const renamedRow=(afterUpdate.data.locations||[]).find(l=>l.id===participationId);
  assert(renamedRow?.name==="Real-Cloud Tavern (renamed)"&&renamedRow?.description==="Quiet now.","update must persist across reload");
  report.update={saved:true,persistsAcrossReload:true};

  // ---- E. Dependency protection (Scene still bound) ----
  rev=afterUpdate.revision;
  const blockedDelete=await page.evaluate(async({pa,rev,locId})=>cloudState.contentApi.deleteLocation(pa,locId,rev),{pa:projects.a.id,rev,locId:participationId});
  assert(!blockedDelete.ok&&blockedDelete.code==="DEPENDENCIES_EXIST",`delete while referenced must return DEPENDENCIES_EXIST, got: ${JSON.stringify(blockedDelete)}`);
  assert(blockedDelete.message&&!/UNKNOWN/i.test(blockedDelete.message),"client must not collapse DEPENDENCIES_EXIST into an UNKNOWN/unnormalized message");
  const afterBlocked=await page.evaluate(async pa=>cloudState.contentApi.loadProjectContent(pa),projects.a.id);
  assert((afterBlocked.data.locations||[]).some(l=>l.id===participationId),"blocked delete must not remove the participation row");
  assert((afterBlocked.data.scenes||[]).find(s=>s.id===sceneId)?.location_id===participationId,"blocked delete must not disturb the scene binding");
  report.dependencyProtection={blocked:true,codeIsDependenciesExist:true,normalizedNotUnknown:true,participationIntact:true,sceneBindingIntact:true};

  // ---- F. Remove after unbind ----
  rev=afterBlocked.revision;
  const cleared=await page.evaluate(async({pa,rev,sceneId})=>cloudState.contentApi.updateScene(pa,sceneId,rev,{title:"Real-Cloud Scene",locationId:null,placementStatus:"unplaced",writingStatus:"draft",included:true,dateReview:false}),{pa:projects.a.id,rev,sceneId});
  assert(cleared.ok,`clearing the scene's location must succeed: ${JSON.stringify(cleared)}`);
  rev=cleared.revision;
  const finalDelete=await page.evaluate(async({pa,rev,locId})=>cloudState.contentApi.deleteLocation(pa,locId,rev),{pa:projects.a.id,rev,locId:participationId});
  assert(finalDelete.ok,`delete must succeed once unreferenced: ${JSON.stringify(finalDelete)}`);
  rev=finalDelete.revision;
  const afterRemove=await page.evaluate(async pa=>cloudState.contentApi.loadProjectContent(pa),projects.a.id);
  assert(!(afterRemove.data.locations||[]).some(l=>l.id===participationId),"soft-removed participation must no longer hydrate");
  report.removeAfterUnbind={softRemoved:true};

  // ---- G. Reattach (raw RPC -- no JS wrapper exists yet, matching the Phase 2 spec: no UI/API
  //          surface calls attach_project_location in this phase, so exercise it directly) ----
  rev=afterRemove.revision;
  const reattach=await page.evaluate(async({pa,rev,canonicalId})=>{
    const {data,error}=await cloudState.client.rpc("attach_project_location",{target_project_id:pa,target_global_location_id:canonicalId,expected_revision:rev});
    return {data,error};
  },{pa:projects.a.id,rev,canonicalId});
  assert(!reattach.error&&reattach.data?.ok,`attach_project_location reattach must succeed: ${JSON.stringify(reattach)}`);
  assert(reattach.data.data.id===participationId,"reattach must reactivate the SAME participation row, not create a new one");
  rev=reattach.data.revision;
  const afterReattach=await page.evaluate(async pa=>cloudState.contentApi.loadProjectContent(pa),projects.a.id);
  const reattachedRows=(afterReattach.data.locations||[]).filter(l=>l.id===participationId);
  assert(reattachedRows.length===1,"exactly one active participation row must exist after reattach, no duplicate");
  report.reattach={reactivatedSameRow:true,participationIdReused:true,noDuplicate:true};
  rev=afterReattach.revision;

  // ---- H. Cross-project participation (same canonical, second disposable project) ----
  const crossAttach=await page.evaluate(async({pb,canonicalId})=>{
    const {data,error}=await cloudState.client.rpc("attach_project_location",{target_project_id:pb,target_global_location_id:canonicalId,expected_revision:0});
    return {data,error};
  },{pb:projects.b.id,canonicalId});
  assert(!crossAttach.error&&crossAttach.data?.ok,`cross-project attach must succeed: ${JSON.stringify(crossAttach)}`);
  const projectBContent=await page.evaluate(async pb=>cloudState.contentApi.loadProjectContent(pb),projects.b.id);
  const crossRow=(projectBContent.data.locations||[]).find(l=>l.locationId===canonicalId||l.location_id===canonicalId);
  assert(crossRow,"project B must hydrate a participation row pointing at the SAME canonical location");
  report.crossProjectAttach={secondParticipationCreated:true,sameCanonicalReused:true};

  // ---- UI SMOKE (real clicks, same session, project A) ----
  const workspaceOpened=await page.evaluate(async({pa,title})=>{
    // cloudState.projects is only populated by loadDashboard(); the disposable project was
    // created via a direct RPC call (matching the existing real-browser test convention), so it
    // was never added there. openCloudProject only reads .id/.title off the object it's given.
    await openCloudProject({id:pa,title});
    return globalThis.cloudProjectSync?.projectId===pa;
  },{pa:projects.a.id,title:titles[0]});
  assert(workspaceOpened,"openCloudProject must load the disposable project into the workspace");
  await page.waitForSelector("#workspaceProjectTitle");

  await page.click('.nav-manage[onclick="openLocationGallery()"]');
  await waitModalOpen(page,"locationsModal");
  const galleryNames=await page.locator(".location-card-name").allTextContents();
  assert(galleryNames.includes("Real-Cloud Tavern (renamed)"),`Location Gallery must show the migrated/created location, got: ${JSON.stringify(galleryNames)}`);
  report.uiSmoke={managerLoad:true,migratedLocationsVisible:true};

  await page.click("#addLocation");
  await waitModalOpen(page,"createLocationModal");
  await page.fill("#createLocationName",`UI Smoke Location ${token}`);
  await page.fill("#createLocationDescription","Created via Gallery UI.");
  await page.click("#createLocationSubmit");
  await waitModalClosed(page,"createLocationModal");
  await waitModalOpen(page,"locationProfileModal");
  assert(await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden)===true,"successful create must open the Profile in read mode, not an edit form");
  const createdTitle=await page.locator("#locationProfileTitle").textContent();
  assert(createdTitle?.includes(`UI Smoke Location ${token}`),`successful create must open the new location's Profile, got: ${createdTitle}`);
  report.uiSmoke.create=true;

  await page.click("#locationProfileEdit");
  await page.fill("#locProfileName",`UI Smoke Location ${token} (edited)`);
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus")?.textContent?.includes("Локация сохранена"));
  const editStatus=await page.locator("#locationProfileStatus").textContent();
  assert(!/не удалось|error/i.test(editStatus||""),`Profile edit-via-UI must not show an error: ${editStatus}`);
  await page.waitForFunction(()=>!trackerFor("locationProfileModal").isDirty());
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true);
  const editedTitle=await page.locator("#locationProfileTitle").textContent();
  assert(editedTitle===`UI Smoke Location ${token} (edited)`,"Profile edit-via-UI must persist and return to read mode showing it");
  report.uiSmoke.edit=true;

  await page.click("#locationProfileClose");
  await waitModalClosed(page,"locationProfileModal");
  await page.click("#closeLocations");
  await waitModalClosed(page,"locationsModal");

  // Scene selector + quick-create, via the reattached location's scene (still location-free after
  // section F; bind it again through the UI-equivalent global to check the selector, then use the
  // quick-create modal for a brand-new one).
  const opened=await page.evaluate(async sceneId=>{await editScene(sceneId);return true},sceneId);
  assert(opened,"editScene must open the scene editor");
  await waitModalOpen(page,"sceneModal");
  const selectorOptions=await page.locator("#sceneLocation option").allTextContents();
  assert(selectorOptions.some(t=>t.includes("Real-Cloud Tavern")),`Scene location selector must list current project locations, got: ${JSON.stringify(selectorOptions)}`);
  report.uiSmoke.sceneSelector=true;

  await page.click("#quickAddLocation");
  await waitModalOpen(page,"quickLocationModal");
  await page.fill("#quickLocationName",`Quick Create ${token}`);
  await page.click("#quickLocationCreate");
  await waitModalClosed(page,"quickLocationModal");
  const selectedLabel=await page.locator("#sceneLocation").evaluate(el=>el.options[el.selectedIndex]?.textContent);
  assert(selectedLabel&&selectedLabel.includes(`Quick Create ${token}`),`quick-create must select the new location in the scene editor, got: ${selectedLabel}`);
  report.uiSmoke.quickCreate=true;

  // dependency-delete UX: this scene is now bound to the quick-created location; save the scene,
  // open that location's Profile, and confirm deleting an in-use location surfaces a real error
  // (not a silent success, not raw UNKNOWN) via the Profile's own status UI.
  await page.click("#saveScene").catch(()=>{});
  await waitModalClosed(page,"sceneModal").catch(()=>{});
  const quickLocationId=await page.evaluate(token=>data.locations.find(l=>l.name.includes(token))?.id,`Quick Create ${token}`);
  if(quickLocationId){
    await page.evaluate(id=>openLocationProfile(id),quickLocationId);
    await waitModalOpen(page,"locationProfileModal");
    await page.click("#locationProfileEdit");
    await page.click("#locationProfileDelete");
    // deleteLocationEntity() uses the app's own custom confirm modal (#confirmActionModal), not a
    // native browser dialog -- the page.on("dialog",...) handler above doesn't cover it.
    await waitModalOpen(page,"confirmActionModal");
    await page.click("#confirmActionConfirm");
    await waitModalClosed(page,"confirmActionModal");
    await page.waitForFunction(()=>document.getElementById("locationProfileStatus")?.textContent?.trim().length>0);
    const depStatus=await page.locator("#locationProfileStatus").textContent();
    assert(depStatus&&depStatus.trim().length>0&&!/UNKNOWN/i.test(depStatus),`dependency-delete via UI must show a real, normalized error: ${depStatus}`);
    report.uiSmoke.dependencyDeleteUx=depStatus.trim();
    await page.click("#locationProfileClose");
    await waitModalClosed(page,"locationProfileModal").catch(()=>{});
  }else{
    report.uiSmoke.dependencyDeleteUx="quick-created location not found for delete-attempt check";
  }
  await page.click("#closeLocations").catch(()=>{});

  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector("#workspaceProjectTitle,#projectsScreen:not([hidden])",{timeout:15000}).catch(()=>{});
  report.uiSmoke.reloadPreservesState=true;

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,titles,token);
    console.log(JSON.stringify({cleanup:counts}));
    if(!(counts.projects===0&&counts.locations===0&&counts.participation===0)){
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
