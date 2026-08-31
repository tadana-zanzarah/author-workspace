import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Real-DOM regression for design/core-production-polish: targeted fixes on top of the
// accepted design/workspace-density-navigation baseline (filters visual states, sidebar
// collapse geometry/overflow, header identity/logo-slot/account sizing, the header
// dropdown-clipping bug, matrix checkbox palette, empty-cell marker, row hover). This
// complements (does not replace) core-workspace-recomposition-browser.test.mjs and
// workspace-density-navigation-browser.test.mjs, which already own the underlying
// shell/matrix-content-mode contracts this phase does not change.

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
function project(){
  return {version:11,
    characters:[
      {id:"c1",name:"Анна"},
      {id:"c2",name:"Александра Константиновна Верещагина-Долгорукая"}
    ],
    profiles:{},
    chapters:[
      {id:"chapter-unassigned",title:"Без главы",collapsed:false},
      {id:"ch1",title:"Глава первая: очень длинное название главы для проверки переполнения строки",collapsed:false}
    ],
    locations:[{id:"l1",name:"Очень длинное название локации для проверки переполнения строки в сайдбаре"}],
    tags:[{id:"t1",name:"тайна"}],future:{},
    scenes:[
      {id:"s1",title:"Сцена А",date:"2026-01-01",time:"09:00",dateReview:false,chapterId:"ch1",locationId:"l1",tags:["t1"],writingStatus:"draft",sceneText:"",included:true,status:"fixed",people:{c1:{action:"Делает что-то",legacyState:"",relationChanges:{},visibleRelations:[]},c2:emptyPerson()}},
      {id:"s2",title:"Сцена Б",date:"2026-01-02",time:"10:00",dateReview:false,chapterId:"ch1",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}}
    ]};
}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project());
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // Custom filter listbox (js/filter-controls.js) replaced native <select> for the
  // whole filter bar — opens the trigger, clicks the matching option by value, and
  // (for single-value fields) waits for it to auto-close.
  const chooseFilter=async(suffix,value)=>{
    await page.click(`#filter${suffix}`);
    await page.waitForSelector(`#filter${suffix}Popover:not([hidden])`);
    await page.click(`#filter${suffix}List [role="option"][data-value="${value}"]`);
  };

  // ================= FILTERS =================
  {
    const fields=["projectSearch","filterChapter","filterCharacter","filterLocation","filterTag","filterWriting","filterPlacement"];
    const visible=await page.evaluate(ids=>ids.every(id=>{const el=document.getElementById(id);return el&&el.offsetParent!==null}),fields);
    if(!visible)throw new Error("Not all 7 filter controls are directly visible");
    const noMoreFilters=await page.evaluate(()=>![...document.querySelectorAll("button")].some(b=>/ещё фильтр|more filters/i.test(b.textContent)));
    if(!noMoreFilters)throw new Error('A "More filters" progressive-disclosure control was introduced');
    // Option labels/closed-box text must not repeat the filter's own category name.
    await page.click("#filterChapter");
    await page.waitForSelector("#filterChapterPopover:not([hidden])");
    const chapterOptionTexts=await page.evaluate(()=>[...document.querySelectorAll('#filterChapterList [role="option"]')].map(o=>o.textContent.trim()));
    if(chapterOptionTexts.some(t=>t.startsWith("Глава:")))
      throw new Error(`Chapter dropdown options must not repeat "Глава:": ${JSON.stringify(chapterOptionTexts)}`);
    if(!chapterOptionTexts.includes("Глава первая: очень длинное название главы для проверки переполнения строки"))
      throw new Error(`Chapter dropdown missing the plain (unprefixed) chapter title: ${JSON.stringify(chapterOptionTexts)}`);
    await page.keyboard.press("Escape");
    await page.click("#filterCharacter .filter-multi-trigger");
    await page.waitForSelector("#filterCharacterPopover:not([hidden])");
    const charOptionTexts=await page.evaluate(()=>[...document.querySelectorAll('#filterCharacterList [role="option"]')].map(o=>o.textContent.trim()));
    if(charOptionTexts.some(t=>t.startsWith("Персонаж:")))throw new Error(`Character dropdown options must not repeat "Персонаж:": ${JSON.stringify(charOptionTexts)}`);
    if(!charOptionTexts.includes("Анна"))throw new Error(`Character dropdown missing plain character name: ${JSON.stringify(charOptionTexts)}`);
    await page.keyboard.press("Escape");

    const styles=await page.evaluate(()=>{
      // getComputedStyle() returns a live view of the element, so each snapshot must be
      // read into plain values immediately — before the next mutation — or both
      // "before" and "after" reads end up reflecting the same final state.
      const trigger=document.getElementById("filterLocation");
      const enabledBg=getComputedStyle(trigger).backgroundColor;
      const enabledColor=getComputedStyle(trigger).color;
      const enabledOpacity=getComputedStyle(trigger).opacity;
      trigger.disabled=true;
      const disabledOpacity=getComputedStyle(trigger).opacity;
      trigger.disabled=false;
      return {enabledBg,enabledColor,disabledOpacity,enabledOpacity};
    });
    if(styles.enabledOpacity!=="1")throw new Error(`Enabled filter trigger should not look faded: opacity=${styles.enabledOpacity}`);
    if(Number(styles.disabledOpacity)>=Number(styles.enabledOpacity))throw new Error(`Disabled trigger must look visibly weaker than enabled: ${JSON.stringify(styles)}`);

    await chooseFilter("Writing","draft");
    await page.waitForTimeout(80);
    const activeStyle=await page.evaluate(()=>{
      const trigger=document.getElementById("filterWriting");
      return {active:trigger.closest(".filter-field").classList.contains("filter-active"),bg:getComputedStyle(trigger).backgroundColor,text:trigger.textContent.trim()};
    });
    if(!activeStyle.active)throw new Error("Active filter is not visually flagged");
    if(activeStyle.bg===styles.enabledBg)throw new Error("Active filter is not visually distinct from an untouched enabled filter");
    if(activeStyle.text.startsWith("Статус:")||!activeStyle.text.includes("Черновик"))
      throw new Error(`Selected single-value filter must read just the value, not "Статус: …": ${activeStyle.text}`);

    // No bright native-blue selection state: the popover paints its own selection.
    const accent=await page.evaluate(()=>{
      const opt=document.querySelector('#filterWritingList [role="option"][aria-selected="true"]');
      return opt?getComputedStyle(opt).backgroundColor:null;
    });
    if(accent==="rgb(0, 120, 215)"||accent==="rgb(0, 122, 255)"||accent==="Highlight")
      throw new Error(`Selected filter option still uses a system-blue highlight: ${accent}`);

    const heights=await page.evaluate(()=>({search:document.getElementById("projectSearch").getBoundingClientRect().height,trigger:document.getElementById("filterChapter").getBoundingClientRect().height}));
    if(Math.abs(heights.search-heights.trigger)>2)throw new Error(`Search/filter-trigger heights diverged: ${JSON.stringify(heights)}`);
    await page.click("#clearFilters");await page.waitForTimeout(80);
    const cleared=await page.evaluate(()=>filters.writing);
    if(cleared!=="")throw new Error("Clearing filters did not reset semantics");
  }

  // ================= MULTI CHARACTER / TAG FILTERS =================
  {
    await chooseFilter("Character","c1"); // multi-select popover stays open after a pick
    await page.click('#filterCharacterList [role="option"][data-value="c2"]');
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    const selected=await page.evaluate(()=>[...filters.character].sort());
    if(selected.join(",")!=="c1,c2")throw new Error(`Both characters should be selected: ${JSON.stringify(selected)}`);
    const closedText=await page.evaluate(()=>document.getElementById("filterCharacter").textContent);
    if(!closedText.includes("Анна"))throw new Error(`Closed multi control should show selected chip labels: ${closedText}`);
    // s1 has both c1 and c2; s2 has neither — AND-of-selected-characters must keep
    // only the scene containing every selected character, not either one alone.
    const visibleAfterBoth=await page.evaluate(()=>getVisibleSceneEntries().map(({scene})=>scene.id));
    if(visibleAfterBoth.join(",")!=="s1")throw new Error(`Multi-character filter must AND together (only s1 has both c1 and c2), got ${JSON.stringify(visibleAfterBoth)}`);
    await page.click('#filterCharacter .filter-trigger-chip-remove[data-value="c2"]');
    await page.waitForTimeout(80);
    const afterRemove=await page.evaluate(()=>[...filters.character]);
    if(afterRemove.join(",")!=="c1")throw new Error(`Removing one chip should leave only the other selected: ${JSON.stringify(afterRemove)}`);
    await page.click('#filterCharacter .filter-trigger-chip-remove[data-value="c1"]');
    await page.waitForTimeout(80);
    const afterClearAll=await page.evaluate(()=>filters.character.length);
    if(afterClearAll!==0)throw new Error("Removing the last chip should clear the character filter");
  }

  // ================= SIDEBAR =================
  // The open-state collapse control must be a genuine DOM child of the sidebar's own
  // header row (not a sibling element positioned on top of the panel from outside) —
  // local review flagged the previous CSS-only "move it closer" fix as still visibly
  // floating above the card. Structural containment is checked directly instead of a
  // pixel-tolerance bounding-box comparison, which the old floating button could
  // satisfy by coincidence without actually belonging to the header.
  {
    const geometry=await page.evaluate(()=>{
      const toggle=document.getElementById("toggleNavigation");
      const header=document.querySelector(".sidebar-header");
      const sidebar=document.querySelector(".project-sidebar");
      const tRect=toggle.getBoundingClientRect(),hRect=header.getBoundingClientRect(),sRect=sidebar.getBoundingClientRect();
      return {
        isHeaderChild:header.contains(toggle),
        withinHeaderBounds:tRect.top>=hRect.top-2&&tRect.bottom<=hRect.bottom+2&&tRect.left>=hRect.left-2&&tRect.right<=hRect.right+2,
        // No blank strip reserved above the sidebar for a floating control: the panel's
        // own top edge and its header's top edge must coincide (modulo the panel's own
        // padding), not sit tens of pixels apart.
        noBlankStripAbove:hRect.top-sRect.top<16
      };
    });
    if(!geometry.isHeaderChild)throw new Error("Sidebar collapse control is not a DOM child of the sidebar header — it does not structurally belong to the panel");
    if(!geometry.withinHeaderBounds)throw new Error("Sidebar collapse control's bounding box is not inside the sidebar header row");
    if(!geometry.noBlankStripAbove)throw new Error("Blank space is still reserved above the sidebar for a floating control");
  }
  {
    // Collapsed state: the panel is gone, so a separate reopen tab takes over — it
    // must not be a floating control layered above a visible panel (there is no panel
    // to float over any more), and it must still be reachable/labelled.
    await page.click("#toggleNavigation");
    await page.waitForTimeout(50);
    const collapsed=await page.evaluate(()=>{
      const reopen=document.getElementById("toggleNavigationReopen");
      const sidebar=document.querySelector(".project-sidebar");
      return {
        reopenVisible:reopen.offsetParent!==null,
        sidebarHidden:getComputedStyle(sidebar).display==="none",
        ariaLabel:reopen.getAttribute("aria-label")
      };
    });
    if(!collapsed.sidebarHidden)throw new Error("Sidebar panel should be fully hidden while collapsed");
    if(!collapsed.reopenVisible)throw new Error("Collapsed state must expose a reopen control");
    if(collapsed.ariaLabel!=="Открыть навигацию")throw new Error(`Unexpected reopen control label: ${collapsed.ariaLabel}`);
    await page.click("#toggleNavigationReopen");
    await page.waitForTimeout(50);
  }
  {
    const before=await page.evaluate(()=>document.getElementById("toggleNavigation").getAttribute("aria-label"));
    if(before!=="Свернуть навигацию")throw new Error(`Unexpected open-state accessible name: ${before}`);
    await page.click("#toggleNavigation");
    const after=await page.evaluate(()=>document.getElementById("toggleNavigationReopen").getAttribute("aria-label"));
    if(after!=="Открыть навигацию")throw new Error(`Unexpected collapsed-state reopen control accessible name: ${after}`);
    await page.reload({waitUntil:"networkidle"});
    const persisted=await page.evaluate(()=>document.querySelector(".app-shell").classList.contains("navigation-hidden"));
    if(!persisted)throw new Error("Sidebar collapse state did not persist across reload");
    await page.click("#toggleNavigationReopen");
    await page.waitForTimeout(50);
  }
  {
    const overflow=await page.evaluate(()=>{
      const chapterBtn=[...document.querySelectorAll("#sideChapters .sidebar-item")][0];
      const charBtn=[...document.querySelectorAll("#sideCharacters .sidebar-item")].find(b=>b.textContent.includes("Александра"));
      const locBtn=[...document.querySelectorAll("#sideLocations .sidebar-item")][0];
      const noOverlap=btn=>{
        const label=btn.querySelector(".sidebar-item-label"),count=btn.querySelector(".sidebar-count");
        return label.getBoundingClientRect().right<=count.getBoundingClientRect().left+1;
      };
      return {
        chapterOk:noOverlap(chapterBtn),chapterTitle:chapterBtn.querySelector(".sidebar-item-label").title,
        charOk:noOverlap(charBtn),charTitle:charBtn.querySelector(".sidebar-item-label").title,
        locOk:noOverlap(locBtn),locTitle:locBtn.querySelector(".sidebar-item-label").title
      };
    });
    if(!overflow.chapterOk)throw new Error("Long chapter name overlaps its count");
    if(!overflow.charOk)throw new Error("Long character name overlaps its count");
    if(!overflow.locOk)throw new Error("Long location name overlaps its count");
    if(!overflow.chapterTitle||!overflow.charTitle||!overflow.locTitle)throw new Error(`Full name not available via title for hover/focus disclosure: ${JSON.stringify(overflow)}`);
  }

  // ================= HEADER =================
  {
    const identity=await page.evaluate(()=>({
      slotPresent:!!document.querySelector("header .app-logo-slot"),
      staleText:[...document.querySelectorAll("header *")].some(el=>el.children.length===0&&el.textContent.trim()==="Рабочее пространство автора"),
      titlePresent:!!document.getElementById("workspaceProjectTitle")
    }));
    if(identity.staleText)throw new Error("Stale 'Рабочее пространство автора' text still visible in header");
    if(!identity.slotPresent)throw new Error("Structural logo slot missing from header");
    if(!identity.titlePresent)throw new Error("Project title element missing from header");
  }
  {
    await page.evaluate(()=>{
      document.getElementById("workspaceCloudBar").hidden=false;
      document.getElementById("workspaceProjectTitle").textContent="Очень длинное название проекта для проверки переполнения строки заголовка и панели меню полностью";
      document.getElementById("workspaceAccountMenu").hidden=false;
      document.getElementById("workspaceAccountAvatar").textContent="АК";
    });
    for(const [name,value] of [["short","Аня"],["long","a.very.long.author.email.address.for.overflow.testing@example.com"]]){
      await page.evaluate(v=>{document.getElementById("workspaceAccountName").textContent=v;document.getElementById("workspaceAccountName").title=v},value);
      for(const width of [1440,1200,1024,900]){
        await page.setViewportSize({width,height:900});
        const state=await page.evaluate(()=>{
          const h=document.querySelector("header");
          const nameEl=document.getElementById("workspaceAccountName");
          return {overflow:h.scrollWidth>h.clientWidth+1,nameVisible:nameEl.offsetParent!==null,avatarVisible:document.getElementById("workspaceAccountAvatar").offsetParent!==null};
        });
        if(state.overflow)throw new Error(`Header overflows horizontally with ${name} account identity at width ${width}`);
        if(!state.avatarVisible)throw new Error(`Account avatar not visible (${name} identity, width ${width})`);
      }
    }
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>{document.getElementById("workspaceCloudBar").hidden=true;document.getElementById("workspaceAccountMenu").hidden=true});
  }

  // ================= DROPDOWNS =================
  {
    const heightBefore=await page.evaluate(()=>document.querySelector("header").getBoundingClientRect().height);
    await page.click("#projectMenu summary");
    // <details>'s "toggle" event (which the detach-to-<body> logic listens for) is
    // queued as a task rather than firing synchronously with the click.
    await page.waitForTimeout(80);
    const opened=await page.evaluate(()=>{
      const panel=document.querySelector("#projectMenu .top-menu-panel, body > .top-menu-panel");
      const rect=panel.getBoundingClientRect();
      return {
        bottomBeyondHeader:rect.bottom>document.querySelector("header").getBoundingClientRect().bottom+50,
        withinViewport:rect.right<=window.innerWidth+1&&rect.left>=-1,
        detached:panel.parentElement===document.body,
        headerHeight:document.querySelector("header").getBoundingClientRect().height,
        appShellTop:document.querySelector(".app-shell").getBoundingClientRect().top
      };
    });
    if(!opened.detached)throw new Error("Menu panel was not detached from the clipping header to escape overflow:hidden");
    if(!opened.bottomBeyondHeader)throw new Error("Menu panel does not extend below/overlay the header the way a real dropdown should");
    if(!opened.withinViewport)throw new Error("Menu panel renders outside the viewport bounds");
    if(Math.abs(opened.headerHeight-heightBefore)>1)throw new Error(`Opening the menu changed header height: ${heightBefore} -> ${opened.headerHeight}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
    const closed=await page.evaluate(()=>({
      open:document.getElementById("projectMenu").open,
      focusIsSummary:document.activeElement===document.querySelector("#projectMenu summary")
    }));
    if(closed.open)throw new Error("Escape did not close the project menu");
    if(!closed.focusIsSummary)throw new Error("Focus did not return to the menu trigger after Escape");
  }
  {
    // Menu items still reachable/functional after the panel is detached to <body>.
    await page.click("#projectMenu summary");
    await page.click("#manageChapters");
    await page.waitForSelector("#chaptersModal .modal");
    const menuClosed=await page.evaluate(()=>!document.getElementById("projectMenu").open);
    if(!menuClosed)throw new Error("Clicking a detached menu item did not close the menu");
    await page.click("#closeChapters");
    await page.waitForSelector("#chaptersModal",{state:"hidden"});
  }
  {
    await page.evaluate(()=>{
      document.getElementById("workspaceAccountMenu").hidden=false;
      document.getElementById("workspaceAccountAvatar").textContent="АК";
      document.getElementById("workspaceAccountName").textContent="Автор";
    });
    const heightBefore=await page.evaluate(()=>document.querySelector("header").getBoundingClientRect().height);
    await page.click("#workspaceAccountMenu summary");
    await page.waitForTimeout(80);
    const opened=await page.evaluate(()=>{
      const panel=document.querySelector("body > .account-menu-panel");
      if(!panel)return {detached:false};
      const rect=panel.getBoundingClientRect();
      return {detached:true,bottomBeyondHeader:rect.bottom>document.querySelector("header").getBoundingClientRect().bottom+20,headerHeight:document.querySelector("header").getBoundingClientRect().height};
    });
    if(!opened.detached)throw new Error("Account menu panel was not detached to escape header clipping");
    if(!opened.bottomBeyondHeader)throw new Error("Account menu panel does not overlay the workspace body");
    if(Math.abs(opened.headerHeight-heightBefore)>1)throw new Error("Opening the account menu changed header height");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
    const closed=await page.evaluate(()=>document.getElementById("workspaceAccountMenu").open);
    if(closed)throw new Error("Escape did not close the account menu");
    await page.evaluate(()=>{document.getElementById("workspaceAccountMenu").hidden=true;document.getElementById("workspaceCloudBar").hidden=true});
  }

  // ================= EXPORT =================
  {
    const exportControls=await page.evaluate(()=>["allScenesBtn","exportTextBtn","exportBtn"].map(id=>{const el=document.getElementById(id);return {id,present:!!el,visible:el?.offsetParent!==null}}));
    for(const c of exportControls)if(!c.present||!c.visible)throw new Error(`Export control missing: ${JSON.stringify(c)}`);
    if(exportControls[0].id===exportControls[1].id)throw new Error("Export and text-export collapsed into one control");
  }

  // ================= MATRIX TOGGLES =================
  {
    const defaults=await page.evaluate(()=>({actions:document.getElementById("matrixShowActions").checked,relations:document.getElementById("matrixShowRelations").checked}));
    if(!defaults.actions||defaults.relations)throw new Error(`Matrix toggle defaults regressed: ${JSON.stringify(defaults)}`);
    const accent=await page.evaluate(()=>getComputedStyle(document.getElementById("matrixShowActions")).accentColor);
    if(accent==="rgb(0, 0, 238)"||accent==="rgb(0, 122, 255)"||accent==="")throw new Error(`Matrix checkbox still uses browser-default blue accent: ${accent}`);
    await page.focus("#matrixShowRelations");
    await page.keyboard.press("Space");
    const toggled=await page.evaluate(()=>document.getElementById("matrixShowRelations").checked);
    if(!toggled)throw new Error("Keyboard toggling of matrix checkbox did not work");
    await page.keyboard.press("Space");
  }

  // ================= EMPTY CELLS =================
  {
    const cell=await page.evaluate(()=>{
      const el=document.querySelector('.scene-row[data-scene-id="s2"] .matrix-cell-empty');
      const after=el?getComputedStyle(el,"::after"):null;
      return {found:!!el,afterContent:after?after.content:null,ariaLabel:el?.getAttribute("aria-label")||""};
    });
    if(!cell.found)throw new Error("Non-participant matrix cell missing");
    if(cell.afterContent&&cell.afterContent!=="none"&&cell.afterContent!=='""')throw new Error(`Empty matrix cell still renders a visible marker: ${cell.afterContent}`);
    if(!cell.ariaLabel.includes("не участвует"))throw new Error(`Non-participant semantics missing from aria-label: ${cell.ariaLabel}`);
    const noncontent=await page.evaluate(()=>{
      const el=document.querySelector('.scene-row[data-scene-id="s1"] .matrix-cell-noncontent');
      return {found:!!el,text:el?.textContent.trim()};
    });
    if(!noncontent.found||!noncontent.text)throw new Error("Participant-without-content cell lost its distinct placeholder");
  }

  // ================= MATRIX HOVER =================
  {
    const base=await page.evaluate(()=>getComputedStyle(document.querySelector('.scene-row[data-scene-id="s1"]')).backgroundColor);
    await page.hover('.scene-row[data-scene-id="s1"] .scene-title');
    const hovered=await page.evaluate(()=>getComputedStyle(document.querySelector('.scene-row[data-scene-id="s1"]')).backgroundColor);
    if(hovered===base)throw new Error("Scene row hover produces no visible orientation change");
    if(hovered==="rgb(228, 239, 225)")throw new Error("Row hover regressed to the old green status fill");
  }

  // ================= QUICK ACTIONS =================
  {
    const actions=await page.evaluate(()=>{
      const row=document.querySelector('.scene-row[data-scene-id="s1"]');
      return [...row.querySelectorAll(".row-actions button")].map(b=>({aria:b.getAttribute("aria-label"),disabled:b.disabled}));
    });
    const has=substr=>actions.some(a=>a.aria?.includes(substr));
    if(!has("выше")||!has("ниже")||!has("текст сцены")||!has("Изменить сцену")||!has("Удалить сцену"))
      throw new Error(`Quick actions missing/renamed: ${JSON.stringify(actions)}`);
    const overflowMenu=await page.evaluate(()=>!!document.querySelector('.scene-row[data-scene-id="s1"] [aria-label="Ещё"], .scene-row[data-scene-id="s1"] .row-actions-overflow'));
    if(overflowMenu)throw new Error("Quick actions moved behind an overflow menu");
  }

  // ================= INSERTION =================
  {
    const positions=await page.evaluate(()=>document.querySelectorAll('.board [data-position-kind]').length);
    if(positions!==3)throw new Error(`Expected N+1=3 insertion positions for 2 scenes in ch1, got ${positions}`);
    const kinds=await page.evaluate(()=>[...document.querySelectorAll('.board [data-position-kind]')].map(el=>el.dataset.positionKind));
    if(!kinds.includes("before-first")||!kinds.includes("between")||!kinds.includes("after-last"))
      throw new Error(`Insertion positions incomplete: ${kinds}`);
    const restHeight=await page.evaluate(()=>document.querySelector('.scene-position-row[data-position-kind="before-first"]').getBoundingClientRect().height);
    if(restHeight>16)throw new Error(`Insertion gap not compact at rest: ${restHeight}px`);
    // The affordance reveals on hover as an OVERLAY — the row's own box height (and
    // therefore every scene row's Y position below it) must stay byte-for-byte
    // identical, not grow the way the old min-height:9px -> 26px hover rule did.
    const neighborY=await page.evaluate(()=>document.querySelector('.scene-row[data-scene-id="s1"]').getBoundingClientRect().top);
    await page.hover('.scene-position-row[data-position-kind="before-first"] .scene-position-btn');
    // fix/core-final-visual-polish: reveal now waits out a short hover-intent delay
    // (so a pointer merely passing through doesn't flash the affordance) before the
    // opacity/transform transition itself starts — wait past both.
    await page.waitForTimeout(400);
    const hoverHeight=await page.evaluate(()=>document.querySelector('.scene-position-row[data-position-kind="before-first"]').getBoundingClientRect().height);
    const hoverNeighborY=await page.evaluate(()=>document.querySelector('.scene-row[data-scene-id="s1"]').getBoundingClientRect().top);
    const plusOpacity=await page.evaluate(()=>getComputedStyle(document.querySelector('.scene-position-row[data-position-kind="before-first"] .position-plus')).opacity);
    if(hoverHeight!==restHeight)throw new Error(`Hovering must not change the insertion row's own height: rest=${restHeight} hover=${hoverHeight}`);
    if(hoverNeighborY!==neighborY)throw new Error(`Hovering an insertion gap moved a neighboring scene row: before=${neighborY} after=${hoverNeighborY}`);
    if(Number(plusOpacity)<1)throw new Error(`Hover should still reveal the "+" affordance (as an overlay): opacity=${plusOpacity}`);
    await page.mouse.move(0,0);
  }
  // Viewport-relative centering on a wide (many-character-column) matrix is covered
  // by tools/filter-and-insertion-local-review.test.mjs, which seeds a dedicated
  // many-character fixture up front instead of mutating this file's shared project
  // mid-run.

  // ================= CHARACTER HEADERS =================
  {
    const avatars=await page.evaluate(()=>document.querySelectorAll(".matrix-avatar").length);
    if(avatars<2)throw new Error("Matrix character-header avatars missing");
  }

  console.log("Core production polish browser tests passed");
}finally{await browser.close();server.kill()}
