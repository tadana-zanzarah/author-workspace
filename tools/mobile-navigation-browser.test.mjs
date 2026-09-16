import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false},{id:"chapter-two",title:"Глава 2",collapsed:false}],locations:[],tags:[],future:{},scenes:[
  {id:"scene-a",title:"Сцена А",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:"Текст А",included:true,status:"floating",people:{}},
  {id:"scene-b",title:"Сцена Б",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"draft",sceneText:"Текст Б",included:true,status:"floating",people:{}}
]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(5000);
  await page.addInitScript(value=>{if(sessionStorage.getItem("mobile-nav-seeded"))return;sessionStorage.setItem("mobile-nav-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // Checks the inline style the app itself sets (openModal/forceCloseModal write
  // style.display directly), not Playwright's own isVisible()/computed-style —
  // a closing modal-backdrop's allow-discrete close-fade transition (see
  // css/modals.css) keeps it painted for ~160ms after style.display is already
  // "none", so isVisible() reports true well after the app has genuinely closed
  // it. Same idiom already used throughout this suite, e.g. tools/dirty-
  // browser.test.mjs's own "visible" helper.
  const displayIs=(id,value)=>page.$eval(`#${id}`,(node,v)=>node.style.display===v,value);

  // Stage E1: below the mobile-shell breakpoint the desktop sidebar is
  // replaced by the FAB-triggered Navigation drawer (openMobileNav, see
  // js/chapters.js) — this is the primary chapter/scene entry point on
  // phone, so its two required behaviors ("tap a scene reaches its text in
  // one step", "tap a chapter scrolls the board to it") are the contracts
  // worth protecting here, not exact styling.
  if(await page.evaluate(()=>getComputedStyle(document.querySelector(".project-sidebar")).display)!=="none")throw new Error("Desktop sidebar should be hidden below the mobile-shell breakpoint");
  if(!await page.isVisible("#mobileNavTrigger"))throw new Error("Mobile Navigation trigger should be visible below the mobile-shell breakpoint");

  await page.click("#mobileNavTrigger");
  await page.waitForFunction(()=>document.getElementById("mobileNavModal").style.display==="flex");
  const chapterTitles=await page.evaluate(()=>[...document.querySelectorAll(".mobile-nav-chapter-title")].map(el=>el.textContent.trim()));
  if(!chapterTitles.some(t=>t.startsWith("Без главы"))||!chapterTitles.some(t=>t.startsWith("Глава 1"))||!chapterTitles.some(t=>t.startsWith("Глава 2")))throw new Error(`Navigation drawer missing expected chapters: ${JSON.stringify(chapterTitles)}`);
  const sceneLabels=await page.evaluate(()=>[...document.querySelectorAll(".mobile-nav-scene")].map(el=>el.textContent.trim()));
  if(!sceneLabels.includes("Сцена А")||!sceneLabels.includes("Сцена Б"))throw new Error(`Navigation drawer missing expected scenes: ${JSON.stringify(sceneLabels)}`);

  // Tap a scene: drawer closes, Text Scene opens directly for it — no
  // intermediate "find it again in the scene list" step.
  await page.click('.mobile-nav-scene:has-text("Сцена Б")');
  await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
  if(!await displayIs("mobileNavModal","none"))throw new Error("Navigation drawer should close when a scene is opened");
  if(await page.evaluate(()=>textEditingSceneId)!=="scene-b")throw new Error("Text Scene opened for the wrong scene");
  if(await page.textContent("#textModalTitle")!=="Сцена Б")throw new Error("Text Scene title does not match the tapped scene");
  await page.evaluate(()=>document.getElementById("closeText").click());
  await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");

  // Tap a chapter: drawer closes, board scrolls to (and highlights) that
  // chapter's existing [data-chapter-id] divider — the same mechanism the
  // desktop sidebar already used (navigateToChapter, js/chapters.js).
  await page.click("#mobileNavTrigger");
  await page.waitForFunction(()=>document.getElementById("mobileNavModal").style.display==="flex");
  await page.click('.mobile-nav-chapter-title:has-text("Глава 2")');
  await page.waitForFunction(()=>document.getElementById("mobileNavModal").style.display==="none");
  await page.waitForSelector('[data-chapter-id="chapter-two"].chapter-nav-highlight',{timeout:2000});

  // Read-only navigation: none of this should have touched project data.
  const counts=await page.evaluate(()=>({chapters:data.chapters.length,scenes:data.scenes.length}));
  if(counts.chapters!==3||counts.scenes!==2)throw new Error(`Navigation drawer use mutated project data: ${JSON.stringify(counts)}`);

  console.log("Mobile Navigation drawer browser tests passed");
}finally{await browser.close();server.kill()}
