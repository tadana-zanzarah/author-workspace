// Location History -- HYBRID IMPLEMENTATION -- published-smoke PHASE 4: delete (persisted event),
// dirty-state/Cancel-zero-writes, EXPLICIT async-race regression checks (the two bugs fixed in
// js/locations.js after phase1's first real-cloud run), and the remaining regressions (B3B/B3C
// chip-only dirty state, hierarchy/children, Gallery navigation). Runs against the REAL published
// GitHub Pages app + REAL production Supabase project, CLOUD_TEST fixtures only. Kept as its own
// short session, same reasoning as phase2/phase3.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"https://tadana-zanzarah.github.io/author-workspace/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location history published-smoke phase4 skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW history4 ${token}`;
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
  const create=await page.evaluate(({pid,token})=>cloudState.contentApi.createLocationCanonical(pid,0,{name:`History Location4 ${token}`,description:""}),{pid:project.id,token});
  assert(create.ok,`create_location_canonical failed: ${JSON.stringify(create)}`);
  const canonicalId=create.data.location_id;
  canonicalLocationIds.push(canonicalId);
  // Two pre-existing events (no prose at all -- events-only, the exact shape that exposed the
  // second async-race bug) seeded directly, matching phase1/phase2/phase3's own setup style.
  let locRev=create.data.location_revision;
  const seedIds=[];
  for(const [i,t] of [`Первое ${token}`,`Второе ${token}`].entries()){
    const r=await page.evaluate(({cid,rev,t,i})=>cloudProjectSync.api.createLocationHistoryEvent(cid,rev,{eventId:crypto.randomUUID(),title:t,dateLabel:"",description:"",sortOrder:i}),{cid:canonicalId,rev:locRev,t,i});
    assert(r.ok,`seed failed: ${JSON.stringify(r)}`);locRev=r.locationRevision;seedIds.push(r.data.id);
  }

  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations)&&globalThis.data.locations.length>0);
  const participationId=await page.evaluate(cid=>globalThis.data.locations.find(l=>l.locationId===cid)?.id,canonicalId);
  assert(participationId,"participation id must resolve");

  // ============ I: async-race regression 1 -- delayed event fetch must not overwrite an
  // already-in-progress draft edit. Open the Profile and enter edit mode, then IMMEDIATELY (no
  // wait for the lazy list_location_history_events fetch) add a brand-new draft event -- racing
  // the add against the network round trip on purpose, exactly the sequence that exposed the bug
  // on the very first real-cloud run before the fix. ============
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  await page.evaluate(()=>{addLocationHistoryEventDraft();finishEditLocationHistoryEventDraft()});
  {
    // Give the lazy fetch every chance to resolve and (pre-fix) clobber the draft. The fix does not
    // MERGE the freshly-resolved seeded events into an already-dirty draft (locationHistoryEvents
    // Original still updates correctly for the next edit-entry/Save diff) -- it only guarantees the
    // draft the author is actively looking at is never silently replaced out from under them. So
    // the correct post-fix assertion is "the in-progress addition is still exactly there", not "it
    // merged with the seeded events".
    await page.waitForTimeout(4000);
    const draft=await page.evaluate(()=>currentLocationProfileHistoryEventsSnapshot());
    assert(draft.length===1,`race regression 1: the in-progress draft addition must survive the lazy fetch resolving underneath it (expected exactly the 1 unsaved item), got ${draft.length}`);
    report.testI_race1={ok:true,draftLength:draft.length};
  }
  // Discard this draft-only addition cleanly before the next check.
  await page.click("#locationProfileCancelEdit");
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex")await page.click("#discardChanges");

  // ============ I: async-race regression 2 -- delayed event fetch must not leave a stale
  // Hide/Remove/Delete action row or collapsed accordion after edit mode is already open. A full
  // page reload first is required to genuinely re-arm the race: after race regression 1 above,
  // this module's locationHistoryEventsOriginal is already correctly populated in memory, so a
  // same-page re-open would synchronously reuse it and never actually race the fetch again.
  // Enter edit mode immediately on the fresh load, THEN wait for the fetch, then confirm the Hide
  // control is both present (hasData correctly recomputed) and actually visible (accordion
  // re-expanded), matching the exact events-only shape that exposed this.
  await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>globalThis.cloudState?.dashboardStatus==="success",null,{timeout:60000});
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations)&&globalThis.data.locations.length>0);
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  await page.waitForFunction(()=>currentLocationProfileHistoryEventsSnapshot().length===2,null,{timeout:15000});
  {
    const hideVisible=await page.evaluate(()=>{
      const btn=document.getElementById("locProfileHistoryHide");
      const body=document.getElementById("locProfileHistoryBody");
      return !btn.hidden&&!body.hidden;
    });
    assert(hideVisible,"race regression 2: Hide control/accordion must become visible once the lazy fetch resolves, even though edit mode opened before it did");
    report.testI_race2={ok:true};
  }
  await page.click("#locationProfileCancelEdit");
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex")await page.click("#discardChanges");

  // ============ H: dirty state + exact Cancel (zero writes) ============
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  await page.waitForFunction(()=>currentLocationProfileHistoryEventsSnapshot().length===2,null,{timeout:15000});
  {
    const clean=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
    assert(clean===false,"H: freshly entered edit mode must start clean");
  }
  // prose-only dirty
  await page.evaluate(()=>{document.getElementById("locProfileLegends").value="draft-only, must be discarded";document.getElementById("locProfileLegends").dispatchEvent(new Event("input",{bubbles:true}))});
  assert(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()),"H: prose-only edit must mark dirty");
  const projectRevBefore=await page.evaluate(()=>cloudProjectSync.revision);
  await page.click("#locationProfileCancelEdit");
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex")await page.click("#discardChanges");
  {
    const clean=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
    assert(clean===false,"H: Cancel must return to a clean state");
    const projectRevAfter=await page.evaluate(()=>cloudProjectSync.revision);
    assert(projectRevBefore===projectRevAfter,"H: Cancel must perform zero writes (no revision change)");
  }
  // event-only dirty (edit an existing event's title, then Cancel -- must not persist)
  await page.click("#locationProfileEdit");
  await page.waitForFunction(()=>currentLocationProfileHistoryEventsSnapshot().length===2,null,{timeout:15000});
  await page.evaluate(()=>{
    const item=currentLocationProfileHistoryEventsSnapshot()[0];
    updateLocationHistoryEventDraftField(item.id,"title","DRAFT ONLY, must revert");
  });
  assert(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()),"H: event-field edit must mark dirty");
  // reorder-only dirty
  await page.evaluate(()=>{const items=currentLocationProfileHistoryEventsSnapshot();moveLocationHistoryEventDraftItem(items[1].id,"up")});
  const revertOk=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
  assert(revertOk,"H: reorder must (still) mark dirty");
  await page.click("#locationProfileCancelEdit");
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex")await page.click("#discardChanges");
  {
    const events=await page.evaluate(cid=>cloudProjectSync.api.listLocationHistoryEvents(cid),canonicalId);
    const titles=events.data.map(e=>e.title);
    assert(!titles.includes("DRAFT ONLY, must revert"),"H: Cancel must discard the event-field edit, never persist it");
    assert(titles.includes(`Первое ${token}`)&&titles.includes(`Второе ${token}`),"H: Cancel must leave the original events exactly as they were");
    report.testH={ok:true};
  }

  // ============ F: delete a PERSISTED event via the real UI, save, reload, confirm gone ============
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  await page.waitForFunction(()=>currentLocationProfileHistoryEventsSnapshot().length===2,null,{timeout:15000});
  await page.evaluate(()=>{const item=currentLocationProfileHistoryEventsSnapshot().find(e=>e.title.includes("Второе"));removeLocationHistoryEventDraftItem(item.id)});
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:15000});
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  {
    const events=await page.evaluate(cid=>cloudProjectSync.api.listLocationHistoryEvents(cid),canonicalId);
    assert(events.data.length===1&&events.data[0].title===`Первое ${token}`,`F: deleting the persisted event must leave exactly the other one, got ${JSON.stringify(events.data.map(e=>e.title))}`);
    report.testF={ok:true};
  }

  // ============ J: B3B/B3C chip-only dirty-state regression, hierarchy/children, Gallery ============
  await page.evaluate(pid=>openLocationProfile(pid),participationId);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  await page.click(`.location-thematic-add-chip:has-text("Экономика")`);
  {
    const host=await page.$("#locProfileIndustries input");
    await host.fill("Рыболовство");await host.press("Enter");
  }
  assert(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()),"J: a chip-only edit (economy.industries) must still mark the Profile dirty (B3B/B3C regression)");
  await page.click("#locationProfileCancelEdit");
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex")await page.click("#discardChanges");
  {
    const childrenOk=await page.evaluate(()=>!!document.getElementById("locationProfileChildren"));
    const scenesOk=await page.evaluate(()=>document.getElementById("locationProfileScenes")?.className==="location-profile-scenes");
    assert(childrenOk&&scenesOk,"J: hierarchy/children container and Scenes section must remain intact");
    report.testJ_hierarchyScenes={ok:true};
  }
  await page.evaluate(()=>document.getElementById("locationProfileClose").click());
  await page.evaluate(()=>openLocationGallery());
  await page.waitForSelector("#locationsGalleryGrid",{state:"visible"});
  {
    const galleryHasEntry=await page.evaluate(token=>document.getElementById("locationsGalleryGrid").innerHTML.includes(token),token);
    assert(galleryHasEntry,"J: Gallery navigation must list this session's Location");
    report.testJ_gallery={ok:true};
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
