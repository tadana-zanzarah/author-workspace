import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
// Creation order: Зейн, Рене де Лакруа-Бреннер, Арман Бреннер, Реми Бреннер (the real-world regression report).
const project={version:11,characters:[
  {id:"char-zayn",name:"Зейн"},{id:"char-rene",name:"Рене де Лакруа-Бреннер"},
  {id:"char-arman",name:"Арман Бреннер"},{id:"char-remi",name:"Реми Бреннер"}
],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{},scenes:[]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("character-order-seeded"))return;sessionStorage.setItem("character-order-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // A. Newly created/attached characters render in addition (creation) order, not name/alphabetical order.
  await page.click("#sidebarManageChars");
  await page.waitForSelector(".profile-card");
  let order=await page.evaluate(()=>[...document.querySelectorAll(".profile-card")].map(x=>x.dataset.characterId));
  if(order.join(",")!=="char-zayn,char-rene,char-arman,char-remi")throw new Error(`Initial order was not creation order: ${order.join(",")}`);

  const handles=await page.evaluate(()=>[...document.querySelectorAll(".profile-drag-handle")].map(x=>({label:x.getAttribute("aria-label"),draggable:x.draggable})));
  if(handles.length!==4||handles.some(x=>!x.draggable||!x.label?.includes("Перетащить персонажа")))throw new Error("Character drag handles missing or inaccessible");

  // Keyboard-accessible fallback (arrow buttons) must still exist and remain usable independent of drag.
  const arrows=await page.evaluate(()=>[...document.querySelectorAll('[aria-label^="Переместить персонажа"]')].length);
  if(arrows!==8)throw new Error(`Expected 8 keyboard reorder buttons (2 per character), found ${arrows}`);

  // B. Manual drag reorder changes project order: drop "Арман" before "Зейн".
  const dragReorder=async(characterId,targetCharacterId)=>page.evaluate(({characterId,targetCharacterId})=>{
    const handle=document.querySelector(`[data-character-id="${characterId}"] .profile-drag-handle`);
    const target=document.querySelector(`[data-character-id="${targetCharacterId}"]`);
    const transfer=new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:target.getBoundingClientRect().top}));
    target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:target.getBoundingClientRect().top}));
    handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
  },{characterId,targetCharacterId});
  await dragReorder("char-arman","char-zayn");
  await page.waitForTimeout(50);
  order=await page.evaluate(()=>data.characters.map(x=>x.id));
  if(order.join(",")!=="char-arman,char-zayn,char-rene,char-remi")throw new Error(`Drag reorder failed: ${order.join(",")}`);

  // C. Reload preserves manual order (persisted in the local project array).
  await page.reload({waitUntil:"networkidle"});
  order=await page.evaluate(()=>data.characters.map(x=>x.id));
  if(order.join(",")!=="char-arman,char-zayn,char-rene,char-remi")throw new Error(`Reload lost manual character order: ${order.join(",")}`);

  // H. Duplicate display names never affect stable-ID ordering.
  await page.evaluate(()=>{
    commitDataChange(next=>{next.characters.push({id:"char-zayn-2",name:"Зейн"})});
    renderProfiles();
  });
  order=await page.evaluate(()=>data.characters.map(x=>x.id));
  if(order.join(",")!=="char-arman,char-zayn,char-rene,char-remi,char-zayn-2")throw new Error(`Duplicate name changed ordering: ${order.join(",")}`);
  await dragReorder("char-zayn-2","char-arman");
  await page.waitForTimeout(50);
  order=await page.evaluate(()=>data.characters.map(x=>x.id));
  if(order.join(",")!=="char-zayn-2,char-arman,char-zayn,char-rene,char-remi")throw new Error(`Reorder with duplicate names picked the wrong "Зейн": ${order.join(",")}`);

  // Sidebar and scene participant selector must reuse the same canonical project order.
  const sideOrder=await page.evaluate(()=>[...document.querySelectorAll("#sideCharacters .sidebar-item")].map(x=>x.textContent.trim().replace(/\d+$/,"").trim()));
  const nameOrder=await page.evaluate(()=>data.characters.map(c=>c.name));
  if(JSON.stringify(sideOrder)!==JSON.stringify(nameOrder))throw new Error(`Sidebar order diverged from canonical character order: ${JSON.stringify({sideOrder,nameOrder})}`);

  console.log("Character order browser tests passed");
}finally{await browser.close();server.kill()}
