// Location Adaptive Module Selection (Phase 1) -- real-cloud smoke against the REAL production
// Supabase project (already-applied migration 20260904140000), driven through the ACTUAL
// application paths: js/locations.js's real DOM (Add/Show/Hide/Remove/Delete-confirm buttons,
// Save), the real update_project_location_module_selection RPC via js/cloud-content-api.js, and
// the real list_owned_locations()/participation_count read path. Disposable CLOUD_TEST fixture
// user + TWO disposable projects + a primary canonical Location (attached to both, to exercise
// participation_count>1) + a child canonical Location (parent/hierarchy + "Внутри"), all named
// with this run's unique token. Skips gracefully if credentials are not configured. Mirrors
// tools/location-phase-b3a-real-cloud-check.mjs exactly for login/cleanup conventions.
//
// Scope: application-path smoke only. The backend contract itself (namespace/merge correctness,
// normalization, RLS/cross-owner isolation, no-op semantics) is already exhaustively covered by
// supabase/tests/location_adaptive_module_selection.sql in disposable CI -- this does not repeat
// that, it proves the REAL frontend wiring against the REAL now-applied production RPC.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location adaptive module selection real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectATitle=`AW adaptive-A ${token}`;
const projectBTitle=`AW adaptive-B ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

async function login(){
  const context=await browser.newContext();
  const page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(base,{waitUntil:"networkidle"});
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
  await page.waitForFunction(()=>globalThis.cloudState?.dashboardStatus==="success",null,{timeout:60000});
  return {context,page};
}

// Same convention as location-phase-b3a-real-cloud-check.mjs's cleanup(): delete disposable
// projects (cascades project_locations/scenes), then delete every canonical Location this account
// owns whose name contains this run's token -- not just the ones this script captured an id for.
async function cleanup(page,projectIds,canonicalLocationIds,titles,token){
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
    const remainingScenes=projects.length?await client.from("scenes").select("id").in("project_id",projects):{data:[]};
    return {
      projects:remainingProjects.data.length,locations:remainingLocations.data.length,
      participation:remainingParticipation.data.length,scenes:remainingScenes.data.length
    };
  },{projectIds,canonicalLocationIds,titles,token});
}

async function openAddPanelChip(page,label){
  await page.click("#locProfileAddSectionToggle");
  await page.click(`.location-thematic-add-chip:has-text("${label}")`);
}
async function freshReopen(page,project,participationId){
  // Cold server read + real UI reopen -- not just in-memory post-save state (same guarantee a
  // page reload would prove; a genuine full page.reload() is exercised once below for step 9).
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationId);
}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;

  // ---- Fixture: two disposable projects ----
  const projectA=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectATitle);
  projectIds.push(projectA.id);
  const projectB=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectBTitle);
  projectIds.push(projectB.id);

  // ---- Open project A through the REAL workspace path ----
  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},projectA);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  assert(opened,"openCloudProject must reach workspace state for disposable project A");
  let rev=(await page.evaluate(()=>cloudProjectSync.revision));

  // ---- Fixture: primary Location, bare/legacy shape (no base_profile modules at all) ----
  const primaryCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`Adaptive Primary ${token}`,typePreset:"settlement",description:`Disposable adaptive-selection smoke fixture ${token}.`
  }),{pa:projectA.id,rev,token});
  assert(primaryCreate.ok,`create_location_canonical (primary) must succeed: ${JSON.stringify(primaryCreate)}`);
  rev=primaryCreate.revision;
  const participationA=primaryCreate.data.id,canonicalId=primaryCreate.data.location_id;
  canonicalLocationIds.push(canonicalId);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));

  // ================= 1-5: legacy/default adaptive behavior, no moduleSelection metadata =================
  await page.evaluate(id=>openLocationProfile(id),participationA);
  const readState=await page.evaluate(()=>({appearanceHidden:document.getElementById("locationProfileAppearance").hidden,geographyHidden:document.getElementById("locationProfileGeography").hidden}));
  assert(readState.appearanceHidden&&readState.geographyHidden,"fresh Location: neither thematic module shows in Read");
  await page.click("#locationProfileEdit");
  const editState=await page.evaluate(()=>({
    appearanceModuleHidden:document.getElementById("locProfileAppearanceModule").hidden,
    geographyModuleHidden:document.getElementById("locProfileGeographyModule").hidden,
    addWrapperHidden:document.getElementById("locationProfileThematicAdd").hidden
  }));
  assert(editState.appearanceModuleHidden&&editState.geographyModuleHidden,"fresh Location: neither module renders as an accordion in Edit");
  assert(!editState.addWrapperHidden,"+ Добавить раздел must be visible when both catalog modules are candidates");
  report.test1_5_legacyDefault={ok:true};

  // ================= 6-7: add empty Appearance, Save =================
  await openAddPanelChip(page,"Внешний вид и атмосфера");
  assert(!(await page.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden)),"adding empty Appearance must render the accordion immediately");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  report.test6_7_addEmptySave={ok:true};

  // ================= 8-10: genuine full page reload; empty module persists in Edit (shown), absent in Read =================
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector("#projectsScreen:not([hidden]), body[data-app-state=\"workspace\"]",{timeout:20000});
  await freshReopen(page,projectA,participationA);
  const afterReloadRead=await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden);
  assert(afterReloadRead,"empty added module must NOT appear in Read after a genuine full page reload");
  await page.click("#locationProfileEdit");
  assert(!(await page.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden)),"a persisted empty `shown` module must still render as an accordion after a genuine full page reload");
  const moduleSelectionAfterReload=await page.evaluate(id=>locationById(id).moduleSelection,participationA);
  assert(moduleSelectionAfterReload&&Array.isArray(moduleSelectionAfterReload.shown)&&moduleSelectionAfterReload.shown.includes("appearanceAtmosphere"),`moduleSelection.shown must survive a full reload: ${JSON.stringify(moduleSelectionAfterReload)}`);
  report.test8_10_persistAcrossReload={ok:true,moduleSelectionAfterReload};

  // ================= 11-12: remove persisted empty module, Save/reload, stays removed =================
  await page.click("#locProfileAppearanceToggle"); // expand (persisted-empty starts collapsed)
  await page.click("#locProfileAppearanceRemove");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await freshReopen(page,projectA,participationA);
  const afterRemoveSelection=await page.evaluate(id=>locationById(id).moduleSelection,participationA);
  assert(!(afterRemoveSelection&&afterRemoveSelection.shown&&afterRemoveSelection.shown.length),`removing a PERSISTED shown module must clear it from storage on Save: ${JSON.stringify(afterRemoveSelection)}`);
  await page.click("#locationProfileEdit");
  assert(await page.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden),"a removed persisted-empty module must not render as an accordion after reload");
  report.test11_12_removePersisted={ok:true};

  // ================= 13-14: add + fill Appearance, Save/reload =================
  await openAddPanelChip(page,"Внешний вид и атмосфера");
  await page.fill("#locProfileVisualDescription",`Просторный зал с высокими окнами ${token}.`);
  await page.fill("#locProfileAtmosphere",`Спокойно и торжественно ${token}.`);
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await freshReopen(page,projectA,participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden)),"populated Appearance must show in Read after reload");
  const appearanceAfterFill=await page.evaluate(id=>locationById(id).baseProfile.appearanceAtmosphere,participationA);
  assert(appearanceAfterFill?.visualDescription===`Просторный зал с высокими окнами ${token}.`,"Appearance data must persist to a fresh cloud read");
  report.test13_14_addFillSave={ok:true};

  // ================= 15-17: hide Appearance, Save/reload; absent Read, absent edit-visible, picker offers Показать раздел, data preserved =================
  await page.click("#locationProfileEdit");
  assert(!(await page.evaluate(()=>document.getElementById("locProfileAppearanceHide").hidden)),"populated module must offer Скрыть раздел");
  await page.click("#locProfileAppearanceHide");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await freshReopen(page,projectA,participationA);
  assert(await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden),"hidden populated module must NOT appear in Read after reload");
  await page.click("#locationProfileEdit");
  assert(await page.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden),"hidden populated module must not be an edit-visible accordion after reload");
  await page.click("#locProfileAddSectionToggle");
  const panelAfterHide=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").innerHTML);
  assert(/showLocationThematicModule\('appearanceAtmosphere'\)/.test(panelAfterHide)&&panelAfterHide.includes("есть данные"),`picker must offer Показать раздел tagged "есть данные" for the hidden populated module: ${panelAfterHide}`);
  const appearanceStillStored=await page.evaluate(id=>locationById(id).baseProfile.appearanceAtmosphere,participationA);
  assert(appearanceStillStored?.visualDescription===`Просторный зал с высокими окнами ${token}.`,"hiding must NEVER touch canonical base_profile data");
  report.test15_17_hidePersist={ok:true};

  // ================= 18-19: restore Appearance, Save/reload, data reappears =================
  await page.click(".location-thematic-add-chip:has-text(\"Внешний вид и атмосфера\")");
  assert(!(await page.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden)),"Показать раздел must restore the accordion immediately");
  assert((await page.evaluate(()=>document.getElementById("locProfileVisualDescription").value))===`Просторный зал с высокими окнами ${token}.`,"restoring must show the ORIGINAL data, not a blank form");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await freshReopen(page,projectA,participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden)),"restored module must show in Read again after Save+reload");
  report.test18_19_restore={ok:true};

  // ================= 20-21: add + fill Geography as sibling, both coexist =================
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"География и природа");
  await page.fill("#locProfileTerrain",`Прибрежная терраса ${token}`);
  await page.fill("#locProfileClimate",`Мягкий морской ${token}`);
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await freshReopen(page,projectA,participationA);
  const bothState=await page.evaluate(()=>({appearanceHidden:document.getElementById("locationProfileAppearance").hidden,geographyHidden:document.getElementById("locationProfileGeography").hidden}));
  assert(!bothState.appearanceHidden&&!bothState.geographyHidden,"both modules must coexist and both show in Read");
  report.test20_21_bothCoexist={ok:true};

  // ================= 22-24: prepare delete on Appearance, Cancel (inline), data remains =================
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAppearanceDeleteStart");
  assert(!(await page.evaluate(()=>document.getElementById("locProfileAppearanceDeleteConfirm").hidden)),"Удалить данные раздела must show an inline Да/Отмена confirm");
  await page.click("#locProfileAppearanceDeleteConfirm .location-thematic-delete-confirm-no");
  assert(!(await page.evaluate(()=>document.getElementById("locProfileAppearanceHide").hidden)),"cancelling the inline delete-confirm must restore the normal Скрыть/Удалить action row");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  const afterCancelDiscard=await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display);
  if(afterCancelDiscard==="flex")await page.click("#discardChanges");
  const appearanceAfterCancel=await page.evaluate(id=>locationById(id).baseProfile.appearanceAtmosphere,participationA);
  assert(appearanceAfterCancel?.visualDescription===`Просторный зал с высокими окнами ${token}.`,"Cancel after starting a delete-confirm must fully discard it -- data survives");
  report.test22_24_cancelDelete={ok:true};

  // ================= 31: participation_count=1 delete wording (before the 2nd-project attach) =================
  await page.click("#locationProfileEdit");
  await page.click("#locProfileGeographyDeleteStart");
  const warningCount1=await page.evaluate(()=>document.getElementById("locProfileGeographyDeleteWarning").textContent);
  assert(warningCount1.includes("будут удалены из локации")&&!/\d+\s+проект/.test(warningCount1),`participation_count=1 must use the plain single-project wording, got: ${warningCount1}`);
  await page.click("#locProfileGeographyDeleteConfirm .location-thematic-delete-confirm-no");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  report.test31_singleProjectWording={ok:true,warningCount1};

  // ================= 32-36: attach the SAME canonical Location to a 2nd disposable project =================
  // No dedicated UI exists yet for cross-project attach (by design -- see the Phase 2 migration
  // header, "no Location Gallery" at the time); attach_project_location is nonetheless a real,
  // already-deployed production RPC. Call it directly via the authenticated Supabase client
  // (the same real API surface cleanup() above already uses), not a hand-rolled table write.
  let projectBRevision=await page.evaluate(async pb=>{
    const content=await cloudState.contentApi.loadProjectContent(pb);
    return content.data.project.revision;
  },projectB.id);
  const attachResult=await page.evaluate(async({pb,rev,canonicalId})=>{
    const {data,error}=await cloudState.client.rpc("attach_project_location",{target_project_id:pb,target_global_location_id:canonicalId,expected_revision:rev});
    if(error)return {ok:false,message:error.message};
    return data;
  },{pb:projectB.id,rev:projectBRevision,canonicalId});
  assert(attachResult.ok,`attach_project_location must succeed: ${JSON.stringify(attachResult)}`);
  const participationB=attachResult.data.id;

  await freshReopen(page,projectA,participationA);
  await page.evaluate(()=>loadOwnedLocationRows(true));
  const rowsAfterAttach=await page.evaluate(()=>[...ownedLocationRowsSync().values()]);
  const canonicalRow=rowsAfterAttach.find(r=>r.id===canonicalId);
  assert(canonicalRow&&canonicalRow.participation_count===2,`participation_count must read 2 from the live list_owned_locations() after attaching a 2nd project: ${JSON.stringify(canonicalRow)}`);
  report.test32_34_attachAndCount={ok:true,participationCount:canonicalRow.participation_count};

  // 35-36: cross-project warning driven by the REAL live participation_count, not just text.
  await page.click("#locationProfileEdit");
  await page.click("#locProfileGeographyDeleteStart");
  const warningCount2=await page.evaluate(()=>document.getElementById("locProfileGeographyDeleteWarning").textContent);
  // Cyrillic letters are NOT in JavaScript's (non-Unicode) \w class, so \b around "проектах"
  // never matches -- plain substring checks are the correct tool here, not \b regex boundaries.
  assert(warningCount2.includes("2 проектах"),`participation_count=2 must surface the real count in the warning, got: ${warningCount2}`);
  assert(canonicalRow.participation_count===2,"the warning's number must match the live participation_count value, not a hardcoded/placeholder string");
  report.test35_36_crossProjectWarning={ok:true,warningCount2,livePcount:canonicalRow.participation_count};

  // ================= 25-27, 37: confirm the prepared delete, Save; verify sibling preserved, no
  // phantom shown/hidden state, cross-participation reflection, and selection-only dirty-state =================
  // (37) Confirm the Geography delete now (still project A's editor) -- proves deletion from one
  // participation reflects in the other, since Geography is canonical/shared.
  await page.click("#locProfileGeographyDeleteConfirm .location-thematic-delete-confirm-yes");
  // 27: selection-only Hide on Appearance in the SAME draft, with no field edit, must still mark
  // the form dirty and enable Save (dirty-tracker wired to moduleSelection, not just serializeForm).
  const dirtyBeforeHide=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
  await page.click("#locProfileAppearanceHide");
  const dirtyAfterHide=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
  const saveEnabledAfterHide=await page.evaluate(()=>!document.getElementById("locationProfileSave").disabled);
  assert(dirtyBeforeHide&&dirtyAfterHide&&saveEnabledAfterHide,"a selection-only Hide action (no field edit) must mark the form dirty and enable Save");
  // Undo the extra Hide before saving so this run's assertions below stay scoped to the delete.
  await page.click("#locProfileAddSectionToggle");
  await page.click(".location-thematic-add-chip:has-text(\"Внешний вид и атмосфера\")");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});

  const afterDelete=await page.evaluate(id=>{const l=locationById(id);return {baseProfile:l.baseProfile,moduleSelection:l.moduleSelection}},participationA);
  assert(!("geography" in afterDelete.baseProfile),"confirmed + saved delete must remove geography from base_profile entirely");
  assert(afterDelete.baseProfile.appearanceAtmosphere?.visualDescription===`Просторный зал с высокими окнами ${token}.`,"deleting Geography must not affect the sibling Appearance module's data");
  const sel=afterDelete.moduleSelection||{shown:[],hidden:[]};
  assert(!(sel.shown||[]).includes("geography")&&!(sel.hidden||[]).includes("geography"),`deleted module must leave no phantom shown/hidden state: ${JSON.stringify(sel)}`);
  report.test25_27_confirmDelete={ok:true,selectionityAfterDelete:sel};

  // 37 (continued): reopen via participation B (project B) and confirm Geography is gone there too.
  await page.evaluate(async project=>{await openCloudProject(project)},projectB);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const rowInProjectB=await page.evaluate(id=>locationById(id)?.baseProfile,participationB);
  assert(rowInProjectB&&!("geography" in rowInProjectB),"canonical delete from participation A must be reflected in participation B (shared canonical data)");
  report.test37_crossParticipationReflection={ok:true};

  // ================= 28-29: parent/hierarchy editing + "Внутри" =================
  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  let revA=(await page.evaluate(()=>cloudProjectSync.revision));
  const childCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`Adaptive Child ${token}`,typePreset:"room",description:""
  }),{pa:projectA.id,rev:revA,token});
  assert(childCreate.ok,`create_location_canonical (child) must succeed: ${JSON.stringify(childCreate)}`);
  const participationChild=childCreate.data.id,childCanonicalId=childCreate.data.location_id;
  canonicalLocationIds.push(childCanonicalId);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(()=>loadOwnedLocationRows(true));
  await page.evaluate(id=>openLocationProfile(id),participationChild);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileParent");
  await page.fill("#locProfileParent",`Adaptive Primary ${token}`);
  await page.waitForTimeout(300);
  await page.locator("#locProfileParentListbox [role=\"option\"]",{hasText:`Adaptive Primary ${token}`}).first().click();
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  const childParentId=await page.evaluate(id=>locationById(id).parentId,participationChild);
  assert(childParentId===canonicalId,`parent/hierarchy save must persist: expected ${canonicalId}, got ${childParentId}`);

  await freshReopen(page,projectA,participationA);
  const insideList=await page.evaluate(()=>document.getElementById("locationProfileChildren").hidden);
  assert(!insideList,"Внутри must show the newly-parented child Location");
  const insideText=await page.evaluate(()=>document.getElementById("locationProfileChildren").textContent);
  assert(insideText.includes(`Adaptive Child ${token}`),"Внутри must list the child Location by name");
  report.test28_29_parentAndInside={ok:true};

  // ================= 30: Сцены здесь unaffected, with a disposable Scene =================
  let revForScene=(await page.evaluate(()=>cloudProjectSync.revision));
  const sceneCreate=await page.evaluate(({pa,rev,pid,token})=>cloudState.contentApi.createScene(pa,rev,{title:`Adaptive Scene ${token}`,chapterId:null,locationId:pid,placementStatus:"unplaced",writingStatus:"draft"}),{pa:projectA.id,rev:revForScene,pid:participationA,token});
  assert(sceneCreate.ok,`create_scene must succeed: ${JSON.stringify(sceneCreate)}`);
  await freshReopen(page,projectA,participationA);
  const scenesHereText=await page.evaluate(()=>document.getElementById("locationProfileScenes").textContent);
  assert(scenesHereText.includes(`Adaptive Scene ${token}`),"Сцены здесь must list the disposable Scene, unaffected by the adaptive shell");
  report.test30_scenesHere={ok:true};

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,stack:error.stack,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectATitle,projectBTitle],token);
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
