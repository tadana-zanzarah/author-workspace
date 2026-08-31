import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const project={version:11,characters:[{id:"char-a",name:"Анна"},{id:"char-b",name:"Борис"}],profiles:{"char-a":{id:"char-a",characterId:"char-a",name:"Анна",photos:[],hidden:{},initialRelations:{"char-b":"друзья"}},"char-b":{id:"char-b",characterId:"char-b",name:"Борис",photos:[],hidden:{},initialRelations:{}}},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false},{id:"chapter-two",title:"Глава 2",collapsed:false},{id:"chapter-empty",title:"Глава 3",collapsed:false}],locations:[],tags:[],future:{},scenes:[
  {id:"scene-a",title:"A",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{"char-a":{action:"",relationChanges:{"char-b":"враги"},visibleRelations:["char-b"]}}},
  {id:"scene-b",title:"B",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
  {id:"scene-c",title:"C",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
  {id:"scene-d",title:"D",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{"char-a":{action:"",relationChanges:{"char-b":"снова друзья"},visibleRelations:["char-b"]}}}
]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("compact-dnd-seeded"))return;sessionStorage.setItem("compact-dnd-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.click('[data-view="list"]');
  await page.waitForSelector(".compact-chapter-group");
  const structure=await page.evaluate(()=>({handles:[...document.querySelectorAll(".compact-drag-handle")].map(x=>({disabled:x.disabled,label:x.getAttribute("aria-label"),draggable:x.draggable})),chapters:[...document.querySelectorAll(".compact-chapter-group")].map(x=>x.dataset.chapterId)}));
  if(structure.handles.length!==4||structure.handles.some(x=>x.disabled||!x.draggable||!x.label?.includes("Перетащить сцену")))throw new Error("Compact handles missing or inaccessible");
  if(!structure.chapters.includes("chapter-empty")||!structure.chapters.includes("chapter-unassigned"))throw new Error("Empty/unassigned chapter drop zones missing");

  const move=async(sceneId,chapterId,beforeSceneId=null)=>page.evaluate(({sceneId,chapterId,beforeSceneId})=>{
    const handle=document.querySelector(`[data-scene-id="${sceneId}"] .compact-drag-handle`),zone=document.querySelector(`[data-compact-drop-chapter-id="${chapterId}"][data-before-scene-id="${beforeSceneId||""}"]`),transfer=new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    zone.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:zone.getBoundingClientRect().top}));
    const indicator=zone.classList.contains("active");
    zone.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:zone.getBoundingClientRect().top}));
    handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
    if(!indicator)throw new Error("Drop indicator was not shown");
  },{sceneId,chapterId,beforeSceneId});
  await move("scene-b","chapter-two","scene-d");
  let state=await page.evaluate(()=>({order:data.scenes.map(x=>x.id),chapter:data.scenes.find(x=>x.id==="scene-b").chapterId,review:data.scenes.find(x=>x.id==="scene-b").dateReview,relation:relationshipsAt(data.scenes.findIndex(x=>x.id==="scene-c"))["char-a"]["char-b"],explicit:data.scenes.find(x=>x.id==="scene-a").people["char-a"].relationChanges["char-b"]}));
  if(state.order.join(",")!=="scene-a,scene-c,scene-b,scene-d"||state.chapter!=="chapter-two"||!state.review)throw new Error(`Cross-chapter move failed: ${JSON.stringify(state)}`);
  if(state.explicit!=="враги"||state.relation!=="враги")throw new Error(`Relationship regression: ${JSON.stringify(state)}`);

  await move("scene-d","chapter-two","scene-c");
  const recalculated=await page.evaluate(()=>({inherited:relationshipsAt(data.scenes.findIndex(x=>x.id==="scene-c"))["char-a"]["char-b"],explicit:data.scenes.find(x=>x.id==="scene-d").people["char-a"].relationChanges["char-b"]}));
  if(recalculated.inherited!=="снова друзья"||recalculated.explicit!=="снова друзья")throw new Error(`Inherited relations were not recalculated: ${JSON.stringify(recalculated)}`);
  await move("scene-a","chapter-empty",null);
  await move("scene-a","chapter-unassigned",null);
  await page.evaluate(()=>selectScene("scene-b"));
  await move("scene-b","chapter-one",null);
  state=await page.evaluate(()=>({order:data.scenes.map(x=>x.id),selected:selectedSceneId,selectedClass:document.querySelector('[data-scene-id="scene-b"]')?.classList.contains("selected-scene"),chapter:data.scenes.find(x=>x.id==="scene-a").chapterId}));
  if(state.selected!=="scene-b"||!state.selectedClass||state.chapter!=="chapter-unassigned")throw new Error(`Selection/unassigned move failed: ${JSON.stringify(state)}`);

  const beforeSame=await page.evaluate(()=>({raw:localStorage.getItem("novelTimelineV11"),review:data.scenes.find(x=>x.id==="scene-b").dateReview}));
  await move("scene-b","chapter-one",null);
  const afterSame=await page.evaluate(()=>({raw:localStorage.getItem("novelTimelineV11"),review:data.scenes.find(x=>x.id==="scene-b").dateReview}));
  if(afterSame.raw!==beforeSame.raw||afterSame.review!==beforeSame.review)throw new Error("Same-position drop saved or changed dateReview");

  await page.click("#filterChapter");
  await page.waitForSelector("#filterChapterPopover:not([hidden])");
  await page.click('#filterChapterList [role="option"][data-value="chapter-one"]');
  await page.waitForTimeout(100);
  if(!await page.isDisabled(".compact-drag-handle")||!await page.locator(".compact-dnd-notice").isVisible())throw new Error("Chapter filter did not disable DnD");
  await page.click("#clearFilters");await page.fill("#projectSearch","A");await page.dispatchEvent("#projectSearch","input");
  await page.waitForTimeout(150);
  if(!await page.isDisabled(".compact-drag-handle"))throw new Error("Search did not disable DnD");
  await page.fill("#projectSearch","");await page.dispatchEvent("#projectSearch","input");

  const rollback=await page.evaluate(()=>{const before=JSON.stringify(data);const original=localStorage.setItem;localStorage.setItem=()=>{throw new DOMException("full","QuotaExceededError")};const result=compactMoveScene("scene-c",{chapterId:"chapter-one",beforeSceneId:"scene-b"});localStorage.setItem=original;return {ok:result.ok,same:before===JSON.stringify(data),chapter:data.scenes.find(x=>x.id==="scene-c").chapterId}});
  if(rollback.ok||!rollback.same||rollback.chapter!=="chapter-two")throw new Error(`Save failure did not roll back: ${JSON.stringify(rollback)}`);

  // Vertical scrolling for the scene list is now the page/document scroll (the
  // workspace viewport itself only scrolls horizontally — see css/timeline.css), so
  // autoscroll-during-drag now targets document.scrollingElement based on proximity
  // to the window edges instead of the (no-longer-vertically-scrollable) viewport box.
  const scroll=await page.evaluate(()=>{commitDataChange(next=>{for(let i=0;i<45;i++)next.scenes.push({id:`long-${i}`,title:`Long ${i}`,date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}})});currentView="list";render();const scroller=document.scrollingElement,handle=document.querySelector(".compact-drag-handle");compactDragStart({currentTarget:handle,preventDefault(){},dataTransfer:{effectAllowed:"",setData(){}}},handle.closest("[data-scene-id]").dataset.sceneId);scroller.scrollTop=0;for(let i=0;i<20;i++)autoscrollSceneViewport(window.innerHeight-2);const down=scroller.scrollTop;scroller.scrollTop=scroller.scrollHeight;for(let i=0;i<20;i++)autoscrollSceneViewport(2);return {down,up:scroller.scrollTop<scroller.scrollHeight-window.innerHeight}});
  if(scroll.down<=0||!scroll.up)throw new Error(`Compact autoscroll failed: ${JSON.stringify(scroll)}`);
  await page.reload({waitUntil:"networkidle"});await page.click('[data-view="list"]');
  const persisted=await page.evaluate(()=>({order:data.scenes.slice(0,4).map(x=>x.id),chapters:Object.fromEntries(data.scenes.slice(0,4).map(x=>[x.id,x.chapterId]))}));
  if(persisted.order.join(",")!=="scene-a,scene-b,scene-d,scene-c"||persisted.chapters["scene-a"]!=="chapter-unassigned")throw new Error(`Reload lost compact order: ${JSON.stringify(persisted)}`);
  console.log("Compact list DnD browser tests passed");
}finally{await browser.close();server.kill()}
