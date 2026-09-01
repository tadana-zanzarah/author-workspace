import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");

const port=3024,server=spawn(process.execPath,["tools/server.mjs"],{env:{...process.env,PORT:String(port)},stdio:"ignore"});
const dataUrl="data:image/svg+xml;base64,"+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="480"><rect width="240" height="480" fill="tomato"/></svg>').toString("base64");
const project={version:11,characters:[{id:"character-a",name:"Анна"}],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",photos:[dataUrl],hidden:{},initialRelations:{}}},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]};

try{
  await new Promise(resolve=>setTimeout(resolve,500));
  const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}),page=await browser.newPage({viewport:{width:390,height:760}});page.setDefaultTimeout(7000);
  await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.click("#projectMenu > summary");await page.click("#manageChars");await page.locator('#profilesGrid button[aria-label^="Редактировать анкету"]').click();
  await page.waitForSelector('[data-photo-id]');
  await page.click('[data-action="crop-photo"]');await page.waitForSelector("#photoCropModal",{state:"visible"});
  const before=await page.evaluate(()=>JSON.stringify(profileDraftPhotos[0].crop));
  await page.fill("#photoCropZoom","1.8");await page.dispatchEvent("#photoCropZoom","input");
  await page.click("#cancelPhotoCrop");
  if(await page.evaluate(()=>JSON.stringify(profileDraftPhotos[0].crop))!==before)throw new Error("Cancel changed crop draft");
  await page.click('[data-action="view-photo"]');await page.waitForSelector("#photoLightboxModal",{state:"visible"});
  if(await page.locator("#photoLightboxImage").getAttribute("src")!==dataUrl)throw new Error("Lightbox did not use original source");
  await page.keyboard.press("Escape");if(!await page.locator("#profileEditorModal").isVisible())throw new Error("Escape closed parent modal");
  console.log("character image browser tests passed");await browser.close();
} finally {server.kill()}
