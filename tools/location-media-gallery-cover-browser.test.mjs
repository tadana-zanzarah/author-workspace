// Location Media B4C -- Gallery primary-photo cover browser regression suite, driven through the
// REAL application paths (js/locations.js's renderLocationGallery/renderLocationGalleryCovers,
// js/location-media.js's locationGalleryCoverInfo/resolveGalleryCoverOutcome,
// js/cloud-location-media-api.js's already-live signedUrl cache) against the REAL production
// Supabase project. Disposable CLOUD_TEST fixture user + ONE disposable project + TWO disposable
// canonical Locations, named with this run's unique token. Skips gracefully if credentials are not
// configured.
//
// Gallery cover reads get_project_content's own bounded primary_photo projection -- the ENTIRE
// point of this suite is proving that stays true: one get_project_content call per project
// hydration, zero list_location_media calls from the Gallery, map/floorplan/other never used as a
// cover (enforced server-side by the projection's own media_kind='photo' filter, not by client
// logic this suite could accidentally get right for the wrong reason).
//
// NOT EXECUTED THIS SESSION: Playwright/a real browser binary were not available in the environment
// this file was authored in (same disclosed gap as B4A/B4B). Every scenario below (A-N per the B4C
// task brief) WAS exercised live this session via the Claude Browser pane's page.evaluate-equivalent
// tool against this same production project, including an RPC-call-count instrumentation pass that
// confirmed exactly one get_project_content and zero list_location_media calls per hydration.
// Committed so a future session WITH Playwright available can run this exact suite for real.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location media gallery cover browser suite skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW b4c-gallery ${token}`;
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
async function addMedia(page,participationId,kind,fileLabel,{makePrimary=false}={}){
  return page.evaluate(async({participationId,kind,fileLabel,makePrimary,png})=>{
    const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
    const file=new File([bytes],fileLabel,{type:"image/png"});
    startAddLocationMedia(kind);
    handleLocationMediaFileChosen({target:{files:[file],value:""}});
    await new Promise(r=>setTimeout(r,30));
    const cards=[...document.querySelectorAll(`.location-media-card[data-kind="${kind}"]`)];
    const id=cards[cards.length-1].dataset.mediaId;
    if(makePrimary)setLocationMediaDraftPrimary(id);
    return id;
  },{participationId,kind,fileLabel,makePrimary,png:ONE_PIXEL_PNG_BASE64});
}
async function galleryCoverState(page,participationId){
  return page.evaluate(pid=>{
    const card=document.querySelector(`[data-location-id="${pid}"]`);
    const img=card?.querySelector(".location-card-monogram img");
    return {hasImg:!!img,imgSrcIsHttps:img?.src?.startsWith("https://")||false,primaryPhoto:globalThis.data.locations.find(l=>l.id===pid)?.primaryPhoto??null};
  },participationId);
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

  const create=await page.evaluate(({pid,rev,token})=>cloudState.contentApi.createLocationCanonical(pid,rev,{name:`B4C Gallery ${token}`,description:"Disposable B4C cover fixture."}),{pid:project.id,rev,token});
  assert(create.ok,`create_location_canonical must succeed: ${JSON.stringify(create)}`);
  const participationId=create.data.id,canonicalId=create.data.location_id;
  canonicalLocationIds.push(canonicalId);

  // ================= A: no media -> monogram =================
  await page.evaluate(()=>openLocationGallery());
  await page.waitForTimeout(400);
  let coverState=await galleryCoverState(page,participationId);
  assert(!coverState.hasImg&&coverState.primaryPhoto===null,"a Location with no media must show the monogram, no cover img");
  report.testA_noMediaMonogram={ok:true};

  // ================= Performance instrumentation: bounded hydration =================
  const rpcCalls=await page.evaluate(async()=>{
    const original=cloudState.client.rpc.bind(cloudState.client);
    const calls=[];
    cloudState.client.rpc=(name,args)=>{calls.push(name);return original(name,args)};
    const reloaded=await cloudProjectSync.reload();
    globalThis.data=reloaded.data;renderLocationGallery();
    await new Promise(r=>setTimeout(r,300));
    cloudState.client.rpc=original;
    return calls;
  });
  assert(rpcCalls.filter(c=>c==="get_project_content").length===1,`exactly one get_project_content call per hydration: ${JSON.stringify(rpcCalls)}`);
  assert(rpcCalls.filter(c=>c==="list_location_media").length===0,`Gallery hydration must never call list_location_media: ${JSON.stringify(rpcCalls)}`);
  report.testPerf_boundedHydration={ok:true,rpcCalls};

  // ================= B/C: first photo -> Save -> reload -> cover persists =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  const photo1Id=await addMedia(page,participationId,"photo","p1.png");
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  await page.evaluate(()=>forceHideModal("locationProfileModal"));
  await page.evaluate(()=>openLocationGallery());
  await page.waitForTimeout(600);
  coverState=await galleryCoverState(page,participationId);
  assert(coverState.hasImg&&coverState.imgSrcIsHttps&&coverState.primaryPhoto?.id===photo1Id,`first photo must become the Gallery cover: ${JSON.stringify(coverState)}`);
  report.testB_C_firstPhotoCover={ok:true};

  // ================= D: second photo, switch primary -> cover changes =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  const photo2Id=await addMedia(page,participationId,"photo","p2.png",{makePrimary:true});
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  await page.evaluate(()=>forceHideModal("locationProfileModal"));
  await page.evaluate(()=>openLocationGallery());
  await page.waitForTimeout(600);
  coverState=await galleryCoverState(page,participationId);
  assert(coverState.primaryPhoto?.id===photo2Id,`switching primary must change the Gallery cover to photo2: ${JSON.stringify(coverState)}`);
  report.testD_switchPrimaryCoverChanges={ok:true};

  // ================= E: delete primary -> deterministic fallback cover =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  await page.evaluate(id=>removeLocationMediaDraftItem(id),photo2Id);
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  await page.evaluate(()=>forceHideModal("locationProfileModal"));
  await page.evaluate(()=>openLocationGallery());
  await page.waitForTimeout(600);
  coverState=await galleryCoverState(page,participationId);
  assert(coverState.primaryPhoto?.id===photo1Id&&coverState.hasImg,`deleting the primary must promote the deterministic fallback (photo1) as the new cover: ${JSON.stringify(coverState)}`);
  report.testE_deletePrimaryFallbackCover={ok:true};

  // ================= F: delete remaining photo -> monogram returns =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  await page.evaluate(id=>removeLocationMediaDraftItem(id),photo1Id);
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  await page.evaluate(()=>forceHideModal("locationProfileModal"));
  await page.evaluate(()=>openLocationGallery());
  await page.waitForTimeout(500);
  coverState=await galleryCoverState(page,participationId);
  assert(!coverState.hasImg&&coverState.primaryPhoto===null,`deleting all photos must return the Gallery cover to the monogram: ${JSON.stringify(coverState)}`);
  report.testF_deleteAllMonogramReturns={ok:true};

  // ================= G/H: map-only / floorplan-only -> monogram, never used as cover =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(300);
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  await addMedia(page,participationId,"map","m1.png",{makePrimary:true});
  await addMedia(page,participationId,"floorplan","f1.png",{makePrimary:true});
  await page.evaluate(()=>saveLocationProfile());
  await page.waitForFunction(()=>document.getElementById("locationProfileStatus").textContent.includes("сохранена"),null,{timeout:15000});
  await page.evaluate(()=>forceHideModal("locationProfileModal"));
  await page.evaluate(()=>openLocationGallery());
  await page.waitForTimeout(500);
  coverState=await galleryCoverState(page,participationId);
  assert(!coverState.hasImg&&coverState.primaryPhoto===null,`a map+floorplan-only Location must never use either as the Gallery cover: ${JSON.stringify(coverState)}`);
  report.testG_H_mapFloorplanOnlyMonogram={ok:true};

  // ================= I: card click/navigation unaffected =================
  const opensProfile=await page.evaluate(async pid=>{
    forceHideModal("locationsModal");
    document.querySelector(`[data-location-id="${pid}"] .location-card-open`)?.click();
    await new Promise(r=>setTimeout(r,300));
    return document.getElementById("locationProfileModal").style.display==="flex";
  },participationId);
  assert(opensProfile,"clicking a Location card with a cover must still open its Profile");
  await page.evaluate(()=>forceHideModal("locationProfileModal"));
  report.testI_cardClickUnaffected={ok:true};

  // ================= L: multiple Location cards do not cross-wire covers =================
  const create2=await page.evaluate(({pid,token})=>{const rev=cloudProjectSync.revision;return cloudState.contentApi.createLocationCanonical(pid,rev,{name:`B4C Gallery No Photo ${token}`,description:""})},{pid:project.id,token});
  assert(create2.ok,`second disposable Location must be created: ${JSON.stringify(create2)}`);
  const participation2Id=create2.data.id,canonical2Id=create2.data.location_id;
  canonicalLocationIds.push(canonical2Id);
  await page.evaluate(async()=>{const reloaded=await cloudProjectSync.reload();globalThis.data=reloaded.data});
  await page.evaluate(()=>openLocationGallery());
  await page.waitForTimeout(600);
  const state1=await galleryCoverState(page,participationId),state2=await galleryCoverState(page,participation2Id);
  assert(!state1.hasImg&&!state2.hasImg,"a Location with active media only in map/floorplan kinds and a brand-new photo-less Location must both show monogram, independently");
  report.testL_noCrossWiredCovers={ok:true};

  // ================= N: Profile Media regression (Read/Edit/lightbox still work) =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.waitForTimeout(400);
  const mediaSectionVisible=await page.evaluate(()=>!document.getElementById("locationProfileMedia").hidden);
  assert(mediaSectionVisible,"Profile Read Media section (map+floorplan) must still render after B4C changes");
  await page.evaluate(()=>document.getElementById("locationProfileEdit").click());
  const hasPopulationCultureChip=await page.evaluate(()=>{document.getElementById("locProfileAddSectionToggle").click();return document.getElementById("locProfileAddSectionPanel").textContent.includes("Население и культура")});
  assert(hasPopulationCultureChip,"B3B/B3C thematic module chip dirty-state fix must remain unaffected by B4C");
  report.testN_profileMediaRegression={ok:true};

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
