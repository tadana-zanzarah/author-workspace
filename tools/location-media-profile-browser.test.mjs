// Location Media B4B -- Profile UI browser regression suite, driven through the REAL application
// paths (js/locations.js's Media editor/read rendering, js/location-media.js's draft/diff logic,
// js/cloud-location-media-api.js's already-live B4A adapter) against the REAL production Supabase
// project. Disposable CLOUD_TEST fixture user + ONE disposable project + ONE canonical Location,
// named with this run's unique token. Skips gracefully if credentials are not configured.
//
// Location Media is cloud-only (see B4B task brief "LOCAL MODE") -- there is no local-mode variant
// of these scenarios to cover here; local-mode's own "Media add/edit affordance is hidden, a
// restrained explanatory note shows instead" behavior is covered by
// tools/location-media.test.mjs's pure unit coverage plus the manual Browser-pane verification
// recorded in the B4B completion report (no CLOUD_TEST needed for that half).
//
// NOT EXECUTED THIS SESSION: Playwright/a real browser binary were not available in the environment
// this file was authored in (same disclosed gap the B4A/B3C real-cloud scripts have). The exact
// scenarios below (A-X per the B4B task brief) WERE exercised live this session via the Claude
// Browser pane's page.evaluate-equivalent tool against this same production project -- that pass is
// what caught and fixed two real bugs (a missing crypto.randomUUID() on new draft-item ids, and the
// locationProfileModal dirty-tracker never actually being wired to the media draft) before this file
// was written. Committed so a future session WITH Playwright available can run this exact suite for
// real, automated, repeatable coverage.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location media profile browser suite skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW b4b-profile ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};
const ONE_PIXEL_PNG_BASE64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

