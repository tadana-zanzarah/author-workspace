import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

function baseProject(){
  return {version:11,characters:[],profiles:{},characterLinks:[],
    chapters:[
      {id:"chapter-unassigned",title:"Без главы",collapsed:false},
      {id:"chapter-empty",title:"Пустая глава",collapsed:false},
      {id:"chapter-one",title:"Одна сцена",collapsed:false},
      {id:"chapter-three",title:"Три сцены",collapsed:false},
      {id:"chapter-last",title:"Последняя глава",collapsed:false},
      {id:"chapter-never-touched",title:"Нетронутая глава",collapsed:false}
    ],
    locations:[],tags:[],future:{},
    scenes:[
      {id:"solo",title:"Соло",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
      {id:"A",title:"А",date:"",time:"",dateReview:false,chapterId:"chapter-three",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
      {id:"B",title:"Б",date:"",time:"",dateReview:false,chapterId:"chapter-three",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
      {id:"C",title:"В",date:"",time:"",dateReview:false,chapterId:"chapter-three",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
      {id:"tail",title:"Хвост",date:"",time:"",dateReview:false,chapterId:"chapter-last",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}}
    ]};
}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  const seed=async(project=baseProject())=>{
    await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  };
  await seed();

  const insertLabels=()=>page.evaluate(()=>[...document.querySelectorAll('[data-action="insert-scene"]')].map(b=>b.getAttribute("aria-label")||"(no label)"));
  const clickInsert=(label)=>page.evaluate((label)=>{
    const btn=[...document.querySelectorAll('[data-action="insert-scene"]')].find(b=>b.getAttribute("aria-label")===label);
    if(!btn)throw new Error(`insert control not found: ${label}`);
    btn.click();
  },label);

  // ---- 1/2/3) N+1 position counts, table view -------------------------------------
  {
    const labels=await insertLabels();
    const forChapter=(needle)=>labels.filter(l=>l.includes(needle));
    if(forChapter("Пустая глава").length!==1)throw new Error(`Empty chapter must have exactly 1 position, got ${forChapter("Пустая глава").length}`);
    if(!forChapter("Пустая глава")[0].startsWith("Вставить первую сцену"))throw new Error("Empty chapter position must be the 'first scene' kind");
    const oneSceneLabels=labels.filter(l=>l.includes("Соло")||l.includes("Одна сцена"));
    if(oneSceneLabels.length!==2)throw new Error(`1-scene chapter must have exactly 2 positions, got ${oneSceneLabels.length}: ${JSON.stringify(oneSceneLabels)}`);
    const threeSceneLabels=labels.filter(l=>/«А»|«Б»|«В»|Три сцены/.test(l));
    if(threeSceneLabels.length!==4)throw new Error(`3-scene chapter must have exactly 4 positions, got ${threeSceneLabels.length}: ${JSON.stringify(threeSceneLabels)}`);
  }

  // ---- 4) Click before-first -> create -> saved first in that chapter -------------
  {
    await clickInsert("Вставить сцену перед «А»");
    await page.fill("#sceneTitle","Перед А");
    await page.click("#saveScene");
    await page.waitForTimeout(150);
    const order=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-three").map(s=>s.title));
    if(order[0]!=="Перед А")throw new Error(`Expected new scene first in chapter-three, got ${JSON.stringify(order)}`);
  }

  // ---- 5) Click between A/B -> create -> saved between --------------------------
  {
    await clickInsert("Вставить сцену между «А» и «Б»");
    await page.fill("#sceneTitle","Между А и Б");
    await page.click("#saveScene");
    await page.waitForTimeout(150);
    const order=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-three").map(s=>s.title));
    const ai=order.indexOf("А"),bi=order.indexOf("Б"),ni=order.indexOf("Между А и Б");
    if(!(ai<ni&&ni<bi))throw new Error(`Expected new scene strictly between А and Б, got ${JSON.stringify(order)}`);
  }

  // ---- 6) Click after-last -> create -> saved last in that chapter --------------
  {
    await clickInsert("Вставить сцену в конец главы «Три сцены»");
    await page.fill("#sceneTitle","Конец главы");
    await page.click("#saveScene");
    await page.waitForTimeout(150);
    const order=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-three").map(s=>s.title));
    if(order[order.length-1]!=="Конец главы")throw new Error(`Expected new scene last in chapter-three, got ${JSON.stringify(order)}`);
  }

  // ---- 7) Cancel a positional create -> absolutely no change ---------------------
  {
    const before=await page.evaluate(()=>JSON.stringify(data));
    const labels=await insertLabels();
    const beforeCLabel=labels.find(l=>l.endsWith("«В»"));
    if(!beforeCLabel)throw new Error(`Could not find the position immediately before В among: ${JSON.stringify(labels)}`);
    await clickInsert(beforeCLabel);
    await page.fill("#sceneTitle","Should never be saved");
    await page.click("#cancelScene");
    // Dirty-tracker routes Cancel through a guarded discard confirmation.
    const discardVisible=await page.evaluate(()=>getComputedStyle(document.getElementById("discardChangesModal")).display!=="none");
    if(discardVisible)await page.click("#discardChanges");
    await page.waitForTimeout(150);
    const after=await page.evaluate(()=>JSON.stringify(data));
    if(before!==after)throw new Error("Cancelling a positional create must not change data");
    const sceneModalOpen=await page.evaluate(()=>getComputedStyle(document.getElementById("sceneModal")).display!=="none");
    if(sceneModalOpen)throw new Error("Scene modal must be closed after confirmed cancel");
  }

  // ---- 8) Create modal receives the correct chapter automatically ----------------
  {
    await clickInsert("Вставить первую сцену главы «Пустая глава»");
    const chapterValue=await page.$eval("#sceneChapter",el=>el.value);
    if(chapterValue!=="chapter-empty")throw new Error(`Expected modal chapter to be chapter-empty, got ${chapterValue}`);
    await page.click("#cancelScene"); // nothing typed yet -> not dirty, closes immediately
    await page.waitForTimeout(100);
  }

  // ---- 9) Changing the chapter in the modal must not reuse the stale position ----
  {
    const labels=await insertLabels();
    const beforeTailLabel=labels.find(l=>l.includes("Хвост")&&l.startsWith("Вставить сцену перед"));
    if(!beforeTailLabel)throw new Error(`Could not find 'insert before Хвост' control among: ${JSON.stringify(labels)}`);
    await clickInsert(beforeTailLabel);
    const openedChapter=await page.$eval("#sceneChapter",el=>el.value);
    if(openedChapter!=="chapter-last")throw new Error(`Expected chapter-last, got ${openedChapter}`);
    await page.selectOption("#sceneChapter","chapter-empty");
    await page.dispatchEvent("#sceneChapter","change");
    const state=await page.evaluate(()=>({insertBeforeSceneId,insertChapterId}));
    if(state.insertBeforeSceneId!==null||state.insertChapterId!=="chapter-empty")throw new Error(`Stale position was not reset on chapter change: ${JSON.stringify(state)}`);
    await page.fill("#sceneTitle","Remapped after chapter change");
    await page.click("#saveScene");
    await page.waitForTimeout(150);
    const saved=await page.evaluate(()=>data.scenes.find(s=>s.title==="Remapped after chapter change"));
    if(!saved||saved.chapterId!=="chapter-empty")throw new Error(`Scene must land in the newly selected chapter, got ${JSON.stringify(saved)}`);
    // It must NOT have been inserted before "Хвост" in chapter-last (the stale chapter).
    const lastChapterOrder=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-last").map(s=>s.title));
    if(lastChapterOrder.includes("Remapped after chapter change"))throw new Error("Scene leaked into the stale chapter");
  }

  // ---- 10) Global "+ Новая сцена" keeps its existing append semantics ------------
  {
    await page.click("#filterChapter");
    await page.waitForSelector("#filterChapterPopover:not([hidden])");
    await page.click('#filterChapterList [role="option"][data-value="chapter-empty"]');
    await page.click("#clearFilters");
    await page.click("#addFirst");
    const chapterValue=await page.$eval("#sceneChapter",el=>el.value);
    await page.fill("#sceneTitle","Глобальное создание");
    await page.click("#saveScene");
    await page.waitForTimeout(150);
    const saved=await page.evaluate(()=>data.scenes.find(s=>s.title==="Глобальное создание"));
    if(!saved||saved.chapterId!==chapterValue)throw new Error("Global create must save into the chapter shown in the modal");
  }

  // ---- 16/17/18) Filtered mode: positional insertion hidden, DnD disabled, -------
  // ----           clearing filters restores the full canonical position set. -----
  {
    await page.click("#filterChapter");
    await page.waitForSelector("#filterChapterPopover:not([hidden])");
    await page.click('#filterChapterList [role="option"][data-value="chapter-three"]');
    await page.waitForTimeout(50);
    const filteredInsertCount=await page.evaluate(()=>document.querySelectorAll('[data-action="insert-scene"]').length);
    if(filteredInsertCount!==0)throw new Error(`Filtered mode must hide all positional insertion controls, found ${filteredInsertCount}`);
    const dragDisabled=await page.evaluate(()=>document.getElementById("board").classList.contains("drag-disabled"));
    if(!dragDisabled)throw new Error("Filtered mode must still disable drag-and-drop reorder");
    const addFirstEnabled=await page.evaluate(()=>!document.getElementById("addFirst").disabled);
    if(!addFirstEnabled)throw new Error("Global '+ Новая сцена' must remain available while filtered");
    await page.click("#clearFilters");
    await page.waitForTimeout(50);
    const restoredInsertCount=await page.evaluate(()=>document.querySelectorAll('[data-action="insert-scene"]').length);
    if(restoredInsertCount===0)throw new Error("Clearing filters must restore positional insertion controls");
  }

  // ---- 11/12) DnD via the table view uses the same position model and skips ------
  // ----        a genuine no-op move (previously this view always mutated). -------
  {
    const dragMove=async(sceneId,targetSceneId)=>page.evaluate(({sceneId,targetSceneId})=>{
      const handle=document.querySelector(`[data-scene-id="${sceneId}"] .drag-handle`);
      const targetRow=document.querySelector(`[data-scene-id="${targetSceneId}"]`);
      const transfer=new DataTransfer();
      handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      const rect=targetRow.getBoundingClientRect();
      targetRow.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+1}));
      targetRow.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+1}));
      handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
    },{sceneId,targetSceneId});
    await dragMove("B","A"); // B dropped above A -> B moves before A
    await page.waitForTimeout(100);
    const order=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-three").map(s=>s.id));
    if(order.indexOf("B")>=order.indexOf("A"))throw new Error(`Expected B before A after drag, got ${JSON.stringify(order)}`);
    const rawBefore=await page.evaluate(()=>localStorage.getItem("novelTimelineV11"));
    await dragMove("B","A"); // B is already immediately before A: true no-op
    const rawAfter=await page.evaluate(()=>localStorage.getItem("novelTimelineV11"));
    if(rawBefore!==rawAfter)throw new Error("A genuine no-op table-view drop must not write to storage");
  }

  // ---- 13/14) Keyboard reorder: move up/down buttons, focusable, no drag needed --
  {
    const before=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-three").map(s=>s.id));
    const targetId=before[before.length-1];
    await page.evaluate((id)=>{
      document.querySelector(`[data-scene-id="${id}"] [aria-label^="Переместить сцену"][aria-label$="выше"]`)?.focus();
    },targetId);
    const focused=await page.evaluate(()=>document.activeElement?.getAttribute("aria-label"));
    if(!focused||!focused.startsWith("Переместить сцену"))throw new Error(`Move-up button must be keyboard-focusable, got ${focused}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const after=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-three").map(s=>s.id));
    const oldIndex=before.indexOf(targetId),newIndex=after.indexOf(targetId);
    if(!(newIndex<oldIndex))throw new Error(`Move-up must move the scene earlier, before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  // ---- 19/20/21) All three views expose the same position model ------------------
  {
    await page.click('[data-view="list"]');
    await page.waitForSelector(".compact-chapter-group");
    const compactLabels=await page.evaluate(()=>[...document.querySelectorAll(".compact-position-insert")].map(b=>b.getAttribute("aria-label")));
    await page.click('[data-view="cards"]');
    await page.waitForSelector(".card-chapter-group");
    const cardLabels=await page.evaluate(()=>[...document.querySelectorAll(".card-position-insert,.card-position-empty button")].map(b=>b.getAttribute("aria-label")));
    await page.click('[data-view="table"]');
    await page.waitForSelector(".scene-row");
    const tableLabels=await insertLabels();
    const norm=list=>[...list].sort().join("|");
    if(norm(compactLabels)!==norm(tableLabels))throw new Error(`Compact view positions differ from table view.\ncompact=${JSON.stringify(compactLabels)}\ntable=${JSON.stringify(tableLabels)}`);
    if(norm(cardLabels)!==norm(tableLabels))throw new Error(`Cards view positions differ from table view.\ncards=${JSON.stringify(cardLabels)}\ntable=${JSON.stringify(tableLabels)}`);
  }

  // ---- 22) Empty compact view keeps exactly one target, no phantom extra zone ----
  {
    await page.click('[data-view="list"]');
    const emptyChapterZones=await page.evaluate(()=>document.querySelectorAll('[data-chapter-id="chapter-never-touched"] .compact-drop-position').length);
    if(emptyChapterZones!==1)throw new Error(`Empty chapter must render exactly one compact drop/insert row, got ${emptyChapterZones}`);
  }

  // ---- 15) Touch/coarse-pointer: the control is a real, clickable element even ---
  // ----     though it is visually quiet without hover — never hover-only. --------
  {
    await page.click('[data-view="table"]');
    const tapped=await page.evaluate(()=>{
      const btn=document.querySelector('.scene-position-btn[data-action="insert-scene"]');
      if(!btn)return {ok:false};
      const rect=btn.getBoundingClientRect();
      return {ok:true,hasArea:rect.width>0&&rect.height>0,visible:getComputedStyle(btn).display!=="none"&&getComputedStyle(btn).visibility!=="hidden"};
    });
    if(!tapped.ok||!tapped.hasArea||!tapped.visible)throw new Error(`Insertion control must remain a real, tappable element without hover: ${JSON.stringify(tapped)}`);
  }

  // ---- 23) Chronology model is untouched by this feature -------------------------
  {
    await page.evaluate(()=>{
      // Assign compatible ascending dates and confirm no false chronology conflicts appear.
      commitDataChange(next=>{
        const three=next.scenes.filter(s=>s.chapterId==="chapter-three");
        three.forEach((s,i)=>{s.date=`2024-01-${String(i+1).padStart(2,"0")}`;s.dateReview=false});
      });
      render();
    });
    const conflicts=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="chapter-three").map(s=>chronologicalWarning(data.scenes.findIndex(x=>x.id===s.id))));
    if(conflicts.some(Boolean))throw new Error(`Ascending in-chapter dates must never conflict: ${JSON.stringify(conflicts)}`);
  }

  console.log("Scene position interactions browser tests passed");
}finally{await browser.close();server.kill()}
