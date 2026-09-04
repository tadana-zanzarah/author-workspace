// Location Adaptive Modules B3B (governmentSociety, economy) -- published-build authenticated
// smoke, against the LIVE GitHub Pages deployment (not the local dev server) and the LIVE
// production Supabase backend. Narrower than tools/location-government-economy-modules-real-
// cloud-check.mjs (which already proved the full lifecycle against the local build) -- this exists
// solely to confirm the PUBLISHED assets themselves load and wire up correctly end to end. Same
// disposable-fixture, dedicated CLOUD_TEST account, and cleanup conventions as every other
// real-cloud check in this repo. Skips gracefully if credentials or the published URL are not
// configured.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.PUBLISHED_URL||"https://tadana-zanzarah.github.io/author-workspace/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("published smoke skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectATitle=`AW b3b-pub-A ${token}`;
const projectBTitle=`AW b3b-pub-B ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

async function login(){
  const context=await browser.newContext();
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const consoleErrors=[],failedRequests=[];
  page.on("console",msg=>{if(msg.type()==="error")consoleErrors.push(msg.text())});
  page.on("pageerror",err=>consoleErrors.push(err.message));
  page.on("requestfailed",r=>failedRequests.push(r.url()+" :: "+(r.failure()?.errorText||"")));
  page.on("response",r=>{if(r.status()>=400)failedRequests.push(`${r.status()} ${r.url()}`)});
  await page.goto(base,{waitUntil:"networkidle"});
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
  await page.waitForFunction(()=>globalThis.cloudState?.dashboardStatus==="success",null,{timeout:60000});
  return {context,page,consoleErrors,failedRequests};
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

  // ================= A: LOCATION PROFILE -- country Location, add-panel offers both new modules
  // with the recommendation hint =================
  const countryCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`B3B Published Country ${token}`,typePreset:"country",description:""
  }),{pa:projectA.id,rev,token});
  assert(countryCreate.ok,`create_location_canonical must succeed: ${JSON.stringify(countryCreate)}`);
  rev=countryCreate.revision;
  const participationA=countryCreate.data.id,canonicalId=countryCreate.data.location_id;
  canonicalLocationIds.push(canonicalId);

  await freshReopen(page,projectA,participationA);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
  assert(panelText.includes("Государство и общество")&&panelText.includes("Экономика"),"A: both B3B modules must appear in the add panel");
  const recommendTagCount=await page.evaluate(()=>document.querySelectorAll("#locProfileAddSectionPanel .location-thematic-add-chip-recommend-tag").length);
  assert(recommendTagCount===2,`A: country type must show the recommendation hint for both modules, got ${recommendTagCount}`);
  report.A_locationProfileAddPanel={ok:true,recommendTagCount};

  // ================= B: GOVERNMENT -- add, fill all fields, save, full page reload, reopen, verify
  // persistence + Read rendering =================
  await page.click(`.location-thematic-add-chip:has-text("Государство и общество")`);
  await page.fill("#locProfileGovernmentForm",`Республика ${token}`);
  await page.fill("#locProfileLeadership",`Президент Ковальская ${token}`);
  await page.fill("#locProfilePoliticalSituation",`Растущее напряжение между столицей и провинциями ${token}.`);
  await page.fill("#locProfileLawsAndRules",`Ношение оружия в столице запрещено без разрешения ${token}.`);
  await fillMultiValue(page,"locProfileSecurityForces",`Национальная гвардия ${token}`);
  await fillMultiValue(page,"locProfileNotableInstitutions",`Верховный суд ${token}`);
  await saveAndWait(page);

  // Genuine FULL PAGE RELOAD of the published build (not just an in-app re-fetch), as the task
  // specifically requires for the published smoke.
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector("#projectsScreen:not([hidden]), body[data-app-state=\"workspace\"]",{timeout:20000});
  await freshReopen(page,projectA,participationA);
  {
    const readHidden=await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden);
    assert(!readHidden,"B: populated Government must show in Read after a full page reload");
    const readText=await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").textContent);
    assert(readText.includes(`Президент Ковальская ${token}`)&&readText.includes(`Республика ${token}`)&&readText.includes(`Национальная гвардия ${token}`)&&readText.includes(`Верховный суд ${token}`),"B: Read rendering must include all filled Government fields, chips included");
    const stored=await page.evaluate(id=>locationById(id).baseProfile.governmentSociety,participationA);
    assert(stored.leadership===`Президент Ковальская ${token}`&&stored.governmentForm===`Республика ${token}`,"B: governmentSociety values must persist exactly across a full reload");
  }
  report.B_government={ok:true};

  // ================= C: ECONOMY -- add, fill all fields, save/reload/reopen, verify persistence +
  // Read rendering + Government unchanged =================
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Экономика");
  await page.fill("#locProfileCurrency",`Крон ${token}`);
  await page.fill("#locProfileEconomicCharacter",`Развитая экономика услуг с растущим расслоением ${token}.`);
  await fillMultiValue(page,"locProfileIndustries",`Туризм ${token}`);
  await page.fill("#locProfileCostOfLiving",`Очень дорого в столице ${token}.`);
  await fillMultiValue(page,"locProfileScarcity",`Чистая вода ${token}`);
  await fillMultiValue(page,"locProfileTradeConnections",`Морской путь на юг ${token}`);
  await saveAndWait(page);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector("#projectsScreen:not([hidden]), body[data-app-state=\"workspace\"]",{timeout:20000});
  await freshReopen(page,projectA,participationA);
  {
    const readHidden=await page.evaluate(()=>document.getElementById("locationProfileEconomy").hidden);
    assert(!readHidden,"C: populated Economy must show in Read after a full page reload");
    const readText=await page.evaluate(()=>document.getElementById("locationProfileEconomy").textContent);
    assert(readText.includes(`Крон ${token}`)&&readText.includes(`Очень дорого в столице ${token}.`)&&readText.includes(`Туризм ${token}`)&&readText.includes(`Чистая вода ${token}`)&&readText.includes(`Морской путь на юг ${token}`),"C: Read rendering must include all filled Economy fields, chips included");
    const stored=await page.evaluate(id=>locationById(id).baseProfile,participationA);
    assert(stored.economy?.currency===`Крон ${token}`,"C: economy values must persist exactly across a full reload");
    assert(stored.governmentSociety?.leadership===`Президент Ковальская ${token}`,"C: Government must remain unchanged after adding Economy");
  }
  report.C_economy={ok:true};

  // ================= D: ADAPTIVE LIFECYCLE -- hide/show Government, delete-cancel/delete-confirm
  // Economy =================
  await page.click("#locationProfileEdit");
  await page.click("#locProfileGovernmentSocietyHide");
  await saveAndWait(page);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector("#projectsScreen:not([hidden]), body[data-app-state=\"workspace\"]",{timeout:20000});
  await freshReopen(page,projectA,participationA);
  assert(await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden),"D14: hidden Government must not appear in Read");
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.governmentSociety,participationA);
    assert(stored?.leadership===`Президент Ковальская ${token}`,"D14: hiding must never touch canonical governmentSociety data");
  }
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const panelAfterHide=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").innerHTML);
  assert(/showLocationThematicModule\('governmentSociety'\)/.test(panelAfterHide)&&panelAfterHide.includes("есть данные"),"D14: add panel must offer Показать раздел for hidden populated Government");

  await page.click(`.location-thematic-add-chip:has-text("Государство и общество")`);
  assert((await page.evaluate(()=>document.getElementById("locProfileGovernmentForm").value))===`Республика ${token}`,"D16-17: restoring must show the ORIGINAL data");
  await saveAndWait(page);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector("#projectsScreen:not([hidden]), body[data-app-state=\"workspace\"]",{timeout:20000});
  await freshReopen(page,projectA,participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden)),"D17: restored Government must show in Read again after reload");
  report.D_hideShow={ok:true};

  await page.click("#locationProfileEdit");
  await page.click("#locProfileEconomyDeleteStart");
  await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-no");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile.economy,participationA);
    assert(stored?.currency===`Крон ${token}`,"D18: Cancelling a started Economy delete must leave it fully intact");
  }
  report.D_deleteCancel={ok:true};

  await page.click("#locationProfileEdit");
  await page.click("#locProfileEconomyDeleteStart");
  await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-yes");
  await saveAndWait(page);
  {
    const stored=await page.evaluate(id=>locationById(id).baseProfile,participationA);
    assert(!("economy" in stored),"D19: confirmed+saved delete must remove economy from base_profile");
    assert(stored.governmentSociety?.leadership===`Президент Ковальская ${token}`,"D19: deleting Economy must preserve Government");
    const sel=(await page.evaluate(id=>locationById(id).moduleSelection,participationA))||{shown:[],hidden:[]};
    assert(!(sel.shown||[]).includes("economy")&&!(sel.hidden||[]).includes("economy"),`D19: deleted module must leave no phantom shown/hidden state: ${JSON.stringify(sel)}`);
  }
  report.D_deleteConfirm={ok:true};

  // ================= E: RECOMMENDATIONS -- room type shows neither, both remain addable =========
  {
    const roomCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{name:`B3B Published Room ${token}`,typePreset:"room",description:""}),{pa:projectA.id,rev:(await page.evaluate(()=>cloudProjectSync.revision)),token});
    assert(roomCreate.ok,`E: create_location_canonical (room) must succeed: ${JSON.stringify(roomCreate)}`);
    canonicalLocationIds.push(roomCreate.data.location_id);
    const participationRoom=roomCreate.data.id;
    await freshReopen(page,projectA,participationRoom);
    await page.click("#locationProfileEdit");
    await page.click("#locProfileAddSectionToggle");
    const roomPanelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
    assert(!roomPanelText.includes("Рекомендуется"),"E20: room type must NOT show the recommendation hint");
    await page.click(`.location-thematic-add-chip:has-text("Государство и общество")`);
    assert(!(await page.evaluate(()=>document.getElementById("locProfileGovernmentSocietyModule").hidden)),"E22: non-recommended module must remain addable");
    report.E_recommendations={ok:true};
    await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
    if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  }

  // ================= F: CROSS-PROJECT WARNING -- attach, verify participation_count>1 and the
  // warning driven by it (full lifecycle already proven pre-merge; verifying warning behavior only) =
  let projectBRevision=await page.evaluate(async pb=>{const content=await cloudState.contentApi.loadProjectContent(pb);return content.data.project.revision},projectB.id);
  const attachResult=await page.evaluate(async({pb,rev,canonicalId})=>{
    const {data,error}=await cloudState.client.rpc("attach_project_location",{target_project_id:pb,target_global_location_id:canonicalId,expected_revision:rev});
    if(error)return {ok:false,message:error.message};
    return data;
  },{pb:projectB.id,rev:projectBRevision,canonicalId});
  assert(attachResult.ok,`F21: attach_project_location must succeed: ${JSON.stringify(attachResult)}`);

  await freshReopen(page,projectA,participationA);
  await page.evaluate(()=>loadOwnedLocationRows(true));
  const rowsAfterAttach=await page.evaluate(()=>[...ownedLocationRowsSync().values()]);
  const canonicalRow=rowsAfterAttach.find(r=>r.id===canonicalId);
  assert(canonicalRow&&canonicalRow.participation_count===2,`F22: participation_count must read 2 after attaching a 2nd project: ${JSON.stringify(canonicalRow)}`);

  await page.click("#locationProfileEdit");
  await page.click("#locProfileGovernmentSocietyDeleteStart");
  const warningText=await page.evaluate(()=>document.getElementById("locProfileGovernmentSocietyDeleteWarning").textContent);
  assert(warningText.includes("2 проектах"),`F23: cross-project delete warning must surface the real participation_count, got: ${warningText}`);
  await page.click("#locProfileGovernmentSocietyDeleteConfirm .location-thematic-delete-confirm-no");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  report.F_crossProjectWarning={ok:true,warningText};

  // ================= G: EXISTING MODULES / HIERARCHY -- Appearance/Geography still work, parent/
  // breadcrumb, "Внутри", "Сцены здесь" all unaffected =================
  await page.click("#locationProfileEdit");
  await openAddPanelChip(page,"Внешний вид и атмосфера");
  await page.fill("#locProfileAtmosphere",`Спокойная гавань ${token}.`);
  await openAddPanelChip(page,"География и природа");
  await page.fill("#locProfileTerrain",`Прибрежная равнина ${token}`);
  await saveAndWait(page);
  await freshReopen(page,projectA,participationA);
  {
    const appearanceHidden=await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden);
    const geographyHidden=await page.evaluate(()=>document.getElementById("locationProfileGeography").hidden);
    assert(!appearanceHidden&&!geographyHidden,"G24: existing Appearance/Geography modules must still open and render normally");
  }

  // Parent/breadcrumb: create a child location and set its parent to the country fixture.
  let revForChild=(await page.evaluate(()=>cloudProjectSync.revision));
  const childCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{name:`B3B Published Child ${token}`,typePreset:"settlement",description:""}),{pa:projectA.id,rev:revForChild,token});
  assert(childCreate.ok,`G25: create_location_canonical (child) must succeed: ${JSON.stringify(childCreate)}`);
  canonicalLocationIds.push(childCreate.data.location_id);
  const participationChild=childCreate.data.id;
  await page.evaluate(()=>loadOwnedLocationRows(true));
  await freshReopen(page,projectA,participationChild);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileParent");
  await page.fill("#locProfileParent",`B3B Published Country ${token}`);
  await page.waitForTimeout(300);
  await page.locator("#locProfileParentListbox [role=\"option\"]",{hasText:`B3B Published Country ${token}`}).first().click();
  await saveAndWait(page);
  const childParentId=await page.evaluate(id=>locationById(id).parentId,participationChild);
  assert(childParentId===canonicalId,`G25: parent/hierarchy save must persist: expected ${canonicalId}, got ${childParentId}`);

  await freshReopen(page,projectA,participationA);
  const insideHidden=await page.evaluate(()=>document.getElementById("locationProfileChildren").hidden);
  assert(!insideHidden,"G26: Внутри must show the newly-parented child Location");
  const insideText=await page.evaluate(()=>document.getElementById("locationProfileChildren").textContent);
  assert(insideText.includes(`B3B Published Child ${token}`),"G26: Внутри must list the child Location by name");

  let revForScene=(await page.evaluate(()=>cloudProjectSync.revision));
  const sceneCreate=await page.evaluate(({pa,rev,pid,token})=>cloudState.contentApi.createScene(pa,rev,{title:`B3B Published Scene ${token}`,chapterId:null,locationId:pid,placementStatus:"unplaced",writingStatus:"draft"}),{pa:projectA.id,rev:revForScene,pid:participationA,token});
  assert(sceneCreate.ok,`G27: create_scene must succeed: ${JSON.stringify(sceneCreate)}`);
  await freshReopen(page,projectA,participationA);
  const scenesText=await page.evaluate(()=>document.getElementById("locationProfileScenes").textContent);
  assert(scenesText.includes(`B3B Published Scene ${token}`),"G27: Сцены здесь must list the disposable Scene, unaffected by B3B");
  report.G_existingModulesHierarchy={ok:true};

  console.log(JSON.stringify({ok:true,...report,consoleErrors:session.consoleErrors,failedRequests:session.failedRequests},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,stack:error.stack,partialReport:report,consoleErrors:session?.consoleErrors,failedRequests:session?.failedRequests},null,2));
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
