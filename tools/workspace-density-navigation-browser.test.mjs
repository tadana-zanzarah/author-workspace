import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Real-DOM regression for design/workspace-density-navigation: header/sidebar/
// project-overview/view-toolbar/filters/matrix/cards density & semantic-navigation
// changes on top of the accepted design/core-workspace-recomposition shell. This
// complements (does not replace) core-workspace-recomposition-browser.test.mjs and
// the other suites this phase's report lists as re-verified.

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
function project(){
  const chapters=[
    {id:"chapter-unassigned",title:"Без главы",collapsed:false},
    {id:"ch1",title:"Глава 1",collapsed:false},
    {id:"ch2",title:"Глава 2",collapsed:false},
    {id:"ch3",title:"Глава 3",collapsed:false},
    {id:"ch4",title:"Глава 4",collapsed:false},
    {id:"ch5",title:"Глава 5",collapsed:false},
    {id:"ch6",title:"Глава 6",collapsed:false},
    {id:"ch7",title:"Глава 7 (пустая)",collapsed:false}
  ];
  const characters=["c1","c2","c3","c4","c5","c6","c7"].map((id,i)=>({id,name:["Анна","Борис","Виктор","Галина","Дмитрий","Елена","Жанна"][i]}));
  const locations=[{id:"l1",name:"Дом"},{id:"l2",name:"Кафе"},{id:"l3",name:"Офис"},{id:"l4",name:"Парк"},{id:"l5",name:"Вокзал"},{id:"l6",name:"Порт"}];
  const tags=["романтика","тайна","конфликт","юмор","драма","флешбек"].map((name,i)=>({id:"t"+(i+1),name}));
  const scenes=[
    {id:"s1",title:"Сцена А",date:"2026-01-01",time:"09:00",dateReview:false,chapterId:"ch1",locationId:"l1",tags:["t1","t2","t3"],writingStatus:"draft",sceneText:"",included:true,status:"fixed",people:{c1:{action:"Делает что-то",legacyState:"",relationChanges:{},visibleRelations:[]}}},
    {id:"s2",title:"Сцена Б",date:"",time:"",dateReview:true,chapterId:"ch1",locationId:"l2",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{c2:emptyPerson()}},
    {id:"s3",title:"Сцена В",date:"2026-01-03",time:"11:00",dateReview:true,chapterId:"ch1",locationId:"",tags:["t4"],writingStatus:"final",sceneText:"",included:false,status:"fixed",people:{}}
  ];
  // Dense chapter (ch2) for chapters show-more / row-density checks.
  for(let i=0;i<9;i++){
    scenes.push({id:`d${i}`,title:`Глава 2 плотная сцена ${i+1}`,date:i%3?`2026-02-${String(10+i).padStart(2,"0")}`:"",time:i%3?"10:00":"",dateReview:false,chapterId:"ch2",locationId:locations[i%locations.length].id,tags:[],writingStatus:"idea",sceneText:"",included:true,status:i%2?"fixed":"floating",people:{[characters[i%characters.length].id]:{action:"действие",relationChanges:{},visibleRelations:[]}}});
  }
  for(const ch of ["ch3","ch4","ch5","ch6"])scenes.push({id:`sc-${ch}`,title:`Сцена главы ${ch}`,date:"",time:"",dateReview:false,chapterId:ch,locationId:"",tags:[],writingStatus:"plan",sceneText:"",included:true,status:"floating",people:{}});
  return {version:11,characters,profiles:{},characterLinks:[],chapters,locations,tags,future:{},scenes};
}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project());
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // ================= HEADER =================
  for(const width of [1440,1200]){
    await page.setViewportSize({width,height:900});
    const rows=await page.evaluate(()=>document.querySelector("header").getBoundingClientRect().height);
    if(rows>70)throw new Error(`Header wrapped to more than one row at ${width}: height=${rows}`);
  }
  for(const width of [1440,1200,1024,900]){
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>{const h=document.querySelector("header");return h.scrollWidth>h.clientWidth+1});
    if(overflow)throw new Error(`Header is horizontally scrollable at width ${width}`);
  }
  await page.setViewportSize({width:1440,height:900});
  {
    const noBack=await page.evaluate(()=>!document.getElementById("backToProjects"));
    if(!noBack)throw new Error("Legacy standalone ← Проекты header control must be removed");
    const projectsReachable=await page.evaluate(()=>!!document.getElementById("workspaceProjects"));
    if(!projectsReachable)throw new Error("Мои проекты must remain reachable (now via the account menu)");
    // core-production-polish: the permanent "Рабочее пространство автора" wordmark is
    // removed (superseded by a reserved, currently-empty logo slot before the project
    // title — see core-production-polish-browser.test.mjs).
    const identity=await page.evaluate(()=>({
      slotPresent:!!document.querySelector("header .app-logo-slot"),
      staleText:[...document.querySelectorAll("header *")].some(el=>el.children.length===0&&el.textContent.trim()==="Рабочее пространство автора")
    }));
    if(!identity.slotPresent)throw new Error(`Reserved header logo slot missing: ${JSON.stringify(identity)}`);
    if(identity.staleText)throw new Error("Stale 'Рабочее пространство автора' wordmark still present in header");
  }
  {
    // Simulate the cloud workspace identity bar (no live Supabase needed for this
    // structural/visual check — see cloud-*-browser suites for the real-cloud path).
    const state=await page.evaluate(()=>{
      document.getElementById("workspaceCloudBar").hidden=false;
      document.getElementById("workspaceProjectTitle").textContent="Очень длинное название проекта для проверки переполнения строки заголовка";
      document.getElementById("workspaceAccountMenu").hidden=false;
      document.getElementById("workspaceAccountAvatar").textContent="АК";
      document.getElementById("workspaceAccountName").textContent="a.very.long.author.email@example.com";
      const h=document.querySelector("header");
      return {
        titleVisible:document.getElementById("workspaceProjectTitle").offsetParent!==null,
        titleText:document.getElementById("workspaceProjectTitle").textContent,
        legacyIndicatorAbsent:!document.querySelector(".local-only-indicator"),
        overflowing:h.scrollWidth>h.clientWidth+1,
        avatarPresent:!!document.getElementById("workspaceAccountAvatar").textContent.trim(),
        accountNameVisible:document.getElementById("workspaceAccountName").offsetParent!==null
      };
    });
    if(!state.titleVisible||!state.titleText)throw new Error(`Project title not shown/dominant: ${JSON.stringify(state)}`);
    if(!state.legacyIndicatorAbsent)throw new Error("Legacy local-storage indicator must not exist in the normal cloud header");
    if(state.overflowing)throw new Error("Header overflows horizontally with a long project title + long account email");
    if(!state.avatarPresent||!state.accountNameVisible)throw new Error(`Account identity (avatar + name) not shown: ${JSON.stringify(state)}`);
    await page.evaluate(()=>{document.getElementById("workspaceCloudBar").hidden=true;document.getElementById("workspaceAccountMenu").hidden=true});
  }
  {
    // Idle state shows nothing permanent; a real save flashes transient text.
    const idle=await page.evaluate(()=>document.getElementById("saveStatus").textContent.trim());
    if(idle.includes("Сохранено")||idle.includes("Автосохранение"))throw new Error(`Save status must be empty at idle, got: "${idle}"`);
    await page.evaluate(()=>saveData());
    const afterSave=await page.evaluate(()=>document.getElementById("saveStatus").textContent);
    if(!afterSave.includes("Сохранено"))throw new Error(`Save status has no visible path after an explicit save: "${afterSave}"`);
  }

  // ================= SIDEBAR =================
  {
    const layout=await page.evaluate(()=>{
      const sidebar=document.querySelector(".project-sidebar");
      const header=sidebar.querySelector(".sidebar-header");
      const label=header?.querySelector(".sidebar-header-label")?.textContent.trim();
      const firstSection=sidebar.querySelector(".sidebar-section");
      return {
        headerIsFirstMeaningfulChild:sidebar.children[0]===header,
        label,
        headerToSectionGap:firstSection.getBoundingClientRect().top-header.getBoundingClientRect().bottom
      };
    });
    if(!layout.headerIsFirstMeaningfulChild)throw new Error("Sidebar should open with a compact identity/header row, not blank space");
    if(layout.label!=="Навигация")throw new Error(`Sidebar header should read as navigation identity, got: "${layout.label}"`);
    if(layout.headerToSectionGap>40)throw new Error(`Unexpectedly large gap between sidebar header and first section: ${layout.headerToSectionGap}px`);
  }
  {
    const noTags=await page.evaluate(()=>!document.getElementById("sideTags")&&!document.querySelector('[data-sidebar-section="tags"]'));
    if(!noTags)throw new Error("Tags must not be a sidebar navigation section");
    const noConfigure=await page.evaluate(()=>![...document.querySelectorAll(".project-sidebar button")].some(b=>b.textContent.trim().toLowerCase()==="настроить"));
    if(!noConfigure)throw new Error('Legacy "настроить" text buttons must be replaced with accessible icon controls');
    const manageButtons=await page.evaluate(()=>[...document.querySelectorAll(".project-sidebar .nav-manage")].map(b=>({text:b.textContent.trim(),aria:b.getAttribute("aria-label")})));
    if(manageButtons.some(b=>!b.aria))throw new Error(`Sidebar section action missing accessible name: ${JSON.stringify(manageButtons)}`);
  }
  {
    const chapterState=await page.evaluate(()=>{
      const items=[...document.querySelectorAll("#sideChapters .sidebar-item")];
      const showMore=document.querySelector("#sideChapters + .sidebar-show-more, #sideChapters .sidebar-show-more")||[...document.getElementById("sideChapters").parentElement.querySelectorAll(".sidebar-show-more")][0];
      return {visibleCount:items.length,hasShowMore:!!showMore};
    });
    if(chapterState.visibleCount<4||chapterState.visibleCount>5)throw new Error(`Chapters should default to ~4-5 visible items, got ${chapterState.visibleCount}`);
    if(!chapterState.hasShowMore)throw new Error("Chapters section missing a show-more control for a longer list");
    await page.click("#sideChapters .sidebar-show-more, .sidebar-section[data-sidebar-section='chapters'] .sidebar-show-more");
    const expanded=await page.evaluate(()=>document.querySelectorAll("#sideChapters .sidebar-item").length);
    if(expanded<7)throw new Error(`Show more did not reveal the remaining chapters: ${expanded}`);
  }
  {
    // Chapter click navigates (scrolls to the section) instead of filtering scenes.
    const before=await page.evaluate(()=>filters.chapter);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.evaluate(()=>{
      const btn=[...document.querySelectorAll("#sideChapters .sidebar-item")].find(b=>b.textContent.includes("Глава 2"));
      if(!btn)throw new Error("Глава 2 sidebar item not found");
      btn.click();
    });
    await page.waitForTimeout(150);
    const after=await page.evaluate(()=>({filterChapter:filters.chapter,highlighted:!!document.querySelector(".chapter-nav-highlight[data-chapter-id='ch2']")}));
    if(after.filterChapter!==before)throw new Error(`Chapter sidebar click must not change the active filter, got: ${after.filterChapter}`);
    if(!after.highlighted)throw new Error("Chapter sidebar click did not navigate to/highlight the chapter section");
  }
  {
    // Character click opens the profile instead of filtering.
    const before=await page.evaluate(()=>[...filters.character]);
    await page.click('#sideCharacters .sidebar-item');
    await page.waitForSelector("#profileEditorModal .modal");
    const after=await page.evaluate(()=>({filterCharacter:[...filters.character],modalOpen:document.getElementById("profileEditorModal").style.display==="flex",name:document.getElementById("pf_name").value}));
    if(JSON.stringify(after.filterCharacter)!==JSON.stringify(before))throw new Error(`Character sidebar click must not change the active filter, got: ${JSON.stringify(after.filterCharacter)}`);
    if(!after.modalOpen||!after.name)throw new Error(`Character sidebar click did not open a populated profile: ${JSON.stringify(after)}`);
    await page.click("#cancelProfile");
    await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  }
  {
    // Location click opens that Location's Profile directly, not a filter — same
    // contract as the Character sidebar click above (see openLocationEntity).
    const before=await page.evaluate(()=>filters.location);
    await page.click('#sideLocations .sidebar-item');
    await page.waitForSelector("#locationProfileModal .modal");
    const after=await page.evaluate(()=>({filterLocation:filters.location,modalOpen:document.getElementById("locationProfileModal").style.display==="flex",name:document.getElementById("locationProfileTitle").textContent,readMode:document.getElementById("locationProfileEditView").hidden}));
    if(after.filterLocation!==before)throw new Error(`Location sidebar click must not change the active filter, got: ${after.filterLocation}`);
    if(!after.modalOpen||!after.name||!after.readMode)throw new Error(`Location sidebar click did not open a populated Profile in read mode: ${JSON.stringify(after)}`);
    await page.click("#locationProfileClose");
    await page.waitForSelector("#locationProfileModal",{state:"hidden"});
  }

  // ================= PROJECT OVERVIEW =================
  {
    const overview=await page.evaluate(()=>{
      const pipeline=document.querySelector(".pipeline-strip");
      const readiness=document.querySelector(".readiness-compact");
      return {
        pipelineStages:document.querySelectorAll(".pipeline-stage").length,
        readinessPresent:!!readiness,
        sameRow:pipeline&&readiness&&pipeline.parentElement===readiness.parentElement,
        readinessText:readiness?.textContent||"",
        computedReadiness:projectReadiness(),
        statPills:[...document.querySelectorAll(".stat-pill")].map(s=>s.textContent)
      };
    });
    if(overview.pipelineStages<6)throw new Error(`Pipeline stages missing: ${overview.pipelineStages}`);
    if(!overview.readinessPresent||!overview.sameRow)throw new Error("Readiness must share the pipeline's row, not sit on its own full-width row");
    if(!overview.readinessText.includes(`${overview.computedReadiness}%`))throw new Error(`Readiness value regressed: ${JSON.stringify(overview)}`);
    if(!overview.statPills.length)throw new Error("Project stats strip missing");
  }

  // ================= VIEW TOOLBAR =================
  {
    const noHeading=await page.evaluate(()=>![...document.querySelectorAll("*")].some(el=>el.children.length===0&&el.textContent.trim()==="СОДЕРЖИМОЕ ЯЧЕЕК"));
    if(!noHeading)throw new Error('The "СОДЕРЖИМОЕ ЯЧЕЕК" heading must be removed');
    const layout=await page.evaluate(()=>{
      const viewSwitch=document.getElementById("viewSwitch"),toggle=document.getElementById("matrixToolbar");
      return {sameRow:viewSwitch.parentElement===toggle.parentElement,hidden:toggle.hidden,actions:document.getElementById("matrixShowActions").checked,relations:document.getElementById("matrixShowRelations").checked};
    });
    if(!layout.sameRow)throw new Error("Actions/Relationships toggle must be in the same row as the view switch");
    if(layout.hidden)throw new Error("Matrix toggle should be visible while Table view is active");
    if(!layout.actions||layout.relations)throw new Error(`Default content mode regressed: actions=${layout.actions} relations=${layout.relations}`);
  }
  await page.click('[data-view="cards"]');
  {
    const hidden=await page.evaluate(()=>document.getElementById("matrixToolbar").hidden);
    if(!hidden)throw new Error("Matrix toggle must be hidden in Cards view");
  }
  await page.click('[data-view="list"]');
  {
    const hidden=await page.evaluate(()=>document.getElementById("matrixToolbar").hidden);
    if(!hidden)throw new Error("Matrix toggle must be hidden in Compact view");
  }
  await page.click('[data-view="table"]');
  await page.waitForSelector(".scene-row");

  // ================= FILTERS =================
  {
    const noLabelRow=await page.evaluate(()=>document.querySelectorAll(".filter-label").length===0);
    if(!noLabelRow)throw new Error("Filter fields must not carry a separate visible label above the control");
    const heights=await page.evaluate(()=>{
      const search=document.getElementById("projectSearch").getBoundingClientRect().height;
      const select=document.getElementById("filterChapter").getBoundingClientRect().height;
      return {search,select,diff:Math.abs(search-select)};
    });
    if(heights.diff>2)throw new Error(`Search and select filters should share one height, got ${JSON.stringify(heights)}`);
    const inactive=await page.evaluate(()=>document.querySelector("#filterLocation .filter-trigger-text").textContent.trim());
    if(inactive!=="Локация")throw new Error(`Inactive filter should show its category as a placeholder, got: "${inactive}"`);
    // Selecting a value must NOT repeat the category name into the closed box — the
    // exact "Локация: Дом" duplication flagged in local review. The closed control
    // should read just the value ("Дом").
    await page.click("#filterLocation");
    await page.waitForSelector("#filterLocationPopover:not([hidden])");
    await page.click('#filterLocationList [role="option"][data-value="l1"]');
    await page.waitForTimeout(80);
    const active=await page.evaluate(()=>document.querySelector("#filterLocation .filter-trigger-text").textContent.trim());
    if(active.includes("Локация:"))throw new Error(`Active single-value filter must not repeat its category name, got: "${active}"`);
    if(!active.includes("Дом"))throw new Error(`Active filter should read the selected value, got: "${active}"`);
    // Reset toggles via visibility (not [hidden]/display:none) so its box stays in
    // the flex-wrap flow at a stable size and activating it can't reflow the other
    // filter fields — see the fix/core-final-visual-polish pass.
    const resetVisible=await page.evaluate(()=>getComputedStyle(document.getElementById("clearFilters")).visibility!=="hidden");
    if(!resetVisible)throw new Error("Reset must appear once a filter is active");
    for(const width of [1440,1200,1024,900]){
      await page.setViewportSize({width,height:900});
      const alone=await page.evaluate(()=>{
        const reset=document.getElementById("clearFilters");
        const resetTop=Math.round(reset.getBoundingClientRect().top);
        const shareRow=[...document.querySelectorAll(".search-row > *")].some(f=>f!==reset&&Math.round(f.getBoundingClientRect().top)===resetTop);
        return !shareRow;
      });
      if(alone)throw new Error(`Reset is stranded alone on its own row at width ${width}`);
    }
    await page.setViewportSize({width:1440,height:900});
    await page.click("#clearFilters");
    const clearedHidden=await page.evaluate(()=>getComputedStyle(document.getElementById("clearFilters")).visibility==="hidden");
    if(!clearedHidden)throw new Error("Reset must hide again once no filters are active");
  }

  // ================= MATRIX (TABLE VIEW) =================
  {
    const row=await page.evaluate(()=>{
      const r=document.querySelector('.scene-row[data-scene-id="s1"]');
      const text=r.querySelector(".time-cell").textContent;
      return {
        containsChapterTitle:text.includes("Глава 1"),
        containsParticipantEmoji:text.includes("👥"),
        containsCharacterName:text.includes("Анна"),
        tagChipCount:r.querySelectorAll(".scene-meta .tag-chip:not(.tag-count-chip)").length,
        hasTagCountChip:!!r.querySelector(".tag-count-chip"),
        title:r.querySelector(".scene-title").textContent,
        dateText:r.querySelector(".scene-chronology-chip").textContent,
        locationText:text.includes("Дом"),
        writingChip:!!r.querySelector(".writing-chip"),
        hasOnMeBadgeText:text.includes("На месте")||text.includes("Разместить"),
        hiddenPlacementLabel:r.querySelector(".visually-hidden")?.textContent||""
      };
    });
    if(row.containsChapterTitle)throw new Error("Scene cell must not repeat the chapter title");
    if(row.containsParticipantEmoji||row.containsCharacterName)throw new Error("Scene cell must not repeat the participant list");
    if(row.tagChipCount>0)throw new Error(`Scene cell must not list full tags, found ${row.tagChipCount} loose tag chips`);
    if(!row.hasTagCountChip)throw new Error("Scene cell with tags should show a compact tag count instead");
    if(!row.title.includes("Сцена А"))throw new Error(`Scene title missing/wrong: ${row.title}`);
    if(!row.dateText.includes("2026"))throw new Error(`Date/time summary missing: ${row.dateText}`);
    if(!row.locationText)throw new Error("Location missing from scene cell");
    if(!row.writingChip)throw new Error("Writing status missing from scene cell");
    if(row.hasOnMeBadgeText)throw new Error('Permanent "На месте"/"Разместить" text badge must be removed');
    if(!row.hiddenPlacementLabel)throw new Error("Placement state must still be exposed to assistive tech");
  }
  {
    const review=await page.evaluate(()=>{
      const needsReview=document.querySelector('.scene-row[data-scene-id="s2"] .date-review-toggle');
      const reviewed=document.querySelector('.scene-row[data-scene-id="s3"] .date-review-toggle');
      return {
        needsReviewAria:needsReview?.getAttribute("aria-label")||"",
        needsReviewClass:needsReview?.className||"",
        reviewedAria:reviewed?.getAttribute("aria-label")||"",
        reviewedClass:reviewed?.className||""
      };
    });
    // s2 has no date at all, so it carries no review affordance; s3 has a reviewed date.
    if(!review.reviewedAria.includes("проверена"))throw new Error(`Reviewed date indicator missing/wrong: ${JSON.stringify(review)}`);
  }
  {
    const actions=await page.evaluate(()=>{
      const r=document.querySelector('.scene-row[data-scene-id="s1"]');
      return [...r.querySelectorAll(".row-actions button")].map(b=>({text:b.textContent.trim(),aria:b.getAttribute("aria-label")}));
    });
    const textBtn=actions.find(a=>a.aria?.includes("текст сцены"));
    const editBtn=actions.find(a=>a.aria?.includes("Изменить сцену"));
    const deleteBtn=actions.find(a=>a.aria?.includes("Удалить сцену"));
    if(!textBtn||textBtn.text.length>2)throw new Error(`Text action must be a compact icon with an accessible name: ${JSON.stringify(actions)}`);
    if(!editBtn||editBtn.text.length>2)throw new Error(`Edit action must be a compact icon with an accessible name: ${JSON.stringify(actions)}`);
    if(!deleteBtn)throw new Error(`Delete action missing an accessible name: ${JSON.stringify(actions)}`);
  }
  {
    // Character cells (kept as-is): action text must still render normally.
    const cellText=await page.evaluate(()=>document.querySelector('.scene-row[data-scene-id="s1"] .matrix-cell-content .matrix-action-text')?.textContent);
    if(!cellText||!cellText.includes("Делает что-то"))throw new Error(`Character cell action text regressed: ${cellText}`);
  }
  {
    const rowHeight=await page.evaluate(()=>document.querySelector('.scene-row[data-scene-id="s1"]').getBoundingClientRect().height);
    if(rowHeight>=220)throw new Error(`Scene row is not meaningfully denser than the pre-phase baseline: ${rowHeight}px`);
  }

  // ================= CARDS =================
  await page.click('[data-view="cards"]');
  await page.waitForSelector(".card-chapter-group");
  {
    const card=await page.evaluate(()=>{
      const el=document.querySelector('.compact-scene-card[data-scene-id="s1"]');
      const text=el.textContent;
      return {
        containsChapterTitle:text.includes("Глава 1"),
        hasOnMeBadgeText:text.includes("На месте"),
        borderLeftColor:getComputedStyle(el).borderLeftColor,
        hiddenPlacementLabel:el.querySelector(".visually-hidden")?.textContent||"",
        dateText:text.includes("2026"),
        locationText:text.includes("Дом"),
        writingChip:!!el.querySelector(".writing-chip"),
        participantChip:text.includes("Анна"),
        tagChipCount:el.querySelectorAll(".tag-chip:not(.tag-chip-more)").length,
        hasMoreTag:!!el.querySelector(".tag-chip-more")
      };
    });
    if(card.containsChapterTitle)throw new Error("Card must not repeat the chapter name");
    if(card.hasOnMeBadgeText)throw new Error('Card must not show a permanent "На месте" text badge');
    if(!card.hiddenPlacementLabel)throw new Error("Card placement state must still be exposed to assistive tech");
    if(!card.dateText||!card.locationText||!card.writingChip)throw new Error(`Card lost date/location/status: ${JSON.stringify(card)}`);
    if(!card.participantChip)throw new Error("Card should keep participants (no matrix columns exist in Cards view)");
    if(card.tagChipCount>2)throw new Error(`Card tags must be capped, found ${card.tagChipCount} full chips`);
    if(!card.hasMoreTag)throw new Error("Card with more than the cap of tags should show a '+N' indicator");
  }
  {
    const reorder=await page.evaluate(()=>{
      const el=document.querySelector('.compact-scene-card[data-scene-id="s1"]');
      return [...el.querySelectorAll(".card-actions button")].map(b=>({text:b.textContent.trim(),aria:b.getAttribute("aria-label")}));
    });
    if(!reorder.some(b=>b.aria?.includes("раньше")))throw new Error(`Card reorder must expose an "earlier" action: ${JSON.stringify(reorder)}`);
    if(!reorder.some(b=>b.aria?.includes("позже")))throw new Error(`Card reorder must expose a "later" action: ${JSON.stringify(reorder)}`);
    if(reorder.some(b=>b.text==="↑"||b.text==="↓"))throw new Error(`Card reorder must not use literal up/down glyphs: ${JSON.stringify(reorder)}`);
  }
  {
    // DnD / positional insertion still functions (light regression check; the full
    // contract lives in core-workspace-recomposition-browser.test.mjs).
    const edge=await page.evaluate(()=>{
      const btn=document.querySelector(".card-insert-edge");
      return btn?{present:true,tappable:btn.getBoundingClientRect().width>0}:{present:false};
    });
    if(!edge.present||!edge.tappable)throw new Error("Card insertion affordance regressed");
  }

  // ================= SCROLL ARCHITECTURE =================
  await page.click('[data-view="table"]');
  await page.waitForSelector(".scene-row");
  {
    const scroll=await page.evaluate(()=>{
      const vp=document.querySelector(".viewport");
      const sidebar=document.querySelector(".project-sidebar");
      return {
        viewportHasNoVerticalOverflow:vp.scrollHeight===vp.clientHeight,
        viewportCanScrollHorizontally:getComputedStyle(vp).overflowX==="auto",
        sidebarScrollable:getComputedStyle(sidebar).overflowY!=="visible"
      };
    });
    if(!scroll.viewportHasNoVerticalOverflow)throw new Error("Workspace viewport must not introduce its own nested vertical scrollbar any more");
    if(!scroll.viewportCanScrollHorizontally)throw new Error("Workspace viewport must keep its own horizontal scroll for wide matrices");
    if(!scroll.sidebarScrollable)throw new Error("Sidebar must keep its own (legitimate) internal scroll");
  }

  console.log("Workspace density & navigation browser tests passed");
}finally{await browser.close();server.kill()}
