import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Regression coverage for the fix/core-final-visual-polish pass (local review
// on top of fix/core-local-review-feedback @ 335d7f9): sidebar starting under
// the app header and filling the viewport height, plain-hover reveal on the
// table insertion "+" (no permanent circles, no jitter), the global filter
// Reset sitting after every filter field, "Статус" replacing "Написание", the
// bottom horizontal scroll rail, the two-row sticky matrix header (character
// columns + current chapter) and its chapter-to-chapter handoff, and genuinely
// empty nonparticipant matrix cells.

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
function project(){
  // 10 characters (wide enough to force horizontal overflow at 1440px) and two
  // real chapters, the first long enough (16 scenes) to force real vertical
  // scroll past one viewport height before reaching the second chapter.
  const characters=[
    {id:"zayn",name:"Зейн"},{id:"rene",name:"Рене"},
    ...Array.from({length:8},(_,i)=>({id:`extra${i}`,name:`Персонаж ${i+3}`}))
  ];
  const makeScenes=(chapterId,count,startIdx)=>Array.from({length:count},(_,i)=>{
    const idx=startIdx+i;
    const people={};
    if(i%3===0)people.zayn=emptyPerson();
    if(i%2===0)people.rene={action:"Разговаривает с Зейном о плане",legacyState:"",relationChanges:{},visibleRelations:[]};
    return {id:`s-${chapterId}-${i}`,title:`Сцена ${idx}`,date:"",time:"",dateReview:false,chapterId,
      locationId:"",tags:i%4===0?["tag-wasabi"]:[],writingStatus:["idea","plan","draft","edit1","edit2","final"][i%6],
      sceneText:"",included:true,status:i%2===0?"fixed":"floating",people};
  });
  return {version:11,characters,profiles:{},
    chapters:[
      {id:"chapter-unassigned",title:"Без главы",collapsed:false},
      {id:"chapter-a",title:"Глава 1. Пятница, вечер",collapsed:false},
      {id:"chapter-b",title:"Глава 2. Суббота, утро",collapsed:false}
    ],
    locations:[],tags:[{id:"tag-wasabi",name:"васаби"},{id:"tag-dice",name:"Игральная кость"}],future:{},
    scenes:[...makeScenes("chapter-a",16,1),...makeScenes("chapter-b",6,17)]};
}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project());
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // ================= SIDEBAR (1,2,5,6) =================
  {
    const geo=await page.evaluate(()=>{
      const header=document.querySelector("header");
      const sidebar=document.querySelector(".project-sidebar");
      const dashboard=document.getElementById("projectDashboard");
      const banner=document.getElementById("storageBanner");
      return {
        headerBottom:header.getBoundingClientRect().bottom,
        sidebarTop:sidebar.getBoundingClientRect().top,
        sidebarBottom:sidebar.getBoundingClientRect().bottom,
        dashboardTop:dashboard.getBoundingClientRect().top,
        bannerInsideMain:document.querySelector(".main-workspace")?.contains(banner),
        viewportHeight:window.innerHeight
      };
    });
    if(geo.sidebarTop-geo.headerBottom>16)throw new Error(`Blank strip remains above the sidebar: header bottom ${geo.headerBottom}, sidebar top ${geo.sidebarTop}`);
    if(geo.sidebarTop>=geo.dashboardTop)throw new Error(`Sidebar should start at/above Project Overview, not be pinned to its (banner-pushed) top: sidebarTop=${geo.sidebarTop} dashboardTop=${geo.dashboardTop}`);
    if(!geo.bannerInsideMain)throw new Error("Storage banner should live inside .main-workspace so it no longer pushes the sidebar down with it");
    if(geo.viewportHeight-geo.sidebarBottom>24)throw new Error(`Sidebar does not reach near the viewport bottom: bottom=${geo.sidebarBottom} viewport=${geo.viewportHeight}`);
    const collapseGeometry=await page.evaluate(()=>{
      const collapseBtn=document.getElementById("toggleNavigation");
      const header=document.querySelector(".sidebar-header");
      return {isHeaderChild:header.contains(collapseBtn)};
    });
    if(!collapseGeometry.isHeaderChild)throw new Error("Collapse control is not a structural child of the sidebar header");
    await page.focus("#toggleNavigation");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
    const collapsed=await page.evaluate(()=>({
      sidebarHidden:getComputedStyle(document.querySelector(".project-sidebar")).display==="none",
      reopenVisible:document.getElementById("toggleNavigationReopen").offsetParent!==null
    }));
    if(!collapsed.sidebarHidden||!collapsed.reopenVisible)throw new Error(`Collapsed state broken: ${JSON.stringify(collapsed)}`);
    await page.focus("#toggleNavigationReopen");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
  }

  // ================= FILTERS: EMPTY STATE PARITY (7,8) =================
  {
    const styles=await page.evaluate(()=>{
      const ids=["filterChapter","filterCharacter","filterLocation","filterTag","filterWriting","filterPlacement"];
      return Object.fromEntries(ids.map(id=>{
        const el=document.getElementById(id);
        const cs=getComputedStyle(el);
        return [id,{bg:cs.backgroundColor,border:cs.borderColor}];
      }));
    });
    const reference=styles.filterChapter;
    for(const id of ["filterCharacter","filterTag","filterLocation","filterWriting","filterPlacement"]){
      if(styles[id].bg!==reference.bg||styles[id].border!==reference.border)
        throw new Error(`Empty ${id} does not visually match other empty filters: ${JSON.stringify(styles[id])} vs ${JSON.stringify(reference)}`);
    }
  }

  // ================= FILTERS: HOVER TRANSIENT, ACTIVE DISTINCT (9,10) =================
  {
    const emptyBorder=await page.evaluate(()=>getComputedStyle(document.getElementById("filterLocation")).borderColor);
    await page.hover("#filterLocation");
    await page.waitForTimeout(50);
    const hoverBorder=await page.evaluate(()=>getComputedStyle(document.getElementById("filterLocation")).borderColor);
    await page.mouse.move(10,10);
    await page.waitForTimeout(200);
    const afterBorder=await page.evaluate(()=>getComputedStyle(document.getElementById("filterLocation")).borderColor);
    if(hoverBorder===emptyBorder)throw new Error("Hovering a filter control produced no visible transient change");
    if(afterBorder!==emptyBorder)throw new Error("Hover state on a filter control did not revert once the pointer left");
  }

  // ================= FILTERS: GLOBAL RESET POSITION + NO SHIFT (11,13,14) =================
  {
    // Reset is grouped with the last filter field (Placement) into one wrapping
    // unit — see .filter-field-tail in index.html/layout.css — so it's still the
    // very last interactive filter control in DOM/tab order, just not a direct
    // child of .search-row any more.
    const domOrder=await page.evaluate(()=>{
      const all=[...document.querySelectorAll('.search-row [id^="filter"], .search-row #clearFilters')].map(el=>el.id);
      return all[all.length-1];
    });
    if(domOrder!=="clearFilters")throw new Error(`Reset is not last in DOM order: ${domOrder}`);
    const before=await page.evaluate(()=>({
      chapter:document.getElementById("filterChapter").getBoundingClientRect().left,
      character:document.getElementById("filterCharacter").getBoundingClientRect().left,
      resetHidden:getComputedStyle(document.getElementById("clearFilters")).visibility==="hidden"
    }));
    if(!before.resetHidden)throw new Error("Reset should be hidden while no filters are active");
    await page.click(".filter-multi-trigger"); // Character trigger (first multi field)
    await page.waitForSelector("#filterCharacterPopover:not([hidden])");
    await page.click('#filterCharacterList [role="option"][data-value="zayn"]');
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    const after=await page.evaluate(()=>({
      chapter:document.getElementById("filterChapter").getBoundingClientRect().left,
      character:document.getElementById("filterCharacter").getBoundingClientRect().left,
      resetHidden:getComputedStyle(document.getElementById("clearFilters")).visibility==="hidden",
      resetLeft:document.getElementById("clearFilters").getBoundingClientRect().left,
      characterRight:document.getElementById("filterCharacter").getBoundingClientRect().right
    }));
    if(after.resetHidden)throw new Error("Reset should appear once a filter is active");
    if(Math.abs(after.chapter-before.chapter)>2)throw new Error(`Selecting a character shifted the Chapter control: ${before.chapter} -> ${after.chapter}`);
    if(Math.abs(after.character-before.character)>2)throw new Error(`Selecting a character shifted the Character control's own position: ${before.character} -> ${after.character}`);
    if(after.resetLeft<after.characterRight)throw new Error("Reset renders before/overlapping a filter field instead of after all of them");
  }

  // ================= FILTERS: MULTI CHARACTER/TAG AND SEMANTICS STILL WORK (12) =================
  {
    await page.click(".filter-multi-trigger");
    await page.waitForSelector("#filterCharacterPopover:not([hidden])");
    await page.click('#filterCharacterList [role="option"][data-value="rene"]');
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
    const visible=await page.evaluate(()=>getVisibleSceneEntries().length);
    const totalWithBoth=await page.evaluate(()=>data.scenes.filter(s=>s.people.zayn&&s.people.rene).length);
    if(visible!==totalWithBoth||visible===0)throw new Error(`Multi-character AND filter broken: visible=${visible} expected=${totalWithBoth}`);
    await page.click("#clearFilters");
    await page.waitForTimeout(60);
  }

  // ================= TERMINOLOGY: СТАТУС, NOT НАПИСАНИЕ (15,16) =================
  {
    const bodyText=await page.evaluate(()=>document.querySelector(".search-row").textContent);
    if(bodyText.includes("Написание"))throw new Error("Filter bar still shows the old «Написание» label");
    const label=await page.evaluate(()=>document.querySelector("#filterWriting .filter-trigger-text").textContent.trim());
    if(label!=="Статус")throw new Error(`Writing-status filter should read "Статус", got "${label}"`);
  }

  // ================= INSERTION: REST STATE, PLAIN HOVER, NO JITTER (17-23) =================
  // No JS hover-intent delay any more (see js/matrix-sticky.js history / css/timeline.css):
  // the row's own box never changes size on hover, so a bare :hover/:focus-within reveal
  // carries no layout cost and the extra JS timer bought nothing once the real cause of
  // the "always-visible circle" complaint (a stale .insert-content button CSS rule) was
  // fixed at the root. Reveal is now immediate on hover/focus.
  {
    const restOpacities=await page.evaluate(()=>[...document.querySelectorAll(".position-plus")].map(el=>getComputedStyle(el).opacity));
    if(restOpacities.some(o=>o!=="0"))throw new Error(`Insertion "+" is visible at rest somewhere: ${JSON.stringify(restOpacities)}`);
    const restBackgrounds=await page.evaluate(()=>[...document.querySelectorAll(".scene-position-btn")].map(el=>getComputedStyle(el).backgroundColor));
    if(restBackgrounds.some(bg=>bg!=="rgba(0, 0, 0, 0)"))throw new Error(`Insertion trigger has a visible background at rest somewhere: ${JSON.stringify(restBackgrounds)}`);

    const target='.scene-position-row[data-position-kind="between"] .scene-position-btn';
    const rowsBefore=await page.evaluate(()=>[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>r.getBoundingClientRect().top));
    await page.hover(target);
    await page.waitForTimeout(220); // no artificial delay any more — just past the --motion-base(160ms) transition
    const revealed=await page.evaluate(sel=>getComputedStyle(document.querySelector(sel).querySelector(".position-plus")).opacity,target);
    if(revealed!=="1")throw new Error(`Hover did not immediately reveal the insertion affordance: ${revealed}`);
    const rowsAfter=await page.evaluate(()=>[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>r.getBoundingClientRect().top));
    for(let i=0;i<rowsBefore.length;i++)if(rowsBefore[i]!==rowsAfter[i])throw new Error(`Revealing the insertion affordance moved scene row ${i}: ${rowsBefore[i]} -> ${rowsAfter[i]}`);
    await page.mouse.move(10,10);
    await page.waitForTimeout(220);
    const restoredOpacity=await page.evaluate(sel=>getComputedStyle(document.querySelector(sel).querySelector(".position-plus")).opacity,target);
    if(restoredOpacity!=="0")throw new Error(`Insertion affordance stayed visible after the pointer moved away: ${restoredOpacity}`);

    // Keyboard focus reveals identically — via real Tab navigation, not a
    // scripted page.focus() call. Since 0d28b30 the reveal is driven by
    // :focus-visible rather than :focus-within (css/timeline.css), precisely
    // so that focus RESTORED programmatically (e.g. by the modal manager
    // after a mouse-driven Cancel) does not leave the "+" looking stuck open.
    // A scripted .focus() is exactly that kind of programmatic focus and is
    // not guaranteed to satisfy :focus-visible — only genuine keyboard input
    // reliably does. See tools/scene-position-plus-interaction-browser.test.mjs
    // for the fuller contract (this same reveal check plus the mouse-driven
    // Cancel case) across Matrix/Cards/Compact.
    await page.evaluate(()=>document.activeElement?.blur?.());
    let tabbedToTarget=false;
    for(let i=0;i<400;i++){
      await page.keyboard.press("Tab");
      const matched=await page.evaluate(sel=>document.activeElement?.matches?.(sel)||false,target);
      if(matched){tabbedToTarget=true;break}
    }
    if(!tabbedToTarget)throw new Error("Could not reach the insertion control via real Tab navigation");
    await page.waitForTimeout(220);
    const focusRevealed=await page.evaluate(sel=>getComputedStyle(document.querySelector(sel).parentElement.querySelector(".position-plus")).opacity,target);
    if(focusRevealed!=="1")throw new Error("Keyboard focus did not reveal the insertion affordance");
    // ...and it's genuinely operable via the keyboard, not just visually revealed.
    await page.keyboard.press("Enter");
    if(!await page.locator("#sceneModal").isVisible())throw new Error("Enter on the Tab-focused insertion control did not open Create Scene");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    if(await page.locator("#discardChangesModal").isVisible()){await page.click("#discardChanges");await page.waitForTimeout(80)}

    const labels=await page.evaluate(()=>[...document.querySelectorAll('[data-action="insert-scene"][data-chapter-id="chapter-a"]')].map(b=>b.getAttribute("aria-label")));
    if(labels.length!==17)throw new Error(`Expected N+1=17 insertion positions for 16 chapter-a scenes, got ${labels.length}`);
  }

  // ================= INSERTION: VIEWPORT CENTERING PRESERVED (24,25) =================
  {
    const viewport=await page.$(".viewport.workspace-viewport");
    const reading=async()=>page.evaluate(()=>{
      const vp=document.querySelector(".viewport.workspace-viewport");
      const btn=document.querySelector(".scene-position-row .scene-position-btn");
      const vpRect=vp.getBoundingClientRect(),btnRect=btn.getBoundingClientRect();
      return {offset:Math.abs((btnRect.left+btnRect.width/2)-(vpRect.left+vpRect.width/2)),withinViewport:btnRect.left>=vpRect.left-2&&btnRect.right<=vpRect.right+2};
    });
    for(const fraction of [0,0.5,1]){
      await viewport.evaluate((el,f)=>{el.scrollLeft=Math.round((el.scrollWidth-el.clientWidth)*f);el.dispatchEvent(new Event("scroll"))},fraction);
      await page.waitForTimeout(60);
      const r=await reading();
      if(r.offset>4)throw new Error(`Insertion "+" not centered on the visible viewport at scroll fraction ${fraction}: ${JSON.stringify(r)}`);
      if(!r.withinViewport)throw new Error(`Insertion "+" rendered outside the visible viewport at fraction ${fraction}`);
    }
    await viewport.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event("scroll"))});
  }

  // ================= HORIZONTAL SCROLL RAIL (26-30) =================
  {
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(80);
    const initial=await page.evaluate(()=>{updateMatrixSticky();const rail=document.querySelector(".matrix-scroll-rail");return {hidden:rail===null||rail.hidden}});
    // Not scrolled yet, but the rail should already be usable (horizontal overflow exists and the matrix is on screen) — it must not require scrolling to the final chapter first.
    if(initial.hidden)throw new Error("Horizontal scroll rail is not available even though the matrix is on screen and overflows horizontally");
    const railRect=await page.evaluate(()=>{const r=document.querySelector(".matrix-scroll-rail").getBoundingClientRect();return {bottom:r.bottom,top:r.top,innerHeight:window.innerHeight}});
    if(railRect.bottom<railRect.innerHeight-40)throw new Error(`Rail is not anchored near the viewport bottom: ${JSON.stringify(railRect)}`);

    const viewport=await page.$(".viewport.workspace-viewport");
    await page.evaluate(()=>{const rail=document.querySelector(".matrix-scroll-rail");rail.scrollLeft=300;rail.dispatchEvent(new Event("scroll"))});
    await page.waitForTimeout(60);
    const vpLeftAfterRailScroll=await viewport.evaluate(el=>el.scrollLeft);
    if(Math.abs(vpLeftAfterRailScroll-300)>2)throw new Error(`Scrolling the rail did not move the matrix: viewport.scrollLeft=${vpLeftAfterRailScroll}`);

    await viewport.evaluate(el=>{el.scrollLeft=600;el.dispatchEvent(new Event("scroll"))});
    await page.waitForTimeout(60);
    const railLeftAfterMatrixScroll=await page.evaluate(()=>{updateMatrixSticky();return document.querySelector(".matrix-scroll-rail").scrollLeft});
    if(Math.abs(railLeftAfterMatrixScroll-600)>2)throw new Error(`Scrolling the matrix did not move the rail: rail.scrollLeft=${railLeftAfterMatrixScroll}`);
    await viewport.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event("scroll"))});

    // Rail disappears once the matrix is no longer the relevant surface (e.g. a
    // different view), rather than floating on over whatever replaces it.
    await page.click('#viewSwitch button[data-view="cards"]');
    await page.waitForTimeout(80);
    const inCardsView=await page.evaluate(()=>{updateMatrixSticky();return document.querySelector(".matrix-scroll-rail").hidden});
    if(!inCardsView)throw new Error("Rail remains visible after switching away from the table view, floating over unrelated content");
    await page.click('#viewSwitch button[data-view="table"]');
    await page.waitForTimeout(80);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(60);
  }

  // ================= STICKY MATRIX HEADER (31-37) =================
  {
    const header=await page.evaluate(()=>{updateMatrixSticky();return {
      overlayHidden:document.querySelector(".matrix-sticky-overlay").hidden,
      boardHeadInBoard:!!document.querySelector("#board > .board-head")
    }});
    if(header.overlayHidden!==true||!header.boardHeadInBoard)throw new Error(`Sticky overlay should be inactive before scrolling: ${JSON.stringify(header)}`);

    await page.evaluate(()=>window.scrollTo(0,700));
    await page.waitForTimeout(100);
    const pinned=await page.evaluate(()=>{
      updateMatrixSticky();
      const overlay=document.querySelector(".matrix-sticky-overlay");
      const headerBottom=document.querySelector("header").getBoundingClientRect().bottom;
      const overlayRect=overlay.getBoundingClientRect();
      const chapterText=overlay.querySelector(".chapter-divider")?.textContent||"";
      return {
        hidden:overlay.hidden,
        topMatchesHeader:Math.abs(overlayRect.top-headerBottom)<2,
        hasHeadRow:!!overlay.querySelector(".board-head"),
        chapterText,
        boardHeadRemovedFromFlow:!document.querySelector("#board > .board-head")
      };
    });
    if(pinned.hidden)throw new Error("Sticky overlay did not activate after scrolling past the matrix header");
    if(!pinned.topMatchesHeader)throw new Error("Sticky overlay is not docked flush under the application header");
    if(!pinned.hasHeadRow)throw new Error("Sticky overlay is missing the character header row");
    if(!pinned.boardHeadRemovedFromFlow)throw new Error("Character header row appears both pinned and still in normal flow (duplicate)");
    if(!pinned.chapterText.includes("Глава 1"))throw new Error(`Sticky overlay chapter row shows the wrong chapter: ${pinned.chapterText}`);

    // Horizontal scroll keeps character columns aligned with the pinned header.
    const viewport=await page.$(".viewport.workspace-viewport");
    await viewport.evaluate(el=>{el.scrollLeft=400;el.dispatchEvent(new Event("scroll"))});
    await page.waitForTimeout(80);
    const aligned=await page.evaluate(()=>{
      updateMatrixSticky();
      const sceneRow=document.querySelector(".scene-row[data-scene-id]");
      const sceneCell=sceneRow.children[2];
      const overlayHead=document.querySelector(".matrix-sticky-head-scroll .board-head");
      const overlayCell=overlayHead.children[2];
      return Math.abs(sceneCell.getBoundingClientRect().left-overlayCell.getBoundingClientRect().left);
    });
    if(aligned>2)throw new Error(`Pinned character columns drift out of alignment with the matrix on horizontal scroll: ${aligned}px`);
    await viewport.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event("scroll"))});

    // Scrolling into chapter 2 hands the sticky chapter row off from chapter 1.
    const chapterBTop=await page.evaluate(()=>{
      const div=[...document.querySelectorAll("#board > .insert-row[data-chapter-id]")].find(d=>d.dataset.chapterId==="chapter-b");
      return div.getBoundingClientRect().top+window.scrollY;
    });
    await page.evaluate(y=>window.scrollTo(0,y),chapterBTop+30);
    await page.waitForTimeout(100);
    const handoff=await page.evaluate(()=>{updateMatrixSticky();return document.querySelector(".matrix-sticky-overlay .chapter-divider")?.textContent||""});
    if(!handoff.includes("Глава 2"))throw new Error(`Sticky chapter row did not hand off to chapter 2: "${handoff}"`);

    // Scrolling back to the top restores both real nodes to their original flow position (no leftover duplicates).
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(100);
    const restored=await page.evaluate(()=>{
      updateMatrixSticky();
      return {
        overlayHidden:document.querySelector(".matrix-sticky-overlay").hidden,
        boardHeadCount:document.querySelectorAll(".board-head").length,
        dividerCount:document.getElementById("board").querySelectorAll(":scope > .insert-row[data-chapter-id]").length
      };
    });
    if(!restored.overlayHidden)throw new Error("Sticky overlay stayed active after scrolling back to the top");
    if(restored.boardHeadCount!==1)throw new Error(`Expected exactly one .board-head after restoring, found ${restored.boardHeadCount}`);
    if(restored.dividerCount!==3)throw new Error(`Expected exactly 3 chapter dividers after restoring, found ${restored.dividerCount}`);
  }

  // ================= CHAPTER TITLE STAYS FIXED LEFT ON HORIZONTAL SCROLL =================
  // Covers both the natural in-flow divider (page not yet scrolled far enough to
  // vertically pin the sticky overlay) and the pinned overlay copy — see
  // .chapter-identity in css/layout.css.
  {
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(60);
    const viewport=await page.$(".viewport.workspace-viewport");
    // Raw viewport-relative left — NOT measured relative to #board's own rect,
    // since #board IS the horizontally-scrolled content and its own left edge
    // moves with scrollLeft; a sticky element correctly holding its position
    // in viewport-space would otherwise misreport as "drifting" by exactly the
    // scroll delta once #board's shift is subtracted back in.
    const identityLeftInFlow=async()=>page.evaluate(()=>
      document.querySelector("#board > .insert-row[data-chapter-id] .chapter-identity").getBoundingClientRect().left
    );
    const before=await identityLeftInFlow();
    await viewport.evaluate(el=>{el.scrollLeft=500;el.dispatchEvent(new Event("scroll"))});
    await page.waitForTimeout(60);
    const after=await identityLeftInFlow();
    if(Math.abs(after-before)>2)throw new Error(`Chapter title drifted with the matrix's own horizontal scroll instead of staying fixed left: before=${before} after=${after}`);
    const stillOnScreen=await page.evaluate(()=>{
      const identity=document.querySelector("#board > .insert-row[data-chapter-id] .chapter-identity");
      const r=identity.getBoundingClientRect();
      return r.left>=0&&r.left<window.innerWidth;
    });
    if(!stillOnScreen)throw new Error("Chapter title scrolled off-screen to the left");
    await viewport.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event("scroll"))});

    // Same check once vertically pinned (sticky overlay active).
    await page.evaluate(()=>window.scrollTo(0,700));
    await page.waitForTimeout(80);
    await page.evaluate(()=>updateMatrixSticky());
    const pinnedBefore=await page.evaluate(()=>document.querySelector(".matrix-sticky-chapter-row .chapter-identity").getBoundingClientRect().left);
    await viewport.evaluate(el=>{el.scrollLeft=500;el.dispatchEvent(new Event("scroll"))});
    await page.waitForTimeout(60);
    await page.evaluate(()=>updateMatrixSticky());
    const pinnedAfter=await page.evaluate(()=>document.querySelector(".matrix-sticky-chapter-row .chapter-identity").getBoundingClientRect().left);
    if(Math.abs(pinnedAfter-pinnedBefore)>2)throw new Error(`Pinned chapter title drifted with horizontal scroll: before=${pinnedBefore} after=${pinnedAfter}`);
    await viewport.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event("scroll"))});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(80);
  }

  // ================= VERTICAL SCROLL JITTER (matrix-sticky.js reparent thrash) =================
  // Regression guard for the local-review bug where matrix-sticky.js restored and
  // re-pinned the current chapter divider's REAL DOM node on every single scroll
  // frame (forcing a full grid reflow twice per tick), instead of only when the
  // current chapter actually changes. That showed up as jittery/jumping scroll,
  // worse with the pointer sitting over a scene row. Guard both the DOM-churn
  // count and that row geometry never jumps mid-scroll.
  {
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(60);
    await page.evaluate(()=>updateMatrixSticky());
    await page.mouse.move(300,400); // over a scene row — the reported jitter trigger
    const result=await page.evaluate(async()=>{
      const board=document.getElementById("board");
      const chapterRow=document.querySelector(".matrix-sticky-chapter-row");
      let mutations=0;
      const observer=new MutationObserver(muts=>{mutations+=muts.length});
      observer.observe(chapterRow,{childList:true});
      observer.observe(board,{childList:true});
      const rowsBefore=[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>r.getBoundingClientRect().top);
      let steps=0,maxJump=0;
      let prevRows=rowsBefore;
      for(let i=0;i<120;i++){
        window.scrollBy(0,15);
        updateMatrixSticky();
        steps++;
        const rows=[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>r.getBoundingClientRect().top);
        // Compare rows present in both frames (ignore ones that scrolled out) —
        // any row still on screen in consecutive frames should move by roughly
        // one scroll step (15px), never jump further from a reflow/reparent.
        for(let j=0;j<Math.min(rows.length,prevRows.length);j++){
          const delta=Math.abs((prevRows[j]-rows[j])-15);
          if(delta>maxJump)maxJump=delta;
        }
        prevRows=rows;
        if(window.scrollY+window.innerHeight>=document.body.scrollHeight-5)break;
      }
      await new Promise(r=>setTimeout(r,30));
      return {steps,mutations,maxJump,endY:window.scrollY};
    });
    if(result.maxJump>3)throw new Error(`Scene row geometry jumped mid-scroll (reflow/reparent thrash): maxJump=${result.maxJump}px over ${result.steps} steps`);
    // 3 chapter dividers total => at most a handful of real transitions, nowhere
    // near one reparent (or two) PER scroll frame, which is what the old
    // every-tick restore+re-pin design produced.
    if(result.mutations>20)throw new Error(`Chapter divider was reparented far more than the number of chapters allows (${result.mutations} DOM mutations over ${result.steps} scroll steps) — looks like the per-frame reparent regression`);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForTimeout(80);
  }

  // ================= EMPTY MATRIX CELLS (38-40) =================
  {
    const cells=await page.evaluate(()=>{
      const empty=document.querySelector(".matrix-cell-empty");
      const content=document.querySelector(".matrix-cell-content, .matrix-cell-noncontent");
      return {
        emptyHtml:empty?empty.innerHTML.trim():null,
        emptyAriaLabel:empty?empty.getAttribute("aria-label"):null,
        emptyBg:empty?getComputedStyle(empty).backgroundColor:null,
        contentHtml:content?content.innerHTML.trim():null
      };
    });
    if(cells.emptyHtml!=="")throw new Error(`Nonparticipant cell has visible content: "${cells.emptyHtml}"`);
    if(!cells.emptyAriaLabel||!cells.emptyAriaLabel.includes("не участвует"))throw new Error(`Nonparticipant cell lost its accessible label: "${cells.emptyAriaLabel}"`);
    if(cells.emptyBg!=="rgba(0, 0, 0, 0)")throw new Error(`Nonparticipant cell has a visible background: ${cells.emptyBg}`);
    if(!cells.contentHtml)throw new Error("A participant cell with content rendered nothing");
  }

  console.log("Core final visual polish browser tests passed");
}finally{await browser.close();server.kill()}
