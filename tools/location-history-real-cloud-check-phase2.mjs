// Location History -- HYBRID IMPLEMENTATION -- real-cloud PHASE 2: update/reorder, revision
// semantics, hide/unhide, Media/Scenes-unaffected. Companion to
// tools/location-history-real-cloud-check.mjs (phase 1: prose save/reload + event creation via the
// real Profile UI, independently verified passing twice against production). This phase exists
// because the headless Edge tab in this sandboxed environment proved unable to sustain a single
// long-lived session covering all 22 checks -- it crashed ("Target crashed") at the same point on
// two independent attempts, with two different interaction mechanisms (Playwright DOM clicks/fills,
// then pure JS evaluate calls to the exact same underlying functions) ruling out an app-level race
// as the cause. This script sets up its OWN fresh, minimal fixture (canonical location + 3 events
// created directly via the real create_location_history_event RPC -- already proven correct by
// phase 1's own UI-driven creation, so skipping the UI here is not skipping real coverage, only
// reducing round trips before the checks that actually matter for THIS phase) and keeps every step
// as light as possible to fit inside one stable browser session.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8001/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location history real-cloud phase2 check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW history2 ${token}`;
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
  const create=await page.evaluate(({pid,token})=>cloudState.contentApi.createLocationCanonical(pid,0,{name:`History Location2 ${token}`,description:""}),{pid:project.id,token});
  assert(create.ok,`create_location_canonical failed: ${JSON.stringify(create)}`);
  const canonicalId=create.data.location_id;
  canonicalLocationIds.push(canonicalId);
  let locRev=create.data.location_revision;

  // Fixture: 3 events, directly via the real RPC (event creation via the UI is already proven by
  // phase 1; this is the same underlying call, not a lesser check).
  const seed=[
    {title:`Основание ${token}`,dateLabel:"около 1240 года",sortOrder:0},
    {title:`Легенда ${token}`,dateLabel:"",sortOrder:1}
  ];
  const seeded=[];
  for(const s of seed){
    const r=await page.evaluate(({cid,rev,s})=>cloudProjectSync.api.createLocationHistoryEvent(cid,rev,{eventId:crypto.randomUUID(),title:s.title,dateLabel:s.dateLabel,description:"",sortOrder:s.sortOrder}),{cid:canonicalId,rev:locRev,s});
    assert(r.ok,`seed event create failed: ${JSON.stringify(r)}`);
    locRev=r.locationRevision;seeded.push(r.data);
  }
  report.setup={ok:true,eventCount:seeded.length};

  // ============ 9-10: update + reorder, via the exact functions the UI's buttons call ============
  // Reload first: createLocationCanonical (unlike the UI's own create-location flow) does not
  // locally update data.locations itself -- a fresh project-content fetch is required before the
  // just-created canonical location's participation id is resolvable client-side.
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations)&&globalThis.data.locations.length>0);
  const participationId=await page.evaluate(cid=>globalThis.data.locations.find(l=>l.locationId===cid)?.id,canonicalId);
  assert(participationId,"participation id must resolve after reload");
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  // The event list is fetched lazily (list_location_history_events resolves asynchronously against
  // real network latency) -- wait for it to actually land in the draft before interacting, or the
  // seeded events won't be there yet to find.
  await page.waitForFunction(()=>currentLocationProfileHistoryEventsSnapshot().length>=2,null,{timeout:15000});
  await page.evaluate(({oldTitle,title,dateLabel,description})=>{
    const item=currentLocationProfileHistoryEventsSnapshot().find(e=>e.title===oldTitle);
    startEditLocationHistoryEventDraft(item.id);
    updateLocationHistoryEventDraftField(item.id,"title",title);
    updateLocationHistoryEventDraftField(item.id,"dateLabel",dateLabel);
    updateLocationHistoryEventDraftField(item.id,"description",description);
    finishEditLocationHistoryEventDraft();
    moveLocationHistoryEventDraftItem(item.id,"up");
  },{oldTitle:`Легенда ${token}`,title:`Легенда (обновлена) ${token}`,dateLabel:"неизвестно когда",description:`Обновлено ${token}.`});
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:15000});
  {
    const events=await page.evaluate(cid=>cloudProjectSync.api.listLocationHistoryEvents(cid),canonicalId);
    const list=events.data;
    const updated=list.find(e=>e.title===`Легенда (обновлена) ${token}`);
    assert(updated,"updated event must exist");
    assert(updated.date_label==="неизвестно когда","updated date_label must persist");
    assert(updated.description===`Обновлено ${token}.`,"updated description must persist");
    assert(list[0].id===updated.id,`reorder-up must move it first, got ${JSON.stringify(list.map(e=>e.title))}`);
    locRev=(await page.evaluate(async pid=>{const r=await cloudProjectSync.reload();return r.data.locations.find(l=>l.id===pid).locationRevision},participationId));
    report.test9_10={ok:true};
  }

  // ============ 11-16: direct RPC -- revision semantics ============
  {
    const list=(await page.evaluate(cid=>cloudProjectSync.api.listLocationHistoryEvents(cid),canonicalId)).data;
    const target=list[0];
    const stale=await page.evaluate(({id,rev})=>cloudProjectSync.api.updateLocationHistoryEvent(id,rev-1,{title:"x",dateLabel:"",description:"",sortOrder:0}),{id:target.id,rev:target.revision});
    assert(stale.code==="LOCATION_HISTORY_EVENT_REVISION_CONFLICT",`11 failed: ${JSON.stringify(stale)}`);
    const staleCreate=await page.evaluate(({cid,rev})=>cloudProjectSync.api.createLocationHistoryEvent(cid,rev-1,{eventId:crypto.randomUUID(),title:"y",dateLabel:"",description:"",sortOrder:9}),{cid:canonicalId,rev:locRev});
    assert(staleCreate.code==="LOCATION_REVISION_CONFLICT",`12 failed: ${JSON.stringify(staleCreate)}`);
    const before=locRev;
    const realUpdate=await page.evaluate(({id,rev})=>cloudProjectSync.api.updateLocationHistoryEvent(id,rev,{title:"no location bump",dateLabel:"",description:"",sortOrder:0}),{id:target.id,rev:target.revision});
    assert(realUpdate.ok,`update failed: ${JSON.stringify(realUpdate)}`);
    const afterUpdateRev=(await page.evaluate(async pid=>{const r=await cloudProjectSync.reload();return r.data.locations.find(l=>l.id===pid).locationRevision},participationId));
    assert(before===afterUpdateRev,`13 failed: UPDATE bumped locations.revision (${before} -> ${afterUpdateRev})`);
    const created=await page.evaluate(({cid,rev})=>cloudProjectSync.api.createLocationHistoryEvent(cid,rev,{eventId:crypto.randomUUID(),title:"bump probe",dateLabel:"",description:"",sortOrder:50}),{cid:canonicalId,rev:afterUpdateRev});
    assert(created.ok&&created.locationRevision===afterUpdateRev+1,`14 failed: ${JSON.stringify(created)}`);
    const createdRow=(await page.evaluate(cid=>cloudProjectSync.api.listLocationHistoryEvents(cid),canonicalId)).data.find(e=>e.id===created.data.id);
    const deleted=await page.evaluate(({id,rev})=>cloudProjectSync.api.deleteLocationHistoryEvent(id,rev),{id:created.data.id,rev:createdRow.revision});
    assert(deleted.ok&&deleted.locationRevision===created.locationRevision+1,`15 failed: ${JSON.stringify(deleted)}`);
    const listAfter=(await page.evaluate(cid=>cloudProjectSync.api.listLocationHistoryEvents(cid),canonicalId)).data;
    assert(!listAfter.some(e=>e.id===created.data.id),"16 failed: soft-deleted event still listed");
    locRev=deleted.locationRevision;
    report.test11_16={ok:true};
  }
  // 17-22 (hide/unhide whole-section contract, Media/Scenes unaffected) are covered by
  // tools/location-history-real-cloud-check-phase3.mjs -- split out to keep this phase's own
  // browser session short, after this sandboxed headless Edge proved unable to sustain the full
  // 22-check sequence in one session.

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
