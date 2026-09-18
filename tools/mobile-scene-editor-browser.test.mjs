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

    // Stage E3.2.4: E3.2.3's original "shared bounded region" attempt was
    // REJECTED on real-device testing -- it bounded the TOOLBAR, the
    // Find/Replace controls, results, AND the manuscript together in one
    // 50dvh budget, leaving only ~20-30px for the manuscript once the
    // chrome above it was subtracted. E3.2.4 reverted to "manuscript
    // independent of Find/Replace state, outer modal absorbs results
    // growth" -- itself later found incomplete (E3.2.5/E3.2.6): letting
    // the outer modal absorb growth meant its own scrollable length (and
    // therefore where focusing the find input naturally scrolled to)
    // changed unpredictably every time Find/Replace opened or resized,
    // which read on a real phone as content shifting for no clear reason.
    //
    // Stage E3.2.6 (current, corrected architecture): reproduces DESKTOP's
    // own `#textModal` mechanism (pure flexbox -- `.modal{display:flex;
    // flex-direction:column;height:92vh;overflow:hidden}` +
    // `.rte-editor{flex:1 1 auto;min-height:0}`, confirmed by direct
    // measurement to shrink its editor by exactly the same amount results
    // grows, with the modal's own height never changing) but scoped
    // NARROWLY: on `#sceneModal`, ONLY [project-results pane, splitter,
    // manuscript] share a bounded flex region (`.rte-manuscript-region`,
    // css/editor.css) -- the toolbar and Find/Replace controls stay
    // OUTSIDE it entirely, never competing for that budget, which is the
    // actual fix over E3.2.3's too-broad boundary. The region's own total
    // height is now INVARIANT regardless of Find/Replace state: results
    // growth is paid for by the manuscript shrinking WITHIN that same
    // fixed budget, never by the outer modal. This also structurally
    // resolves E3.2.5's sticky-footer-occlusion defect: with the outer
    // modal's scrollable length no longer changing between Find/Replace
    // states, and `.sticky-modal-footer` now made non-sticky (`position:
    // static`) whenever the results pane is visible (css/editor.css,
    // `:has()`-based, same precedent `#textModal` already uses
    // unconditionally) -- E3.2.5's `revealResizerPastStickyFooter()`
    // auto-scroll workaround was removed as no longer needed, confirmed by
    // the reachability assertion below finding the resizer reachable with
    // zero auto-scroll at all.
    await page.locator('[data-scene-id="scene-a"] .row-action-icon[title="Изменить сцену"]').tap();
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    await page.waitForSelector("#sceneTextEditor .ProseMirror");

    // Baseline-failure proof (must fail against pre-E3.2.6 HEAD c2dcc39 for
    // the real reason): `.rte-manuscript-region` does not exist before this
    // stage -- surfaced as an explicit assertion message here rather than a
    // bare null-dereference crash, so a failed run is legible as "the
    // shared-region architecture is missing," not a confusing stack trace.
    const geometry=()=>page.evaluate(()=>{
      const editor=document.getElementById("sceneTextEditor");
      const region=document.querySelector("#sceneModal .rte-manuscript-region");
      if(!region)throw new Error("#sceneModal .rte-manuscript-region does not exist -- pre-E3.2.6 architecture");
      const modal=document.querySelector("#sceneModal .modal");
      const results=document.querySelector(".rte-project-results");
      // Stage E3.2.5/E3.2.6: `#sceneTextFindReplace` (the Find/Replace
      // toolbar row itself) is the closest stable control ABOVE the
      // shared region -- it lives outside `.rte-manuscript-region`
      // entirely, so it must never move as a consequence of the splitter.
      // `.scene-participant-selector` is the closest stable control BELOW
      // the shared region -- also outside it, must also never move.
      // `.rte-find-replace` is a class on `#sceneTextFindReplace` itself,
      // never a descendant, so getElementById is the correct/only way to
      // reach it directly (see createFindReplacePanel's own comment).
      const anchorAbove=document.getElementById("sceneTextFindReplace");
      const anchorBelow=document.querySelector(".scene-participant-selector");
      const editorRect=editor.getBoundingClientRect();
      const regionRect=region.getBoundingClientRect();
      return {
        editorHeight:editorRect.height,
        editorTop:editorRect.top,
        // Stage E3.2.7: the manuscript's own bottom edge must never extend
        // past the shared region's own bottom edge -- `.rte-manuscript-
        // region{overflow:hidden}` would silently clip whatever does,
        // taking the manuscript's own bottom border/rounded corners with
        // it. See find-replace-panel.js's effectiveMaxResultsHeight() own
        // comment for the margin-accounting bug this stage fixed.
        editorBottomOverflow:editorRect.bottom-regionRect.bottom,
        regionHeight:regionRect.height,
        modalScrollHeight:modal.scrollHeight,
        modalScrollTop:modal.scrollTop,
        resultsHeight:results?results.getBoundingClientRect().height:null,
        anchorAboveTop:anchorAbove.getBoundingClientRect().top,
        anchorBelowTop:anchorBelow?anchorBelow.getBoundingClientRect().top:null,
        windowScrollY:window.scrollY
      };
    });
    const heightTolerance=4;
    // How far the region total / manuscript-minimum / stable anchors are
    // allowed to drift -- tight enough to actually prove the invariants
    // (a broken model would drift by the FULL drag distance, e.g. ~90-
    // 100px) without chasing sub-pixel layout noise.
    const anchorTolerance=4;
    // Stage E3.2.7 visual-acceptance check: the manuscript box's own
    // bottom border + rounded bottom corners must never be clipped by
    // `.rte-manuscript-region{overflow:hidden}` -- checked via computed
    // geometry (editor bottom vs region bottom), not a brittle screenshot
    // pixel match. A small positive tolerance absorbs sub-pixel rounding;
    // this must stay far tighter than the ~10px clipping this stage
    // actually found and fixed (a stale chromeOverhead calculation that
    // silently dropped the results wrapper's own bottom margin).
    const assertNoBottomClipping=(g,label)=>{
      if(g.editorBottomOverflow>1)throw new Error(`Manuscript bottom border/rounded corners must not be clipped by the shared region (${label}): editor extends ${g.editorBottomOverflow}px past the region's own bottom edge`);
    };

    // A. Find/Replace closed: baseline manuscript height -- the full
    // shared-region budget, since results isn't competing for it at all.
    const closedGeometry=await geometry();
    if(closedGeometry.editorHeight<300)throw new Error(`Manuscript must have a genuinely useful ~50dvh height with Find/Replace closed: ${closedGeometry.editorHeight}`);
    if(Math.abs(closedGeometry.regionHeight-closedGeometry.editorHeight)>heightTolerance)throw new Error(`With no results pane, the manuscript must claim the ENTIRE shared region: region=${closedGeometry.regionHeight}, editor=${closedGeometry.editorHeight}`);
    assertNoBottomClipping(closedGeometry,"Find/Replace closed");

    // B. Find/Replace open, current-scene mode (no results pane at all):
    // manuscript height must stay approximately the same -- the toolbar/
    // Find/Replace controls are outside the shared region and must not
    // consume any of its budget.
    await page.tap("#sceneTextToolbar .rte-btn-find");
    await page.waitForSelector("#sceneTextFindReplace .rte-find-input",{state:"visible"});
    const currentSceneGeometry=await geometry();
    if(Math.abs(currentSceneGeometry.editorHeight-closedGeometry.editorHeight)>heightTolerance)throw new Error(`Opening current-scene Find/Replace must not materially change the manuscript height: closed=${closedGeometry.editorHeight}, open=${currentSceneGeometry.editorHeight}`);
    if(Math.abs(currentSceneGeometry.regionHeight-closedGeometry.regionHeight)>heightTolerance)throw new Error(`The shared region's own total height must stay stable regardless of Find/Replace state: closed=${closedGeometry.regionHeight}, current-scene=${currentSceneGeometry.regionHeight}`);

    // C. Switch to project mode BEFORE typing a query: the results pane
    // (default height, hint content only) already exists and already
    // claims its share -- the manuscript must already have shrunk to make
    // room, and the region's total must still be exactly the same.
    await page.tap('#sceneTextFindReplace .rte-scope-btn:not(.active)');
    await page.waitForTimeout(80);
    const beforeQueryGeometry=await geometry();
    if(beforeQueryGeometry.resultsHeight==null)throw new Error("Project mode must show a results pane even before a query is typed");
    if(Math.abs(beforeQueryGeometry.regionHeight-closedGeometry.regionHeight)>heightTolerance)throw new Error(`Switching to project mode must not change the shared region's own total height: closed=${closedGeometry.regionHeight}, project-before-query=${beforeQueryGeometry.regionHeight}`);
    if(beforeQueryGeometry.editorHeight>=currentSceneGeometry.editorHeight-20)throw new Error(`The manuscript must visibly shrink once the results pane claims its share of the shared region: current-scene=${currentSceneGeometry.editorHeight}, project-before-query=${beforeQueryGeometry.editorHeight}`);
    assertNoBottomClipping(beforeQueryGeometry,"project mode before query");

    // Stage E3.2.6 root-cause proof: the resizer must be genuinely
    // touchable (elementFromPoint resolves to it, not to the sticky
    // footer or anything else) the very first time it appears, with NO
    // auto-scroll of any kind (E3.2.5's revealResizerPastStickyFooter()
    // was removed -- this proves the structural `:has()` footer fix
    // (css/editor.css) makes it unnecessary).
    await page.waitForSelector(".rte-project-results-resizer");
    const resizerReachable=await page.evaluate(()=>{
      const resizer=document.querySelector(".rte-project-results-resizer");
      const r=resizer.getBoundingClientRect();
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return hit===resizer||resizer.contains(hit);
    });
    if(!resizerReachable)throw new Error("The results-pane resizer must be genuinely touchable (not occluded by the sticky footer) as soon as it first appears, with no auto-scroll needed");

    // D. Now type a query -- real results replace the hint, but the
    // resultsRoot's own explicit JS-managed height (and therefore the
    // manuscript/region split) does not depend on content, so nothing
    // about the shared-region geometry should change here.
    await page.locator("#sceneTextFindReplace .rte-find-input").fill("такого текста в этой сцене нет чтобы результатов не было");
    await page.waitForTimeout(80);
    const projectModeGeometry=await geometry();
    if(Math.abs(projectModeGeometry.editorHeight-beforeQueryGeometry.editorHeight)>heightTolerance)throw new Error(`Typing a query must not itself change the manuscript/results split: before=${beforeQueryGeometry.editorHeight}, after=${projectModeGeometry.editorHeight}`);
    if(Math.abs(projectModeGeometry.regionHeight-closedGeometry.regionHeight)>heightTolerance)throw new Error(`The shared region's own total height must stay stable once results are populated: closed=${closedGeometry.regionHeight}, with-results=${projectModeGeometry.regionHeight}`);

    // Stage E3.2.7 visual-acceptance check: the active/current result row's
    // own outline/background must span the full available row width, not
    // just the intrinsic width of its (possibly short) snippet text --
    // real-phone review found the row's painted state hugging the text
    // for short snippets, which read as visually wrong. Query for a
    // unique, exact paragraph number so exactly one (short-ish) row comes
    // back -- a deliberately short snippet is the case that was broken.
    await page.locator("#sceneTextFindReplace .rte-find-input").fill("Абзац номер 1.");
    await page.waitForSelector(".rte-project-result-row.active");
    await page.waitForTimeout(80);
    const activeRowWidthCheck=await page.evaluate(()=>{
      const row=document.querySelector(".rte-project-result-row.active");
      const results=document.querySelector(".rte-project-results");
      return {rowWidth:row.getBoundingClientRect().width,resultsClientWidth:results.clientWidth};
    });
    // The row's own box (outline/background) must cover ALMOST the whole
    // available row width (a little short of it is fine -- the results
    // list has its own left/right padding) -- NOT just wrap the snippet
    // text, which for "Абзац номер 1." would be under 100px.
    if(activeRowWidthCheck.rowWidth<activeRowWidthCheck.resultsClientWidth*0.85)throw new Error(`The active result row must span the full available row width, not just its intrinsic snippet width: ${JSON.stringify(activeRowWidthCheck)}`);

    // E. A genuine touch drag on the resizer (Chromium's real touch input
    // pipeline via CDP -- see the E3.2.2 test lesson on why a plain
    // dispatchEvent would not prove anything about touch-action) must
    // grow results substantially while shrinking the manuscript by
    // APPROXIMATELY THE SAME AMOUNT -- the desktop-style exchange this
    // stage's whole point is to reproduce -- with the shared region's own
    // total height staying exactly stable (never "paid for" by the outer
    // modal any more).
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

    await dragResizerTouch(100);
    const afterGrow=await geometry();
    const growResultsDelta=afterGrow.resultsHeight-projectModeGeometry.resultsHeight;
    const growEditorDelta=afterGrow.editorHeight-projectModeGeometry.editorHeight;
    if(growResultsDelta<50)throw new Error(`Dragging the splitter down must grow the results pane substantially: before=${projectModeGeometry.resultsHeight}, after=${afterGrow.resultsHeight}`);
    if(Math.abs(growEditorDelta+growResultsDelta)>heightTolerance)throw new Error(`Results growth must be paid for by the manuscript shrinking by approximately the SAME amount, not by the outer modal: resultsDelta=${growResultsDelta}, editorDelta=${growEditorDelta}`);
    if(Math.abs(afterGrow.regionHeight-projectModeGeometry.regionHeight)>heightTolerance)throw new Error(`The shared region's own total height must stay stable across a drag: before=${projectModeGeometry.regionHeight}, after=${afterGrow.regionHeight}`);
    if(afterGrow.modalScrollTop!==projectModeGeometry.modalScrollTop)throw new Error(`The outer modal's own scrollTop must not move as a consequence of the splitter drag: before=${projectModeGeometry.modalScrollTop}, after=${afterGrow.modalScrollTop}`);
    if(afterGrow.windowScrollY!==0)throw new Error(`Resizing the results pane must never scroll the page itself: windowScrollY=${afterGrow.windowScrollY}`);
    if(Math.abs(afterGrow.anchorAboveTop-projectModeGeometry.anchorAboveTop)>anchorTolerance)throw new Error(`Content ABOVE the shared region (the Find/Replace controls) must not move because of the drag: before=${projectModeGeometry.anchorAboveTop}, after=${afterGrow.anchorAboveTop}`);
    if(Math.abs(afterGrow.anchorBelowTop-projectModeGeometry.anchorBelowTop)>anchorTolerance)throw new Error(`Content BELOW the shared region (participants) must not move because of the drag: before=${projectModeGeometry.anchorBelowTop}, after=${afterGrow.anchorBelowTop}`);
    assertNoBottomClipping(afterGrow,"after +100 grow drag");

    // F. Reverse direction: dragging the splitter back up (shrinking
    // results) must prove the exact inverse -- manuscript grows by
    // approximately the shrink amount, region total still stable, both
    // anchors still stable, no outer/window scroll. Growing by 100 can
    // itself have moved the resizer below the fold (expected -- nothing
    // in this stage keeps it in view after a completed resize, since
    // doing so would itself disturb the outer-modal-must-not-move
    // invariant) -- scrollIntoViewIfNeeded is the realistic "the user
    // scrolls a little to find the handle again" step, a TEST-side
    // action representing the user's own scroll, not part of the drag
    // contract itself, so the "before" snapshot is taken after it
    // settles (and must NOT have moved the two anchors either, since a
    // plain user scroll moving the whole modal is expected/fine -- the
    // invariant is specifically about the DRAG not causing movement).
    await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    const beforeShrink=await geometry();
    await dragResizerTouch(-60);
    const afterShrink=await geometry();
    const shrinkResultsDelta=beforeShrink.resultsHeight-afterShrink.resultsHeight;
    const shrinkEditorDelta=afterShrink.editorHeight-beforeShrink.editorHeight;
    if(shrinkResultsDelta<40)throw new Error(`Dragging the splitter up must shrink the results pane substantially: before=${beforeShrink.resultsHeight}, after=${afterShrink.resultsHeight}`);
    if(Math.abs(shrinkEditorDelta-shrinkResultsDelta)>heightTolerance)throw new Error(`Results shrinkage must be RETURNED to the manuscript by approximately the same amount: resultsShrink=${shrinkResultsDelta}, editorGrowth=${shrinkEditorDelta}`);
    if(Math.abs(afterShrink.regionHeight-beforeShrink.regionHeight)>heightTolerance)throw new Error(`The shared region's own total height must stay stable across the reverse drag too: before=${beforeShrink.regionHeight}, after=${afterShrink.regionHeight}`);
    if(afterShrink.modalScrollTop!==beforeShrink.modalScrollTop)throw new Error(`The outer modal's own scrollTop must not move during the reverse drag either: before=${beforeShrink.modalScrollTop}, after=${afterShrink.modalScrollTop}`);
    if(afterShrink.windowScrollY!==0)throw new Error(`Shrinking the results pane must never scroll the page itself: windowScrollY=${afterShrink.windowScrollY}`);
    if(Math.abs(afterShrink.anchorAboveTop-beforeShrink.anchorAboveTop)>anchorTolerance)throw new Error(`Content ABOVE the shared region must also not move during the reverse drag: before=${beforeShrink.anchorAboveTop}, after=${afterShrink.anchorAboveTop}`);
    if(Math.abs(afterShrink.anchorBelowTop-beforeShrink.anchorBelowTop)>anchorTolerance)throw new Error(`Content BELOW the shared region must also not move during the reverse drag: before=${beforeShrink.anchorBelowTop}, after=${afterShrink.anchorBelowTop}`);

    // G. Repeated grow/shrink cycles must not drift -- returns to exactly
    // the same split every time (catches the "sometimes expands/collapses
    // strangely" real-phone symptom, which would show up as accumulating
    // error across cycles).
    let cyclePrev=await geometry();
    for(let cycle=0;cycle<3;cycle++){
      await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
      await dragResizerTouch(50);
      await dragResizerTouch(-50);
      const cycleAfter=await geometry();
      if(Math.abs(cycleAfter.resultsHeight-cyclePrev.resultsHeight)>heightTolerance)throw new Error(`Repeated grow/shrink cycle ${cycle} drifted the results height: before=${cyclePrev.resultsHeight}, after=${cycleAfter.resultsHeight}`);
      if(Math.abs(cycleAfter.editorHeight-cyclePrev.editorHeight)>heightTolerance)throw new Error(`Repeated grow/shrink cycle ${cycle} drifted the manuscript height: before=${cyclePrev.editorHeight}, after=${cycleAfter.editorHeight}`);
      if(Math.abs(cycleAfter.regionHeight-cyclePrev.regionHeight)>heightTolerance)throw new Error(`Repeated grow/shrink cycle ${cycle} drifted the shared region's total height: before=${cyclePrev.regionHeight}, after=${cycleAfter.regionHeight}`);
      cyclePrev=cycleAfter;
    }

    // H. Switching scope current-scene -> project -> current-scene ->
    // project, and closing/reopening Find/Replace, must not drift or
    // corrupt the geometry either (the other real-phone symptom: "results
    // sometimes appear to expand/collapse in ways that do not correspond
    // to the finger drag").
    await page.tap('#sceneTextFindReplace .rte-scope-btn:not(.active)'); // -> scene
    await page.waitForTimeout(60);
    const backToScene=await geometry();
    if(Math.abs(backToScene.editorHeight-closedGeometry.editorHeight)>heightTolerance)throw new Error(`Leaving project scope must restore the manuscript to its full shared-region height: expected~=${closedGeometry.editorHeight}, got=${backToScene.editorHeight}`);
    await page.tap('#sceneTextFindReplace .rte-scope-btn:not(.active)'); // -> project
    await page.waitForTimeout(60);
    const backToProject=await geometry();
    if(backToProject.resultsHeight==null)throw new Error("Re-entering project scope must show the results pane again");
    if(Math.abs(backToProject.regionHeight-closedGeometry.regionHeight)>heightTolerance)throw new Error(`Re-entering project scope must not have drifted the shared region's own total height: closed=${closedGeometry.regionHeight}, re-entered=${backToProject.regionHeight}`);
    await page.tap("#sceneTextFindReplace .rte-find-close");
    await page.waitForTimeout(60);
    const afterClose=await geometry();
    if(Math.abs(afterClose.editorHeight-closedGeometry.editorHeight)>heightTolerance)throw new Error(`Closing Find/Replace must restore the manuscript to its full shared-region height: expected~=${closedGeometry.editorHeight}, got=${afterClose.editorHeight}`);
    await page.tap("#sceneTextToolbar .rte-btn-find");
    await page.waitForTimeout(60);
    const afterReopen=await geometry();
    if(afterReopen.resultsHeight==null)throw new Error("Reopening Find/Replace must restore the previously-active project scope with its results pane");
    if(Math.abs(afterReopen.regionHeight-closedGeometry.regionHeight)>heightTolerance)throw new Error(`Reopening Find/Replace must not have drifted the shared region's own total height: closed=${closedGeometry.regionHeight}, reopened=${afterReopen.regionHeight}`);

    // I. Extreme drags: MIN/MAX still hold, and MAX now also respects the
    // manuscript's own practical minimum (MANUSCRIPT_MIN_HEIGHT,
    // find-replace-panel.js) -- the manuscript must never be crushed below
    // it, which is exactly what makes this a corrected E3.2.3, not a
    // repeat of it. Both anchors stay stable even under an extreme drag.
    await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    const beforeMaxDrag=await geometry();
    await dragResizerTouch(2000,20);
    const afterMaxDrag=await geometry();
    if(afterMaxDrag.resultsHeight>420+2)throw new Error(`Touch drag must still respect the results pane's flat max height: ${afterMaxDrag.resultsHeight}`);
    if(afterMaxDrag.editorHeight<140-heightTolerance)throw new Error(`Even an extreme drag must never crush the manuscript below its practical minimum (140px): ${afterMaxDrag.editorHeight}`);
    if(Math.abs(afterMaxDrag.regionHeight-beforeMaxDrag.regionHeight)>heightTolerance)throw new Error(`An extreme drag clamped to MAX must still keep the shared region's total height stable: before=${beforeMaxDrag.regionHeight}, after=${afterMaxDrag.regionHeight}`);
    if(Math.abs(afterMaxDrag.anchorAboveTop-beforeMaxDrag.anchorAboveTop)>anchorTolerance)throw new Error(`An extreme drag clamped to MAX must still keep the above-anchor stable: before=${beforeMaxDrag.anchorAboveTop}, after=${afterMaxDrag.anchorAboveTop}`);
    if(Math.abs(afterMaxDrag.anchorBelowTop-beforeMaxDrag.anchorBelowTop)>anchorTolerance)throw new Error(`An extreme drag clamped to MAX must still keep the below-anchor stable: before=${beforeMaxDrag.anchorBelowTop}, after=${afterMaxDrag.anchorBelowTop}`);
    // Stage E3.2.7: this is the exact drag position (manuscript at its
    // practical minimum, results at its dynamic max) that originally
    // exhibited the border-clipping defect -- the most important place to
    // check it.
    assertNoBottomClipping(afterMaxDrag,"after extreme MAX drag");
    await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    const beforeMinDrag=await geometry();
    await dragResizerTouch(-2000,20);
    const afterMinDrag=await geometry();
    if(afterMinDrag.resultsHeight<90-2)throw new Error(`Touch drag must still respect the results pane's min height: ${afterMinDrag.resultsHeight}`);
    if(Math.abs(afterMinDrag.regionHeight-beforeMinDrag.regionHeight)>heightTolerance)throw new Error(`An extreme drag clamped to MIN must still keep the shared region's total height stable: before=${beforeMinDrag.regionHeight}, after=${afterMinDrag.regionHeight}`);
    if(Math.abs(afterMinDrag.anchorAboveTop-beforeMinDrag.anchorAboveTop)>anchorTolerance)throw new Error(`An extreme drag clamped to MIN must still keep the above-anchor stable: before=${beforeMinDrag.anchorAboveTop}, after=${afterMinDrag.anchorAboveTop}`);
    assertNoBottomClipping(afterMinDrag,"after extreme MIN drag");

    // The outer modal must remain the ONLY scroll owner involved in this
    // whole resize sequence -- window/page scroll must still be exactly 0.
    if(await page.evaluate(()=>window.scrollY)!==0)throw new Error("The whole splitter-resize sequence must never have scrolled the page itself");

    // Outer scroll reaches participants/footer while the manuscript's own
    // scrollTop can stay at 0 -- the manuscript is never traversed to get
    // there, exactly the required contract. `#sceneTextEditor` is the same
    // DOM node reused across mounts (only its content is replaced), so
    // explicitly zero its scrollTop first -- otherwise it would still
    // carry over from the earlier "deep paragraph" scroll-into-view test
    // (section F/H, same scene-a fixture, same scrollHeight), which would
    // make this check pass or fail for the wrong reason.
    await page.$eval("#sceneTextEditor",el=>{el.scrollTop=0});
    await page.$eval("#sceneModal .modal",el=>{el.scrollTop=el.scrollHeight});
    await page.waitForTimeout(50);
    const afterOuterScroll=await page.evaluate(()=>({
      editorScrollTop:document.getElementById("sceneTextEditor").scrollTop,
      participantsVisible:(()=>{const r=document.querySelector(".scene-participant-selector")?.getBoundingClientRect();return r&&r.top<window.innerHeight&&r.bottom>0})()
    }));
    if(afterOuterScroll.editorScrollTop!==0)throw new Error(`Reaching participants via the outer modal scroll must not require advancing the manuscript's own scroll: ${afterOuterScroll.editorScrollTop}`);
    if(!afterOuterScroll.participantsVisible)throw new Error("Participants must be reachable via the outer modal's own scroll");
    await page.$eval("#sceneModal .modal",el=>{el.scrollTop=0});

    // Manuscript remains genuinely editable and internally scrollable, and
    // project results remain their own scrollable region, after resizing.
    const editableAfterResize=await page.evaluate(()=>{
      const view=sceneModalTextEditor.view;
      view.dispatch(view.state.tr.insertText("ПОСЛЕRESIZE"));
      return sceneModalTextEditor.serialize().sceneText.includes("ПОСЛЕRESIZE");
    });
    if(!editableAfterResize)throw new Error("Manuscript must remain editable after resizing the results pane");
    const editorScrollAfterResize=await page.$eval("#sceneTextEditor",el=>{const before=el.scrollTop;el.scrollTop=el.scrollHeight;const after=el.scrollTop;el.scrollTop=before;return {before,after}});
    if(editorScrollAfterResize.after<0)throw new Error("Manuscript must remain independently scrollable after resizing the results pane");
    const resultsScrollAfterResize=await page.$eval(".rte-project-results",el=>{const before=el.scrollTop;el.scrollTop=999;const after=el.scrollTop;return {before,after,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}});
    if(resultsScrollAfterResize.scrollHeight>resultsScrollAfterResize.clientHeight&&resultsScrollAfterResize.after<=resultsScrollAfterResize.before)throw new Error(`Project results must remain their own scrollable region after resizing: ${JSON.stringify(resultsScrollAfterResize)}`);

    // Page-level horizontal overflow must not appear.
    const pageOverflowAfterResize={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth)};
    if(pageOverflowAfterResize.scrollWidth>pageOverflowAfterResize.clientWidth+heightTolerance)throw new Error(`Resizing the results pane must not introduce page-level horizontal overflow: ${JSON.stringify(pageOverflowAfterResize)}`);

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

    // Stage E3.2.6 sanity (no landscape redesign, per explicit scope guard):
    // at 667x375, `.rte-manuscript-region`'s 50dvh budget is only ~187.5px
    // -- less than results' own default (140px, flex:none, never shrinks)
    // plus the manuscript's practical 140px minimum (flex-shrink stops
    // there) combined (~298px+chrome). Measured directly: both the results
    // pane and the manuscript still each get their own full requested
    // height from the flex algorithm (`overflow:hidden` on the region just
    // clips whatever doesn't fit, rather than forcing an ugly negative
    // size) -- a real, honest degraded state in this tight orientation,
    // NOT a crash, NOT a redesign target for this stage (landscape/tablet
    // work is explicitly out of scope; deferred to E6, matching every
    // earlier landscape note in this doc). This section only asserts: no
    // page error, no horizontal overflow, the manuscript keeps a real
    // (non-zero, still-editable) presence, and the results pane is still
    // there -- not the strict portrait exchange invariants above, which
    // this cramped a viewport cannot honestly satisfy.
    await page.tap("#sceneTextToolbar .rte-btn-find");
    await page.tap('#sceneTextFindReplace .rte-scope-btn:not(.active)');
    await page.locator("#sceneTextFindReplace .rte-find-input").fill("текст");
    await page.waitForSelector(".rte-project-results-resizer");
    await page.waitForTimeout(100);
    const landscapeGeometry=await page.evaluate(()=>({
      editorHeight:document.getElementById("sceneTextEditor").getBoundingClientRect().height,
      resultsHeight:document.querySelector(".rte-project-results").getBoundingClientRect().height
    }));
    if(!(landscapeGeometry.editorHeight>0))throw new Error(`Manuscript must keep a real presence in short landscape even when cramped: ${JSON.stringify(landscapeGeometry)}`);
    if(!(landscapeGeometry.resultsHeight>0))throw new Error(`Results pane must keep a real presence in short landscape even when cramped: ${JSON.stringify(landscapeGeometry)}`);
    const landscapeEditableStillWorks=await page.evaluate(()=>{
      const view=sceneModalTextEditor.view;
      view.dispatch(view.state.tr.insertText("ЛАНДШАФТ"));
      return sceneModalTextEditor.serialize().sceneText.includes("ЛАНДШАФТ");
    });
    if(!landscapeEditableStillWorks)throw new Error("Manuscript must remain editable in short landscape even with project results open");
    const landscapeOverflowWithResults={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth)};
    if(landscapeOverflowWithResults.scrollWidth>landscapeOverflowWithResults.clientWidth+geometryTolerance)throw new Error(`Project results in short landscape must not introduce page-level horizontal overflow: ${JSON.stringify(landscapeOverflowWithResults)}`);
    await page.tap("#sceneTextFindReplace .rte-find-close");
    // The manuscript was just edited (ЛАНДШАФТ above), so this close hits
    // the same dirty-state discard guard used throughout this file.
    await page.evaluate(()=>document.getElementById("cancelScene").click());
    await page.waitForFunction(()=>document.getElementById("discardChangesModal").style.display==="flex");
    await page.tap("#discardChanges");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="none");

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
