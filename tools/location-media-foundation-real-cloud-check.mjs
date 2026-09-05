// Location Media B4A -- FULL real-cloud round-trip against the REAL production Supabase project,
// driven through the ACTUAL application paths: js/cloud-location-media-api.js's real
// createCloudLocationMediaApi (cloudState.locationMediaApi), the real create/update/delete/
// list_location_media RPCs, real Storage upload/signed-url/remove against the real `location-media`
// bucket, and the real get_project_content primary_photo projection. Disposable CLOUD_TEST fixture
// user + ONE disposable project + ONE canonical Location, named with this run's unique token.
// Skips gracefully if credentials are not configured.
//
// SCOPE: B4A has NO Media UI (no upload button, no Gallery cover, no Profile Media section --
// see the B4A brief's explicit non-goals). This script therefore drives everything through
// page.evaluate() calls into the real cloudState.locationMediaApi / cloudState.client.storage /
// cloudState.contentApi, exactly the way tools/location-population-culture-real-cloud-check.mjs's
// own test 8/9 call RPCs directly for paths that have no DOM surface yet. The backend contract
// itself (constraints, indexes, RLS, primary/fallback semantics, revision domains) is already
// exhaustively covered by supabase/tests/location_media_foundation.sql in disposable CI -- this
// proves the REAL frontend adapter wiring against the REAL, now-live production backend.
//
// DO NOT RUN THIS AGAINST PRODUCTION BEFORE THE MIGRATION (20260907090000_location_media_
// foundation.sql) HAS BEEN EXPLICITLY APPROVED AND APPLIED. Before that, every RPC/bucket call
// below will fail with NOT_FOUND/42883 (undefined function) or a missing-bucket error -- that
// failure mode is itself a correct pre-apply signal, not a bug in this script.
//
// NOT EXECUTED THIS SESSION: mirrors tools/location-population-culture-real-cloud-check.mjs's own
// note -- Playwright/a real browser binary were not available in the environment this file was
// authored in, and (independently) the migration this script depends on has not been approved/
// applied yet. Committed so a future session with both Playwright available AND the migration live
// can run it for real.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location media foundation real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW b4a-media ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

