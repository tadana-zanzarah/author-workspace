import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");

const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const token=crypto.randomBytes(8).toString("hex"),email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD,title=`Cloud structure ${token}`;
if(!email||!password){console.log("cloud project structure real-browser test skipped: CLOUD_TEST_EMAIL/CLOUD_TEST_PASSWORD are not configured");process.exit(0)}
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const a=await browser.newContext(),b=await browser.newContext();
const pageA=await a.newPage(),pageB=await b.newPage();
for(const page of [pageA,pageB])page.setDefaultTimeout(15000);

async function login(page){
  await page.goto(base,{waitUntil:"networkidle"});await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
}
async function openProject(page){
  const row=page.locator(".cloud-project",{has:page.getByText(title,{exact:true})});await row.getByRole("button",{name:"Открыть"}).click();
  await page.waitForSelector('body[data-app-state="workspace"]');await page.getByText("Сцен пока нет",{exact:false}).waitFor();
}

try{
  await login(pageA);
  await pageA.getByRole("button",{name:"＋ Новый проект"}).first().click();await pageA.fill('#newProjectForm [name="title"]',title);await pageA.click('#newProjectForm button[type="submit"]');
  await pageA.waitForSelector("#newProjectModal",{state:"hidden"});await openProject(pageA);
  if(!await pageA.getByText("Сцен пока нет",{exact:false}).isVisible())throw new Error("Empty cloud project state missing");

  await pageA.click("#manageChapters");await pageA.click("#addChapter");await pageA.locator(".chapter-name-input").last().fill("Cloud chapter");await pageA.click("#saveChapters");await pageA.click("#closeChapters");
  await pageA.click("#manageLocations");await pageA.click("#addLocation");await pageA.locator(".location-name-input").last().fill("Cloud location");await pageA.click("#saveLocations");await pageA.click("#closeLocations");
  await pageA.click("#manageTags");await pageA.evaluate(()=>{const original=prompt;globalThis.prompt=()=>"Cloud tag";document.getElementById("addTag").click();globalThis.prompt=original});await pageA.getByDisplayValue("Cloud tag").waitFor();await pageA.click("#closeTags");

  await pageA.click("#addFirst");await pageA.fill("#sceneTitle","Cross device scene");await pageA.selectOption("#sceneChapter",{label:"Cloud chapter"});await pageA.selectOption("#sceneLocation",{label:"Cloud location"});await pageA.selectOption("#sceneWritingStatus","draft");await pageA.fill("#sceneTagInput","Cloud tag");await pageA.click("#addSceneTag");await pageA.click("#saveScene");
  await pageA.getByText("Cross device scene",{exact:true}).waitFor();
  const immediate=await pageA.evaluate(()=>{const s=data.scenes.find(x=>x.title==="Cross device scene");return {chapter:chapterById(s.chapterId)?.title,status:s.writingStatus,revision:cloudProjectSync.revision}});
  if(immediate.chapter!=="Cloud chapter"||immediate.status!=="draft")throw new Error(`First-create regression: ${JSON.stringify(immediate)}`);

  await login(pageB);await openProject(pageB);await pageB.getByText("Cross device scene",{exact:true}).waitFor();
  const fresh=await pageB.evaluate(()=>({cache:localStorage.getItem(activeWorkspaceContext().storageKey),revision:cloudProjectSync.revision,scene:data.scenes.find(x=>x.title==="Cross device scene")}));
  if(!fresh.cache||fresh.scene.writingStatus!=="draft")throw new Error("Fresh context cache/status missing");
  if(await pageB.locator("#sideLocations").getByText("Cloud location",{exact:false}).count()===0)throw new Error("Location missing in fresh context");
  if(await pageB.locator("#sideTags").getByText("Cloud tag",{exact:false}).count()===0)throw new Error("Tag missing in fresh context");
  const bChapter=await pageB.evaluate(()=>chapterById(data.scenes.find(x=>x.title==="Cross device scene").chapterId)?.title);
  if(bChapter!=="Cloud chapter")throw new Error("Chapter missing in fresh context");

  await pageB.getByText("Cross device scene",{exact:true}).dblclick();await pageB.fill("#sceneTitle","Changed in B");await pageB.click("#saveScene");await pageB.getByText("Changed in B",{exact:true}).waitFor();
  pageA.once("dialog",dialog=>dialog.dismiss());await pageA.getByText("Cross device scene",{exact:true}).dblclick();await pageA.fill("#sceneTitle","Stale A");await pageA.click("#saveScene");
  await pageA.getByText("Проект изменился в другом окне или на другом устройстве.",{exact:false}).waitFor();
  if(!await pageA.locator("#sceneModal").isVisible()||await pageA.inputValue("#sceneTitle")!=="Stale A")throw new Error("Conflict destroyed dirty draft");

  const projectId=await pageB.evaluate(()=>cloudProjectSync.projectId),userId=await pageB.evaluate(()=>cloudState.session.user.id);
  console.log(JSON.stringify({ok:true,projectId,userId,email,revision:fresh.revision}));
}finally{await a.close();await b.close();await browser.close()}
