import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Regression coverage for the fix/core-final-visual-polish pass (local review
// on top of fix/core-local-review-feedback @ 335d7f9): sidebar starting under
// the app header and filling the viewport height, hover-intent on the table
// insertion "+" (no permanent circles, no jitter), the global filter Reset
// sitting after every filter field, "Статус" replacing "Написание", the
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

  // ================= INSERTION: REST STATE, HOVER-INTENT, NO JITTER (17-23) =================
  {
    const restOpacities=await page.evaluate(()=>[...document.querySelectorAll(".position-plus")].map(el=>getComputedStyle(el).opacity));
    if(restOpacities.some(o=>o!=="0"))throw new Error(`Insertion "+" is visible at rest somewhere: ${JSON.stringify(restOpacities)}`);

    const target='.scene-position-row[data-position-kind="between"] .scene-position-btn';
    await page.hover(target);
    await page.waitForTimeout(40); // shorter than the hover-intent delay
    const quickPass=await page.evaluate(sel=>document.querySelector(sel).closest(".scene-position-row").classList.contains("hover-intent"),target);
    await page.mouse.move(10,10);
    await page.waitForTimeout(20);
    if(quickPass)throw new Error("A brief pointer pass revealed the insertion affordance before the hover-intent delay elapsed");

    const rowsBefore=await page.evaluate(()=>[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>r.getBoundingClientRect().top));
    await page.hover(target);
    await page.waitForTimeout(400); // past the hover-intent delay + reveal transition
    const revealed=await page.evaluate(sel=>{
      const row=document.querySelector(sel).closest(".scene-position-row");
      return {hasClass:row.classList.contains("hover-intent"),opacity:getComputedStyle(row.querySelector(".position-plus")).opacity};
    },target);
    if(!revealed.hasClass||revealed.opacity!=="1")throw new Error(`Intentional hover did not reveal the insertion affordance: ${JSON.stringify(revealed)}`);
    const rowsAfter=await page.evaluate(()=>[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>r.getBoundingClientRect().top));
    for(let i=0;i<rowsBefore.length;i++)if(rowsBefore[i]!==rowsAfter[i])throw new Error(`Revealing the insertion affordance moved scene row ${i}: ${rowsBefore[i]} -> ${rowsAfter[i]}`);
    await page.mouse.move(10,10);
    await page.waitForTimeout(20);

    // Keyboard focus reveals with no artificial hover-intent delay (still animates
    // over the same short opacity transition as everything else here).
    await page.focus(target);
    await page.waitForTimeout(200);
    const focusRevealed=await page.evaluate(sel=>getComputedStyle(document.querySelector(sel).parentElement.querySelector(".position-plus")).opacity,target);
    if(focusRevealed!=="1")throw new Error("Keyboard focus did not reveal the insertion affordance");
    await page.keyboard.press("Escape");

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
