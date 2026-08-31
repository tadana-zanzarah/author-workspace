import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Regression coverage for the fix/core-local-review-feedback pass: filter-label
// duplication, character/tag multi-select (AND semantics), the custom
// listbox/popover filter control (js/filter-controls.js), and the table-view
// insertion "+" (viewport-relative centering, zero layout shift on hover).
// core-production-polish-browser.test.mjs already covers a first slice of this
// (label duplication, one multi-select field, hover height-parity, sidebar
// structure); this file owns what that one doesn't: combined character+tag AND
// semantics, full keyboard/ARIA/click-outside coverage of the custom control,
// and viewport-centering across a genuinely scrollable many-character matrix.

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
function project(){
  // 12 characters (Зейн, Рене + 10 filler) so the matrix is wide enough to force
  // horizontal scroll at 1440px — the insertion "+" must stay centered on the
  // VISIBLE viewport at every scroll position, not the full ~3300px table width.
  const characters=[
    {id:"zayn",name:"Зейн"},{id:"rene",name:"Рене"},
    ...Array.from({length:10},(_,i)=>({id:`extra${i}`,name:`Персонаж ${i+3}`}))
  ];
  return {version:11,characters,profiles:{},
    chapters:[
      {id:"chapter-unassigned",title:"Без главы",collapsed:false},
      {id:"chapter-a",title:"Глава 1. Пятница, вечер",collapsed:false}
    ],
    locations:[],
    tags:[{id:"tag-wasabi",name:"васаби"},{id:"tag-dice",name:"Игральная кость"}],
    future:{},
    scenes:[
      // Has both characters AND both tags — the only scene that should survive a
      // combined {characters:[zayn,rene], tags:[wasabi,dice]} filter.
      {id:"s-both",title:"Оба и оба",date:"",time:"",dateReview:false,chapterId:"chapter-a",locationId:"",tags:["tag-wasabi","tag-dice"],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{zayn:emptyPerson(),rene:emptyPerson()}},
      // Has Зейн but not Рене — must drop out once both characters are selected.
      {id:"s-zayn-only",title:"Только Зейн",date:"",time:"",dateReview:false,chapterId:"chapter-a",locationId:"",tags:["tag-wasabi","tag-dice"],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{zayn:emptyPerson()}},
      // Has both characters but only one tag — must drop out once both tags are selected.
      {id:"s-one-tag",title:"Один тег",date:"",time:"",dateReview:false,chapterId:"chapter-a",locationId:"",tags:["tag-wasabi"],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{zayn:emptyPerson(),rene:emptyPerson()}},
      // Matches nothing.
      {id:"s-none",title:"Ничего",date:"",time:"",dateReview:false,chapterId:"chapter-a",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}}
    ]};
}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project());
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  const visibleTitles=async()=>page.evaluate(()=>getVisibleSceneEntries().map(({scene})=>scene.title).sort());
  const openPopover=async suffix=>{await page.click(`#filter${suffix}${suffix==="Character"||suffix==="Tag"?" .filter-multi-trigger":""}`.trim());await page.waitForSelector(`#filter${suffix}Popover:not([hidden])`)};
  const pick=async(suffix,value)=>page.click(`#filter${suffix}List [role="option"][data-value="${value}"]`);

  // ================= FILTER LABEL DUPLICATION =================
  {
    await openPopover("Chapter");
    const chapterTexts=await page.evaluate(()=>[...document.querySelectorAll('#filterChapterList [role="option"]')].map(o=>o.textContent.trim()));
    if(chapterTexts.some(t=>t.startsWith("Глава:")))throw new Error(`Chapter options repeat the category label: ${JSON.stringify(chapterTexts)}`);
    if(!chapterTexts.includes("Глава 1. Пятница, вечер"))throw new Error(`Missing plain chapter title option: ${JSON.stringify(chapterTexts)}`);
    await page.keyboard.press("Escape");

    const emptyLabel=await page.evaluate(()=>document.getElementById("filterCharacter").textContent.trim());
    if(emptyLabel!=="Персонаж")throw new Error(`Empty character filter should read just "Персонаж", got: "${emptyLabel}"`);
    await openPopover("Character");
    const charTexts=await page.evaluate(()=>[...document.querySelectorAll('#filterCharacterList [role="option"]')].map(o=>o.textContent.trim()));
    if(charTexts.some(t=>t.startsWith("Персонаж:")))throw new Error(`Character options repeat the category label: ${JSON.stringify(charTexts)}`);
    if(!charTexts.includes("Рене"))throw new Error(`Missing plain character name option: ${JSON.stringify(charTexts)}`);
    await pick("Character","rene");
    const oneSelectedLabel=await page.evaluate(()=>document.getElementById("filterCharacter").textContent.trim());
    if(oneSelectedLabel.includes("Персонаж:")||!oneSelectedLabel.includes("Рене"))
      throw new Error(`Single selection should read just the name, got: "${oneSelectedLabel}"`);
    await page.keyboard.press("Escape");
    // Individual clear (× on the chip) works on its own, global reset is separate.
    await page.click('#filterCharacter .filter-trigger-chip-remove[data-value="rene"]');
    await page.waitForTimeout(60);
    if((await page.evaluate(()=>filters.character.length))!==0)throw new Error("Per-chip × did not clear the character filter");
  }

  // ================= MULTI CHARACTER (AND) =================
  {
    await openPopover("Character");
    await pick("Character","zayn");
    await pick("Character","rene"); // multi-select stays open across picks
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
    if((await visibleTitles()).join(",")!=="Оба и оба,Один тег")
      throw new Error(`Character AND-filter should keep only scenes with BOTH selected characters: ${(await visibleTitles()).join(",")}`);
    // Remove one -> result updates to single-character semantics.
    await page.click('#filterCharacter .filter-trigger-chip-remove[data-value="rene"]');
    await page.waitForTimeout(60);
    if((await visibleTitles()).join(",")!=="Оба и оба,Один тег,Только Зейн")
      throw new Error(`Removing one character should widen back to single-character matches: ${(await visibleTitles()).join(",")}`);
    // Clear this filter only — leaves other (currently inactive) filters untouched.
    await page.click('#filterCharacter .filter-trigger-chip-remove[data-value="zayn"]');
    await page.waitForTimeout(60);
    if((await page.evaluate(()=>filters.character.length))!==0)throw new Error("Character filter did not fully clear");
  }

  // ================= MULTI TAG (AND) + COMBINED WITH CHARACTERS =================
  {
    await openPopover("Tag");
    await pick("Tag","tag-wasabi");
    await pick("Tag","tag-dice");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
    if((await visibleTitles()).join(",")!=="Оба и оба,Только Зейн")
      throw new Error(`Tag AND-filter should keep only scenes with BOTH selected tags: ${(await visibleTitles()).join(",")}`);
    // Combine with characters — AND across groups too: only the scene with both
    // characters AND both tags should remain.
    await openPopover("Character");
    await pick("Character","zayn");
    await pick("Character","rene");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
    if((await visibleTitles()).join(",")!=="Оба и оба")
      throw new Error(`Character+tag filters must AND together, got: ${(await visibleTitles()).join(",")}`);
    // Clear tag filter only — character filter (still 2 values) stays active.
    await page.click('#filterTag .filter-trigger-chip-remove[data-value="tag-wasabi"]');
    await page.click('#filterTag .filter-trigger-chip-remove[data-value="tag-dice"]');
    await page.waitForTimeout(60);
    const state=await page.evaluate(()=>({tag:filters.tag.length,character:[...filters.character].sort()}));
    if(state.tag!==0||state.character.join(",")!=="rene,zayn")throw new Error(`Clearing tag filter should not touch the character filter: ${JSON.stringify(state)}`);
    await page.click("#clearFilters");
    await page.waitForTimeout(60);
  }

  // ================= CUSTOM FILTER CONTROL: KEYBOARD / ARIA / CLICK-OUTSIDE =================
  {
    // Open via keyboard (ArrowDown on the closed trigger), navigate, select with Enter.
    await page.focus("#filterWriting");
    await page.keyboard.press("ArrowDown");
    await page.waitForSelector("#filterWritingPopover:not([hidden])");
    const ariaOnOpen=await page.evaluate(()=>({
      expanded:document.getElementById("filterWriting").getAttribute("aria-expanded"),
      haspopup:document.getElementById("filterWriting").getAttribute("aria-haspopup"),
      role:document.getElementById("filterWritingList").getAttribute("role")
    }));
    if(ariaOnOpen.expanded!=="true"||ariaOnOpen.haspopup!=="listbox"||ariaOnOpen.role!=="listbox")
      throw new Error(`Trigger/listbox ARIA contract broken on open: ${JSON.stringify(ariaOnOpen)}`);
    await page.keyboard.press("ArrowDown");await page.keyboard.press("ArrowDown");
    const activeBeforeEnter=await page.evaluate(()=>document.activeElement?.getAttribute("role"));
    if(activeBeforeEnter!=="option")throw new Error("Arrow-key navigation did not move focus onto an option");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
    const afterEnter=await page.evaluate(()=>({value:filters.writing,popoverHidden:document.getElementById("filterWritingPopover").hidden,triggerFocused:document.activeElement?.id==="filterWriting"}));
    if(!afterEnter.value)throw new Error("Enter did not select the active option");
    if(!afterEnter.popoverHidden)throw new Error("Selecting a single-value option must close the popover");
    if(!afterEnter.triggerFocused)throw new Error("Focus must return to the trigger after a single-value selection closes the popover");

    // Escape closes without changing the value.
    await page.click("#filterWriting");
    await page.waitForSelector("#filterWritingPopover:not([hidden])");
    await page.keyboard.press("Escape");
    const afterEscape=await page.evaluate(()=>({value:filters.writing,popoverHidden:document.getElementById("filterWritingPopover").hidden}));
    if(afterEscape.value!==afterEnter.value)throw new Error("Escape must not change the filter's value");
    if(!afterEscape.popoverHidden)throw new Error("Escape must close the popover");

    // Click-outside closes without changing the value.
    await page.click("#filterWriting");
    await page.waitForSelector("#filterWritingPopover:not([hidden])");
    await page.mouse.click(10,10);
    await page.waitForTimeout(60);
    const afterOutsideClick=await page.evaluate(()=>document.getElementById("filterWritingPopover").hidden);
    if(!afterOutsideClick)throw new Error("Clicking outside the popover must close it");

    // Selected state uses the design-system accent, not native browser-blue.
    await page.click("#filterWriting");
    await page.waitForSelector("#filterWritingPopover:not([hidden])");
    const selectedBg=await page.evaluate(()=>{
      const opt=document.querySelector('#filterWritingList [role="option"][aria-selected="true"]');
      return opt?getComputedStyle(opt).backgroundColor:null;
    });
    if(!selectedBg)throw new Error("No option reports aria-selected=true for the active value");
    if(/^rgb\(0, (0, 238|122, 255|120, 215)\)$/.test(selectedBg))throw new Error(`Selected option still uses system/browser blue: ${selectedBg}`);
    await page.keyboard.press("Escape");
    await page.click("#clearFilters");
  }

  // ================= INSERTION: N+1, ZERO LAYOUT SHIFT =================
  {
    const labels=await page.evaluate(()=>[...document.querySelectorAll('[data-action="insert-scene"]')].map(b=>b.getAttribute("aria-label")));
    // 4 scenes in chapter-a -> N+1 = 5 positions (before-first, 3x between, after-last).
    const forChapterA=labels.filter(l=>/Оба и оба|Только Зейн|Один тег|Ничего|Глава 1/.test(l));
    if(forChapterA.length!==5)throw new Error(`Expected 5 N+1 insertion positions for 4 scenes, got ${forChapterA.length}: ${JSON.stringify(forChapterA)}`);

    const rows=await page.evaluate(()=>[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>({id:r.dataset.sceneId,top:r.getBoundingClientRect().top})));
    await page.hover('.scene-position-row[data-position-kind="before-first"] .scene-position-btn');
    const rowsAfterHover=await page.evaluate(()=>[...document.querySelectorAll(".scene-row[data-scene-id]")].map(r=>({id:r.dataset.sceneId,top:r.getBoundingClientRect().top})));
    for(let i=0;i<rows.length;i++){
      if(rows[i].top!==rowsAfterHover[i].top)
        throw new Error(`Hovering an insertion gap moved scene row ${rows[i].id}: ${rows[i].top} -> ${rowsAfterHover[i].top}`);
    }
    const boardHeightBefore=await page.evaluate(()=>document.getElementById("board").getBoundingClientRect().height);
    await page.hover('.scene-position-btn[data-before-scene-id="s-zayn-only"]');
    const boardHeightAfter=await page.evaluate(()=>document.getElementById("board").getBoundingClientRect().height);
    if(boardHeightBefore!==boardHeightAfter)throw new Error(`Hover changed the matrix's total height: ${boardHeightBefore} -> ${boardHeightAfter}`);
    await page.mouse.move(0,0);
  }

  // ================= INSERTION: VIEWPORT-CENTERED ON A WIDE, SCROLLABLE MATRIX =================
  {
    const viewport=await page.$(".viewport.workspace-viewport");
    const reading=async()=>page.evaluate(()=>{
      const vp=document.querySelector(".viewport.workspace-viewport");
      const btn=document.querySelector(".scene-position-row .scene-position-btn");
      const vpRect=vp.getBoundingClientRect(),btnRect=btn.getBoundingClientRect();
      return {
        offset:Math.abs((btnRect.left+btnRect.width/2)-(vpRect.left+vpRect.width/2)),
        scrollLeft:vp.scrollLeft,maxScroll:vp.scrollWidth-vp.clientWidth,
        withinViewport:btnRect.left>=vpRect.left-2&&btnRect.right<=vpRect.right+2
      };
    });
    const atStart=await reading();
    if(atStart.maxScroll<=0)throw new Error("Fixture did not produce a horizontally scrollable matrix (need more character columns)");
    for(const fraction of [0,0.5,1]){
      await viewport.evaluate((el,f)=>{el.scrollLeft=Math.round((el.scrollWidth-el.clientWidth)*f);el.dispatchEvent(new Event("scroll"))},fraction);
      await page.waitForTimeout(60);
      const r=await reading();
      if(r.offset>4)throw new Error(`Insertion "+" not centered on the visible viewport at scroll fraction ${fraction}: ${JSON.stringify(r)}`);
      if(!r.withinViewport)throw new Error(`Insertion "+" rendered outside the visible viewport at scroll fraction ${fraction}: ${JSON.stringify(r)}`);
    }
    await viewport.evaluate(el=>{el.scrollLeft=0;el.dispatchEvent(new Event("scroll"))});
  }

  // ================= SIDEBAR: STRUCTURAL FIX =================
  {
    const geometry=await page.evaluate(()=>{
      const collapseBtn=document.getElementById("toggleNavigation");
      const header=document.querySelector(".sidebar-header");
      const sidebar=document.querySelector(".project-sidebar");
      return {
        isHeaderChild:header.contains(collapseBtn),
        noBlankStripAbove:header.getBoundingClientRect().top-sidebar.getBoundingClientRect().top<16
      };
    });
    if(!geometry.isHeaderChild)throw new Error("Collapse control is not a structural child of the sidebar header");
    if(!geometry.noBlankStripAbove)throw new Error("Blank space is still reserved above the sidebar");
    // Keyboard + ARIA + persistence for the collapsed/reopen pair.
    await page.focus("#toggleNavigation");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    const collapsed=await page.evaluate(()=>({
      sidebarHidden:getComputedStyle(document.querySelector(".project-sidebar")).display==="none",
      reopenVisible:document.getElementById("toggleNavigationReopen").offsetParent!==null,
      reopenAriaExpanded:document.getElementById("toggleNavigationReopen").getAttribute("aria-expanded")
    }));
    if(!collapsed.sidebarHidden||!collapsed.reopenVisible||collapsed.reopenAriaExpanded!=="false")
      throw new Error(`Collapsed state broken: ${JSON.stringify(collapsed)}`);
    await page.reload({waitUntil:"networkidle"});
    const persisted=await page.evaluate(()=>document.querySelector(".app-shell").classList.contains("navigation-hidden"));
    if(!persisted)throw new Error("Sidebar collapse state did not persist across reload");
    await page.focus("#toggleNavigationReopen");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    const reopened=await page.evaluate(()=>!document.querySelector(".app-shell").classList.contains("navigation-hidden"));
    if(!reopened)throw new Error("Reopen control did not restore the sidebar");
  }

  console.log("Filter/insertion/sidebar local-review regression tests passed");
}finally{await browser.close();server.kill()}
