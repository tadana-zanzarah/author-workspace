// Real-cloud verification for the scene position model (V3). Opt-in, not part of
// `npm test` — mirrors the existing *-real-browser.test.mjs convention: skips
// cleanly when CLOUD_TEST_EMAIL/CLOUD_TEST_PASSWORD are not configured, runs
// against a disposable project created and torn down by this script, and never
// touches any project it did not create itself.
import {createRequire} from "node:module";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("scene position real-cloud test skipped: credentials are not configured");process.exit(0)}
const port=process.env.AUTHOR_WORKSPACE_URL?null:8074;
const server=port?spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}}):null;
const base=process.env.AUTHOR_WORKSPACE_URL||`http://127.0.0.1:${port}/`;
const token=crypto.randomBytes(7).toString("hex"),title=`AW scene position QA ${token}`;
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
  // A, B, C appended in order via the existing global create flow (unchanged semantics).
  await createScene("A");await createScene("B");await createScene("C");
  await page.waitForTimeout(300);
  let order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="A,B,C",`expected A,B,C after three global creates, got ${order.join(",")}`);

  // Positional create between A and B via the real move_scene/create_scene RPCs.
  const betweenLabel=await page.evaluate(()=>{
    const btn=[...document.querySelectorAll('[data-action="insert-scene"]')].find(b=>(b.getAttribute("aria-label")||"").includes("между «A» и «B»"));
    return btn?btn.getAttribute("aria-label"):null;
  });
  assert(betweenLabel,"could not find the 'insert between A and B' position control");
  await page.evaluate((label)=>{
    [...document.querySelectorAll('[data-action="insert-scene"]')].find(b=>b.getAttribute("aria-label")===label).click();
  },betweenLabel);
  await page.waitForSelector("#sceneModal:not([hidden])");
  await page.fill("#sceneTitle","Between");
  await page.click("#saveScene");
  await page.waitForSelector("#sceneModal",{state:"hidden"});
  await page.waitForTimeout(300);
  order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="A,Between,B,C",`expected A,Between,B,C after positional create, got ${order.join(",")}`);

  // Verify it survives an authoritative reload (Supabase, not local cache).
  await page.reload({waitUntil:"networkidle"});
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForSelector('body[data-app-state="workspace"]');
  await page.waitForTimeout(300);
  order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="A,Between,B,C",`positional create did not survive reload, got ${order.join(",")}`);

  // Reorder: move C to before A via the real move_scene RPC (table view drag).
  const dragMove=async(sceneTitle,targetTitle)=>page.evaluate(({sceneTitle,targetTitle})=>{
    const idOf=t=>data.scenes.find(s=>s.title===t).id;
    const sceneId=idOf(sceneTitle),targetId=idOf(targetTitle);
    const handle=document.querySelector(`[data-scene-id="${sceneId}"] .drag-handle`);
    const targetRow=document.querySelector(`[data-scene-id="${targetId}"]`);
    const transfer=new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    const rect=targetRow.getBoundingClientRect();
    targetRow.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+1}));
    targetRow.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+1}));
    handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
  },{sceneTitle,targetTitle});
  await dragMove("C","A");
  await page.waitForTimeout(500);
  order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="C,A,Between,B",`expected C,A,Between,B after reorder, got ${order.join(",")}`);

  // Verify the reorder survives an authoritative reload too.
  await page.reload({waitUntil:"networkidle"});
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForSelector('body[data-app-state="workspace"]');
  await page.waitForTimeout(300);
  order=await page.evaluate(()=>data.scenes.map(s=>s.title));
  assert(order.join(",")==="C,A,Between,B",`reorder did not survive reload, got ${order.join(",")}`);

  console.log(JSON.stringify({ok:true,positionalCreatePersists:true,reorderPersists:true}));
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
