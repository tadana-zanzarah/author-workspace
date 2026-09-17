import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Long enough that the legacy fixed 320px nested scroll (pre-E3.2) would
// have required dozens of internal "pages" to reach the end -- see
// css/editor.css's own comment on `#sceneModal .rte-editor`.
const longText=Array.from({length:100},(_,i)=>`Абзац номер ${i+1}. `+"Текст сцены для проверки длинной прокрутки в редакторе сцены. ".repeat(5)).join("\n\n");

// Realistic metadata (date/time/status/chapter/location/one participant) so
// the metadata-reflow and participants-reachability checks below exercise
// genuine form content, not an empty scene. `tags:[]` deliberately -- a
// malformed tags shape here would make the app's own load-time validation
// silently fall back to an empty default project (discovered during this
// stage's manual verification), which would make every check below fail
// for the wrong reason.
const project={version:11,characters:[{id:"char-a",name:"Анна",surname:"Иванова"}],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false}],locations:[{id:"loc-a",name:"Дом"}],tags:[],future:{},scenes:[
  {id:"scene-a",title:"Сцена с метаданными",date:"2026-05-01",time:"14:30",dateReview:false,chapterId:"chapter-one",locationId:"loc-a",tags:[],writingStatus:"draft",sceneText:longText,included:true,status:"fixed",people:{"char-a":{action:"говорит",relationChanges:{},visibleRelations:[]}}}
]};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const displayIs=(page,id,value)=>page.$eval(`#${id}`,(node,v)=>node.style.display===v,value);

  // --- Phone: fullscreen geometry, scroll ownership, metadata/toolbar
  // reflow, long-text editing, handoff, new-scene flow -- via genuine
  // touch, not desktop-emulated clicks (Stage E2.2.1's lesson). ---
  {
    const page=await browser.newPage({
      viewport:{width:390,height:844},
      isMobile:true,
      hasTouch:true,
      userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    });
    page.setDefaultTimeout(5000);
    const pageErrors=[];
    page.on("pageerror",error=>pageErrors.push(error.message));
    page.on("console",message=>{if(message.type()==="error")pageErrors.push("console: "+message.text())});
    await page.addInitScript(value=>{if(sessionStorage.getItem("mobile-scene-editor-seeded"))return;sessionStorage.setItem("mobile-scene-editor-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
    // Stage E3.1's Cards single-tap already goes to Text Scene on mobile
    // (handleCardPrimaryTap), and Cards'/Compact's own dblclick=edit is a
    // plain desktop-mouse convention that a genuine double-TAP under a
    // touch-enabled context does not reliably reproduce (confirmed during
    // this stage's investigation: dblclick under isMobile/hasTouch lands on
    // Cards' single-tap handler first and opens Text Scene instead). Table
    // view's dedicated "Изменить сцену" (✎) row-action icon is a real,
    // single-tap, `event.stopPropagation()`-guarded existing entry point
    // that does not fight any mobile single-tap semantics -- use it as the
    // normal open path for an EXISTING scene here.
    await page.evaluate(()=>{currentView="table";render()});

    // A. Open an EXISTING scene through the normal path.
    await page.locator('[data-scene-id="scene-a"] .row-action-icon[title="Изменить сцену"]').tap();
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    await page.waitForSelector("#sceneTextEditor .ProseMirror");

    const viewportSize=page.viewportSize();
    const geometryTolerance=2;
    const modalRect=await page.$eval("#sceneModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(modalRect.top-0)>geometryTolerance)throw new Error(`Scene Editor must reach the viewport top on phone: top=${modalRect.top}`);
    if(Math.abs(modalRect.left-0)>geometryTolerance)throw new Error(`Scene Editor must reach the viewport left on phone: left=${modalRect.left}`);
    if(Math.abs(viewportSize.width-modalRect.right)>geometryTolerance)throw new Error(`Scene Editor must reach the viewport right on phone: right=${modalRect.right}`);
    if(Math.abs(viewportSize.height-modalRect.bottom)>geometryTolerance)throw new Error(`Scene Editor must reach the viewport bottom on phone: bottom=${modalRect.bottom}`);
    const shellGeometry=await page.$eval("#sceneModal .modal",el=>{const s=getComputedStyle(el);return {borderRadius:s.borderRadius,margin:s.margin}});
    if(shellGeometry.borderRadius!=="0px")throw new Error(`Scene Editor must have no outer border radius on phone: ${shellGeometry.borderRadius}`);
    if(shellGeometry.margin!=="0px")throw new Error(`Scene Editor must have no outer margin on phone: ${shellGeometry.margin}`);

    // B. Underlying workspace must not be hit-test reachable while open.
    const pointBelongsToModal=await page.evaluate(()=>{
      const el=document.elementFromPoint(20,window.innerHeight-10);
      return el!==null&&el.closest("#sceneModal")!==null;
    });
    if(!pointBelongsToModal)throw new Error("Underlying workspace must not be reachable while Scene Editor is open");

    // D. No page-level horizontal overflow.
    const pageOverflow={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth)};
    if(pageOverflow.scrollWidth>pageOverflow.clientWidth+geometryTolerance)throw new Error(`Scene Editor introduced page-level horizontal overflow: ${JSON.stringify(pageOverflow)}`);

    // E. Metadata reflows to a single column and stays within the phone
    // viewport (the pre-existing `.modal-grid-4`/`.modal-grid` responsive
    // rules, unrelated to this stage's own change, but worth locking in
    // now that the surface is actually reachable at this width).
    const metadataOverflow=await page.$eval(".scene-section-primary",el=>{
      const overflowing=[...el.querySelectorAll("input,select,button")].filter(node=>node.getBoundingClientRect().right>document.documentElement.clientWidth+1);
      return overflowing.map(node=>node.id||node.tagName);
    });
    if(metadataOverflow.length)throw new Error(`Metadata controls must not overflow the phone viewport: ${JSON.stringify(metadataOverflow)}`);
    const gridColumns=await page.$eval(".modal-grid-4",el=>getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length);
    if(gridColumns>2)throw new Error(`Metadata grid should have stacked down from its 4-column desktop layout at phone width, found ${gridColumns} columns`);

    // G. Stage E3.2.1 corrected scroll-ownership contract: real-device
    // review of E3.2's original fix (manuscript flowing unbounded inline
    // in the outer modal scroll) found the OPPOSITE problem -- reaching
    // participants below a realistically long manuscript meant scrolling
    // through the entire scene text first. The manuscript editor is now a
    // bounded, independently-scrolling region again (HYBRID model): the
    // outer `#sceneModal .modal` remains scrollable for metadata/title/
    // participants/footer, AND the manuscript owns its own separate
    // vertical scroll, sized well under its full content height.
    const editorGeometry=await page.$eval("#sceneTextEditor",el=>({overflowY:getComputedStyle(el).overflowY,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}));
    if(editorGeometry.overflowY!=="auto"&&editorGeometry.overflowY!=="scroll")throw new Error(`The manuscript editor must be its own independent vertical scroll owner on phone: overflow-y=${editorGeometry.overflowY}`);
    if(editorGeometry.clientHeight>=editorGeometry.scrollHeight*0.5)throw new Error(`The manuscript editor's rendered height must be substantially smaller than its full content height (bounded, not flowing inline): ${JSON.stringify(editorGeometry)}`);
    const modalScrollGeometry=await page.$eval("#sceneModal .modal",el=>({scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
    if(modalScrollGeometry.scrollHeight<=modalScrollGeometry.clientHeight)throw new Error(`The outer modal must still be vertically scrollable for metadata/title/participants/footer: ${JSON.stringify(modalScrollGeometry)}`);
    if(modalScrollGeometry.scrollHeight>=editorGeometry.scrollHeight*0.5)throw new Error(`The outer modal's scroll length must NOT be proportional to the manuscript's own huge content -- the manuscript's length must stay contained inside its own bounded box: outer=${modalScrollGeometry.scrollHeight}, manuscript=${editorGeometry.scrollHeight}`);

    // Core proof: participants/fields below the manuscript are reachable by
    // scrolling ONLY the outer modal, WITHOUT ever advancing the
    // manuscript's own internal scroll position.
    await page.$eval("#sceneModal .modal",el=>{el.scrollTop=el.scrollHeight});
    await page.waitForTimeout(50);
    const manuscriptScrollTopStillZero=await page.$eval("#sceneTextEditor",el=>el.scrollTop);
    if(manuscriptScrollTopStillZero!==0)throw new Error(`Reaching the end of the outer form must not require advancing the manuscript's own scroll: manuscript scrollTop=${manuscriptScrollTopStillZero}`);
    const participantsVisible=await page.$eval(".scene-participant-selector",el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<window.innerHeight});
    if(!participantsVisible)throw new Error("Participants section must be reachable at the bottom of the outer modal's own scroll");
    const midScrollWindowY=await page.evaluate(()=>window.scrollY);
    if(midScrollWindowY!==0)throw new Error(`Scrolling the Scene Editor must not move the page itself: windowScrollY=${midScrollWindowY}`);
    const footerVisibleMidScroll=await page.$eval("#sceneModal .modal-actions",el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<window.innerHeight});
    if(!footerVisibleMidScroll)throw new Error("Save/Cancel footer must remain reachable (sticky) after scrolling to the bottom of the outer form");
    await page.$eval("#sceneModal .modal",el=>{el.scrollTop=0});

    // F/H. Long manuscript is reachable/editable near its end via the
    // manuscript's OWN internal scroll (Playwright's scrollIntoViewIfNeeded
    // scrolls whichever ancestor scroll container is actually needed --
    // confirmed below to be the editor itself, not the outer modal).
    const deepParagraph=await page.locator("#sceneTextEditor .ProseMirror p").nth(60);
    await deepParagraph.scrollIntoViewIfNeeded();
    const editorScrollTopAfterScrollIntoView=await page.$eval("#sceneTextEditor",el=>el.scrollTop);
    if(editorScrollTopAfterScrollIntoView<=0)throw new Error("Reaching a deep paragraph must scroll the manuscript's own internal scroll region");
    await deepParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" ГЛУБОКАЯПРАВКА.");
    const deepEditReflected=await page.evaluate(()=>sceneModalTextEditor.serialize().sceneText.includes("ГЛУБОКАЯПРАВКА"));
    if(!deepEditReflected)throw new Error("Typing near the end of a long manuscript must reach the live editor doc");
    const afterTypeWindowY=await page.evaluate(()=>window.scrollY);
    if(afterTypeWindowY!==0)throw new Error(`Typing deep in the manuscript must not move the page itself: windowScrollY=${afterTypeWindowY}`);
    if(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2))throw new Error("Long-manuscript editing must not introduce page-level horizontal overflow");

    // I. Close/discard guard -- existing dirty-state contract, unchanged.
    await page.tap("#cancelScene");
    await page.waitForFunction(()=>document.getElementById("discardChangesModal").style.display==="flex");
    await page.tap("#discardChanges");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="none");
    if(await page.evaluate(()=>data.scenes.find(s=>s.id==="scene-a").sceneText.includes("ГЛУБОКАЯПРАВКА")))throw new Error("Discarding must not persist the unsaved deep edit");

    // Stage E3.2.3: real-phone review found that E3.2.2's touch-action fix
    // made the results/manuscript splitter genuinely draggable, but
    // exposed a deeper geometry bug -- growing the results pane did NOT
    // correspondingly shrink the manuscript; the two were unrelated
    // fixed-size siblings, so the combined content just grew taller,
    // pushing the outer modal's scroll (read as "the modal gets pushed").
    // Reopen the scene and project-search Find/Replace fresh to verify the
    // CORRECTED shared-space contract with real rendered geometry, not
    // just that the splitter moves (which E3.2.2's own regression already
    // proved and is not sufficient here).
    await page.locator('[data-scene-id="scene-a"] .row-action-icon[title="Изменить сцену"]').tap();
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.tap("#sceneTextToolbar .rte-btn-find");
    await page.tap('#sceneTextFindReplace .rte-scope-btn:not(.active)');
    await page.locator("#sceneTextFindReplace .rte-find-input").fill("такого текста в этой сцене нет чтобы результатов не было");
    await page.waitForSelector(".rte-project-results-resizer");

    const sharedGeometry=()=>page.evaluate(()=>{
      const editor=document.getElementById("sceneTextEditor");
      const results=document.querySelector(".rte-project-results");
      const section=editor.parentElement;
      const metadata=document.querySelector(".scene-section-primary");
      return {
        editorHeight:editor.getBoundingClientRect().height,
        resultsHeight:results.getBoundingClientRect().height,
        sectionHeight:section.getBoundingClientRect().height,
        metadataTop:metadata.getBoundingClientRect().top,
        modalScrollTop:document.querySelector("#sceneModal .modal").scrollTop
      };
    });

    const beforeDrag=await sharedGeometry();
    // Fixture-sanity: this bounded region only has real slack to trade
    // when project scope's results pane genuinely participates in the
    // section's flex layout (`manuscriptElement`'s parent must be the
    // phone-only flex column -- see css/editor.css's own comment).
    const parentIsFlex=await page.$eval("#sceneTextEditor",el=>getComputedStyle(el.parentElement).display==="flex");
    if(!parentIsFlex)throw new Error("Test fixture invalid: the manuscript's parent section must be the phone-only bounded flex column");

    // A genuine touch drag on the resizer (Chromium's real touch input
    // pipeline via CDP -- see the E3.2.2 test lesson on why a plain
    // dispatchEvent would not prove anything about touch-action).
    const dragResizerTouch=async(deltaY,steps=10)=>{
      const box=await page.$eval(".rte-project-results-resizer",el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
      const cdp=await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x,y:box.y,id:1}]});
      for(let i=1;i<=steps;i++){
        await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x,y:box.y+(deltaY*i)/steps,id:1}]});
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      await page.waitForTimeout(100);
    };

    await dragResizerTouch(80);
    const afterGrow=await sharedGeometry();

    // Core proof: results grew, manuscript shrank -- the OPPOSITE
    // direction, not "unrelated" (the exact defect being fixed).
    if(afterGrow.resultsHeight<=beforeDrag.resultsHeight)throw new Error(`Dragging the splitter down must grow the results pane: before=${beforeDrag.resultsHeight}, after=${afterGrow.resultsHeight}`);
    if(afterGrow.editorHeight>=beforeDrag.editorHeight)throw new Error(`Dragging the splitter down must correspondingly SHRINK the manuscript, not leave it unrelated (the exact E3.2.2 defect): before=${beforeDrag.editorHeight}, after=${afterGrow.editorHeight}`);
    // The bounded shared region itself must not grow -- proves the
    // redistribution is real, not just extra height being added.
    if(Math.abs(afterGrow.sectionHeight-beforeDrag.sectionHeight)>2)throw new Error(`The bounded shared region's own height must stay stable, not grow with the results pane: before=${beforeDrag.sectionHeight}, after=${afterGrow.sectionHeight}`);
    // Upper modal controls (metadata) must not be displaced by a resize
    // that happens entirely below them.
    if(Math.abs(afterGrow.metadataTop-beforeDrag.metadataTop)>2)throw new Error(`Metadata controls above the Find/Replace region must not move as a result of resizing it: before=${beforeDrag.metadataTop}, after=${afterGrow.metadataTop}`);
    if(Math.abs(afterGrow.modalScrollTop-beforeDrag.modalScrollTop)>2)throw new Error(`Dragging the splitter must not itself scroll the outer modal: before=${beforeDrag.modalScrollTop}, after=${afterGrow.modalScrollTop}`);

    // Min constraint: the manuscript never crushes below its own floor.
    const editorMinHeight=await page.$eval("#sceneTextEditor",el=>parseFloat(getComputedStyle(el).minHeight));
    if(afterGrow.editorHeight<editorMinHeight-1)throw new Error(`The manuscript must never shrink below its own min-height floor: height=${afterGrow.editorHeight}, floor=${editorMinHeight}`);
    await dragResizerTouch(600,20); // drag far past any reasonable limit
    const afterMaxDrag=await sharedGeometry();
    if(afterMaxDrag.editorHeight<editorMinHeight-1)throw new Error(`An extreme drag must still respect the manuscript's min-height floor: height=${afterMaxDrag.editorHeight}, floor=${editorMinHeight}`);
    if(Math.abs(afterMaxDrag.sectionHeight-beforeDrag.sectionHeight)>2)throw new Error(`Even an extreme drag must not grow the bounded shared region: before=${beforeDrag.sectionHeight}, after=${afterMaxDrag.sectionHeight}`);
    // Min constraint the other direction: dragging back up must respect
    // the results pane's own existing MIN_RESULTS_HEIGHT floor (90).
    await dragResizerTouch(-600,20);
    const afterMinDrag=await sharedGeometry();
    if(afterMinDrag.resultsHeight<90-2)throw new Error(`Dragging back up must still respect the results pane's existing min height: ${afterMinDrag.resultsHeight}`);

    // Manuscript remains genuinely editable and internally scrollable, and
    // project results remain their own scrollable region, after resizing.
    const editableAfterResize=await page.evaluate(()=>{
      const view=sceneModalTextEditor.view;
      view.dispatch(view.state.tr.insertText("ПОСЛЕRESIZE"));
      return sceneModalTextEditor.serialize().sceneText.includes("ПОСЛЕRESIZE");
    });
    if(!editableAfterResize)throw new Error("Manuscript must remain editable after resizing the shared region");
    const resultsScrollAfterResize=await page.$eval(".rte-project-results",el=>{const before=el.scrollTop;el.scrollTop=999;const after=el.scrollTop;return {before,after,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}});
    if(resultsScrollAfterResize.scrollHeight>resultsScrollAfterResize.clientHeight&&resultsScrollAfterResize.after<=resultsScrollAfterResize.before)throw new Error(`Project results must remain their own scrollable region after resizing: ${JSON.stringify(resultsScrollAfterResize)}`);

    // Shared horizontal project-results scroll (E3.1.2/E3.1.3) is
    // completely unrelated to this vertical splitter and must remain
    // intact after a resize.
    const rowOverflowXAfterResize=await page.$$eval(".rte-project-result-row",els=>els.length?getComputedStyle(els[0]).overflowX:"visible");
    if(rowOverflowXAfterResize==="hidden")throw new Error(`Individual result rows must not become independent horizontal scroll owners: overflow-x=${rowOverflowXAfterResize}`);

    await page.tap("#sceneTextFindReplace .rte-find-close");
    await page.tap("#cancelScene");
    // The manuscript was edited (ПОСЛЕRESIZE) during the editability check
    // above, so this close is expected to hit the same dirty-state guard
    // as I. -- discard it to return to a clean state for J.
    await page.waitForFunction(()=>document.getElementById("discardChangesModal").style.display==="flex");
    await page.tap("#discardChanges");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="none");

    // J. Save an existing scene -- metadata + manuscript together.
    await page.locator('[data-scene-id="scene-a"] .row-action-icon[title="Изменить сцену"]').tap();
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.selectOption("#sceneStatus","floating");
    const firstParagraph=page.locator("#sceneTextEditor .ProseMirror p").first();
    await firstParagraph.click();
    await page.keyboard.press("Home");
    await page.keyboard.type("СОХРАНЕНО. ");
    await page.tap("#saveScene");
    await page.waitForFunction(()=>{const s=data.scenes.find(x=>x.id==="scene-a");return s&&s.status==="floating"&&s.sceneText.includes("СОХРАНЕНО")});
    if(await page.$eval("#sceneModal",node=>node.style.display)!=="flex")throw new Error("Save must not close the Scene Editor");

    // Toolbar/controls remain reachable after all this scrolling/editing --
    // reuses the same responsive `.rte-toolbar` proven in Quick Scene/Text
    // Scene, not a redesign.
    if(!await page.isVisible("#sceneTextToolbar .rte-btn-bold"))throw new Error("Formatting controls must remain reachable");
    if(!await page.isVisible("#sceneTextToolbar .rte-btn-switch-surface"))throw new Error("The Text Scene switch-surface control must remain reachable");

    // M. Scene Editor -> Text Scene (the reverse direction, always seamless
    // -- Text Scene has no non-text dirty state of its own).
    await page.tap("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    if(await page.evaluate(()=>document.getElementById("sceneModal").style.display)!=="none")throw new Error("Scene Editor -> Text Scene handoff must close the Scene Editor");
    if(!(await page.evaluate(()=>sceneTextEditor.serialize().sceneText)).includes("СОХРАНЕНО"))throw new Error("Scene Editor -> Text Scene handoff must carry the just-typed text across");

    // L. Text Scene -> Scene Editor handoff preserves unsaved text and
    // focus (mousedown-based capture -- a real tap, not a synthetic
    // element.click(), is required for this to engage at all; see
    // js/editor/scene-editor-controller.js's captureFocusAtMousedown).
    // `.rte-btn-switch-surface` is a shared class reused by BOTH surfaces'
    // toolbars -- scope every reference to whichever surface is currently
    // open, never a bare class selector.
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.locator("#fullSceneTextEditor .ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" ИЗТЕКСТАСЦЕНЫ.");
    await page.tap("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    const handoffText=await page.evaluate(()=>sceneModalTextEditor.serialize().sceneText);
    if(!handoffText.includes("ИЗТЕКСТАСЦЕНЫ"))throw new Error("Text Scene -> Scene Editor handoff must carry the live unsaved text across");
    const focusedIsSceneEditor=await page.evaluate(()=>document.activeElement.closest("#sceneTextEditor")!==null);
    if(!focusedIsSceneEditor)throw new Error("A genuine tap on the switch-surface control must focus the destination manuscript editor");
    const handoffModalRect=await page.$eval("#sceneModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(viewportSize.height-handoffModalRect.bottom)>geometryTolerance)throw new Error("Scene Editor must still be fullscreen after a handoff");
    // Clean discard back to a known state.
    await page.tap("#cancelScene");
    await page.waitForFunction(()=>document.getElementById("discardChangesModal").style.display==="flex");
    await page.tap("#discardChanges");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="none");

    // K. "+ Новая сцена" still opens this SAME full editor, fullscreen, and
    // creates exactly one normal scene with canonical defaults.
    const sceneCountBefore=await page.evaluate(()=>data.scenes.length);
    await page.tap("#addFirst");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    const newSceneModalRect=await page.$eval("#sceneModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(viewportSize.height-newSceneModalRect.bottom)>geometryTolerance)throw new Error("+ Новая сцена must open the full editor fullscreen on phone too");
    await page.locator("#sceneTitle").fill("Новая тестовая сцена (мобильная)");
    await page.locator("#sceneTextEditor .ProseMirror").click();
    await page.keyboard.type("Текст новой сцены с телефона.");
    await page.tap("#saveSceneAndClose");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="none");
    const sceneCountAfter=await page.evaluate(()=>data.scenes.length);
    if(sceneCountAfter!==sceneCountBefore+1)throw new Error(`+ Новая сцена must create exactly one scene: before=${sceneCountBefore}, after=${sceneCountAfter}`);
    const created=await page.evaluate(()=>data.scenes.find(s=>s.title==="Новая тестовая сцена (мобильная)"));
    if(!created||created.chapterId!=="chapter-unassigned"||created.status!=="floating")throw new Error(`New scene must use canonical unassigned/unplaced defaults: ${JSON.stringify(created)}`);

    // N. Landscape sanity: fullscreen still holds, no clipping/overflow.
    // 667x375 (not e.g. 844x390) deliberately -- it stays under the
    // 760px phone breakpoint that gates `.mobile-fullscreen-modal`, the
    // same "phone landscape" reference size Stage E3.1's own regression
    // used; a wider landscape size would exceed the breakpoint entirely
    // and correctly NOT be fullscreen, which is a viewport-choice mistake
    // to avoid here, not a product defect.
    await page.setViewportSize({width:667,height:375});
    await page.evaluate(()=>editScene("scene-a"));
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    const landscapeModalRect=await page.$eval("#sceneModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(landscapeModalRect.right-667)>geometryTolerance||Math.abs(landscapeModalRect.bottom-375)>geometryTolerance)throw new Error(`Scene Editor must remain fullscreen in landscape: ${JSON.stringify(landscapeModalRect)}`);
    const landscapeOverflow={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth)};
    if(landscapeOverflow.scrollWidth>landscapeOverflow.clientWidth+geometryTolerance)throw new Error(`Scene Editor introduced page-level horizontal overflow in landscape: ${JSON.stringify(landscapeOverflow)}`);

    // Stage E3.2.3: the shared-space model must fail gracefully at short
    // height -- open project Find/Replace here too and confirm the bounded
    // region still holds its own height (no runaway growth/overflow) even
    // though 50dvh of a 375px-tall landscape viewport is very little room.
    await page.tap("#sceneTextToolbar .rte-btn-find");
    await page.tap('#sceneTextFindReplace .rte-scope-btn:not(.active)');
    await page.locator("#sceneTextFindReplace .rte-find-input").fill("текст");
    await page.waitForSelector(".rte-project-results-resizer");
    const landscapeSectionHeight=await page.$eval("#sceneTextEditor",el=>el.parentElement.getBoundingClientRect().height);
    const landscapeExpected=375*0.5;
    if(Math.abs(landscapeSectionHeight-landscapeExpected)>4)throw new Error(`The bounded shared region must still hold its own 50dvh height in short landscape, not overflow: ${landscapeSectionHeight}, expected ~${landscapeExpected}`);
    const landscapeOverflowWithResults={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth)};
    if(landscapeOverflowWithResults.scrollWidth>landscapeOverflowWithResults.clientWidth+geometryTolerance)throw new Error(`Project results in short landscape must not introduce page-level horizontal overflow: ${JSON.stringify(landscapeOverflowWithResults)}`);
    await page.tap("#sceneTextFindReplace .rte-find-close");
    await page.evaluate(()=>document.getElementById("cancelScene").click());

    if(pageErrors.length)throw new Error(`Unexpected page errors: ${pageErrors.join("; ")}`);
    await page.close();
  }

  // --- Desktop: Scene Editor remains an ordinary centered, non-fullscreen
  // modal with its existing nested 320px manuscript scroll -- fully
  // preserved, unaffected by this stage. ---
  {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    page.setDefaultTimeout(5000);
    await page.addInitScript(value=>{if(sessionStorage.getItem("mobile-scene-editor-desktop-seeded"))return;sessionStorage.setItem("mobile-scene-editor-desktop-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
    await page.evaluate(()=>{editScene("scene-a")});
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");

    const modalRect=await page.$eval("#sceneModal .modal",el=>el.getBoundingClientRect().toJSON());
    const shellGeometry=await page.$eval("#sceneModal .modal",el=>({borderRadius:getComputedStyle(el).borderRadius}));
    if(modalRect.left<=0||modalRect.top<=0)throw new Error(`Desktop Scene Editor must remain a centered modal, not fullscreen: ${JSON.stringify(modalRect)}`);
    if(shellGeometry.borderRadius==="0px")throw new Error("Desktop Scene Editor should keep its ordinary rounded modal corners");
    const editorGeometry=await page.$eval("#sceneTextEditor",el=>({height:getComputedStyle(el).height,overflowY:getComputedStyle(el).overflowY}));
    if(editorGeometry.height!=="320px")throw new Error(`Desktop Scene Editor must keep its existing fixed 320px manuscript box, unaffected by the phone-only fix: height=${editorGeometry.height}`);
    if(editorGeometry.overflowY!=="auto")throw new Error(`Desktop Scene Editor's manuscript box must keep its own internal scroll: overflow-y=${editorGeometry.overflowY}`);

    await page.click("#cancelScene");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="none");
    await page.close();
  }

  console.log("Mobile Scene Editor browser tests passed");
}finally{await browser.close();server.kill()}
