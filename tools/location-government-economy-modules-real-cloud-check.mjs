// Location Adaptive Modules B3B (governmentSociety, economy) -- real-cloud smoke against the REAL
// production Supabase project (already-applied migration 20260905090000), driven through the
// ACTUAL application paths: js/locations.js's real DOM (Add/Fill/Save, Hide/Show, Delete-confirm),
// the real update_location_canonical / update_project_location_module_selection RPCs via
// js/cloud-content-api.js, and the real list_owned_locations()/participation_count read path.
// Disposable CLOUD_TEST fixture user + TWO disposable projects + one canonical Location (attached
// to both, to exercise participation_count>1), all named with this run's unique token. Skips
// gracefully if credentials are not configured. Mirrors
// tools/location-adaptive-module-selection-real-cloud-check.mjs exactly for login/cleanup
// conventions.
//
// Scope: application-path smoke only. The backend contract itself (allowlist order, generic patch/
// selection/import acceptance, unknown-key rejection, revision semantics) is already exhaustively
// covered by supabase/tests/location_government_economy_modules.sql in disposable CI -- this does
// not repeat that, it proves the REAL frontend wiring against the REAL now-applied production RPC.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location government/economy modules real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectATitle=`AW b3b-A ${token}`;
const projectBTitle=`AW b3b-B ${token}`;
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
    return {projects:remainingProjects.data.length,locations:remainingLocations.data.length,participation:remainingParticipation.data.length};
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

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;

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

  // ---- Fixture: a country-typed canonical Location (both B3B modules STRONGLY RECOMMENDed) ----
  const primaryCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`B3B Country ${token}`,typePreset:"country",description:`Disposable B3B smoke fixture ${token}.`
  }),{pa:projectA.id,rev,token});
  assert(primaryCreate.ok,`create_location_canonical must succeed: ${JSON.stringify(primaryCreate)}`);
  rev=primaryCreate.revision;
  const participationA=primaryCreate.data.id,canonicalId=primaryCreate.data.location_id;
  canonicalLocationIds.push(canonicalId);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));

  // ================= 1: recommendation hint for a country-typed Location =================
  await page.evaluate(id=>openLocationProfile(id),participationA);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
  assert(panelText.includes("Государство и общество")&&panelText.includes("Экономика"),"both B3B modules must be offered in the add panel");
  const recommendTagCount=await page.evaluate(()=>document.querySelectorAll("#locProfileAddSectionPanel .location-thematic-add-chip-recommend-tag").length);
  assert(recommendTagCount===2,`country type must show the recommendation hint for both governmentSociety and economy, got ${recommendTagCount} tags`);
  report.test1_recommendation={ok:true,recommendTagCount};

  // ================= 2-3: add + fill both modules, Save =================
  await page.click(`.location-thematic-add-chip:has-text("Государство и общество")`);
  await page.fill("#locProfileGovernmentForm",`Республика ${token}`);
  await page.fill("#locProfileLeadership",`Президент Ковальская ${token}`);
  await page.fill("#locProfilePoliticalSituation",`Растущее напряжение между столицей и провинциями ${token}.`);
  {const host=await page.$("#locProfileSecurityForces input");await host.fill(`Национальная гвардия ${token}`);await host.press("Enter")}
  await page.click("#locProfileAddSectionToggle");
  await page.click(`.location-thematic-add-chip:has-text("Экономика")`);
  await page.fill("#locProfileCurrency",`Крон ${token}`);
  await page.fill("#locProfileEconomicCharacter",`Развитая экономика услуг с растущим расслоением ${token}.`);
  {const host=await page.$("#locProfileIndustries input");await host.fill(`Туризм ${token}`);await host.press("Enter")}
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  report.test2_3_addFillSave={ok:true};

  // ================= 4: read rendering + persistence across a fresh reopen =================
  await freshReopen(page,projectA,participationA);
  const readState=await page.evaluate(()=>({
    govHidden:document.getElementById("locationProfileGovernmentSociety").hidden,
    econHidden:document.getElementById("locationProfileEconomy").hidden
  }));
  assert(!readState.govHidden&&!readState.econHidden,"both filled B3B modules must show in Read after a fresh reopen");
  const stored=await page.evaluate(id=>locationById(id).baseProfile,participationA);
  assert(stored.governmentSociety?.leadership===`Президент Ковальская ${token}`,"governmentSociety must persist to a fresh cloud read");
  assert(stored.economy?.currency===`Крон ${token}`,"economy must persist to a fresh cloud read");
  report.test4_readAndPersist={ok:true};

  // ================= 5: hide Government, Save/reload; Economy (sibling) unaffected =================
  await page.click("#locationProfileEdit");
  // Government already has data, so its disclosure auto-expands on entry -- no toggle click
  // needed (clicking the toggle here would COLLAPSE it instead, since it starts expanded).
  await page.click("#locProfileGovernmentSocietyHide");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await freshReopen(page,projectA,participationA);
  const afterHide=await page.evaluate(()=>({
    govHidden:document.getElementById("locationProfileGovernmentSociety").hidden,
    econHidden:document.getElementById("locationProfileEconomy").hidden
  }));
  assert(afterHide.govHidden&&!afterHide.econHidden,"hiding Government must not hide sibling Economy");
  const govStillStored=await page.evaluate(id=>locationById(id).baseProfile.governmentSociety,participationA);
  assert(govStillStored?.leadership===`Президент Ковальская ${token}`,"hiding must never touch canonical governmentSociety data");
  report.test5_hideSiblingIsolation={ok:true};

  // ================= 6: show Government again =================
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Государство и общество");
  assert((await page.evaluate(()=>document.getElementById("locProfileGovernmentForm").value))===`Республика ${token}`,"restoring must show the ORIGINAL data");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await freshReopen(page,projectA,participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden)),"restored Government must show in Read again");
  report.test6_show={ok:true};

  // ================= 7: participation_count=1 delete wording for Economy =================
  await page.click("#locationProfileEdit");
  // Economy already has data, so its disclosure auto-expands on entry -- no toggle click needed.
  await page.click("#locProfileEconomyDeleteStart");
  const warningCount1=await page.evaluate(()=>document.getElementById("locProfileEconomyDeleteWarning").textContent);
  assert(warningCount1.includes("будут удалены из локации")&&!/\d+\s+проект/.test(warningCount1),`participation_count=1 must use the plain single-project wording, got: ${warningCount1}`);
  await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-no");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  report.test7_singleProjectWording={ok:true,warningCount1};

  // ================= 8: attach the SAME canonical Location to a 2nd disposable project =================
  let projectBRevision=await page.evaluate(async pb=>{const content=await cloudState.contentApi.loadProjectContent(pb);return content.data.project.revision},projectB.id);
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
  assert(canonicalRow&&canonicalRow.participation_count===2,`participation_count must read 2 after attaching a 2nd project: ${JSON.stringify(canonicalRow)}`);
  report.test8_attach={ok:true,participationCount:canonicalRow.participation_count};

  // ================= 9: participation_count>1 warning, then confirm + Save the Economy delete =================
  await page.click("#locationProfileEdit");
  await page.click("#locProfileEconomyDeleteStart");
  const warningCount2=await page.evaluate(()=>document.getElementById("locProfileEconomyDeleteWarning").textContent);
  assert(warningCount2.includes("2 проектах"),`participation_count=2 must surface the real count in the warning, got: ${warningCount2}`);
  await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-yes");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  report.test9_crossProjectWarningAndDelete={ok:true,warningCount2};

  // ================= 10: canonical Economy delete reflected in BOTH participations; Government
  // (other module) preserved in both =================
  const afterDeleteA=await page.evaluate(id=>locationById(id)?.baseProfile,participationA);
  assert(afterDeleteA&&!("economy" in afterDeleteA),"confirmed+saved Economy delete must remove it from base_profile in participation A");
  assert(afterDeleteA.governmentSociety?.leadership===`Президент Ковальская ${token}`,"deleting Economy must not affect sibling Government data");

  await page.evaluate(async project=>{await openCloudProject(project)},projectB);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const afterDeleteB=await page.evaluate(id=>locationById(id)?.baseProfile,participationB);
  assert(afterDeleteB&&!("economy" in afterDeleteB),"canonical Economy delete from participation A must be reflected in participation B");
  assert(afterDeleteB.governmentSociety?.leadership===`Президент Ковальская ${token}`,"Government data must survive intact in participation B too (shared canonical row)");
  report.test10_crossParticipationReflection={ok:true};

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,stack:error.stack,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectATitle,projectBTitle],token);
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
