// Location History -- HYBRID IMPLEMENTATION -- real-cloud PHASE 3: hide/unhide (whole-section
// contract) + Media/Scenes-sections-unaffected. Companion to phase1 (prose+event creation via real
// UI) and phase2 (update/reorder/revision semantics), split out for the same reason as phase2 --
// this sandboxed headless Edge session cannot sustain all 22 checks in one browser lifetime. Kept
// deliberately minimal (one event, fewest possible round trips) since phase1/phase2 already proved
// event CRUD/revision correctness; this phase's only new ground is the combined hide/unhide
// contract and confirming sibling sections render.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8001/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location history real-cloud phase3 check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW history3 ${token}`;
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
async function cleanup(page,projectIds,canonicalLocationIds,titles){
  return page.evaluate(async({projectIds,canonicalLocationIds,titles})=>{
    const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
    const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
    const session=await cloudState.client.auth.getSession();
    await client.auth.setSession(session.data.session);
    const found=await client.from("projects").select("id").in("title",titles);
    if(found.error)throw found.error;
    const projects=[...new Set([...projectIds,...found.data.map(x=>x.id)])];
    const allLocationIds=[...new Set(canonicalLocationIds)];
    if(allLocationIds.length){const d=await client.from("location_history_events").delete().in("location_id",allLocationIds);if(d.error)throw d.error}
    if(projects.length){const d=await client.from("projects").delete().in("id",projects);if(d.error)throw d.error}
    if(allLocationIds.length){const d=await client.from("locations").delete().in("id",allLocationIds);if(d.error)throw d.error}
    const rp=await client.from("projects").select("id").in("id",projects);
    const rl=allLocationIds.length?await client.from("locations").select("id").in("id",allLocationIds):{data:[]};
    return {projects:rp.data.length,locations:rl.data.length};
  },{projectIds,canonicalLocationIds,titles});
}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;
  const project=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectTitle);
  projectIds.push(project.id);
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const create=await page.evaluate(({pid,token})=>cloudState.contentApi.createLocationCanonical(pid,0,{name:`History Location3 ${token}`,description:""}),{pid:project.id,token});
  assert(create.ok,`create_location_canonical failed: ${JSON.stringify(create)}`);
  const canonicalId=create.data.location_id;
  canonicalLocationIds.push(canonicalId);
  const seeded=await page.evaluate(({cid,rev,token})=>cloudProjectSync.api.createLocationHistoryEvent(cid,rev,{eventId:crypto.randomUUID(),title:`Событие ${token}`,dateLabel:"",description:"",sortOrder:0}),{cid:canonicalId,rev:create.data.location_revision,token});
  assert(seeded.ok,`seed event create failed: ${JSON.stringify(seeded)}`);

  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations)&&globalThis.data.locations.length>0);
  const participationId=await page.evaluate(cid=>globalThis.data.locations.find(l=>l.locationId===cid)?.id,canonicalId);
  assert(participationId,"participation id must resolve after reload");

  // ============ 17-18: hide -> whole section hidden, data preserved ============
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  // The event list is fetched lazily -- wait for it to land before the module's hasData-gated
  // "Скрыть раздел" action row can correctly show as available.
  await page.waitForFunction(()=>currentLocationProfileHistoryEventsSnapshot().length>=1,null,{timeout:15000});
  await page.click("#locProfileHistoryHide");
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:15000});
  {
    const hidden=await page.evaluate(()=>document.getElementById("locationProfileHistory").hidden);
    assert(hidden===true,"17 failed: hiding must hide the whole History section");
    const list=(await page.evaluate(cid=>cloudProjectSync.api.listLocationHistoryEvents(cid),canonicalId)).data;
    assert(list.length===1,"18 failed: hiding must not delete event data");
    report.test17_18={ok:true};
  }

  // ============ 19-20: reload, hidden survives, unhide restores prose+events ============
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  assert((await page.evaluate(()=>document.getElementById("locationProfileHistory").hidden))===true,"hidden state must survive reload");
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  await page.click(`.location-thematic-add-chip:has-text("История")`);
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:15000});
  {
    const hidden=await page.evaluate(()=>document.getElementById("locationProfileHistory").hidden);
    assert(hidden===false,"19/20 failed: unhide must restore the section");
    const html=await page.evaluate(()=>document.getElementById("locationProfileHistory").innerHTML);
    assert(html.includes(token),"19/20 failed: unhide must restore event data intact");
    report.test19_20={ok:true};
  }

  // ============ 21-22: Media/Scenes unaffected ============
  {
    const mediaOk=await page.evaluate(()=>!!document.getElementById("locationProfileMedia"));
    const scenesOk=await page.evaluate(()=>document.getElementById("locationProfileScenes")?.className==="location-profile-scenes");
    assert(mediaOk&&scenesOk,"21/22 failed: Media/Scenes sections must remain intact");
    report.test21_22={ok:true};
  }

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,stack:error.stack,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectTitle]);
    console.log(JSON.stringify({cleanup:counts}));
    if(!(counts.projects===0&&counts.locations===0)){console.log(JSON.stringify({cleanupIncomplete:true,counts}));process.exitCode=1}
  }catch(cleanupError){console.log(JSON.stringify({cleanupError:cleanupError.message}));process.exitCode=1}
  if(session)await session.context.close();
  await browser.close();
}
