import {createRequire} from "node:module";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("manager save UX real-browser acceptance skipped: credentials are not configured");process.exit(0)}
const port=process.env.AUTHOR_WORKSPACE_URL?null:8074;
const server=port?spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}}):null;
const base=process.env.AUTHOR_WORKSPACE_URL||`http://127.0.0.1:${port}/`;
const token=crypto.randomBytes(7).toString("hex"),title=`AW manager save ux ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(message)};
let projectId=null,contextA,pageA,contextB,pageB;
const report={};

async function login(page){
  for(let i=0;i<30;i++){try{await page.goto(base,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
}
async function openProject(page,project){
  page.on("dialog",dialog=>dialog.dismiss());
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},project);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  assert(opened,"openCloudProject did not reach workspace state after retries");
}
const content=page=>page.evaluate(async()=>(await cloudState.contentApi.loadProjectContent(cloudProjectSync.projectId)).data);
const revision=page=>page.evaluate(()=>cloudProjectSync.revision);

try{
  contextA=await browser.newContext();pageA=await contextA.newPage();pageA.setDefaultTimeout(20000);
  await login(pageA);
  const project=await pageA.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},title);
  projectId=project.id;
  await openProject(pageA,project);

  /* ---------- Chapters: staged create, no write before Save, rename, authoritative persistence ---------- */
  await pageA.click("#projectMenu > summary");await pageA.click("#manageChapters");
  const chapterRevBefore=await revision(pageA);
  await pageA.click("#addChapter");
  await pageA.locator(".chapter-name-input").last().fill("Cloud Chapter A");
  assert((await revision(pageA))===chapterRevBefore,"chapter draft add must not touch cloud revision before Save");
  assert((await content(pageA)).chapters.length===0,"chapter draft add must not create a remote row before Save");
  await pageA.click("#saveChapters");
  await pageA.waitForFunction(()=>!trackerFor("chaptersModal").isDirty());
  assert((await revision(pageA))>chapterRevBefore,"chapter save must increment cloud revision");
  let remote=await content(pageA);
  let chapterId=remote.chapters.find(c=>c.title==="Cloud Chapter A")?.id;
  assert(chapterId,"created chapter missing from authoritative reload");
  report.chapterCreate="ok";

  await pageA.locator(".chapter-name-input").first().fill("Cloud Chapter A Renamed");
  await pageA.click("#saveChapters");
  await pageA.waitForFunction(()=>!trackerFor("chaptersModal").isDirty());
  remote=await content(pageA);
  assert(remote.chapters.some(c=>c.id===chapterId&&c.title==="Cloud Chapter A Renamed"),"chapter rename did not survive authoritative reload");
  report.chapterRename="ok";
  await pageA.click("#closeChapters");

  /* ---------- Locations: staged create, no write before Save, rename, authoritative persistence ---------- */
  await pageA.click("#projectMenu > summary");await pageA.click("#manageLocations");
  const locationRevBefore=await revision(pageA);
  await pageA.click("#addLocation");
  await pageA.locator(".location-name-input").last().fill("Cloud Location A");
  assert((await revision(pageA))===locationRevBefore,"location draft add must not touch cloud revision before Save");
  assert((await content(pageA)).locations.length===0,"location draft add must not create a remote row before Save");
  await pageA.click("#saveLocations");
  await pageA.waitForFunction(()=>!trackerFor("locationsModal").isDirty());
  assert((await revision(pageA))>locationRevBefore,"location save must increment cloud revision");
  remote=await content(pageA);
  const locationId=remote.locations.find(l=>l.name==="Cloud Location A")?.id;
  assert(locationId,"created location missing from authoritative reload");
  report.locationCreate="ok";

  await pageA.locator(".location-name-input").first().fill("Cloud Location A Renamed");
  await pageA.click("#saveLocations");
  await pageA.waitForFunction(()=>!trackerFor("locationsModal").isDirty());
  remote=await content(pageA);
  assert(remote.locations.some(l=>l.id===locationId&&l.name==="Cloud Location A Renamed"),"location rename did not survive authoritative reload");
  report.locationRename="ok";
  await pageA.click("#closeLocations");

  /* ---------- Tags: staged create, no write before Save, rename, canonicalization/dedup, authoritative persistence ---------- */
  await pageA.click("#projectMenu > summary");await pageA.click("#manageTags");
  const tagRevBefore=await revision(pageA);
  await pageA.click("#addTag");
  await pageA.locator(".tag-name-input").last().fill("#Дедуп Тест");
  await pageA.click("#addTag");
  await pageA.locator(".tag-name-input").last().fill("дедуп тест");
  assert((await revision(pageA))===tagRevBefore,"tag draft add must not touch cloud revision before Save");
  assert((await content(pageA)).tags.length===0,"tag draft add must not create a remote row before Save");
  await pageA.click("#saveTags");
  await pageA.waitForFunction(()=>!trackerFor("tagsModal").isDirty());
  assert((await revision(pageA))>tagRevBefore,"tag save must increment cloud revision");
  remote=await content(pageA);
  const dedupMatches=remote.tags.filter(t=>t.name.toLocaleLowerCase("ru")==="дедуп тест");
  assert(dedupMatches.length===1,`tag canonicalization/dedup must keep exactly one remote row, found ${dedupMatches.length}`);
  report.tagCreateDedup="ok";

  const tagId=dedupMatches[0].id;
  await pageA.locator(".tag-name-input").first().fill("Переименованный тег");
  await pageA.click("#saveTags");
  await pageA.waitForFunction(()=>!trackerFor("tagsModal").isDirty());
  remote=await content(pageA);
  assert(remote.tags.some(t=>t.id===tagId&&t.name==="Переименованный тег"),"tag rename did not survive authoritative reload");
  report.tagRename="ok";
  await pageA.click("#closeTags");

  /* ---------- Conflicting save preserves the draft (chapter rename raced by a second session) ---------- */
  contextB=await browser.newContext();pageB=await contextB.newPage();pageB.setDefaultTimeout(20000);
  await login(pageB);await openProject(pageB,project);
  await pageA.click("#projectMenu > summary");await pageA.click("#manageChapters");
  await pageA.locator(".chapter-name-input").first().fill("Conflict Draft From A");
  await pageB.evaluate(async chapterId=>{const r=await cloudState.contentApi.updateChapter(cloudProjectSync.projectId,chapterId,cloudProjectSync.revision,{title:"Changed By B"});if(!r.ok)throw new Error("setup mutation from B failed: "+r.code)},chapterId);
  await pageA.click("#saveChapters");
  await pageA.waitForTimeout(500);
  assert(await pageA.locator("#chaptersModal").isVisible(),"conflicting save must not close the manager");
  assert(await pageA.evaluate(()=>trackerFor("chaptersModal").isDirty()),"conflicting save must preserve the dirty draft");
  assert(await pageA.locator(".chapter-name-input").first().inputValue()==="Conflict Draft From A","conflicting save must not discard the typed draft");
  assert((await pageA.textContent("#chaptersSaveStatus"))?.trim().length>0,"conflicting save must show an app-native error");
  remote=await content(pageA);
  assert(remote.chapters.find(c=>c.id===chapterId)?.title==="Changed By B","a losing writer must not overwrite the winning remote value");
  report.conflictPreservesDraft="ok";
  // Recover pageA in place (reload the confirmed cloud state and force-close the still-dirty manager)
  // rather than a full page reload, since a persisted auth session would skip the login screen.
  await pageA.evaluate(async()=>{const loaded=await cloudProjectSync.reload();if(loaded.ok){data=loaded.data;render()}});
  await pageA.evaluate(()=>{trackerFor("chaptersModal").resetDirty();forceCloseModal("chaptersModal")});

  /* ---------- Scene quick-create Location: no prompt, single-flight, selection, draft preservation, persistence ---------- */
  await pageA.click("#addFirst");
  await pageA.fill("#sceneTitle","Quick-create Scene Draft");
  const beforeQuickCreate=(await content(pageA)).locations.length;
  await pageA.click("#quickAddLocation");
  await pageA.fill("#quickLocationName","Cloud Quick Location");
  await pageA.evaluate(()=>{document.getElementById("quickLocationCreate").click();document.getElementById("quickLocationCreate").click()});
  await pageA.waitForSelector("#quickLocationModal",{state:"hidden"});
  await pageA.waitForTimeout(500);
  remote=await content(pageA);
  const quickMatches=remote.locations.filter(l=>l.name==="Cloud Quick Location");
  assert(quickMatches.length===1,`rapid repeated quick-create submit must create exactly one remote location, found ${quickMatches.length}`);
  assert(remote.locations.length===beforeQuickCreate+1,"quick-create must not create extra locations");
  assert(await pageA.inputValue("#sceneLocation")===quickMatches[0].id,"quick-created location must be selected in the scene");
  assert(await pageA.inputValue("#sceneTitle")==="Quick-create Scene Draft","quick-create must preserve the scene draft");
  report.quickCreateLocationSingleFlight="ok";
  await pageA.click("#saveScene");
  await pageA.getByText("Quick-create Scene Draft",{exact:true}).waitFor();
  remote=await content(pageA);
  assert(remote.scenes.some(s=>s.title==="Quick-create Scene Draft"&&s.location_id===quickMatches[0].id),"scene with quick-created location did not persist");
  report.quickCreateLocationPersists="ok";

  console.log(JSON.stringify({ok:true,...report}));
}finally{
  try{
    if(pageA&&projectId){
      await pageA.evaluate(async projectId=>{
        const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
        const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
        await client.from("projects").delete().eq("id",projectId);
      },projectId).catch(error=>console.error("cleanup failed",error));
    }
  }finally{
    await contextA?.close();await contextB?.close();await browser.close();server?.kill();
  }
}
