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

  // ================= FILTERS =================
  {
    const fields=["projectSearch","filterChapter","filterCharacter","filterLocation","filterTag","filterWriting","filterPlacement"];
    const visible=await page.evaluate(ids=>ids.every(id=>{const el=document.getElementById(id);return el&&el.offsetParent!==null}),fields);
    if(!visible)throw new Error("Not all 7 filter controls are directly visible");
    const noMoreFilters=await page.evaluate(()=>![...document.querySelectorAll("button")].some(b=>/ещё фильтр|more filters/i.test(b.textContent)));
    if(!noMoreFilters)throw new Error('A "More filters" progressive-disclosure control was introduced');
    const styles=await page.evaluate(()=>{
      // getComputedStyle() returns a live view of the element, so each snapshot must be
      // read into plain values immediately — before the next mutation — or both
      // "before" and "after" reads end up reflecting the same final state.
      const select=document.getElementById("filterLocation");
      const enabledBg=getComputedStyle(select).backgroundColor;
      const enabledColor=getComputedStyle(select).color;
      const enabledOpacity=getComputedStyle(select).opacity;
      select.disabled=true;
      const disabledOpacity=getComputedStyle(select).opacity;
      select.disabled=false;
      return {enabledBg,enabledColor,disabledOpacity,enabledOpacity};
    });
    if(styles.enabledOpacity!=="1")throw new Error(`Enabled filter select should not look faded: opacity=${styles.enabledOpacity}`);
    if(Number(styles.disabledOpacity)>=Number(styles.enabledOpacity))throw new Error(`Disabled select must look visibly weaker than enabled: ${JSON.stringify(styles)}`);
    await page.selectOption("#filterWriting","draft");await page.dispatchEvent("#filterWriting","change");
    await page.waitForTimeout(80);
    const activeStyle=await page.evaluate(()=>{
      const select=document.getElementById("filterWriting");
      return {active:select.closest(".filter-field").classList.contains("filter-active"),bg:getComputedStyle(select).backgroundColor};
    });
    if(!activeStyle.active)throw new Error("Active filter is not visually flagged");
    if(activeStyle.bg===styles.enabledBg)throw new Error("Active filter is not visually distinct from an untouched enabled filter");
    const heights=await page.evaluate(()=>({search:document.getElementById("projectSearch").getBoundingClientRect().height,select:document.getElementById("filterChapter").getBoundingClientRect().height}));
    if(Math.abs(heights.search-heights.select)>2)throw new Error(`Search/select filter heights diverged: ${JSON.stringify(heights)}`);
    await page.click("#clearFilters");await page.waitForTimeout(80);
    const cleared=await page.evaluate(()=>filters.writing);
    if(cleared!=="")throw new Error("Clearing filters did not reset semantics");
  }

  // ================= SIDEBAR =================
  {
    const geometry=await page.evaluate(()=>{
      const toggle=document.getElementById("toggleNavigation");
      const sidebar=document.querySelector(".project-sidebar");
      const header=sidebar.querySelector(".sidebar-header");
      const tRect=toggle.getBoundingClientRect(),sRect=sidebar.getBoundingClientRect(),hRect=header.getBoundingClientRect();
      return {
        withinSidebarX:tRect.left>=sRect.left-4&&tRect.right<=sRect.right+4,
        verticalOverlapWithHeaderRow:tRect.top<hRect.bottom+6&&tRect.bottom>hRect.top-6
      };
    });
    if(!geometry.withinSidebarX)throw new Error("Sidebar collapse control is not physically within the sidebar's own bounds");
    if(!geometry.verticalOverlapWithHeaderRow)throw new Error("Sidebar collapse control does not align with the sidebar header row");
  }
  {
    const before=await page.evaluate(()=>document.getElementById("toggleNavigation").getAttribute("aria-label"));
    if(before!=="Свернуть навигацию")throw new Error(`Unexpected open-state accessible name: ${before}`);
    await page.click("#toggleNavigation");
    const after=await page.evaluate(()=>document.getElementById("toggleNavigation").getAttribute("aria-label"));
    if(after!=="Открыть навигацию")throw new Error(`Unexpected collapsed-state accessible name: ${after}`);
    await page.reload({waitUntil:"networkidle"});
    const persisted=await page.evaluate(()=>document.querySelector(".app-shell").classList.contains("navigation-hidden"));
    if(!persisted)throw new Error("Sidebar collapse state did not persist across reload");
    await page.click("#toggleNavigation");
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
    await page.hover('.scene-position-row[data-position-kind="before-first"] .scene-position-btn');
    const hoverHeight=await page.evaluate(()=>document.querySelector('.scene-position-row[data-position-kind="before-first"]').getBoundingClientRect().height);
    if(hoverHeight<=restHeight)throw new Error("Hovering an insertion gap did not reveal a usable control");
  }

  // ================= CHARACTER HEADERS =================
  {
    const avatars=await page.evaluate(()=>document.querySelectorAll(".matrix-avatar").length);
    if(avatars<2)throw new Error("Matrix character-header avatars missing");
  }

  console.log("Core production polish browser tests passed");
}finally{await browser.close();server.kill()}
