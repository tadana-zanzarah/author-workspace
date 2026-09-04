// Location Adaptive Modules B3B (governmentSociety, economy) -- FULL real-cloud round-trip against
// the REAL production Supabase project (migration 20260905090000, now applied), driven through the
// ACTUAL application paths: js/locations.js's real DOM, the real update_location_canonical /
// update_project_location_module_selection / import_local_project_content RPCs via
// js/cloud-content-api.js, and the real list_owned_locations()/participation_count read path.
// Disposable CLOUD_TEST fixture user + THREE disposable projects (two for the attach/cross-project
// scenario, one empty target for the local->cloud import scenario) + canonical Locations, all named
// with this run's unique token. Skips gracefully if credentials are not configured.
//
// Scope: application-path smoke only. The backend contract itself (allowlist order, generic patch/
// selection/import acceptance, unknown-key rejection, revision semantics) is already exhaustively
// covered by supabase/tests/location_government_economy_modules.sql in disposable CI -- this proves
// the REAL frontend wiring (and, for import, the real RPC call shape) against the REAL now-live
// production backend.
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
const projectImportTitle=`AW b3b-import ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};
// Order-independent structural equality -- Postgres jsonb does not preserve object key insertion
// order, so a plain JSON.stringify(a)===JSON.stringify(b) comparison would false-positive-fail on
// semantically identical values whose keys merely came back in a different order.
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
async function addChip(page,label){await page.click(`.location-thematic-add-chip:has-text("${label}")`)}
async function fillMultiValue(page,hostId,value){
  const host=await page.$(`#${hostId} input`);await host.fill(value);await host.press("Enter");
}
function govExpected(t){
  return {
    governmentForm:`Республика ${t}`,leadership:`Президент Ковальская ${t}`,
    politicalSituation:`Растущее напряжение между столицей и провинциями ${t}.`,
    lawsAndRules:`Ношение оружия в столице запрещено без разрешения ${t}.`,
    securityForces:[`Национальная гвардия ${t}`],notableInstitutions:[`Верховный суд ${t}`]
  };
}
function econExpected(t){
  return {
    currency:`Крон ${t}`,economicCharacter:`Развитая экономика услуг с растущим расслоением ${t}.`,
    industries:[`Туризм ${t}`],costOfLiving:`Очень дорого в столице ${t}.`,
    scarcity:[`Чистая вода ${t}`],tradeConnections:[`Морской путь на юг ${t}`]
  };
}
async function fillGovernmentFields(page,g){
  await page.fill("#locProfileGovernmentForm",g.governmentForm);
  await page.fill("#locProfileLeadership",g.leadership);
  await page.fill("#locProfilePoliticalSituation",g.politicalSituation);
  await page.fill("#locProfileLawsAndRules",g.lawsAndRules);
  await fillMultiValue(page,"locProfileSecurityForces",g.securityForces[0]);
  await fillMultiValue(page,"locProfileNotableInstitutions",g.notableInstitutions[0]);
}
async function fillEconomyFields(page,e){
  await page.fill("#locProfileCurrency",e.currency);
  await page.fill("#locProfileEconomicCharacter",e.economicCharacter);
  await fillMultiValue(page,"locProfileIndustries",e.industries[0]);
  await page.fill("#locProfileCostOfLiving",e.costOfLiving);
  await fillMultiValue(page,"locProfileScarcity",e.scarcity[0]);
  await fillMultiValue(page,"locProfileTradeConnections",e.tradeConnections[0]);
}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;
  const gov=govExpected(token),econ=econExpected(token);

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

  // ---- Fixture: a country-typed canonical Location, pre-seeded with Appearance+Geography so the
  // sibling-isolation checks below have real data to prove untouched, not just "still absent". ----
  const primaryCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`B3B Country ${token}`,typePreset:"country",description:`Disposable B3B smoke fixture ${token}.`
  }),{pa:projectA.id,rev,token});
  assert(primaryCreate.ok,`create_location_canonical must succeed: ${JSON.stringify(primaryCreate)}`);
  rev=primaryCreate.revision;
  const participationA=primaryCreate.data.id,canonicalId=primaryCreate.data.location_id;
  canonicalLocationIds.push(canonicalId);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationA);
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Внешний вид и атмосфера");
  await page.fill("#locProfileAtmosphere",`Спокойная гавань ${token}.`);
  await openAddPanelChip(page,"География и природа");
  await page.fill("#locProfileTerrain",`Прибрежная равнина ${token}`);
  await saveAndWait(page);
  report.setup_appearanceGeography={ok:true};

  // ================= 1: recommendation hint (country: both STRONG) =================
  await freshReopen(page,projectA,participationA);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
  assert(panelText.includes("Государство и общество")&&panelText.includes("Экономика"),"both B3B modules must be offered in the add panel");
  const recommendTagCount=await page.evaluate(()=>document.querySelectorAll("#locProfileAddSectionPanel .location-thematic-add-chip-recommend-tag").length);
  assert(recommendTagCount===2,`country type must show the recommendation hint for both governmentSociety and economy, got ${recommendTagCount} tags`);
  report.test20_recommendationCountry={ok:true,recommendTagCount};

  // ================= 2-4: GOVERNMENT full lifecycle: add all fields, Save, reload, verify exact,
  // verify Read rendering =================
  await addChip(page,"Государство и общество");
  await fillGovernmentFields(page,gov);
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.governmentSociety,participationA);
    assert(deepEqual(stored,gov),`governmentSociety must persist byte-exact: ${JSON.stringify(stored)} !== ${JSON.stringify(gov)}`);
    const readHidden=await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden);
    assert(!readHidden,"populated Government must show in Read");
    const readText=await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").textContent);
    assert(readText.includes(gov.leadership)&&readText.includes(gov.governmentForm)&&readText.includes(gov.securityForces[0])&&readText.includes(gov.notableInstitutions[0]),"Read rendering must include all filled Government fields");
  }
  report.test1_7_governmentAddFillVerify={ok:true};

  // ================= 8-10: Hide Government; canonical data preserved; add-panel offers Show =====
  await page.click("#locationProfileEdit");
  await page.click("#locProfileGovernmentSocietyHide");
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  assert(await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden),"hidden Government must not show in Read");
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.governmentSociety,participationA);
    assert(deepEqual(stored,gov),"hiding must never touch canonical governmentSociety data");
  }
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelAfterHide=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").innerHTML);
  assert(/showLocationThematicModule\('governmentSociety'\)/.test(panelAfterHide)&&panelAfterHide.includes("есть данные"),"add panel must offer Показать раздел for the hidden populated Government module");
  report.test8_10_governmentHide={ok:true};

  // ================= 11-12: Restore Government, verify data returns =================
  await page.click(`.location-thematic-add-chip:has-text("Государство и общество")`);
  {
    const restoredForm=await page.evaluate(()=>document.getElementById("locProfileGovernmentForm").value);
    assert(restoredForm===gov.governmentForm,"restoring must show the ORIGINAL governmentForm");
  }
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden)),"restored Government must show in Read again");
  report.test11_12_governmentShow={ok:true};

  // ================= 13-14: Delete Government data -- Cancel first (preserved), then confirm+Save
  // (canonical module deleted, selection bookkeeping cleaned) =================
  await page.click("#locationProfileEdit");
  await page.click("#locProfileGovernmentSocietyDeleteStart");
  await page.click("#locProfileGovernmentSocietyDeleteConfirm .location-thematic-delete-confirm-no");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  {
    const stillThere=await page.evaluate(id=>locationById(id).baseProfile.governmentSociety,participationA);
    assert(deepEqual(stillThere,gov),"Cancelling a started delete-confirm must leave governmentSociety fully intact");
  }
  await page.click("#locationProfileEdit");
  await page.click("#locProfileGovernmentSocietyDeleteStart");
  await page.click("#locProfileGovernmentSocietyDeleteConfirm .location-thematic-delete-confirm-yes");
  await saveAndWait(page);
  {
    const afterDelete=await page.evaluate(id=>locationById(id).baseProfile,participationA);
    assert(!("governmentSociety" in afterDelete),"confirmed+saved delete must remove governmentSociety from base_profile");
    const sel=(await page.evaluate(id=>locationById(id).moduleSelection,participationA))||{shown:[],hidden:[]};
    assert(!(sel.shown||[]).includes("governmentSociety")&&!(sel.hidden||[]).includes("governmentSociety"),`deleted module must leave no phantom shown/hidden selection bookkeeping: ${JSON.stringify(sel)}`);
  }
  report.test13_14_governmentDelete={ok:true};

  // ================= ECONOMY full lifecycle (add/fill/verify/hide/show/delete-cancel/delete) =====
  await freshReopen(page,projectA,participationA);
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Экономика");
  await fillEconomyFields(page,econ);
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.economy,participationA);
    assert(deepEqual(stored,econ),`economy must persist byte-exact: ${JSON.stringify(stored)} !== ${JSON.stringify(econ)}`);
    const readHidden=await page.evaluate(()=>document.getElementById("locationProfileEconomy").hidden);
    assert(!readHidden,"populated Economy must show in Read");
    const readText=await page.evaluate(()=>document.getElementById("locationProfileEconomy").textContent);
    assert(readText.includes(econ.currency)&&readText.includes(econ.costOfLiving)&&readText.includes(econ.industries[0])&&readText.includes(econ.scarcity[0])&&readText.includes(econ.tradeConnections[0]),"Read rendering must include all filled Economy fields");
  }
  report.economy_addFillVerify={ok:true};

  await page.click("#locationProfileEdit");
  await page.click("#locProfileEconomyHide");
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  assert(await page.evaluate(()=>document.getElementById("locationProfileEconomy").hidden),"hidden Economy must not show in Read");
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.economy,participationA);
    assert(deepEqual(stored,econ),"hiding must never touch canonical economy data");
  }
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelAfterHideEcon=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").innerHTML);
  assert(/showLocationThematicModule\('economy'\)/.test(panelAfterHideEcon)&&panelAfterHideEcon.includes("есть данные"),"add panel must offer Показать раздел for the hidden populated Economy module");
  report.economy_hide={ok:true};

  await page.click(`.location-thematic-add-chip:has-text("Экономика")`);
  assert((await page.evaluate(()=>document.getElementById("locProfileCurrency").value))===econ.currency,"restoring Economy must show the ORIGINAL data");
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileEconomy").hidden)),"restored Economy must show in Read again");
  report.economy_show={ok:true};

  await page.click("#locationProfileEdit");
  await page.click("#locProfileEconomyDeleteStart");
  const warningCount1=await page.evaluate(()=>document.getElementById("locProfileEconomyDeleteWarning").textContent);
  assert(warningCount1.includes("будут удалены из локации")&&!/\d+\s+проект/.test(warningCount1),`participation_count=1 must use the plain single-project wording, got: ${warningCount1}`);
  await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-no");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  {
    const stillThere=await page.evaluate(id=>locationById(id).baseProfile.economy,participationA);
    assert(deepEqual(stillThere,econ),"Cancelling a started Economy delete-confirm must leave it fully intact");
  }
  report.economy_deleteCancelPreserved={ok:true,warningCount1};

  // ================= 15-19: MIXED / ISOLATION -- re-add Government, verify editing it leaves
  // Economy byte-identical; delete Economy, verify Government remains; verify Appearance/Geography
  // unaffected throughout =================
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Государство и общество");
  await fillGovernmentFields(page,gov);
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile,participationA);
    assert(deepEqual(stored.governmentSociety,gov)&&deepEqual(stored.economy,econ),"Government + Economy must both persist together (mixed fixture)");
  }
  report.test15_16_mixedBothPersist={ok:true};

  const econBefore=await page.evaluate(id=>locationById(id).baseProfile.economy,participationA);
  await page.click("#locationProfileEdit");
  await page.fill("#locProfileLeadership",`Регент ${token}`);
  await saveAndWait(page);
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile,participationA);
    assert(stored.governmentSociety.leadership===`Регент ${token}`,"Government-only edit must actually persist");
    assert(deepEqual(stored.economy,econBefore),"editing Government only must leave Economy byte-identical");
    assert(deepEqual(stored.appearanceAtmosphere,{atmosphere:`Спокойная гавань ${token}.`})&&deepEqual(stored.geography,{terrain:`Прибрежная равнина ${token}`}),"Government-only edit must leave Appearance/Geography unaffected");
  }
  report.test17_governmentEditIsolatesEconomy={ok:true};

  await page.click("#locationProfileEdit");
  await page.click("#locProfileEconomyDeleteStart");
  await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-yes");
  await saveAndWait(page);
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile,participationA);
    assert(!("economy" in stored),"Economy delete must take effect");
    assert(stored.governmentSociety?.leadership===`Регент ${token}`,"deleting Economy must leave Government intact");
    assert(deepEqual(stored.appearanceAtmosphere,{atmosphere:`Спокойная гавань ${token}.`})&&deepEqual(stored.geography,{terrain:`Прибрежная равнина ${token}`}),"deleting Economy must leave Appearance/Geography unaffected");
  }
  report.test18_19_economyDeleteIsolation={ok:true};

  // Re-add Economy for the cross-project phase below.
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Экономика");
  await fillEconomyFields(page,econ);
  await saveAndWait(page);

  // ================= 21-22: recommendation hint for a room-typed Location (none shown, both still
  // addable) =================
  {
    const roomCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{name:`B3B Room ${token}`,typePreset:"room",description:""}),{pa:projectA.id,rev:(await page.evaluate(()=>cloudProjectSync.revision)),token});
    assert(roomCreate.ok,`create_location_canonical (room) must succeed: ${JSON.stringify(roomCreate)}`);
    canonicalLocationIds.push(roomCreate.data.location_id);
    const participationRoom=roomCreate.data.id;
    await freshReopen(page,projectA,participationRoom);
    await page.click("#locationProfileEdit");
    await page.click("#locProfileAddSectionToggle");
    const roomPanelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
    assert(!roomPanelText.includes("Рекомендуется"),"room type must NOT show the recommendation hint");
    await addChip(page,"Государство и общество");
    assert(!(await page.evaluate(()=>document.getElementById("locProfileGovernmentSocietyModule").hidden)),"non-recommended module must remain addable on click (recommendations never block adding)");
    report.test21_23_recommendationRoom={ok:true};
    await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
    if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  }

  // ================= 24-30: CROSS-PROJECT canonical delete =================
  await freshReopen(page,projectA,participationA);
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
  report.test24_25_attachAndCount={ok:true,participationCount:canonicalRow.participation_count};

  await page.click("#locationProfileEdit");
  await page.click("#locProfileEconomyDeleteStart");
  const warningCount2=await page.evaluate(()=>document.getElementById("locProfileEconomyDeleteWarning").textContent);
  assert(warningCount2.includes("2 проектах"),`participation_count=2 must surface the real count in the warning, got: ${warningCount2}`);
  await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-yes");
  await saveAndWait(page);
  report.test26_crossProjectWarning={ok:true,warningCount2};

  const afterDeleteA=await page.evaluate(id=>locationById(id)?.baseProfile,participationA);
  assert(afterDeleteA&&!("economy" in afterDeleteA),"confirmed+saved Economy delete must remove it from base_profile in participation A");
  assert(afterDeleteA.governmentSociety?.leadership===`Регент ${token}`,"deleting Economy must not affect sibling Government data in participation A");

  await page.evaluate(async project=>{await openCloudProject(project)},projectB);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const afterDeleteB=await page.evaluate(id=>locationById(id)?.baseProfile,participationB);
  assert(afterDeleteB&&!("economy" in afterDeleteB),"canonical Economy delete from participation A must be reflected in participation B");
  assert(afterDeleteB.governmentSociety?.leadership===`Регент ${token}`,"Government data must survive intact in participation B too (shared canonical row)");
  report.test27_30_crossParticipationReflection={ok:true};

  // ================= 31-33: LOCAL -> CLOUD IMPORT =================
  const importProject=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectImportTitle);
  projectIds.push(importProject.id);
  const importResultFull=await page.evaluate(async({pid,token})=>{
    const payload={
      project_id:pid,source_project_id:`b3b-real-cloud-${token}`,migration_attempt_id:crypto.randomUUID(),
      characters:[],chapters:[],
      locations:[{
        id:crypto.randomUUID(),name:`Imported Country ${token}`,description:"Imported via real-cloud check.",
        base_profile:{
          governmentSociety:{leadership:`Imported Leader ${token}`},
          economy:{currency:`Imported Coin ${token}`},
          populationCulture:{note:"not allowlisted, must be dropped"},
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
  assert(importResultFull.ok,`local->cloud import with B3B modules must succeed: ${JSON.stringify(importResultFull)}`);
  await page.evaluate(async project=>{await openCloudProject(project)},importProject);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const importedLocation=await page.evaluate(()=>globalThis.data.locations.find(l=>l.name?.startsWith("Imported Country")));
  canonicalLocationIds.push(importedLocation?.locationId);
  assert(importedLocation?.baseProfile?.governmentSociety?.leadership===`Imported Leader ${token}`,"imported governmentSociety must survive with the exact value");
  assert(importedLocation?.baseProfile?.economy?.currency===`Imported Coin ${token}`,"imported economy must survive with the exact value");
  assert(!("populationCulture" in (importedLocation?.baseProfile||{})),"unallowlisted populationCulture must be dropped by import sanitization");
  assert(!("historyNotes" in (importedLocation?.baseProfile||{})),"malformed (non-object) historyNotes must be dropped by import sanitization");
  report.test31_33_localCloudImport={ok:true};

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
