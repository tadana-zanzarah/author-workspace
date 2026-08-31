import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Real-DOM regression for design/core-workspace-recomposition: the header/sidebar/
// project-overview/filters/cards/matrix/compact recomposition. This is presentation-
// layer coverage — it complements (does not replace) scene-position-model.test.mjs,
// scene-position-interactions-browser.test.mjs and scene-character-matrix-ux-browser.test.mjs,
// which already own the underlying position-model and matrix-content-mode contracts.

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
function project(){
  return {version:11,
    characters:[{id:"c1",name:"Анна"},{id:"c2",name:"Борис"}],
    profiles:{},
    chapters:[
      {id:"chapter-unassigned",title:"Без главы",collapsed:false},
      {id:"ch1",title:"Глава первая",collapsed:false}
    ],
    locations:[{id:"l1",name:"Дом"}],tags:[{id:"t1",name:"тайна"}],future:{},
    scenes:[
      {id:"s1",title:"Сцена А",date:"2026-01-01",time:"09:00",dateReview:false,chapterId:"ch1",locationId:"l1",tags:["t1"],writingStatus:"draft",sceneText:"",included:true,status:"fixed",people:{c1:{action:"Делает что-то",legacyState:"",relationChanges:{},visibleRelations:[]}}},
      {id:"s2",title:"Сцена Б",date:"2026-01-02",time:"10:00",dateReview:false,chapterId:"ch1",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{c2:emptyPerson()}},
      {id:"s3",title:"Сцена В",date:"2026-01-03",time:"11:00",dateReview:false,chapterId:"ch1",locationId:"",tags:[],writingStatus:"final",sceneText:"",included:false,status:"fixed",people:{}},
      {id:"s4",title:"Сцена Г",date:"",time:"",dateReview:false,chapterId:"ch1",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
      {id:"s5",title:"Сцена Д",date:"",time:"",dateReview:false,chapterId:"ch1",locationId:"",tags:[],writingStatus:"plan",sceneText:"",included:true,status:"floating",people:{}},
      {id:"s6",title:"Сцена Е",date:"",time:"",dateReview:false,chapterId:"ch1",locationId:"",tags:[],writingStatus:"edit1",sceneText:"",included:true,status:"floating",people:{}}
    ]};
}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project());
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // ================= HEADER =================
  // 1) Desktop header is one application row, not two stacked rows.
  {
    const rows=await page.evaluate(()=>{
      const header=document.querySelector("header");
      const kids=[...header.children].filter(el=>getComputedStyle(el).display!=="none");
      const tops=new Set(kids.map(el=>Math.round(el.getBoundingClientRect().top)));
      return {headerHeight:header.getBoundingClientRect().height,distinctTops:tops.size};
    });
    if(rows.headerHeight>70)throw new Error(`Header looks like it wrapped to more than one row: height=${rows.headerHeight}`);
  }
  // 2) core-production-polish: the permanent "Рабочее пространство автора" wordmark is
  //    gone (superseded by a reserved, currently-empty logo slot ahead of the project
  //    title — see core-production-polish-browser.test.mjs for the full contract).
  {
    const identity=await page.evaluate(()=>({
      slotPresent:!!document.querySelector("header .app-logo-slot"),
      staleText:[...document.querySelectorAll("header *")].some(el=>el.children.length===0&&el.textContent.trim()==="Рабочее пространство автора")
    }));
    if(!identity.slotPresent)throw new Error("Reserved header logo slot missing");
    if(identity.staleText)throw new Error("Stale 'Рабочее пространство автора' wordmark still present in header");
  }
  // 3) No standalone "Навигация" header button — the control moved to the sidebar edge.
  {
    const stray=await page.evaluate(()=>[...document.querySelectorAll("header button")].some(b=>b.textContent.trim()==="Навигация"));
    if(stray)throw new Error("A standalone header 'Навигация' button still exists");
    const edge=await page.evaluate(()=>{const el=document.getElementById("toggleNavigation");return {present:!!el,inHeader:!!el?.closest("header"),inShell:!!el?.closest(".app-shell")}});
    if(!edge.present||edge.inHeader||!edge.inShell)throw new Error(`Sidebar toggle is not attached to the sidebar shell: ${JSON.stringify(edge)}`);
  }
  // 4/5/6/7) Primary/secondary actions and save status reachable from the single row.
  {
    const controls=await page.evaluate(()=>["addFirst","allScenesBtn","exportTextBtn","exportBtn","saveStatus"].map(id=>{
      const el=document.getElementById(id);return {id,present:!!el,visible:el?.offsetParent!==null};
    }));
    for(const c of controls)if(!c.present||!c.visible)throw new Error(`Header control regressed: ${JSON.stringify(c)}`);
  }

  // ================= SIDEBAR =================
  // 8/9/10/11) Attached edge control collapses/expands, reachable by keyboard, aria stays correct.
  // Two controls share one open/closed state: #toggleNavigation ("‹", collapse) is a
  // real child of the sidebar header and only meaningful/visible while open; once
  // collapsed the panel (and that button with it) is gone, and a separate
  // #toggleNavigationReopen ("›") tab takes over — see js/storage.js syncSidebarEdgeToggle.
  {
    const before=await page.evaluate(()=>({expanded:document.getElementById("toggleNavigation").getAttribute("aria-expanded"),label:document.getElementById("toggleNavigation").getAttribute("aria-label"),reopenHidden:document.getElementById("toggleNavigationReopen").hidden}));
    if(before.expanded!=="true"||before.label!=="Свернуть навигацию"||!before.reopenHidden)throw new Error(`Sidebar toggle default state wrong: ${JSON.stringify(before)}`);
    await page.focus("#toggleNavigation");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    const collapsed=await page.evaluate(()=>({
      reopenLabel:document.getElementById("toggleNavigationReopen").getAttribute("aria-label"),
      reopenVisible:document.getElementById("toggleNavigationReopen").offsetParent!==null,
      shellCollapsed:document.querySelector(".app-shell").classList.contains("navigation-hidden"),
      sidebarHidden:getComputedStyle(document.querySelector(".project-sidebar")).display==="none"
    }));
    if(collapsed.reopenLabel!=="Открыть навигацию"||!collapsed.reopenVisible||!collapsed.shellCollapsed||!collapsed.sidebarHidden)
      throw new Error(`Sidebar did not collapse via keyboard activation: ${JSON.stringify(collapsed)}`);
    // 12) Persists across reload.
    await page.reload({waitUntil:"networkidle"});
    const persisted=await page.evaluate(()=>document.querySelector(".app-shell").classList.contains("navigation-hidden"));
    if(!persisted)throw new Error("Sidebar collapse did not survive reload");
    await page.click("#toggleNavigationReopen"); // restore for the rest of the run
    await page.waitForTimeout(50);
  }

  // ================= PROJECT OVERVIEW =================
  // 13/14/15/16) Pipeline retained, global stats shown once, no duplicated readiness/final pills.
  {
    const overview=await page.evaluate(()=>({
      pipelineStages:document.querySelectorAll(".pipeline-stage").length,
      readinessBar:!!document.querySelector(".progress-bar"),
      statPillTexts:[...document.querySelectorAll(".stat-pill")].map(el=>el.textContent)
    }));
    if(overview.pipelineStages<6)throw new Error(`Pipeline stages missing: ${overview.pipelineStages}`);
    if(!overview.readinessBar)throw new Error("Readiness progress bar missing from project overview");
    if(overview.statPillTexts.some(t=>/Готовность|Финал|выбранной сцене/.test(t)))
      throw new Error(`Stats strip still duplicates dashboard/pipeline data: ${JSON.stringify(overview.statPillTexts)}`);
    if(!overview.statPillTexts.some(t=>/^Сцен/.test(t)))throw new Error("Project-global scene count missing from stats strip");
  }

  // Custom filter listbox (js/filter-controls.js) replaced native <select> — open the
  // trigger, click the matching option by value.
  const chooseFilter=async(suffix,value)=>{
    await page.click(`#filter${suffix}`);
    await page.waitForSelector(`#filter${suffix}Popover:not([hidden])`);
    await page.click(`#filter${suffix}List [role="option"][data-value="${value}"]`);
  };

  // ================= FILTERS =================
  // 17/18/19/20) All filters present, active state visually distinguishable, clear works, no duplicate search.
  {
    const searchInputs=await page.evaluate(()=>document.querySelectorAll('input[id="projectSearch"]').length);
    if(searchInputs!==1)throw new Error(`Expected exactly one search field, found ${searchInputs}`);
    await chooseFilter("Writing","draft");
    await page.waitForTimeout(100);
    const activeClass=await page.evaluate(()=>document.getElementById("filterWriting").closest(".filter-field").classList.contains("filter-active"));
    if(!activeClass)throw new Error("Active filter field does not carry the active visual state");
    const chip=await page.evaluate(()=>!!document.querySelector(".active-filter-chip"));
    if(!chip)throw new Error("Active filter chip missing");
    await page.click("#clearFilters");
    await page.waitForTimeout(100);
    const cleared=await page.evaluate(()=>({value:filters.writing,active:document.getElementById("filterWriting").closest(".filter-field").classList.contains("filter-active")}));
    if(cleared.value!==""||cleared.active)throw new Error(`Clear filters did not reset state: ${JSON.stringify(cleared)}`);
  }

  // ================= CARDS =================
  await page.click('[data-view="cards"]');
  await page.waitForSelector(".card-chapter-group");
  // 21/22) Dense grid: exactly one grid item per scene, no permanent empty insertion cards.
  {
    const grid=await page.evaluate(()=>{
      const slots=[...document.querySelectorAll('[data-chapter-id="ch1"] .card-slot')];
      return {slotCount:slots.length,emptyCards:slots.filter(s=>!s.querySelector(".compact-scene-card")).length};
    });
    if(grid.slotCount!==6)throw new Error(`Expected 6 card slots for 6 scenes, got ${grid.slotCount}`);
    if(grid.emptyCards!==0)throw new Error(`Found ${grid.emptyCards} permanent empty insertion cards in the grid`);
  }
  // 23) Edge insertion controls exist and are real, tappable elements without hover (touch fallback).
  {
    const edge=await page.evaluate(()=>{
      const btn=document.querySelector(".card-insert-edge");
      if(!btn)return {ok:false};
      const rect=btn.getBoundingClientRect();
      return {ok:true,hasArea:rect.width>0&&rect.height>0,visible:getComputedStyle(btn).display!=="none"};
    });
    if(!edge.ok||!edge.hasArea||!edge.visible)throw new Error(`Card insertion control not tappable: ${JSON.stringify(edge)}`);
  }
  // 24/25) Card drag-and-drop reorders via the shared position model and persists.
  {
    const before=await page.evaluate(()=>[...document.querySelectorAll('[data-chapter-id="ch1"] .compact-scene-card')].map(c=>c.dataset.sceneId));
    await page.evaluate(()=>{
      const card=document.querySelector('.compact-scene-card[data-scene-id="s3"]');
      const target=document.querySelector('.card-insert-edge[aria-label*="перед «Сцена А"]');
      const transfer=new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      card.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
    });
    await page.waitForTimeout(150);
    const after=await page.evaluate(()=>[...document.querySelectorAll('[data-chapter-id="ch1"] .compact-scene-card')].map(c=>c.dataset.sceneId));
    if(after[0]!=="s3")throw new Error(`Card DnD did not reorder as expected: before=${before} after=${after}`);
    const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")).scenes.filter(s=>s.chapterId==="ch1").map(s=>s.id));
    if(persisted[0]!=="s3")throw new Error(`Card DnD reorder was not persisted: ${persisted}`);
  }
  // 26) A genuine no-op card drop does not write to storage (no unnecessary mutation/save).
  // s3 is now first (test 24/25 moved it there): dropping it on the "before itself"
  // edge position is the no-op case (beforeSceneId === the dragged scene's own id).
  {
    const rawBefore=await page.evaluate(()=>localStorage.getItem("novelTimelineV11"));
    await page.evaluate(()=>{
      const card=document.querySelector('.compact-scene-card[data-scene-id="s3"]');
      const target=document.querySelector('.card-insert-edge[aria-label*="перед «Сцена В"]');
      const transfer=new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      card.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
    });
    await page.waitForTimeout(100);
    const rawAfter=await page.evaluate(()=>localStorage.getItem("novelTimelineV11"));
    if(rawBefore!==rawAfter)throw new Error("A genuine no-op card drop must not write to storage");
  }
  // 27) Filtered mode disables card insertion/drag affordances (same safety contract as other views).
  {
    await chooseFilter("Writing","idea");
    await page.waitForTimeout(100);
    const state=await page.evaluate(()=>({
      edgeButtons:document.querySelectorAll(".card-insert-edge").length,
      draggable:[...document.querySelectorAll(".compact-scene-card")].some(c=>c.draggable)
    }));
    if(state.edgeButtons!==0)throw new Error(`Filtered mode must hide card insertion controls, found ${state.edgeButtons}`);
    if(state.draggable)throw new Error("Filtered mode must disable card drag");
    await page.click("#clearFilters");
    await page.waitForTimeout(100);
  }

  // ================= MATRIX (TABLE VIEW) =================
  await page.click('[data-view="table"]');
  await page.waitForSelector(".scene-row");
  // 28) Default Actions ON / Relationships OFF preserved.
  {
    const defaults=await page.evaluate(()=>({actions:document.getElementById("matrixShowActions").checked,relations:document.getElementById("matrixShowRelations").checked}));
    if(!defaults.actions||defaults.relations)throw new Error(`Matrix default content mode regressed: ${JSON.stringify(defaults)}`);
  }
  // 29) Matrix canvas is not dominated by full-row green/orange fills (neutral canvas requirement).
  {
    const fills=await page.evaluate(()=>{
      const cell=document.querySelector('.scene-row[data-scene-id="s1"] .matrix-cell');
      return cell?getComputedStyle(cell).backgroundColor:null;
    });
    // Neutral surface tokens resolve to white/near-white; the old design used sage-tint (#e4efe1) across every cell.
    if(fills==="rgb(228, 239, 225)")throw new Error("Matrix cell still carries the old full-fill status background");
  }
  // 30) Normal scene row does not expose raw date/time/checkbox form controls permanently.
  {
    const rawControls=await page.evaluate(()=>{
      const row=document.querySelector('.scene-row[data-scene-id="s1"]');
      return {
        dateInput:!!row.querySelector('input[type="date"]'),
        timeInput:!!row.querySelector('input[type="time"]'),
        includeCheckbox:!!row.querySelector('.include-toggle input[type="checkbox"]')
      };
    });
    if(rawControls.dateInput||rawControls.timeInput||rawControls.includeCheckbox)
      throw new Error(`Scene row still exposes permanent raw form controls: ${JSON.stringify(rawControls)}`);
    // Chronology is still readable, just compact.
    const chip=await page.evaluate(()=>document.querySelector('.scene-row[data-scene-id="s1"] .scene-chronology-chip')?.textContent.trim());
    if(!chip||!chip.includes("2026"))throw new Error(`Compact chronology summary missing: ${JSON.stringify(chip)}`);
  }
  // 31) Excluded-from-text scenes are visibly flagged without a permanent checkbox.
  {
    const excluded=await page.evaluate(()=>{
      const row=document.querySelector('.scene-row[data-scene-id="s3"]');
      return {hasClass:row.classList.contains("excluded"),hasBadge:!!row.querySelector(".excluded-badge")};
    });
    if(!excluded.hasClass||!excluded.hasBadge)throw new Error(`Excluded scene is not visibly flagged: ${JSON.stringify(excluded)}`);
  }
  // 32) Edit action still reaches the existing scene modal (view/edit split).
  {
    await page.click('.scene-row[data-scene-id="s1"] button[aria-label*="Изменить сцену"]');
    await page.waitForSelector("#sceneModal .modal");
    const title=await page.evaluate(()=>document.getElementById("sceneTitle").value);
    if(title!=="Сцена А")throw new Error(`Edit path opened the wrong scene: ${title}`);
    await page.click("#cancelScene");
    await page.waitForSelector("#sceneModal",{state:"hidden"});
  }
  // 33) Drag/reorder still works directly from the row (fast operation preserved).
  {
    const before=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="ch1").map(s=>s.id));
    await page.evaluate(()=>{
      const handle=document.querySelector('[data-scene-id="s2"] .drag-handle');
      const targetRow=document.querySelector('[data-scene-id="s1"]');
      const rect=targetRow.getBoundingClientRect();
      const transfer=new DataTransfer();
      handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
      targetRow.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+1}));
      targetRow.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+1}));
      handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
    });
    await page.waitForTimeout(100);
    const after=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="ch1").map(s=>s.id));
    if(after.indexOf("s2")>=after.indexOf("s1"))throw new Error(`Table row drag did not reorder: before=${before} after=${after}`);
  }

  // ================= COMPACT =================
  await page.click('[data-view="list"]');
  await page.waitForSelector(".compact-chapter-group");
  // 34) N+1 insertion logical behaviour retained (compact list already used the quiet pattern; confirm parity).
  {
    const count=await page.evaluate(()=>document.querySelectorAll('[data-chapter-id="ch1"] .compact-position-insert').length);
    if(count!==7)throw new Error(`Expected 7 insertion positions for 6 scenes (N+1), got ${count}`);
  }
  // 35) Reorder still works (keyboard move-up alternative).
  {
    const before=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="ch1").map(s=>s.id));
    const lastId=before[before.length-1];
    await page.evaluate(id=>document.querySelector(`[data-scene-id="${id}"] [aria-label^="Переместить сцену"][aria-label$="выше"]`)?.focus(),lastId);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const after=await page.evaluate(()=>data.scenes.filter(s=>s.chapterId==="ch1").map(s=>s.id));
    if(after.indexOf(lastId)>=before.indexOf(lastId))throw new Error(`Compact keyboard reorder did not move the scene earlier: ${before} -> ${after}`);
  }

  console.log("Core workspace recomposition browser tests passed");
}finally{await browser.close();server.kill()}
