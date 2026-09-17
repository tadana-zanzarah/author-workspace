import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Stage E3.2.1 real-phone bug: on a phone reaching this dev server over
// plain LAN HTTP (`http://172.22.x.x:8000`, not `localhost`), the browser
// does not consider the origin a secure context, so `crypto.randomUUID` is
// undefined there -- selecting an image while editing a character threw
// "crypto.randomUUID is not a function" (js/characters.js's
// readOriginalImage, the isCloudWorkspace() branch). This test cannot
// reproduce the insecure-origin condition itself (Playwright's own
// `http://127.0.0.1` is treated as a secure context, same as
// `localhost`), so it instead does what the real defect actually needs
// proven: with `crypto.randomUUID` explicitly deleted (simulating its
// absence, the actual observable symptom regardless of WHY it's absent),
// driving the real file-input change event through the real
// readOriginalImage()/profilePhotosInput.onchange code path must not
// throw, and must genuinely add the photo with a valid id.
// isCloudWorkspace() is truthy whenever `cloudProjectSync.projectId` is
// set (js/cloud-project-sync.js) -- stubbed directly here to reach the
// affected branch without needing a real Supabase session, since
// readOriginalImage's cloud branch itself is pure client-side (object URL
// + id generation only; the actual upload RPC happens later, at Save,
// which this test does not reach).
const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");

const project={version:11,characters:[{id:"character-a",name:"Анна"}],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  // --- crypto.randomUUID unavailable: must not throw, must still add the photo. ---
  {
    const page=await browser.newPage({viewport:{width:390,height:760}});
    page.setDefaultTimeout(7000);
    const dialogs=[];
    page.on("dialog",async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
    const pageErrors=[];
    page.on("pageerror",error=>pageErrors.push(error.message));
    await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    // Simulate the real-device condition: crypto.randomUUID absent, exactly
    // the observable symptom regardless of the secure-context root cause.
    // `randomUUID` lives on Crypto.prototype (an inherited, non-own
    // property of `window.crypto`), so a plain `delete` silently no-ops --
    // shadow it with an own `undefined` property instead.
    await page.addInitScript(()=>{Object.defineProperty(window.crypto,"randomUUID",{value:undefined,configurable:true})});
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

    if(await page.evaluate(()=>typeof crypto.randomUUID)!=="undefined")throw new Error("Test setup failed: crypto.randomUUID must actually be absent");

    await page.click("#projectMenu > summary");
    await page.click("#manageChars");
    await page.locator('#profilesGrid button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});

    // Reach the affected branch: isCloudWorkspace() must be true.
    await page.evaluate(()=>{globalThis.cloudProjectSync={projectId:"fake-cloud-project-for-test"}});
    if(!await page.evaluate(()=>isCloudWorkspace()))throw new Error("Test setup failed: isCloudWorkspace() must be true to exercise the affected branch");

    const beforeCount=await page.evaluate(()=>profileDraftPhotos.length);
    await page.setInputFiles("#profilePhotosInput",{name:"1000027130.png",mimeType:"image/png",buffer:tinyPng});
    await page.waitForFunction(count=>profileDraftPhotos.length>count,beforeCount);

    if(dialogs.length)throw new Error(`Selecting an image must not surface an error dialog when crypto.randomUUID is unavailable: ${JSON.stringify(dialogs)}`);
    if(pageErrors.length)throw new Error(`Unexpected page errors: ${pageErrors.join("; ")}`);
    const added=await page.evaluate(()=>profileDraftPhotos[profileDraftPhotos.length-1]);
    if(!added?.id)throw new Error("Added photo must have a generated id");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(added.id))throw new Error(`Fallback photo id must be a properly-shaped v4 UUID, not a trivial timestamp/Math.random id: ${added.id}`);

    await page.close();
  }

  // --- Native crypto.randomUUID available (normal case): unaffected. ---
  {
    const page=await browser.newPage({viewport:{width:390,height:760}});
    page.setDefaultTimeout(7000);
    const dialogs=[];
    page.on("dialog",async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
    await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

    if(await page.evaluate(()=>typeof crypto.randomUUID)!=="function")throw new Error("Test setup failed: crypto.randomUUID must actually be present for this case");

    await page.click("#projectMenu > summary");
    await page.click("#manageChars");
    await page.locator('#profilesGrid button[aria-label^="Редактировать анкету"]').click();
    await page.waitForSelector("#profileEditorModal",{state:"visible"});
    await page.evaluate(()=>{globalThis.cloudProjectSync={projectId:"fake-cloud-project-for-test"}});

    const beforeCount=await page.evaluate(()=>profileDraftPhotos.length);
    await page.setInputFiles("#profilePhotosInput",{name:"native.png",mimeType:"image/png",buffer:tinyPng});
    await page.waitForFunction(count=>profileDraftPhotos.length>count,beforeCount);
    if(dialogs.length)throw new Error(`Selecting an image must not surface an error dialog with native crypto.randomUUID present: ${JSON.stringify(dialogs)}`);
    const added=await page.evaluate(()=>profileDraftPhotos[profileDraftPhotos.length-1]);
    if(!added?.id)throw new Error("Added photo must have a generated id");

    await page.close();
  }

  console.log("character image UUID-fallback browser tests passed");
}finally{await browser.close();server.kill()}
