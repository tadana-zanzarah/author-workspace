import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const project={version:11,characters:[{id:"char-a",name:"Анна"}],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false}],locations:[{id:"loc-a",name:"Дом"}],tags:[],future:{},scenes:[
  {id:"scene-a",title:"Первая сцена",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"loc-a",tags:[],writingStatus:"draft",sceneText:"Текст А",included:true,status:"floating",people:{"char-a":{action:"",relationChanges:{},visibleRelations:[]}}},
  {id:"scene-b",title:"Вторая сцена",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"Текст Б",included:true,status:"floating",people:{}}
]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  // Checks the inline style the app itself sets, not Playwright's isVisible() —
  // see tools/mobile-navigation-browser.test.mjs's identical helper/comment for
  // why (allow-discrete close-fade transition, css/modals.css).
  const displayIs=(page,id,value)=>page.$eval(`#${id}`,(node,v)=>node.style.display===v,value);

  // --- Phone width: single-column Cards + single-tap-to-text -------------
  {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    page.setDefaultTimeout(5000);
    await page.addInitScript(value=>{if(sessionStorage.getItem("mobile-cards-seeded"))return;sessionStorage.setItem("mobile-cards-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
    await page.evaluate(()=>{currentView="cards";render()});

    // Stage E2.1: below the mobile-shell breakpoint (css/layout.css) Cards
    // must be a true single column, not a desktop auto-fill grid with a
    // partially visible second card — the exact defect the real-phone E1.1
    // review reported.
    const trackCount=await page.evaluate(()=>getComputedStyle(document.querySelector(".scene-cards-grid")).gridTemplateColumns.trim().split(/\s+/).length);
    if(trackCount!==1)throw new Error(`Cards should render one grid track on phone, found ${trackCount}`);
    const vw=await page.evaluate(()=>document.documentElement.clientWidth);
    const scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    if(scrollWidth>vw+1)throw new Error(`Cards introduced page-level horizontal overflow: ${scrollWidth} > ${vw}`);

    // Chapter grouping/order and scene order are untouched — same DOM order
    // the seed data was given.
    const order=await page.evaluate(()=>[...document.querySelectorAll(".compact-scene-card")].map(el=>el.dataset.sceneId));
    if(order.join(",")!=="scene-a,scene-b")throw new Error(`Card order changed: ${JSON.stringify(order)}`);

    // A tap on the card's primary surface (its title) opens Text Scene
    // directly — the existing openSceneText path, no intermediate step.
    await page.click('[data-scene-id="scene-a"] .compact-card-title');
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    if(await page.evaluate(()=>textEditingSceneId)!=="scene-a")throw new Error("Card tap opened Text Scene for the wrong scene");
    await page.evaluate(()=>document.getElementById("closeText").click());
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");

    // Nested controls keep their own behavior and must NOT also open Text
    // Scene via event bubbling: location chip (sets the location filter),
    // character chip (sets the character filter), and the reorder button.
    await page.click('[data-scene-id="scene-a"] .meta-chip.entity-link');
    await page.waitForFunction(()=>filters.location==="loc-a");
    if(!await displayIs(page,"textModal","none"))throw new Error("Tapping the location chip should not open Text Scene");
    await page.evaluate(()=>{setFilter("location","");render()});

    const charChip=page.locator('[data-scene-id="scene-a"] .meta-chip.entity-link',{hasText:"Анна"});
    await charChip.click();
    await page.waitForFunction(()=>filterValues("character").includes("char-a"));
    if(!await displayIs(page,"textModal","none"))throw new Error("Tapping the character chip should not open Text Scene");
    await page.evaluate(()=>{clearFilterKey("character");render()});

    await page.click('[data-scene-id="scene-b"] .scene-reorder-btn:not([disabled])');
    await page.waitForTimeout(150);
    if(!await displayIs(page,"textModal","none"))throw new Error("Tapping a reorder control should not open Text Scene");

    await page.close();
  }

  // --- Desktop width: existing click=select / dblclick=edit unchanged ----
  {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    page.setDefaultTimeout(5000);
    await page.addInitScript(value=>{if(sessionStorage.getItem("mobile-cards-desktop-seeded"))return;sessionStorage.setItem("mobile-cards-desktop-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
    await page.evaluate(()=>{currentView="cards";render()});

    const trackCount=await page.evaluate(()=>getComputedStyle(document.querySelector(".scene-cards-grid")).gridTemplateColumns.trim().split(/\s+/).length);
    if(trackCount<2)throw new Error(`Desktop Cards should keep its multi-column auto-fill grid, found ${trackCount} track(s)`);

    await page.click('[data-scene-id="scene-a"] .compact-card-title');
    await page.waitForFunction(()=>document.querySelector('[data-scene-id="scene-a"]').classList.contains("selected-scene"));
    if(await page.$eval("#textModal",node=>node.style.display)==="flex")throw new Error("A single click on desktop Cards should select, not open Text Scene");

    // Not the title itself: .compact-card-title has its own ondblclick
    // (quick-rename, pre-existing/unchanged by E2.1) that stops propagation,
    // so double-clicking it intentionally does not reach the card's own
    // ondblclick=editScene. The date chip (always first in .scene-meta) is a
    // plain <span> with no handler of its own and bubbles normally, same as
    // any other plain area of the card.
    await page.dblclick('[data-scene-id="scene-a"] .scene-meta > .meta-chip:first-child');
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    await page.click("#cancelScene");

    await page.close();
  }

  console.log("Mobile Cards browser tests passed");
}finally{await browser.close();server.kill()}
