import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Real-DOM/interaction regression for the V2 Scene x Character matrix redesign
// (design/scene-character-matrix). Complements the pure-function relationships/filters
// unit tests: this checks the actual rendered matrix cells, the actions/relationships
// content-layer toggle, avatars, sticky behaviour and that DnD/search/chapter grouping
// still work in the redesigned table view.

const TINY_PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
const characters=[
  {id:"char-rene",name:"Рене"},
  {id:"char-zayn",name:"Зейн"},
  {id:"char-arman",name:"Арман"},
  {id:"char-d",name:"Персонаж D"},
  {id:"char-e",name:"Персонаж E"},
  {id:"char-f",name:"Персонаж F"},
  {id:"char-g",name:"Персонаж G"},
  {id:"char-h",name:"Персонаж H"}
];
const profiles={
  "char-rene":{photos:[{id:"photo-1",source:{kind:"data-url",value:TINY_PNG},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""}],primaryPhotoId:"photo-1",initialRelations:{}}
};
const project={version:11,characters,profiles,
  chapters:[
    {id:"chapter-unassigned",title:"Без главы",collapsed:false},
    {id:"chapter-one",title:"Глава первая",collapsed:false},
    {id:"chapter-two",title:"Глава вторая",collapsed:false}
  ],
  locations:[],tags:[],future:{},
  scenes:[
    {id:"scene-airport",title:"Аэропорт",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{
      "char-rene":{action:"Едет в аэропорт, ведёт машину, переживает из-за опоздания Зейна.",legacyState:"",relationChanges:{"char-zayn":"переживает"},visibleRelations:["char-zayn"]},
      "char-zayn":emptyPerson()
      // char-arman intentionally NOT a participant here.
    }},
    {id:"scene-quarrel",title:"Ссора",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{
      "char-rene":{action:"Спорит с Арманом из-за шутки.",legacyState:"",relationChanges:{"char-arman":"раздражён из-за шутки","char-zayn":"чувствует вину"},visibleRelations:["char-arman","char-zayn"]}
    }},
    {id:"scene-dawn",title:"Рассвет",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{
      "char-arman":{action:"Смотрит в окно.",legacyState:"",relationChanges:{},visibleRelations:[]}
    }}
  ]};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(value=>{if(sessionStorage.getItem("scene-character-matrix-seeded"))return;sessionStorage.setItem("scene-character-matrix-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.waitForSelector(".matrix-head-cell");

  const cellFor=(sceneId,charId)=>page.evaluate(({sceneId,charId})=>{
    const row=document.querySelector(`.scene-row[data-scene-id="${sceneId}"]`);
    const chars=[...document.querySelectorAll(".board-head .matrix-head-cell")].map(el=>el.querySelector(".matrix-head-link").getAttribute("onclick").match(/setFilter\('character','([^']+)'\)/)[1]);
    const idx=chars.indexOf(charId);
    const cells=[...row.querySelectorAll(".cell")].filter(c=>!c.classList.contains("time-cell"));
    return cells[idx]?.outerHTML||null;
  },{sceneId,charId});

  // 1) Default display mode: Actions ON, Relationships OFF.
  const defaultToggles=await page.evaluate(()=>({
    actions:document.getElementById("matrixShowActions").checked,
    relations:document.getElementById("matrixShowRelations").checked,
    toolbarVisible:!document.getElementById("matrixToolbar").hidden
  }));
  if(!defaultToggles.actions||defaultToggles.relations||!defaultToggles.toolbarVisible)throw new Error(`Default matrix content mode wrong: ${JSON.stringify(defaultToggles)}`);

  // 2) Matrix toolbar only shows in table view (it's a matrix-scoped control, not a global setting).
  await page.click('[data-view="cards"]');
  let toolbarHiddenInCards=await page.evaluate(()=>document.getElementById("matrixToolbar").hidden);
  if(!toolbarHiddenInCards)throw new Error("Matrix content toggle leaked into a non-table view");
  await page.click('[data-view="table"]');

  // 3) Participant WITH action text: action renders as primary content, no relations (layer off).
  let cellHtml=await cellFor("scene-airport","char-rene");
  if(!cellHtml.includes("matrix-cell-content")||!cellHtml.includes("Едет в аэропорт"))throw new Error(`Participant action content missing: ${cellHtml}`);
  if(cellHtml.includes("matrix-relations"))throw new Error("Relations rendered while Relationships layer is OFF");

  // 4) Participant WITHOUT content: distinguishable from both "has content" and "non-participant".
  cellHtml=await cellFor("scene-airport","char-zayn");
  if(!cellHtml.includes("matrix-cell-noncontent")||!cellHtml.includes("Без описания"))throw new Error(`Participant-without-content cell regressed: ${cellHtml}`);
  if(!cellHtml.includes("участвует в сцене")||!cellHtml.includes("без описания"))throw new Error(`Participant-without-content aria-label missing/wrong: ${cellHtml}`);

  // 5) Non-participant: visually quiet (no visible text) but accessibly labeled, and distinct class.
  cellHtml=await cellFor("scene-airport","char-arman");
  if(!cellHtml.includes("matrix-cell-empty"))throw new Error(`Non-participant cell missing quiet-empty class: ${cellHtml}`);
  if(cellHtml.includes("matrix-cell-noncontent")||cellHtml.includes("matrix-cell-content"))throw new Error("Non-participant cell must not share classes with participant states");
  if(!cellHtml.includes("не участвует в сцене"))throw new Error(`Non-participant aria-label missing: ${cellHtml}`);
  const nonParticipantVisibleText=await page.evaluate(({sceneId})=>{
    const row=document.querySelector(`.scene-row[data-scene-id="${sceneId}"]`);
    const cells=[...row.querySelectorAll(".cell")].filter(c=>!c.classList.contains("time-cell"));
    return cells[2].textContent.trim();
  },{sceneId:"scene-airport"});
  if(nonParticipantVisibleText!=="")throw new Error(`Non-participant cell should carry no visible text, got: "${nonParticipantVisibleText}"`);

  // 6) Turn Relationships ON (Actions stays ON) -> combined mode, multiple relation targets preserved with direction.
  await page.click("#matrixShowRelations");
  await page.waitForTimeout(50);
  cellHtml=await cellFor("scene-quarrel","char-rene");
  if(!cellHtml.includes("matrix-action-text")||!cellHtml.includes("Спорит с Арманом"))throw new Error("Combined mode lost action content");
  if(!cellHtml.includes("Арман")||!cellHtml.includes("раздражён из-за шутки"))throw new Error(`Relation to Арман missing: ${cellHtml}`);
  if(!cellHtml.includes("Зейн")||!cellHtml.includes("чувствует вину"))throw new Error(`Relation to Зейн missing: ${cellHtml}`);
  const relationEntryCount=await page.evaluate(({sceneId})=>{
    const row=document.querySelector(`.scene-row[data-scene-id="${sceneId}"]`);
    const cells=[...row.querySelectorAll(".cell")].filter(c=>!c.classList.contains("time-cell"));
    return cells[0].querySelectorAll(".matrix-relation-entry").length;
  },{sceneId:"scene-quarrel"});
  if(relationEntryCount!==2)throw new Error(`Expected 2 distinct relation entries for one character in one scene, got ${relationEntryCount}`);

  // 7) Relationships-only mode: Actions OFF, Relationships ON.
  await page.click("#matrixShowActions");
  await page.waitForTimeout(50);
  cellHtml=await cellFor("scene-quarrel","char-rene");
  if(cellHtml.includes("matrix-action-text"))throw new Error("Actions layer still rendered after turning Actions off");
  if(!cellHtml.includes("matrix-relation-entry"))throw new Error("Relations-only mode lost relation entries");

  // 8) Cannot reach a meaningless both-OFF state: attempting to turn off the last active layer is a no-op.
  await page.click("#matrixShowRelations");
  await page.waitForTimeout(50);
  const afterBlockedToggle=await page.evaluate(()=>({
    actions:document.getElementById("matrixShowActions").checked,
    relations:document.getElementById("matrixShowRelations").checked,
    mode:{...matrixContentMode}
  }));
  if(afterBlockedToggle.actions||!afterBlockedToggle.relations)throw new Error(`Turning off the last active layer should be blocked: ${JSON.stringify(afterBlockedToggle)}`);
  if(!afterBlockedToggle.mode.relations||afterBlockedToggle.mode.actions)throw new Error(`Internal matrixContentMode should be unchanged by the blocked toggle: ${JSON.stringify(afterBlockedToggle.mode)}`);

  // Restore default (Actions ON, Relationships OFF) for the remaining checks.
  await page.click("#matrixShowActions");
  await page.click("#matrixShowRelations");
  await page.waitForTimeout(50);
  const restored=await page.evaluate(()=>({...matrixContentMode}));
  if(!restored.actions||restored.relations)throw new Error(`Failed to restore default display mode: ${JSON.stringify(restored)}`);

  // 9) Toggling display layers changes DISPLAY only, never the underlying scene data.
  const peopleBefore=await page.evaluate(()=>JSON.stringify(data.scenes.find(s=>s.id==="scene-quarrel").people));
  await page.click("#matrixShowRelations");
  await page.waitForTimeout(50);
  const peopleAfter=await page.evaluate(()=>JSON.stringify(data.scenes.find(s=>s.id==="scene-quarrel").people));
  if(peopleBefore!==peopleAfter)throw new Error("Toggling the matrix content layer mutated scene.people data");
  await page.click("#matrixShowRelations"); // back to default

  // 10) Character with an image uses the existing thumbnail pipeline; character without one gets a fallback.
  const avatars=await page.evaluate(()=>{
    const cells=[...document.querySelectorAll(".board-head .matrix-head-cell")];
    const find=name=>cells.find(c=>c.textContent.includes(name));
    const withPhoto=find("Рене"),withoutPhoto=find("Зейн");
    return {
      hasImg:!!withPhoto?.querySelector(".matrix-avatar img"),
      imgSrcIsDataUrl:(withPhoto?.querySelector(".matrix-avatar img")?.getAttribute("src")||"").startsWith("data:image"),
      fallbackText:withoutPhoto?.querySelector(".matrix-avatar-fallback")?.textContent.trim()
    };
  });
  if(!avatars.hasImg||!avatars.imgSrcIsDataUrl)throw new Error(`Character with a photo should render the existing thumbnail: ${JSON.stringify(avatars)}`);
  if(avatars.fallbackText!=="З")throw new Error(`Character without a photo should get an initials fallback, got: "${avatars.fallbackText}"`);

  // 11) Search/filter results are unaffected by the display-layer toggle (toggle changes display, not the filter contract).
  await page.fill("#projectSearch","Зейн");
  await page.waitForTimeout(250);
  const searchWithActionsOnly=await page.evaluate(()=>getVisibleSceneEntries().map(({scene})=>scene.id));
  await page.click("#matrixShowRelations");
  await page.waitForTimeout(250);
  const searchWithRelationsOn=await page.evaluate(()=>getVisibleSceneEntries().map(({scene})=>scene.id));
  if(JSON.stringify(searchWithActionsOnly)!==JSON.stringify(searchWithRelationsOn))throw new Error(`Search results changed when the display layer toggled: ${JSON.stringify(searchWithActionsOnly)} vs ${JSON.stringify(searchWithRelationsOn)}`);
  await page.click("#matrixShowRelations");
  await page.fill("#projectSearch","");
  await page.waitForTimeout(250);

  // 12) Chapter grouping preserved.
  const chapterTitles=await page.evaluate(()=>[...document.querySelectorAll(".chapter-divider strong")].map(el=>el.textContent));
  if(!chapterTitles.includes("Глава первая")||!chapterTitles.includes("Глава вторая"))throw new Error(`Chapter grouping regressed: ${chapterTitles.join(", ")}`);

  // 13) Scene ordering preserved (unaffected by any of the above).
  const sceneOrder=await page.evaluate(()=>data.scenes.map(s=>s.id));
  if(sceneOrder.join(",")!=="scene-airport,scene-quarrel,scene-dawn")throw new Error(`Scene ordering regressed: ${sceneOrder.join(",")}`);

  // 14) Horizontal scrolling is available for a wide (8-character) sparse matrix.
  const scrollable=await page.evaluate(()=>{
    const viewport=document.querySelector(".workspace-viewport");
    return {scrollWidth:viewport.scrollWidth,clientWidth:viewport.clientWidth};
  });
  if(scrollable.scrollWidth<=scrollable.clientWidth)throw new Error(`Matrix should be horizontally scrollable with 8 character columns: ${JSON.stringify(scrollable)}`);

  // 15) Sticky character-header row: after vertical scroll, the header stays pinned near the viewport top.
  await page.evaluate(()=>{document.querySelector(".workspace-viewport").scrollTop=200});
  await page.waitForTimeout(50);
  const headSticky=await page.evaluate(()=>{
    const viewport=document.querySelector(".workspace-viewport").getBoundingClientRect();
    const head=document.querySelector(".board-head").getBoundingClientRect();
    return Math.abs(head.top-viewport.top)<2;
  });
  if(!headSticky)throw new Error("Character header row did not stay pinned to the top on vertical scroll");

  // 16) Sticky scene column: after horizontal scroll, the scene column stays pinned to the viewport's left edge.
  await page.evaluate(()=>{document.querySelector(".workspace-viewport").scrollTop=0;document.querySelector(".workspace-viewport").scrollLeft=150});
  await page.waitForTimeout(50);
  const stickyColumn=await page.evaluate(()=>{
    const viewport=document.querySelector(".workspace-viewport").getBoundingClientRect();
    const sticky=document.querySelector(".scene-row .sticky-cell").getBoundingClientRect();
    return Math.abs(sticky.left-viewport.left)<2;
  });
  if(!stickyColumn)throw new Error("Scene column did not stay pinned to the left on horizontal scroll");
  await page.evaluate(()=>{document.querySelector(".workspace-viewport").scrollLeft=0});

  // 17) Keyboard interaction with the toggle: Space toggles a focused checkbox (native semantics, no fake div).
  await page.focus("#matrixShowRelations");
  await page.keyboard.press("Space");
  await page.waitForTimeout(50);
  const keyboardToggled=await page.evaluate(()=>matrixContentMode.relations);
  if(!keyboardToggled)throw new Error("Space on the focused checkbox did not toggle Relationships on");
  await page.keyboard.press("Space");
  await page.waitForTimeout(50);

  // 18) Existing edit path remains reachable from the redesigned matrix (row-level "Изменить").
  await page.click('.scene-row[data-scene-id="scene-quarrel"] button:has-text("Изменить")');
  await page.waitForSelector("#sceneModal .modal");
  const editingSceneTitle=await page.evaluate(()=>document.getElementById("sceneTitle").value);
  if(editingSceneTitle!=="Ссора")throw new Error(`Edit path opened the wrong scene: "${editingSceneTitle}"`);
  await page.click("#cancelScene");
  await page.waitForSelector("#sceneModal",{state:"hidden"});

  // 19) DnD still works in the redesigned matrix: drag scene-quarrel to before scene-airport.
  const dragTo=(sceneId,targetSceneId,after)=>page.evaluate(({sceneId,targetSceneId,after})=>{
    const handle=document.querySelector(`.scene-row[data-scene-id="${sceneId}"] .drag-handle`);
    const targetRow=document.querySelector(`.scene-row[data-scene-id="${targetSceneId}"]`);
    const rect=targetRow.getBoundingClientRect();
    const clientY=after?rect.bottom-2:rect.top+2;
    const transfer=new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    targetRow.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY}));
    targetRow.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY}));
    handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
  },{sceneId,targetSceneId,after});
  await dragTo("scene-quarrel","scene-airport",false);
  await page.waitForTimeout(100);
  const orderAfterDnd=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-one").map(s=>s.id));
  if(orderAfterDnd.join(",")!=="scene-quarrel,scene-airport")throw new Error(`DnD reorder did not take effect in the redesigned matrix: ${orderAfterDnd.join(",")}`);

  console.log("Scene x character matrix UX browser tests passed");
}finally{await browser.close();server.kill()}
