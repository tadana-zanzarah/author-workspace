import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const characters=Array.from({length:12},(_,i)=>({id:`char-${i}`,name:`Персонаж ${i}`}));
const project={version:11,characters,profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[{id:"loc-1",name:"Дом"}],tags:[],future:{},scenes:[
  {id:"scene-1",title:"Первая",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",
   people:Object.fromEntries(characters.slice(0,10).map(c=>[c.id,{action:`действие ${c.id}`,relationChanges:{},visibleRelations:[],legacyState:""}]))},
  {id:"scene-2",title:"Вторая",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}}
]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("scene-scroll-seeded"))return;sessionStorage.setItem("scene-scroll-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  const scrollTop=()=>page.evaluate(()=>document.querySelector("#sceneModal .modal").scrollTop);

  // Open a scene with many participant blocks, scroll down, close it.
  await page.evaluate(()=>editScene("scene-1"));
  await page.waitForSelector("#sceneModal .modal");
  await page.evaluate(()=>{document.querySelector("#sceneModal .modal").scrollTop=400});
  if((await scrollTop())===0)throw new Error("Test setup failed: modal did not actually scroll");
  await page.click("#cancelScene");

  // Edit Scene: opening a different (short) scene must start at the top, not wherever the last close left it.
  await page.evaluate(()=>editScene("scene-2"));
  await page.waitForSelector("#sceneModal .modal");
  if((await scrollTop())!==0)throw new Error(`Edit Scene did not open at scrollTop 0: ${await scrollTop()}`);
  await page.click("#cancelScene");

  // New Scene must also always open at the top.
  await page.evaluate(()=>{document.querySelector("#sceneModal .modal").scrollTop=250});
  await page.evaluate(()=>openNewSceneAt(null,"chapter-unassigned"));
  await page.waitForSelector("#sceneModal .modal");
  if((await scrollTop())!==0)throw new Error(`New Scene did not open at scrollTop 0: ${await scrollTop()}`);

  // Nested modal (quick-add location) opening/closing on top of the Scene modal must not disturb its scroll.
  await page.evaluate(()=>{document.querySelector("#sceneModal .modal").scrollTop=180});
  await page.click("#quickAddLocation");
  await page.waitForSelector("#quickLocationModal .modal");
  await page.fill("#quickLocationName","Новая локация");
  await page.click("#quickLocationCancel");
  await page.waitForTimeout(30);
  if((await scrollTop())!==180)throw new Error(`Nested modal close altered the Scene modal's own scroll position: ${await scrollTop()}`);
  await page.click("#cancelScene");

  console.log("Scene modal scroll browser tests passed");
}finally{await browser.close();server.kill()}