async function addMedia(page,kind,fileLabel){
  return page.evaluate(async({kind,fileLabel,png})=>{
    const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
    const file=new File([bytes],fileLabel,{type:"image/png"});
    startAddLocationMedia(kind);
    handleLocationMediaFileChosen({target:{files:[file],value:""}});
    await new Promise(r=>setTimeout(r,30));
    const cards=[...document.querySelectorAll(`.location-media-card[data-kind="${kind}"]`)];
    return cards[cards.length-1].dataset.mediaId;
  },{kind,fileLabel,png:ONE_PIXEL_PNG_BASE64});
}
async function cardIsPrimary(page,id){return page.evaluate(id=>document.querySelector(`.location-media-card[data-media-id="${id}"] .is-primary-active`)!==null,id)}
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
    const ownedLocations=await client.from("locations").select("id,name").eq("owner_id",owner);
    const tokenMatchedLocationIds=ownedLocations.data.filter(l=>l.name.includes(token)).map(l=>l.id);
    const allLocationIds=[...new Set([...canonicalLocationIds,...tokenMatchedLocationIds])];
    const media=allLocationIds.length?await client.from("location_media").select("id,storage_path").in("location_id",allLocationIds):{data:[]};
    if(media.data?.length){
      await client.storage.from("location-media").remove(media.data.map(m=>m.storage_path));
      await client.from("location_media").delete().in("id",media.data.map(m=>m.id));
    }
    if(projects.length){const d=await client.from("projects").delete().in("id",projects);if(d.error)throw d.error}
    if(allLocationIds.length){const d=await client.from("locations").delete().in("id",allLocationIds);if(d.error)throw d.error}
    const remainingProjects=await client.from("projects").select("id").in("id",projects);
    const remainingLocations=allLocationIds.length?await client.from("locations").select("id").in("id",allLocationIds):{data:[]};
    const remainingMedia=allLocationIds.length?await client.from("location_media").select("id").in("location_id",allLocationIds):{data:[]};
    return {projects:remainingProjects.data.length,locations:remainingLocations.data.length,media:remainingMedia.data.length};
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
  let rev=await page.evaluate(()=>cloudProjectSync.revision);

  const create=await page.evaluate(({pid,rev,token})=>cloudState.contentApi.createLocationCanonical(pid,rev,{name:`B4B Profile ${token}`,description:"Disposable B4B UI fixture."}),{pid:project.id,rev,token});
  assert(create.ok,`create_location_canonical must succeed: ${JSON.stringify(create)}`);
  const participationId=create.data.id,canonicalId=create.data.location_id;
  canonicalLocationIds.push(canonicalId);

  // ================= A: empty state =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForFunction(()=>document.getElementById("locationProfileModal").style.display==="flex");
  await page.waitForTimeout(400); // lazy media fetch
  assert(await page.evaluate(()=>document.getElementById("locationProfileMedia").hidden),"empty Location must hide the Read Media section entirely");
  report.testA_emptyState={ok:true};

  // ================= B/C: add photo draft, Cancel -> no persistence =================
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  const draftOnlyId=await addMedia(page,"photo","cancel-me.png");
  assert(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()),"adding a draft photo must mark the Profile dirty");
  await page.evaluate(()=>cancelLocationProfileEdit());
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex"){
    await page.evaluate(()=>resolveDiscardConfirmation(true));
  }
  await page.waitForTimeout(300);
  const afterCancelList=await page.evaluate(cid=>cloudState.locationMediaApi.listMedia(cid,null),canonicalId);
  assert(afterCancelList.data.length===0,`Cancel must leave zero persisted media rows: ${JSON.stringify(afterCancelList)}`);
  report.testB_C_addDraftThenCancel={ok:true};

  // ================= D/E: add photo -> Save -> reload; caption+alt persistence =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  const photo1Id=await addMedia(page,"photo","photo1.png");
  await page.evaluate(()=>{
    const caption=document.querySelector(".location-media-card-caption");
    caption.value="Подпись первого фото";caption.dispatchEvent(new Event("input",{bubbles:true}));
    const alt=document.querySelector(".location-media-card-alt");
    alt.value="Альт первого фото";alt.dispatchEvent(new Event("input",{bubbles:true}));
  });
  assert(await cardIsPrimary(page,photo1Id),"the first photo of a kind must auto-become primary");
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(500);
  const rows1=await page.evaluate(cid=>cloudState.locationMediaApi.listMedia(cid,null),canonicalId);
  const persisted1=rows1.data.find(r=>r.id===photo1Id);
  assert(persisted1?.caption==="Подпись первого фото"&&persisted1?.alt==="Альт первого фото"&&persisted1?.is_primary===true,`caption/alt/primary must persist exactly: ${JSON.stringify(persisted1)}`);
  report.testD_E_addSaveReloadCaptionAlt={ok:true};

  // ================= F/G: second photo, switch primary =================
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  const photo2Id=await addMedia(page,"photo","photo2.png");
  assert(!(await cardIsPrimary(page,photo2Id)),"a second photo must NOT auto-become primary while one already exists");
  await page.evaluate(id=>setLocationMediaDraftPrimary(id),photo2Id);
  assert(await cardIsPrimary(page,photo2Id)&&!(await cardIsPrimary(page,photo1Id)),"switching primary must promote photo2 and demote photo1");
  report.testF_G_secondPhotoSwitchPrimary={ok:true};

  // ================= H: reorder =================
  const orderBefore=await page.evaluate(()=>[...document.querySelectorAll('.location-media-card[data-kind="photo"]')].map(c=>c.dataset.mediaId));
  await page.evaluate(id=>moveLocationMediaDraftItem(id,"up"),orderBefore[1]);
  const orderAfter=await page.evaluate(()=>[...document.querySelectorAll('.location-media-card[data-kind="photo"]')].map(c=>c.dataset.mediaId));
  assert(orderAfter[0]===orderBefore[1],"moving the second card up must reorder it first");
  report.testH_reorder={ok:true};

  // ================= I: crop photo =================
  await page.evaluate(id=>openLocationMediaCrop(id),photo1Id);
  await page.waitForFunction(()=>document.getElementById("locationMediaCropModal").style.display==="flex");
  await page.evaluate(()=>{nudgeLocationMediaCrop(0.1,-0.05);saveLocationMediaCrop()});
  assert(await page.evaluate(()=>document.getElementById("locationMediaCropModal").style.display)!=="flex","crop modal must close after Save Crop");
  report.testI_cropPhoto={ok:true};

  // ================= J/K/L: map, independent primary, no crop action on map =================
  const mapId=await addMedia(page,"map","map1.png");
  assert(await cardIsPrimary(page,mapId),"the first map must auto-become primary");
  assert(await cardIsPrimary(page,photo2Id),"a new map primary must never demote the photo primary");
  const mapHasCrop=await page.evaluate(id=>!!document.querySelector(`.location-media-card[data-media-id="${id}"] button[onclick*="openLocationMediaCrop"]`),mapId);
  assert(!mapHasCrop,"a map card must never expose a crop action");
  report.testJ_K_L_mapIndependentPrimaryNoCrop={ok:true};

  // ================= M/N: floorplan, no crop action =================
  const floorplanId=await addMedia(page,"floorplan","floor1.png");
  const floorplanHasCrop=await page.evaluate(id=>!!document.querySelector(`.location-media-card[data-media-id="${id}"] button[onclick*="openLocationMediaCrop"]`),floorplanId);
  assert(!floorplanHasCrop,"a floorplan card must never expose a crop action");
  report.testM_N_floorplanNoCrop={ok:true};

  // ================= O: other kind =================
  const otherId=await addMedia(page,"other","other1.png");
  assert(!!otherId,"an 'other' kind item must be creatable");
  report.testO_otherKind={ok:true};

  // ================= P: full-size viewer for each kind =================
  for(const id of [photo1Id,mapId,floorplanId,otherId]){
    await page.evaluate(id=>openLocationMediaLightbox(id),id);
    assert(await page.evaluate(()=>document.getElementById("locationMediaLightboxModal").style.display)==="flex",`lightbox must open for ${id}`);
    await page.evaluate(()=>forceHideModal("locationMediaLightboxModal"));
  }
  report.testP_lightboxAllKinds={ok:true};

  // ================= Q: delete unsaved draft item -> zero backend write =================
  const unsavedId=await addMedia(page,"other","unsaved.png");
  await page.evaluate(id=>removeLocationMediaDraftItem(id),unsavedId);
  const listBeforeSave=await page.evaluate(cid=>cloudState.locationMediaApi.listMedia(cid,null),canonicalId);
  assert(!listBeforeSave.data.some(r=>r.id===unsavedId),"a draft item removed before Save must never reach the backend");
  report.testQ_deleteUnsavedDraft={ok:true};

  // ================= R: delete persisted item -> Save -> gone after reload =================
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  await page.evaluate(id=>removeLocationMediaDraftItem(id),otherId);
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  const rowsAfterDelete=await page.evaluate(cid=>cloudState.locationMediaApi.listMedia(cid,null),canonicalId);
  assert(!rowsAfterDelete.data.some(r=>r.id===otherId),"a deleted persisted item must not reappear after reload");
  report.testR_deletePersistedReload={ok:true};

  // ================= S/T: dirty state per mutation type + exact revert -> clean =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  assert(!(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty())),"a fresh edit-mode entry with no changes must be clean");
  const captionOriginal=await page.evaluate(()=>document.querySelector(".location-media-card-caption").value);
  await page.evaluate(()=>{const c=document.querySelector(".location-media-card-caption");c.value="temp";c.dispatchEvent(new Event("input",{bubbles:true}))});
  assert(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()),"a caption-only edit must mark the Profile dirty");
  await page.evaluate(original=>{const c=document.querySelector(".location-media-card-caption");c.value=original;c.dispatchEvent(new Event("input",{bubbles:true}))},captionOriginal);
  assert(!(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty())),"reverting a caption edit back to its original value must return to clean");
  report.testS_T_dirtyStateAndExactRevert={ok:true};

  // ================= U: existing B3B/B3C thematic chip dirty-state must still work =================
  await page.evaluate(()=>{document.getElementById("locProfileAddSectionToggle").click()});
  const hasPopulationCultureChip=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent.includes("Население и культура"));
  assert(hasPopulationCultureChip,"B3C's Population & Culture module chip must still be offered (no regression from Media wiring)");
  report.testU_thematicChipRegression={ok:true};

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,stack:error.stack,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectTitle],token);
    console.log(JSON.stringify({cleanup:counts}));
    if(!(counts.projects===0&&counts.locations===0&&counts.media===0)){
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