// A tiny valid 1x1 PNG, base64-encoded -- small enough to be a trivial real upload, still a real
// decodable image (not just arbitrary bytes) so any future MIME/decode-time validation stays honest.
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
    // location_media rows cascade-delete with their project_locations participation, and the
    // canonical locations delete below cascades nothing further (location_media.location_id is
    // ON DELETE RESTRICT) -- so any still-active media row must be deleted explicitly FIRST, or
    // the location delete itself will fail closed rather than silently orphan a Storage object.
    const remainingMedia=allLocationIds.length?await client.from("location_media").select("id,storage_path").in("location_id",allLocationIds):{data:[]};
    if(remainingMedia.data?.length){
      const paths=remainingMedia.data.map(m=>m.storage_path);
      await client.storage.from("location-media").remove(paths);
      const d=await client.from("location_media").delete().in("id",remainingMedia.data.map(m=>m.id));
      if(d.error)throw d.error;
    }
    if(allLocationIds.length){const d=await client.from("locations").delete().in("id",allLocationIds);if(d.error)throw d.error}
    const remainingProjects=await client.from("projects").select("id").in("id",projects);
    const remainingLocations=allLocationIds.length?await client.from("locations").select("id").in("id",allLocationIds):{data:[]};
    const remainingMediaAfter=allLocationIds.length?await client.from("location_media").select("id").in("location_id",allLocationIds):{data:[]};
    const remainingStorage=await client.storage.from("location-media").list(owner);
    return {
      projects:remainingProjects.data.length,locations:remainingLocations.data.length,
      media:remainingMediaAfter.data.length,storageObjectsUnderOwner:remainingStorage.data?.length||0
    };
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
    name:`B4A Media Location ${token}`,description:`Disposable B4A media smoke fixture ${token}.`
  }),{pid:project.id,rev,token});
  assert(create.ok,`create_location_canonical must succeed: ${JSON.stringify(create)}`);
  const canonicalId=create.data.location_id,locationRevisionAfterCreate=create.data.location_revision;
  canonicalLocationIds.push(canonicalId);

  // ================= 1: real Storage upload + create_location_media (canonical photo, primary) ===
  const photo1Id=await page.evaluate(()=>crypto.randomUUID());
  const upload1=await page.evaluate(async({canonicalId,locationRevision,photo1Id,png})=>{
    const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
    const file=new File([bytes],"photo1.png",{type:"image/png"});
    return cloudState.locationMediaApi.uploadMedia({
      locationId:canonicalId,mediaId:photo1Id,file,
      media:{id:photo1Id,mediaKind:"photo",crop:{x:.5,y:.5,zoom:1},alt:"Маяк",caption:"Первое фото"},
      expectedRevision:locationRevision,isPrimary:true,sortOrder:0
    });
  },{canonicalId,locationRevision:locationRevisionAfterCreate,photo1Id,png:ONE_PIXEL_PNG_BASE64});
  assert(upload1.ok,`real Storage upload + create_location_media must succeed: ${JSON.stringify(upload1)}`);
  report.test1_uploadPrimaryPhoto={ok:true,storagePath:upload1.storagePath};

  // ================= 2: real signed URL read =======================================================
  const signed=await page.evaluate(path=>cloudState.locationMediaApi.signedUrl(path),upload1.storagePath);
  assert(signed.ok&&typeof signed.url==="string"&&signed.url.length>0,`signed URL must resolve for the just-uploaded object: ${JSON.stringify(signed)}`);
  report.test2_signedUrl={ok:true};

  // ================= 3: second photo, becomes primary (demotes photo1) =============================
  const photo2Id=await page.evaluate(()=>crypto.randomUUID());
  const upload2=await page.evaluate(async({canonicalId,photo2Id,png})=>{
    const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
    const file=new File([bytes],"photo2.png",{type:"image/png"});
    return cloudState.locationMediaApi.uploadMedia({
      locationId:canonicalId,mediaId:photo2Id,file,
      media:{id:photo2Id,mediaKind:"photo",crop:{x:.5,y:.5,zoom:1},alt:"Маяк вечером",caption:"Второе фото"},
      expectedRevision:0,isPrimary:true,sortOrder:1
    });
  },{canonicalId,photo2Id,png:ONE_PIXEL_PNG_BASE64});
  assert(upload2.ok,`primary switch upload must succeed: ${JSON.stringify(upload2)}`);
  const list1=await page.evaluate(id=>cloudState.locationMediaApi.listMedia(id),canonicalId);
  assert(list1.ok,`list_location_media must succeed: ${JSON.stringify(list1)}`);
  const rows1=list1.data;
  assert(rows1.find(r=>r.id===photo2Id)?.is_primary===true,"photo2 must be primary after upload");
  assert(rows1.find(r=>r.id===photo1Id)?.is_primary===false,"photo1 must be demoted after photo2 becomes primary");
  report.test3_primarySwitch={ok:true};

  // ================= 4: caption/metadata update on the (now non-primary) photo1 ====================
  const updated=await page.evaluate(({photo1Id,rev})=>cloudState.locationMediaApi.updateMedia(photo1Id,rev,{caption:"Обновлённая подпись"}),{photo1Id,rev:rows1.find(r=>r.id===photo1Id).revision});
  assert(updated.ok,`caption update must succeed: ${JSON.stringify(updated)}`);
  report.test4_metadataUpdate={ok:true};

  // ================= 5: independent map primary (must not disturb the photo primary) ===============
  const mapId=await page.evaluate(()=>crypto.randomUUID());
  const uploadMap=await page.evaluate(async({canonicalId,mapId,png})=>{
    const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
    const file=new File([bytes],"map1.png",{type:"image/png"});
    return cloudState.locationMediaApi.uploadMedia({
      locationId:canonicalId,mediaId:mapId,file,
      media:{id:mapId,mediaKind:"map",crop:{},alt:"Карта окрестностей",caption:""},
      expectedRevision:0,isPrimary:true,sortOrder:0
    });
  },{canonicalId,mapId,png:ONE_PIXEL_PNG_BASE64});
  assert(uploadMap.ok,`independent map primary upload must succeed: ${JSON.stringify(uploadMap)}`);
  const list2=await page.evaluate(id=>cloudState.locationMediaApi.listMedia(id),canonicalId);
  assert(list2.data.find(r=>r.id===photo2Id)?.is_primary===true,"map primary must not demote the existing photo primary");
  assert(list2.data.find(r=>r.id===mapId)?.is_primary===true,"map primary must be set");
  report.test5_independentMapPrimary={ok:true};

  // ================= 6: reload / get_project_content primary_photo projection ======================
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const reloadedLocation=await page.evaluate(cid=>globalThis.data.locations.find(l=>l.locationId===cid),canonicalId);
  assert(reloadedLocation?.primaryPhoto?.id===photo2Id,`get_project_content primary_photo must reflect the current primary photo after reload: ${JSON.stringify(reloadedLocation?.primaryPhoto)}`);
  report.test6_primaryPhotoProjection={ok:true,primaryPhoto:reloadedLocation.primaryPhoto};

  // ================= 7: delete + Storage cleanup, zero residue ======================================
  const deletePhoto1=await page.evaluate(({photo1Id,rev})=>cloudState.locationMediaApi.deleteMedia(photo1Id,rev),{photo1Id,rev:rows1.find(r=>r.id===photo1Id).revision+1});
  assert(deletePhoto1.ok,`delete of the non-primary photo must succeed: ${JSON.stringify(deletePhoto1)}`);
  assert(deletePhoto1.storageDeleted===true,"delete must confirm real Storage object removal, not just DB soft-delete");
  const listAfterDelete=await page.evaluate(id=>cloudState.locationMediaApi.listMedia(id),canonicalId);
  assert(!listAfterDelete.data.some(r=>r.id===photo1Id),"deleted media row must not reappear in list_location_media");
  report.test7_deleteAndCleanup={ok:true};

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
