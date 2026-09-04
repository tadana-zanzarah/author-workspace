// Location Adaptive Module Selection (Phase 1) -- published-build authenticated smoke, against
// the LIVE GitHub Pages deployment (not the local dev server) and the LIVE production Supabase
// backend. Narrower than tools/location-adaptive-module-selection-real-cloud-check.mjs (which
// already covers the full lifecycle against the local build) -- this exists solely to confirm the
// PUBLISHED assets themselves load and wire up correctly end to end. Same disposable-fixture,
// dedicated CLOUD_TEST account, and cleanup conventions as every other real-cloud check in this
// repo. Skips gracefully if credentials or the published URL are not configured.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.PUBLISHED_URL||"https://tadana-zanzarah.github.io/author-workspace/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("published smoke skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectATitle=`AW published-A ${token}`;
const projectBTitle=`AW published-B ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

async function login(){
  const context=await browser.newContext();
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const consoleErrors=[];
  page.on("console",msg=>{if(msg.type()==="error")consoleErrors.push(msg.text())});
  page.on("pageerror",err=>consoleErrors.push(err.message));
  await page.goto(base,{waitUntil:"networkidle"});
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
  await page.waitForFunction(()=>globalThis.cloudState?.dashboardStatus==="success",null,{timeout:60000});
  return {context,page,consoleErrors};
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
    return {projects:remainingProjects.data.length,locations:remainingLocations.data.length};
  },{projectIds,canonicalLocationIds,titles,token});
}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;

  const projectA=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectATitle);
  projectIds.push(projectA.id);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},projectA);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  assert(opened,"published build: openCloudProject must reach workspace state");
  let rev=(await page.evaluate(()=>cloudProjectSync.revision));

  const primaryCreate=await page.evaluate(({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`Published Primary ${token}`,typePreset:"settlement",description:`Disposable published-smoke fixture ${token}.`
  }),{pa:projectA.id,rev,token});
  assert(primaryCreate.ok,`create_location_canonical must succeed on the published build: ${JSON.stringify(primaryCreate)}`);
  rev=primaryCreate.revision;
  const participationA=primaryCreate.data.id,canonicalId=primaryCreate.data.location_id;
  canonicalLocationIds.push(canonicalId);
  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));

  // ---- adaptive shell loads ----
  await page.evaluate(id=>openLocationProfile(id),participationA);
  await page.click("#locationProfileEdit");
  const shellLoaded=await page.evaluate(()=>({
    appearanceHidden:document.getElementById("locProfileAppearanceModule")?.hidden,
    geographyHidden:document.getElementById("locProfileGeographyModule")?.hidden,
    addToggleExists:!!document.getElementById("locProfileAddSectionToggle")
  }));
  assert(shellLoaded.addToggleExists&&shellLoaded.appearanceHidden&&shellLoaded.geographyHidden,`published adaptive shell must load correctly (fresh Location, no modules yet): ${JSON.stringify(shellLoaded)}`);
  report.shellLoads={ok:true};

  // ---- add empty module, Save/reopen ----
  await page.click("#locProfileAddSectionToggle");
  await page.click(".location-thematic-add-chip:has-text(\"Внешний вид и атмосфера\")");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationA);
  assert(await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden),"published build: empty added module must not show in Read after reopen");
  await page.click("#locationProfileEdit");
  assert(!(await page.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden)),"published build: persisted empty shown module must render after reopen");
  report.addEmptySaveReopen={ok:true};

  // ---- fill data, hide, Save/reopen: Read visibility + restore ----
  // A persisted-but-still-empty module starts COLLAPSED on re-entry (same disclosure rule as any
  // other empty module) -- expand it first, same as a real user would.
  await page.click("#locProfileAppearanceToggle");
  await page.fill("#locProfileVisualDescription",`Проверка опубликованной сборки ${token}.`);
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden)),"published build: populated module must show in Read");
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAppearanceHide");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationA);
  assert(await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden),"published build: hidden module must not show in Read");
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  const restorePanel=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").innerHTML);
  assert(restorePanel.includes("есть данные"),"published build: picker must offer restore for the hidden populated module");
  await page.click(".location-thematic-add-chip:has-text(\"Внешний вид и атмосфера\")");
  assert((await page.evaluate(()=>document.getElementById("locProfileVisualDescription").value))===`Проверка опубликованной сборки ${token}.`,"published build: restore must bring back the original data");
  // Persist the restore (not just leave it as an unsaved draft) so the later blocks below see a
  // genuinely populated, visible module, not one that reverts to "hidden" on their own Cancel.
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:20000});
  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(id=>openLocationProfile(id),participationA);
  assert(!(await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden)),"published build: restored module must show in Read again after Save+reopen");
  report.hideRestoreReadVisibility={ok:true};

  // ---- delete confirmation UI ----
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAppearanceDeleteStart");
  const deleteConfirmVisible=!(await page.evaluate(()=>document.getElementById("locProfileAppearanceDeleteConfirm").hidden));
  assert(deleteConfirmVisible,"published build: Удалить данные раздела must show the inline confirm");
  const warningSingle=await page.evaluate(()=>document.getElementById("locProfileAppearanceDeleteWarning").textContent);
  assert(warningSingle.includes("будут удалены из локации"),`published build: single-project delete wording, got: ${warningSingle}`);
  await page.click("#locProfileAppearanceDeleteConfirm .location-thematic-delete-confirm-no");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if((await page.evaluate(()=>document.getElementById("discardChangesModal")?.style.display))==="flex")await page.click("#discardChanges");
  report.deleteConfirmationUi={ok:true,warningSingle};

  // ---- participation_count-driven warning: attach a 2nd disposable project ----
  const projectB=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectBTitle);
  projectIds.push(projectB.id);
  const projectBRevision=await page.evaluate(async pb=>{const content=await cloudState.contentApi.loadProjectContent(pb);return content.data.project.revision},projectB.id);
  const attachResult=await page.evaluate(async({pb,rev,canonicalId})=>{
    const {data,error}=await cloudState.client.rpc("attach_project_location",{target_project_id:pb,target_global_location_id:canonicalId,expected_revision:rev});
    if(error)return {ok:false,message:error.message};
    return data;
  },{pb:projectB.id,rev:projectBRevision,canonicalId});
  assert(attachResult.ok,`published build: attach_project_location must succeed: ${JSON.stringify(attachResult)}`);

  await page.evaluate(async project=>{await openCloudProject(project)},projectA);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(()=>loadOwnedLocationRows(true));
  await page.evaluate(id=>openLocationProfile(id),participationA);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAppearanceDeleteStart");
  const warningMulti=await page.evaluate(()=>document.getElementById("locProfileAppearanceDeleteWarning").textContent);
  assert(warningMulti.includes("2 проектах"),`published build: cross-project warning must reflect the live participation_count, got: ${warningMulti}`);
  await page.click("#locProfileAppearanceDeleteConfirm .location-thematic-delete-confirm-no");
  report.participationCountWarning={ok:true,warningMulti};

  console.log(JSON.stringify({ok:true,...report,consoleErrors:session.consoleErrors},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,partialReport:report,consoleErrors:session?.consoleErrors||[]},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectATitle,projectBTitle],token);
    console.log(JSON.stringify({cleanup:counts}));
    if(!(counts.projects===0&&counts.locations===0)){
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
