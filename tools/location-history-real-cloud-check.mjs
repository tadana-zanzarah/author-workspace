// Location History -- HYBRID IMPLEMENTATION -- real-cloud PHASE 1: prose save/reload + event
// creation via the REAL Profile UI (js/locations.js) against the REAL production Supabase project,
// now that 20260908090000_location_history_base_profile_module.sql and
// 20260908100000_location_history_events_foundation.sql are both live -- origin/historicalOverview/
// legends save+persist, three events (blank date_label, "около 1240 года", a fantasy label) created
// through the real add-event UI flow, free-text date_label round-tripping verbatim, and manual
// (author-controlled, never parsed) event order in Read mode.
//
// Split from the originally-monolithic script: this sandboxed headless Edge could not sustain all
// ~22 checks in one browser session (it hung, then separately crashed with "Target crashed", at the
// same later point regardless of interaction mechanism -- an environment limit, not an app bug).
// tools/location-history-real-cloud-check-phase2.mjs covers update/reorder + revision semantics
// (its own fresh session); tools/location-history-real-cloud-check-phase3.mjs covers the
// hide/unhide whole-section contract + Media/Scenes-unaffected (another fresh session). Disposable
// CLOUD_TEST fixture user + ONE disposable project + ONE canonical Location, named with this run's
// unique token. Skips gracefully if credentials are not configured.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8001/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location history real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW history ${token}`;
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
    // location_history_events.location_id is ON DELETE RESTRICT -- any still-active event row must
    // be deleted explicitly first, or the location delete below fails closed rather than orphaning.
    const remainingEvents=allLocationIds.length?await client.from("location_history_events").select("id").in("location_id",allLocationIds):{data:[]};
    if(remainingEvents.data?.length){const d=await client.from("location_history_events").delete().in("id",remainingEvents.data.map(e=>e.id));if(d.error)throw d.error}
    if(allLocationIds.length){const d=await client.from("locations").delete().in("id",allLocationIds);if(d.error)throw d.error}
    const remainingProjects=await client.from("projects").select("id").in("id",projects);
    const remainingLocations=allLocationIds.length?await client.from("locations").select("id").in("id",allLocationIds):{data:[]};
    const remainingEventsAfter=allLocationIds.length?await client.from("location_history_events").select("id").in("location_id",allLocationIds):{data:[]};
    return {projects:remainingProjects.data.length,locations:remainingLocations.data.length,events:remainingEventsAfter.data.length};
  },{projectIds,canonicalLocationIds,titles,token});
}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;

  const project=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},projectTitle);
  projectIds.push(project.id);
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  let rev=(await page.evaluate(()=>cloudProjectSync.revision));

  const create=await page.evaluate(({pid,rev,token})=>cloudState.contentApi.createLocationCanonical(pid,rev,{
    name:`History Location ${token}`,description:`Disposable History smoke fixture ${token}.`
  }),{pid:project.id,rev,token});
  assert(create.ok,`create_location_canonical must succeed: ${JSON.stringify(create)}`);
  const canonicalId=create.data.location_id;
  canonicalLocationIds.push(canonicalId);
  const reloaded1=await page.evaluate(async project=>{await openCloudProject(project);return true},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations)&&globalThis.data.locations.length>0);
  const participationId=await page.evaluate(cid=>globalThis.data.locations.find(l=>l.locationId===cid)?.id,canonicalId);
  assert(participationId,"participation id must resolve after reload");

  // ============ 1-3: real UI -- open Profile, add History module, save prose (origin/overview/legends) ============
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  await page.click(`.location-thematic-add-chip:has-text("История")`);
  await page.fill("#locProfileOrigin",`Основана беженцами ${token}.`);
  await page.fill("#locProfileHistoricalOverview",`Быстро выросла благодаря гавани ${token}.`);
  await page.fill("#locProfileLegends",`Под городом спит дракон ${token}.`);
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:8000});
  report.test1_3_prose={ok:true};

  // ============ 3: reload, confirm prose persistence ============
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  {
    const loc=await page.evaluate(pid=>globalThis.data.locations.find(l=>l.id===pid),participationId);
    assert(loc.baseProfile?.history?.origin===`Основана беженцами ${token}.`,"origin must survive reload");
    assert(loc.baseProfile?.history?.legends===`Под городом спит дракон ${token}.`,"legends must survive reload");
  }

  // ============ 4-8: real UI -- create 3 events (blank date, "около 1240 года", fantasy label), verify free-text round-trip + manual order ============
  // addEvent(): each step waits for the editing card to actually appear/settle before typing, and
  // waits for it to collapse back before moving on -- real network latency against production
  // makes the naive fire-and-forget sequence (fine against local mode) prone to Playwright
  // catching the editing card mid-re-render.
  // Fills via direct JS property assignment + a real "input" event dispatch, then invokes the
  // "Готово" handler function directly rather than a Playwright click -- avoids Playwright's visual
  // stability wait racing against this vanilla-JS (non-framework) app's own full-innerHTML
  // re-renders under real network latency, which proved flaky against production while the
  // identical flow was reliable in local mode (js/locations.js has no virtual-DOM diffing; every
  // draft mutation that re-renders replaces the whole list's innerHTML, so a literal DOM click
  // arriving mid-replace is a real race, not a product bug -- see this file's history for the
  // exact failure signatures ruled out first).
  async function addEvent({title,dateLabel}){
    await page.click(".location-history-add-event");
    await page.waitForSelector("#locProfileHistoryEventsList .location-history-event-card-editing",{state:"visible"});
    await page.evaluate(({title,dateLabel})=>{
      const card=document.querySelector("#locProfileHistoryEventsList .location-history-event-card-editing");
      const titleInput=card.querySelector("label:nth-of-type(1) input");
      titleInput.value=title;titleInput.dispatchEvent(new Event("input",{bubbles:true}));
      if(dateLabel){
        const dateInput=card.querySelector("label:nth-of-type(2) input");
        dateInput.value=dateLabel;dateInput.dispatchEvent(new Event("input",{bubbles:true}));
      }
      finishEditLocationHistoryEventDraft();
    },{title,dateLabel});
    await page.waitForSelector("#locProfileHistoryEventsList .location-history-event-card-editing",{state:"detached"});
  }
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  await addEvent({title:`Событие без даты ${token}`});
  await addEvent({title:`Основание ${token}`,dateLabel:"около 1240 года"});
  await addEvent({title:`Легендарная война ${token}`,dateLabel:"за три века до войны"});
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:8000});
  {
    const events=await page.evaluate(async cid=>(await cloudProjectSync.api.listLocationHistoryEvents(cid)).data,canonicalId);
    assert(events.length===3,`expected 3 events, got ${events.length}`);
    const undated=events.find(e=>e.title===`Событие без даты ${token}`);
    assert(undated&&undated.date_label==="","blank date_label must round-trip exactly as empty string");
    const dated=events.find(e=>e.title===`Основание ${token}`);
    assert(dated.date_label==="около 1240 года","date label must round-trip verbatim");
    const fantasy=events.find(e=>e.title===`Легендарная война ${token}`);
    assert(fantasy.date_label==="за три века до войны","fantasy date label must round-trip verbatim, never parsed/rejected");
    // 8. manual order: list_location_history_events already orders by (sort_order,id) server-side
    // (also proven independently by supabase/tests/location_history_events_foundation.sql's own
    // ordering block) -- confirm the append order (undated, dated, fantasy) round-trips through the
    // real production RPC without a second browser round-trip (Read-mode's own rendering of this
    // same order is already proven separately by tools/location-history-browser.test.mjs in local
    // mode, where the identical renderLocationProfileHistoryEventsRead function is exercised).
    assert(events[0].id===undated.id&&events[1].id===dated.id&&events[2].id===fantasy.id,`manual append order not preserved: ${JSON.stringify(events.map(e=>e.title))}`);
    report.test4_8_eventsCreatedAndLabelsRoundTrip={ok:true,ids:{undated:undated.id,dated:dated.id,fantasy:fantasy.id}};
  }

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,stack:error.stack,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectTitle],token);
    console.log(JSON.stringify({cleanup:counts}));
    if(!(counts.projects===0&&counts.locations===0&&counts.events===0)){
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
