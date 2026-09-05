// Location Adaptive Modules B3C (populationCulture) -- FULL real-cloud round-trip against the REAL
// production Supabase project (migration 20260906090000, now applied), driven through the ACTUAL
// application paths: js/locations.js's real DOM, the real update_location_canonical/update_
// project_location_module_selection/import_local_project_content/attach_project_location RPCs via
// js/cloud-content-api.js, and the real list_owned_locations()/participation_count read path.
// Disposable CLOUD_TEST fixture user + THREE disposable projects (two for the attach/cross-project
// scenario, one empty target for the local->cloud import scenario) + canonical Locations, all named
// with this run's unique token. Skips gracefully if credentials are not configured.
//
// Scope: application-path smoke only. The backend contract itself (allowlist order, generic patch/
// selection/import acceptance, unknown-key rejection, revision semantics) is already exhaustively
// covered by supabase/tests/location_population_culture_module.sql in disposable CI -- this proves
// the REAL frontend wiring against the REAL now-live production backend, mirroring
// tools/location-government-economy-modules-real-cloud-check.mjs's exact structure/conventions.
//
// NOTE: this script requires Playwright + a real browser binary. In the environment this migration
// was authored and applied in, neither was available, so the equivalent RPC-level round trip (all
// 8 scenarios below, minus DOM assertions) was instead run directly via @supabase/supabase-js --
// see the B3C completion report for that run's full output. This file is committed so a future
// session WITH Playwright available can run the real UI-driven version.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location population/culture module real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectATitle=`AW b3c-A ${token}`;
const projectBTitle=`AW b3c-B ${token}`;
const projectImportTitle=`AW b3c-import ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};
function deepEqual(a,b){
  if(a===b)return true;
  if(typeof a!==typeof b||a===null||b===null)return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>deepEqual(v,b[i]));
  if(typeof a==="object"){
    const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
    if(ak.length!==bk.length||ak.some((k,i)=>k!==bk[i]))return false;
    return ak.every(k=>deepEqual(a[k],b[k]));
  }
  return false;
}

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
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationId);
}
async function saveAndWait(page){
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
}
async function fillMultiValue(page,hostId,value){
  const host=await page.$(`#${hostId} input`);await host.fill(value);await host.press("Enter");
}
function fullExpected(t){
  return {
    populationCharacter:`Космополитичный порт ${t}.`,
    peoplesAndGroups:[`Докерская гильдия ${t}`],
    languages:[`Общий ${t}`],
    customsAndTraditions:`Новичок обязан поставить первую кружку ${t}.`,
    holidays:[`Праздник прилива ${t}`],
    beliefs:[`Вера моряков ${t}`],
    socialNorms:`Не свистеть на корабле ${t}.`
  };
}
async function fillPopulationCultureFields(page,m){
  await page.fill("#locProfilePopulationCharacter",m.populationCharacter);
  await fillMultiValue(page,"locProfilePeoplesAndGroups",m.peoplesAndGroups[0]);
  await fillMultiValue(page,"locProfileLanguages",m.languages[0]);
  await page.fill("#locProfileCustomsAndTraditions",m.customsAndTraditions);
  await fillMultiValue(page,"locProfileHolidays",m.holidays[0]);
  await fillMultiValue(page,"locProfileBeliefs",m.beliefs[0]);
  await page.fill("#locProfileSocialNorms",m.socialNorms);
}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;
  const full=fullExpected(token);

  const projectA=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectATitle);
  projectIds.push(projectA.id);
  const projectB=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectBTitle);
  projectIds.push(projectB.id);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},projectA);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  assert(opened,"openCloudProject must reach workspace state for disposable project A");
  let rev=(await page.evaluate(()=>cloudProjectSync.revision));

  // A country-typed canonical Location, pre-seeded with Economy so the sibling-isolation checks
  // below have real data to prove untouched, not just "still absent".
  const primaryCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`B3C Country ${token}`,typePreset:"country",description:`Disposable B3C smoke fixture ${token}.`
  }),{pa:projectA.id,rev,token});
  assert(primaryCreate.ok,`create_location_canonical must succeed: ${JSON.stringify(primaryCreate)}`);
  rev=primaryCreate.revision;
  const participationA=primaryCreate.data.id,canonicalId=primaryCreate.data.location_id;
  canonicalLocationIds.push(canonicalId);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationA);
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Экономика");
  await page.fill("#locProfileCurrency",`Крон ${token}`);
  await saveAndWait(page);
  report.setup_economy={ok:true};

  // ================= 1: recommendation hint (country: strong) =====================================
  await freshReopen(page,projectA,participationA);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
  assert(panelText.includes("Население и культура"),"populationCulture must be offered in the add panel");
  const recommendTag=await page.evaluate(()=>{
    const chip=[...document.querySelectorAll("#locProfileAddSectionPanel .location-thematic-add-chip")].find(el=>el.textContent.includes("Население и культура"));
    return chip?.textContent.includes("Рекомендуется");
  });
  assert(recommendTag,"country type must show the recommendation hint for populationCulture");
  report.test1_recommendationCountry={ok:true};

  // ================= 2-3: full seven-field add/fill/Save/reload ===================================
  await openAddPanelChip(page,"Население и культура");
  await fillPopulationCultureFields(page,full);
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.populationCulture,participationA);
    assert(deepEqual(stored,full),`populationCulture must persist byte-exact: ${JSON.stringify(stored)} !== ${JSON.stringify(full)}`);
    const readHidden=await page.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden);
    assert(!readHidden,"populated Population & Culture must show in Read");
    const readText=await page.evaluate(()=>document.getElementById("locationProfilePopulationCulture").textContent);
    assert(readText.includes(full.populationCharacter)&&readText.includes(full.peoplesAndGroups[0])&&readText.includes(full.holidays[0]),"Read rendering must include all filled fields");
  }
  report.test2_3_addFillVerify={ok:true};

  // ================= 4: Hide; canonical data preserved; add-panel offers Show ======================
  await page.click("#locationProfileEdit");
  await page.click("#locProfilePopulationCultureHide");
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  assert(await page.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden),"hidden Population & Culture must not show in Read");
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.populationCulture,participationA);
    assert(deepEqual(stored,full),"hiding must never touch canonical populationCulture data");
  }
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelAfterHide=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").innerHTML);
  assert(/showLocationThematicModule\('populationCulture'\)/.test(panelAfterHide)&&panelAfterHide.includes("есть данные"),"add panel must offer Показать раздел for the hidden populated module");
  report.test4_hide={ok:true};

  // ================= 5: Restore, verify data returns ===============================================
  await page.click(`.location-thematic-add-chip:has-text("Население и культура")`);
  {
    const restored=await page.evaluate(()=>document.getElementById("locProfilePopulationCharacter").value);
    assert(restored===full.populationCharacter,"restoring must show the ORIGINAL populationCharacter");
  }
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden)),"restored module must show in Read again");
  report.test5_show={ok:true};

  // ================= 6: Delete data -- Cancel first (preserved), then confirm+Save ================
  await page.click("#locationProfileEdit");
  await page.click("#locProfilePopulationCultureDeleteStart");
  await page.click("#locProfilePopulationCultureDeleteConfirm .location-thematic-delete-confirm-no");
  await page.click("#locationProfileCancelEdit");
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex"){await page.click("#discardChanges")}
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.populationCulture,participationA);
    assert(deepEqual(stored,full),"cancelling delete must leave canonical data untouched");
  }
  await page.click("#locationProfileEdit");
  await page.click("#locProfilePopulationCultureDeleteStart");
  await page.click("#locProfilePopulationCultureDeleteConfirm .location-thematic-delete-confirm-yes");
  await saveAndWait(page);
  {
    const stored=await page.evaluate(id=>locationById(id)?.baseProfile,participationA);
    assert(!("populationCulture" in stored),"confirmed delete must remove populationCulture from base_profile");
    assert(stored.economy?.currency===`Крон ${token}`,"deleting populationCulture must not affect sibling economy");
  }
  report.test6_deleteCancelConfirm={ok:true};

  // ================= 7: unknown key still rejected (historyNotes -- populationCulture itself is
  // now legitimately allowlisted) ====================================================================
  {
    rev=(await page.evaluate(()=>cloudProjectSync.revision));
    const owned=await page.evaluate(()=>cloudState.contentApi.listOwnedLocations());
    const row=owned.data.find(r=>r.id===canonicalId);
    const r=await page.evaluate(({canonicalId,rev,token})=>cloudState.contentApi.updateLocationCanonical(canonicalId,rev,{
      name:`B3C Country ${token}`,typePreset:"country",description:"",baseProfilePatch:{historyNotes:{note:"still not allowlisted"}}
    }),{canonicalId,rev:row.revision,token});
    assert(!r.ok,`an unallowlisted key must still be rejected on live production: ${JSON.stringify(r)}`);
  }
  report.test7_unknownKeyRejected={ok:true};

  // ================= 8: cross-project participation_count =========================================
  await page.evaluate(async project=>{await openCloudProject(project)},projectB);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const revB=(await page.evaluate(()=>cloudProjectSync.revision));
  // contentApi has no attachProjectLocation wrapper (see js/cloud-content-api.js) -- call the RPC directly.
  const attachDirect=await page.evaluate(({pb,revB,canonicalId})=>cloudState.client.rpc("attach_project_location",{target_project_id:pb,target_global_location_id:canonicalId,expected_revision:revB}).then(({data,error})=>error?{ok:false,message:error.message}:data),{pb:projectB.id,revB,canonicalId});
  assert(attachDirect.ok,`attach_project_location must succeed: ${JSON.stringify(attachDirect)}`);
  await page.evaluate(()=>loadOwnedLocationRows(true));
  const rowsAfterAttach=await page.evaluate(()=>[...ownedLocationRowsSync().values()]);
  const canonicalRow=rowsAfterAttach.find(r=>r.id===canonicalId);
  assert(canonicalRow&&canonicalRow.participation_count===2,`participation_count must read 2 after attaching a 2nd project: ${JSON.stringify(canonicalRow)}`);
  report.test8_crossProjectCount={ok:true,participationCount:canonicalRow.participation_count};

  // ================= 9: LOCAL -> CLOUD IMPORT ======================================================
  const importProject=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectImportTitle);
  projectIds.push(importProject.id);
  const importResultFull=await page.evaluate(async({pid,token})=>{
    const payload={
      project_id:pid,source_project_id:`b3c-real-cloud-${token}`,migration_attempt_id:crypto.randomUUID(),
      characters:[],chapters:[],
      locations:[{
        id:crypto.randomUUID(),name:`Imported Town ${token}`,description:"Imported via real-cloud check.",
        base_profile:{
          economy:{currency:`Imported Coin ${token}`},
          populationCulture:{populationCharacter:`Imported Populace ${token}`,languages:[`Imported Lang ${token}`]},
          historyNotes:"not-an-object"
        }
      }],
      tags:[],scenes:[],scene_tags:[],scene_characters:[],initial_relations:[],scene_relation_changes:[],structural_links:[],character_images:[]
    };
    const {data,error}=await cloudState.client.rpc("import_local_project_content",{
      target_project_id:pid,expected_revision:0,migration_attempt_id:payload.migration_attempt_id,source_project_id:payload.source_project_id,import_payload:payload
    });
    if(error)return {ok:false,message:error.message};
    return data;
  },{pid:importProject.id,token});
  assert(importResultFull.ok,`local->cloud import with populationCulture must succeed: ${JSON.stringify(importResultFull)}`);
  await page.evaluate(async project=>{await openCloudProject(project)},importProject);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const importedLocation=await page.evaluate(()=>globalThis.data.locations.find(l=>l.name?.startsWith("Imported Town")));
  canonicalLocationIds.push(importedLocation?.locationId);
  assert(importedLocation?.baseProfile?.populationCulture?.populationCharacter===`Imported Populace ${token}`,"imported populationCulture must survive with the exact value");
  assert(importedLocation?.baseProfile?.economy?.currency===`Imported Coin ${token}`,"imported economy must survive alongside populationCulture");
  assert(!("historyNotes" in (importedLocation?.baseProfile||{})),"malformed (non-object) historyNotes must be dropped by import sanitization");
  report.test9_localCloudImport={ok:true};

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,stack:error.stack,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectATitle,projectBTitle,projectImportTitle],token);
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
