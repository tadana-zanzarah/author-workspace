// One-off real-cloud smoke check for CARD VIEW drag/positional-create specifically
// (design/core-workspace-recomposition). Not wired into package.json / npm test —
// this is a manual verification script, run once against the dedicated
// CLOUD_TEST_EMAIL/CLOUD_TEST_PASSWORD fixture account, mirroring the conventions of
// scene-position-interactions-real-cloud.test.mjs (disposable project, self-cleaning).
import {createRequire} from "node:module";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("card position real-cloud check skipped: credentials are not configured");process.exit(0)}
const port=8075;
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
const base=`http://127.0.0.1:${port}/`;
const token=crypto.randomBytes(7).toString("hex"),title=`AW card position QA ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(message)};
let projectId=null,context,page;
try{
  context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(20000);
  for(let i=0;i<30;i++){try{await page.goto(base,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
  const project=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},title);
  projectId=project.id;
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},project);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  if(!opened)throw new Error("openCloudProject did not reach workspace state after retries");

  const createScene=async(name)=>{
    await page.click("#addFirst");
    await page.waitForSelector("#sceneModal:not([hidden])");
    await page.fill("#sceneTitle",name);
    await page.click("#saveScene");
    await page.waitForSelector("#sceneModal",{state:"hidden"});
  };
  await createScene("A");await createScene("B");await createScene("C");
  await page.waitForTimeout(300);

  await page.click('[data-view="cards"]');
  await page.waitForSelector(".card-chapter-group");

  // Positional create via a card edge control (before B) through the real RPCs.
  const beforeBLabel=await page.evaluate(()=>{
    const btn=[...document.querySelectorAll(".card-insert-edge")].find(b=>(b.getAttribute("aria-label")||"").includes("между «A» и «B»"));
    return btn?btn.getAttribute("aria-label"):null;
  });
  assert(beforeBLabel,"could not find the card 'insert between A and B' edge control");
  await page.evaluate(label=>document.querySelector(`.card-insert-edge[aria-label="${label}"]`).click(),beforeBLabel);
  await page.waitForSelector("#sceneModal:not([hidden])");
  await page.fill("#sceneTitle","Between");
  await page.click("#saveScene");
  await page.waitForSelector("#sceneModal",{state:"hidden"});
  await page.waitForTimeout(300);
  let order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="A,Between,B,C",`expected A,Between,B,C after card positional create, got ${order.join(",")}`);

  await page.reload({waitUntil:"networkidle"});
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForSelector('body[data-app-state="workspace"]');
  await page.waitForTimeout(300);
  order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="A,Between,B,C",`card positional create did not survive reload, got ${order.join(",")}`);

  // Card drag reorder: move C before A.
  await page.click('[data-view="cards"]');
  await page.waitForSelector(".card-chapter-group");
  await page.evaluate(()=>{
    const idOf=t=>data.scenes.find(s=>s.title===t).id;
    const card=document.querySelector(`.compact-scene-card[data-scene-id="${idOf("C")}"]`);
    const target=[...document.querySelectorAll(".card-insert-edge")].find(b=>(b.getAttribute("aria-label")||"").startsWith("Вставить сцену перед «A»"));
    const transfer=new DataTransfer();
    card.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    card.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
  });
  await page.waitForTimeout(500);
  order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="C,A,Between,B",`expected C,A,Between,B after card drag reorder, got ${order.join(",")}`);

  await page.reload({waitUntil:"networkidle"});
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForSelector('body[data-app-state="workspace"]');
  await page.waitForTimeout(300);
  order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="C,A,Between,B",`card drag reorder did not survive reload, got ${order.join(",")}`);

  console.log(JSON.stringify({ok:true,cardPositionalCreatePersists:true,cardDragReorderPersists:true}));
}finally{
  try{
    if(page&&projectId){
      await page.evaluate(async(projectId)=>{
        const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
        const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
        await client.from("projects").delete().eq("id",projectId);
      },projectId).catch(error=>console.error("cleanup failed",error));
    }
  }finally{await context?.close();await browser.close();server?.kill()}
}
