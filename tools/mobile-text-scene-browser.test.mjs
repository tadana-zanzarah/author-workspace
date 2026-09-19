import {createRequire} from "node:module";
import {spawn} from "node:child_process";
import {runSplitterContract} from "./mobile-splitter-contract.mjs";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Long enough that the editor's own internal scroll region genuinely exceeds
// a phone viewport's visible height -- see the scroll-ownership check below.
const longText=Array.from({length:120},(_,i)=>`Абзац номер ${i+1}. `+"Текст сцены для проверки длинной прокрутки на телефоне. ".repeat(5)).join("\n\n");

// Stage E3.1.1/E3.1.2/E3.1.3: long, unbroken (no line breaks) sentences
// containing a shared unique keyword -- project-search result rows built
// from these are reliably wider than a phone viewport. TWO scenes of
// DIFFERENT lengths (not one, not equal) so the project search produces
// multiple result rows of different intrinsic widths -- needed to prove
// they share one horizontal coordinate space (E3.1.2) while each row's own
// painted/interactive box still matches ITS OWN content length, not some
// other row's (E3.1.3), not just that one row overflows.
const longLineKeyword="ГОРИЗОНТМАРКЕР";
const longLine=(n,repeats)=>`Это очень длинное предложение номер ${n} с ключевым словом ${longLineKeyword} и текстом. `.repeat(repeats);

const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false}],locations:[],tags:[],future:{},scenes:[
  {id:"scene-a",title:"Короткая сцена",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:"Текст А",included:true,status:"floating",people:{}},
  {id:"scene-b",title:"Длинная сцена",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:longText,included:true,status:"floating",people:{}},
  {id:"scene-c",title:"Сцена с длинной строкой 1",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:longLine(1,4),included:true,status:"floating",people:{}},
  {id:"scene-d",title:"Сцена с длинной строкой 2",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:longLine(2,2),included:true,status:"floating",people:{}}
]};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  // --- Phone: fullscreen geometry, focus, workspace containment, scroll
  // ownership, and essential actions -- via genuine touch, not desktop-
  // emulated clicks (see tools/quick-scene-browser.test.mjs's E2.2.1 finding:
  // a phone-sized viewport under a desktop-emulated Playwright context misses
  // touch-specific defects entirely). ---
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
    await page.addInitScript(value=>{if(sessionStorage.getItem("mobile-text-scene-seeded"))return;sessionStorage.setItem("mobile-text-scene-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
    await page.evaluate(()=>{currentView="cards";render()});

    // Normal open path #1: a genuine touch tap on a Cards scene (Stage
    // E2.1's existing single-tap-to-Text-Scene contract) -- not a direct
    // openSceneText() call, which would bypass exactly the layer that missed
    // the Quick Scene defect earlier in this stage.
    await page.tap('[data-scene-id="scene-a"] .compact-card-title');
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");

    // Stage E3.1 fullscreen contract: the ACTUAL rendered geometry against
    // the page viewport, not merely that a fullscreen class/rule exists --
    // this is exactly the layer that missed the Quick Scene specificity bug
    // (css/editor.css's own comment on `.mobile-fullscreen-modal .modal`).
    const viewportSize=page.viewportSize();
    const geometryTolerance=2;
    const modalRect=await page.$eval("#textModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(modalRect.top-0)>geometryTolerance)throw new Error(`Text Scene must reach the viewport top on phone: top=${modalRect.top}`);
    if(Math.abs(modalRect.left-0)>geometryTolerance)throw new Error(`Text Scene must reach the viewport left on phone: left=${modalRect.left}`);
    if(Math.abs(viewportSize.width-modalRect.right)>geometryTolerance)throw new Error(`Text Scene must reach the viewport right on phone: right=${modalRect.right}, viewport width=${viewportSize.width}`);
    if(Math.abs(viewportSize.height-modalRect.bottom)>geometryTolerance)throw new Error(`Text Scene must reach the viewport bottom on phone: bottom=${modalRect.bottom}, viewport height=${viewportSize.height}`);
    const shellGeometry=await page.$eval("#textModal .modal",el=>{const s=getComputedStyle(el);return {borderRadius:s.borderRadius,margin:s.margin}});
    if(shellGeometry.borderRadius!=="0px")throw new Error(`Text Scene must have no outer border radius on phone (workspace exposure risk): ${shellGeometry.borderRadius}`);
    if(shellGeometry.margin!=="0px")throw new Error(`Text Scene must have no outer margin on phone (workspace exposure risk): ${shellGeometry.margin}`);

    // Editor genuinely focused after the normal opening path.
    const focusedIsEditor=await page.evaluate(()=>document.activeElement.closest("#fullSceneTextEditor")!==null);
    if(!focusedIsEditor)throw new Error("Text Scene must focus the writing surface after opening");

    // Underlying workspace must not be hit-test reachable while open -- the
    // same probe point as the Quick Scene regression (bottom-left, where the
    // real-phone screenshot showed the exposed strip and the floating
    // "Навигация" control before the fullscreen fix).
    const pointBelongsToTextScene=await page.evaluate(()=>{
      const el=document.elementFromPoint(20,window.innerHeight-10);
      return el!==null&&el.closest("#textModal")!==null;
    });
    if(!pointBelongsToTextScene)throw new Error("Underlying workspace must not be reachable while Text Scene is open");

    const pageOverflow={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth)};
    if(pageOverflow.scrollWidth>pageOverflow.clientWidth+geometryTolerance)throw new Error(`Text Scene introduced page-level horizontal overflow: ${JSON.stringify(pageOverflow)}`);

    // Essential action: Save (without closing) -- existing contract.
    await page.locator("#fullSceneTextEditor .ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.locator("#fullSceneTextEditor .ProseMirror").pressSequentially(" Добавлено.");
    await page.tap("#saveText");
    await page.waitForFunction(()=>data.scenes.find(s=>s.id==="scene-a").sceneText.includes("Добавлено."));
    if(await page.$eval("#textModal",node=>node.style.display)!=="flex")throw new Error("Save must not close Text Scene");

    // Essential action: Find/Replace entry point still opens on this
    // surface, still reachable inside the fullscreen shell.
    await page.tap("#fullSceneTextToolbar .rte-btn-find");
    await page.waitForSelector("#fullSceneTextFindReplace .rte-find-input",{state:"visible"});
    await page.tap("#fullSceneTextFindReplace .rte-find-close");
    if(await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Find/Replace panel did not close");

    // Essential action: "Редактор сцены" handoff -- switches surfaces
    // without prompting to save (Text Scene has no non-text dirty state),
    // carrying the live unsaved doc across.
    await page.tap(".rte-btn-switch-surface");
    await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    if(await page.evaluate(()=>document.getElementById("textModal").style.display)!=="none")throw new Error("Scene Editor handoff must close Text Scene");
    const handedOffText=await page.evaluate(()=>sceneModalTextEditor.serialize().sceneText);
    if(!handedOffText.includes("Добавлено."))throw new Error("Scene Editor handoff must carry the live unsaved text across");
    // Back to Text Scene the same way, confirming the reverse handoff too.
    await page.tap(".rte-btn-switch-surface");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    const backModalRect=await page.$eval("#textModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(viewportSize.height-backModalRect.bottom)>geometryTolerance)throw new Error("Text Scene must still be fullscreen after a round-trip handoff");

    // Essential action: close/discard guard -- an unsaved edit, then Close
    // prompts to discard (existing dirty-state contract, unchanged).
    await page.locator("#fullSceneTextEditor .ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.locator("#fullSceneTextEditor .ProseMirror").pressSequentially(" Ещё правка.");
    await page.tap("#closeText");
    await page.waitForFunction(()=>document.getElementById("discardChangesModal").style.display==="flex");
    await page.tap("#discardChanges");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");
    if(await page.evaluate(()=>data.scenes.find(s=>s.id==="scene-a").sceneText.includes("Ещё правка.")))throw new Error("Discarding must not persist the unsaved edit");

    // Closing restores normal workspace interaction -- same probe point as
    // above must now resolve outside Text Scene.
    const pointRestored=await page.evaluate(()=>{
      const el=document.elementFromPoint(20,window.innerHeight-10);
      return el===null||el.closest("#textModal")===null;
    });
    if(!pointRestored)throw new Error("Closing Text Scene must restore normal workspace interaction");

    // Stage E3.1.2: real-phone review rejected E3.1.1's per-row independent
    // scroll (every row owned two competing gestures, and each row scrolled
    // to its own independent position). `.rte-project-results` -- the
    // results LIST, already the vertical scroll owner -- is now the ONE
    // shared horizontal scroll owner; individual rows must NOT be
    // independently scrollable, and scrolling the shared surface must move
    // every visible row by the identical amount.
    await page.evaluate(()=>openSceneText("scene-c"));
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    await page.tap("#fullSceneTextToolbar .rte-btn-find");
    await page.tap('#fullSceneTextFindReplace .rte-scope-btn:not(.active)');
    await page.locator("#fullSceneTextFindReplace .rte-find-input").fill("ГОРИЗОНТМАРКЕР");
    await page.waitForSelector(".rte-project-result-row");
    const rowCount=await page.locator(".rte-project-result-row").count();
    if(rowCount<2)throw new Error(`Test fixture must produce multiple result rows to prove they share one coordinate space: found ${rowCount}`);

    // A. Stage E3.1.3 superseded the old "row's own scrollWidth exceeds its
    // clientWidth" fixture check here: that was true precisely BECAUSE of
    // the E3.1.2 defect (ink overflowing a box clamped to width:100%) --
    // after this fix, a row's own box correctly SIZES to its content
    // (`width:max-content`), so `scrollWidth===clientWidth` at the ROW
    // level is now the CORRECT state (nothing is clipped/overflowing
    // inside an individual row any more). The equivalent fixture-sanity
    // proof now lives below, where at least one row's own rendered WIDTH
    // must exceed the phone viewport.
    // Stage E3.1.3: each row's own BOX (not just its ink/painted text) must
    // size to ITS OWN content -- the E3.1.2 defect was that every row's box
    // stayed clamped at the shared list's visible width (`width:100%`),
    // which is why background/border (painted only inside the box) and the
    // reported hit-test boundary both stopped at the original viewport
    // edge even though the ink kept painting further right. Two proofs:
    // (1) rows built from genuinely different-length source text must NOT
    // all report the identical box width (that would mean every box is
    // still clamped to the container instead of sized to its own content);
    // (2) at least one row's own box must be wider than the phone viewport
    // itself -- proof that the BOX, not merely unclipped ink, extends past
    // the visible area.
    // Stage E3.2.8 supersedes the E3.1.3 "rows hug their own content"
    // half of that proof (the old assertion here required different-length
    // rows to report DIFFERENT box widths). Real-phone review rejected it:
    // a short row's border/background then ended shortly after its text
    // while a long sibling kept going. The contract is now ONE shared
    // scroll-content canvas (`.rte-project-results-canvas`) and every row
    // spans it -- so all rows report the SAME width, equal to the canvas'
    // content width, which in turn is the widest row's natural width. What
    // E3.1.3 actually protected (the BOX, not just its ink, covers the
    // revealed continuation) still holds, more strongly: half (2) below.
    const rowWidths=await page.$$eval(".rte-project-result-row",els=>els.map(el=>el.getBoundingClientRect().width));
    const canvasContentWidth=await page.$eval(".rte-project-results-canvas",el=>{const cs=getComputedStyle(el);return el.getBoundingClientRect().width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)});
    if(rowWidths.some(w=>Math.abs(w-canvasContentWidth)>1))throw new Error(`Every result row must span the shared scroll canvas' full content width (${canvasContentWidth}): ${JSON.stringify(rowWidths)}`);
    if(Math.max(...rowWidths)<=viewportSize.width)throw new Error(`At least one row's own box must genuinely exceed the phone viewport width (not just its ink): widths=${JSON.stringify(rowWidths)}, viewport=${viewportSize.width}`);

    // C. Individual rows must NOT be independent scroll owners. Two checks,
    // per the explicit E3.1.1 lesson (a bare scrollLeft-moves check already
    // once passed against CSS that was actually broken, because Chromium
    // accepts a programmatic scrollLeft assignment even on some non-scroll
    // elements): (1) computed overflow-x must not be auto/scroll -- it must
    // be genuinely `visible`, the value that makes a box NOT a scroll
    // container at all; (2) as the actual behavioral proof, assigning
    // scrollLeft to an `overflow:visible` box is a documented no-op in
    // every browser (there is no clipped viewport for it to scroll within),
    // unlike the `overflow:hidden` case E3.1.1 had to work around.
    const rowOverflowX=await page.$eval(".rte-project-result-row",el=>getComputedStyle(el).overflowX);
    if(rowOverflowX!=="visible")throw new Error(`Individual result rows must not be scroll containers (overflow-x must be "visible"): overflow-x=${rowOverflowX}`);
    const rowScrollAttempt=await page.$eval(".rte-project-result-row",el=>{el.scrollLeft=200;return el.scrollLeft});
    if(rowScrollAttempt!==0)throw new Error(`A row with overflow-x:visible must ignore scrollLeft assignment (not be independently scrollable): scrollLeft became ${rowScrollAttempt}`);

    // D. The shared results surface IS the horizontal scroll owner.
    const listOverflow=await page.$eval(".rte-project-results",el=>({overflowX:getComputedStyle(el).overflowX,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    if(listOverflow.overflowX==="hidden")throw new Error(`The shared results surface must be horizontally scrollable: overflow-x=${listOverflow.overflowX}`);
    if(listOverflow.scrollWidth<=listOverflow.clientWidth)throw new Error(`The shared results surface did not actually overflow horizontally: ${JSON.stringify(listOverflow)}`);

    // E/F. Scrolling the shared owner moves ALL visible rows by the exact
    // same amount (one shared horizontal coordinate space), and a row
    // remains tappable/navigates to the correct match afterward.
    const rectsBefore=await page.$$eval(".rte-project-result-row",els=>els.map(el=>el.getBoundingClientRect().left));
    const listScrollLeftAfter=await page.$eval(".rte-project-results",el=>{el.scrollLeft=200;return el.scrollLeft});
    if(listScrollLeftAfter<=0)throw new Error("The shared results surface did not actually scroll when scrollLeft was set");
    const rectsAfter=await page.$$eval(".rte-project-result-row",els=>els.map(el=>el.getBoundingClientRect().left));
    const deltas=rectsBefore.map((b,i)=>Math.round((b-rectsAfter[i])*100)/100);
    if(new Set(deltas).size!==1)throw new Error(`All result rows must move by the identical horizontal amount when the shared surface scrolls: ${JSON.stringify({rectsBefore,rectsAfter,deltas})}`);
    if(deltas[0]<=0)throw new Error(`Result rows did not actually shift when the shared surface scrolled: deltas=${JSON.stringify(deltas)}`);

    // Stage E3.1.3 hit-geometry proof: the exact real-phone defect was that
    // the same logical row visually split into a highlighted part and a
    // plain part at the original viewport edge. Start with a DIFFERENT row
    // active (baseline), then probe a point on the WIDEST row's revealed
    // continuation -- to the right of where the row's box used to end
    // under E3.1.2 -- and prove it (1) is geometrically inside that row's
    // own (correctly widened) box, (2) hit-tests via the real browser
    // engine to a descendant of that row, (3) is covered by that row's own
    // `.active`-eligible box (not a plain unstyled remainder), and (4) a
    // genuine COORDINATE click at that exact point (not a Playwright
    // locator click, which targets an element's center regardless of
    // scroll) navigates to THAT row's own match. This does not rely on
    // programmatic scrollLeft alone: elementFromPoint + a real coordinate
    // click is the actual browser hit-testing and event path.
    const widestRowIndex=rowWidths.indexOf(Math.max(...rowWidths));
    const baselineRowIndex=(widestRowIndex+1)%rowWidths.length;
    const baselineMatchId=await page.$$eval(".rte-project-result-row",(els,i)=>els[i].dataset.matchId,baselineRowIndex);
    await page.locator(".rte-project-result-row").nth(baselineRowIndex).click();
    await page.waitForFunction(id=>document.querySelector(".rte-project-result-row.active")?.dataset.matchId===id,baselineMatchId);

    const widestRowMatchId=await page.$$eval(".rte-project-result-row",(els,i)=>els[i].dataset.matchId,widestRowIndex);
    const revealedContinuationProbe=await page.evaluate(({index,vw})=>{
      const row=document.querySelectorAll(".rte-project-result-row")[index];
      const rect=row.getBoundingClientRect();
      const probeX=vw-10;
      const probeY=rect.top+rect.height/2;
      const el=document.elementFromPoint(probeX,probeY);
      return {
        rowRect:{left:rect.left,right:rect.right},
        probeX,probeY,
        probeIsWithinRowBox:probeX>=rect.left&&probeX<=rect.right,
        hitIsInsideRow:el?el.closest(".rte-project-result-row")===row:false
      };
    },{index:widestRowIndex,vw:viewportSize.width});
    if(!revealedContinuationProbe.probeIsWithinRowBox)throw new Error(`The revealed continuation must still be within the target row's own box (not clamped to the original viewport width): ${JSON.stringify(revealedContinuationProbe)}`);
    if(!revealedContinuationProbe.hitIsInsideRow)throw new Error(`A point on the revealed continuation must hit-test into the same result row: ${JSON.stringify(revealedContinuationProbe)}`);

    // The real coordinate tap: activates the WIDEST row's own match, proving
    // the revealed continuation is both painted (background will follow, see
    // below) and genuinely live/tappable at that exact point.
    await page.mouse.click(revealedContinuationProbe.probeX,revealedContinuationProbe.probeY);
    await page.waitForFunction(id=>document.querySelector(".rte-project-result-row.active")?.dataset.matchId===id,widestRowMatchId);
    const activeRowCoversPoint=await page.evaluate(({index,x,y})=>{
      const row=document.querySelectorAll(".rte-project-result-row")[index];
      if(!row.classList.contains("active"))return false;
      const el=document.elementFromPoint(x,y);
      return el?el.closest(".rte-project-result-row.active")===row:false;
    },{index:widestRowIndex,x:revealedContinuationProbe.probeX,y:revealedContinuationProbe.probeY});
    if(!activeRowCoversPoint)throw new Error("After activating the widest row via a real coordinate click on its revealed continuation, that same point must resolve inside the now-active row (its painted background must cover the point it was just clicked at)");

    // G. Vertical result-list browsing still works independently.
    const verticalScrollProbe=await page.$eval(".rte-project-results",el=>{const before=el.scrollTop;el.scrollTop=999;const after=el.scrollTop;return {before,after}});
    if(verticalScrollProbe.after<=verticalScrollProbe.before)throw new Error(`Vertical result-list browsing must still work: ${JSON.stringify(verticalScrollProbe)}`);

    // H. Contained: the Text Scene outer surface, the page, and the
    // manuscript editor's own vertical scroll must be unaffected.
    const outerModalRect=await page.$eval("#textModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(viewportSize.width-outerModalRect.right)>geometryTolerance||Math.abs(outerModalRect.left-0)>geometryTolerance)throw new Error(`Text Scene's outer surface must not gain horizontal scroll/offset from the results surface: ${JSON.stringify(outerModalRect)}`);
    const pageOverflowAfterResultScroll={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth),windowScrollX:await page.evaluate(()=>window.scrollX)};
    if(pageOverflowAfterResultScroll.scrollWidth>pageOverflowAfterResultScroll.clientWidth+geometryTolerance)throw new Error(`Results-surface scroll leaked into page-level horizontal overflow: ${JSON.stringify(pageOverflowAfterResultScroll)}`);
    if(pageOverflowAfterResultScroll.windowScrollX!==0)throw new Error(`Results-surface scroll must not move the page itself: windowScrollX=${pageOverflowAfterResultScroll.windowScrollX}`);
    const editorScrollProbe=await page.$eval("#fullSceneTextEditor",el=>{const before=el.scrollTop;el.scrollTop=el.scrollHeight;const after=el.scrollTop;el.scrollTop=before;return {before,after}});
    if(editorScrollProbe.after<0)throw new Error("Editor vertical scroll should be unaffected by the results-surface horizontal scroll fix");

    // Stage E3.2.2 real-phone microfix: the results/manuscript resizer
    // handle already used Pointer Events end-to-end (pointerdown/
    // pointermove/pointerup/pointercancel, setPointerCapture) -- real
    // Android touch still didn't drag it. Root cause: `touch-action` was
    // unset, so the browser was free to treat the vertical drag as a
    // native scroll/pan gesture on the handle instead of delivering clean
    // pointermove deltas; `event.preventDefault()` in the pointerdown
    // handler is not a reliable substitute (touch-action is resolved by
    // the compositor before JS runs). Fixed with `touch-action:none`,
    // scoped to only the handle (css/editor.css).
    //
    // Honesty note on fidelity: a plain `element.dispatchEvent(new
    // TouchEvent(...))` would only fire JS listeners and would NOT
    // exercise the browser's actual touch/gesture/scroll pipeline that
    // `touch-action` governs -- it would pass identically whether or not
    // the CSS fix was present, proving nothing about the real defect. The
    // CDP `Input.dispatchTouchEvent` sequence below instead drives
    // Chromium's real touch input pipeline (the same one a physical
    // touchscreen feeds), which is the closest this environment can get to
    // a genuine touch drag without an actual device -- confirmed by
    // reverting only the CSS fix and observing this exact sequence produce
    // a partial, scroll-intercepted resize (140->160px for a 100px drag)
    // instead of the full expected delta; final acceptance is still a real
    // Android device, as it was for every other Stage E geometry fix.
    const resizerTouchAction=await page.$eval(".rte-project-results-resizer",el=>getComputedStyle(el).touchAction);
    if(resizerTouchAction!=="none")throw new Error(`Results resizer must disable native touch gestures so a drag isn't intercepted as a scroll: touch-action=${resizerTouchAction}`);

    const cdp=await page.context().newCDPSession(page);
    const dragTouch=async(startY,deltaY,steps=10)=>{
      const box=await page.$eval(".rte-project-results-resizer",el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x,y:startY??box.y,id:1}]});
      const baseY=startY??box.y;
      for(let i=1;i<=steps;i++){
        await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x,y:baseY+(deltaY*i)/steps,id:1}]});
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      await page.waitForTimeout(50);
    };

    // Stage E3.2.7: #textModal now obeys the SAME shared-region splitter
    // contract accepted for #sceneModal in E3.2.6 -- generalized via the
    // exact same `.rte-manuscript-region`/`manuscriptRegion` mechanism
    // (find-replace-panel.js, index.html, css/editor.css), not a second,
    // unrelated workaround. Real-phone testing found #textModal's own
    // PRE-E3.2.7 architecture (toolbar/Find/Replace/results/editor ALL
    // sharing its one fixed-height flex column) let the manuscript
    // collapse to ~26px at MAX_RESULTS_HEIGHT, the splitter travel far
    // downward, and the sticky footer effectively vanish from the
    // composition -- confirmed BEFORE this stage's fix via direct
    // measurement (see docs/responsive-workspace-architecture.md's E3.2.7
    // section). This block proves the corrected contract numerically:
    // results/manuscript exchange height in OPPOSITE directions within a
    // STABLE shared-region total, the manuscript never drops below its
    // practical minimum, and -- unlike #sceneModal, which has an outer
    // scrolling modal -- #textModal's own `.modal` height AND its sticky
    // footer's position must both stay completely fixed throughout,
    // since `#textModal .modal{overflow:hidden}` never scrolls at all.
    const textSceneGeometry=()=>page.evaluate(()=>{
      const editor=document.getElementById("fullSceneTextEditor");
      const region=document.querySelector("#textModal .rte-manuscript-region");
      if(!region)throw new Error("#textModal .rte-manuscript-region does not exist -- pre-E3.2.7 architecture");
      const modal=document.querySelector("#textModal .modal");
      const results=document.querySelector(".rte-project-results");
      const footer=document.querySelector("#textModal .modal-actions.sticky-modal-footer");
      const editorRect=editor.getBoundingClientRect();
      const regionRect=region.getBoundingClientRect();
      const footerRect=footer.getBoundingClientRect();
      return {
        editorHeight:editorRect.height,
        editorBottomOverflow:editorRect.bottom-regionRect.bottom,
        regionHeight:regionRect.height,
        modalHeight:modal.getBoundingClientRect().height,
        resultsHeight:results?results.getBoundingClientRect().height:null,
        footerTop:footerRect.top,
        footerHeight:footerRect.height,
        footerVisible:footerRect.height>0&&footerRect.top<window.innerHeight&&footerRect.bottom>0,
        windowScrollY:window.scrollY
      };
    });
    const textSceneHeightTolerance=4;
    const textSceneManuscriptMin=140;

    const beforeDrag=await textSceneGeometry();
    if(beforeDrag.resultsHeight==null)throw new Error("Project mode must show a results pane before this drag sequence begins");
    if(!beforeDrag.footerVisible)throw new Error(`The sticky footer must be visible/reachable before any drag: ${JSON.stringify(beforeDrag)}`);
    // Splitter must be genuinely touchable (not occluded by anything) the
    // very first time it appears -- the same reachability contract as
    // #sceneModal (E3.2.5/E3.2.6), now proven for #textModal too.
    const textSceneResizerReachable=await page.evaluate(()=>{
      const resizer=document.querySelector(".rte-project-results-resizer");
      const r=resizer.getBoundingClientRect();
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return hit===resizer||resizer.contains(hit);
    });
    if(!textSceneResizerReachable)throw new Error("The results-pane resizer must be genuinely touchable as soon as it first appears in Text Scene");

    const heightBeforeDrag=await page.$eval(".rte-project-results",el=>el.getBoundingClientRect().height);
    await dragTouch(undefined,100);
    const heightAfterDrag=await page.$eval(".rte-project-results",el=>el.getBoundingClientRect().height);
    if(Math.abs(heightAfterDrag-heightBeforeDrag-100)>10)throw new Error(`A genuine touch drag on the resizer must resize the results pane by roughly the drag distance: before=${heightBeforeDrag}, after=${heightAfterDrag}`);

    const afterGrow=await textSceneGeometry();
    const growResultsDelta=afterGrow.resultsHeight-beforeDrag.resultsHeight;
    const growEditorDelta=afterGrow.editorHeight-beforeDrag.editorHeight;
    if(Math.abs(growEditorDelta+growResultsDelta)>textSceneHeightTolerance)throw new Error(`Results growth must be paid for by the manuscript shrinking by approximately the SAME amount, not by the outer modal: resultsDelta=${growResultsDelta}, editorDelta=${growEditorDelta}`);
    if(Math.abs(afterGrow.regionHeight-beforeDrag.regionHeight)>textSceneHeightTolerance)throw new Error(`The shared region's own total height must stay stable across a drag: before=${beforeDrag.regionHeight}, after=${afterGrow.regionHeight}`);
    if(Math.abs(afterGrow.modalHeight-beforeDrag.modalHeight)>textSceneHeightTolerance)throw new Error(`#textModal's own fixed modal height must never move as a consequence of the splitter drag: before=${beforeDrag.modalHeight}, after=${afterGrow.modalHeight}`);
    if(Math.abs(afterGrow.footerTop-beforeDrag.footerTop)>textSceneHeightTolerance)throw new Error(`The sticky footer must not be pushed away by results growth: before=${beforeDrag.footerTop}, after=${afterGrow.footerTop}`);
    if(!afterGrow.footerVisible)throw new Error(`The sticky footer must remain visible/reachable after growing results: ${JSON.stringify(afterGrow)}`);
    if(afterGrow.windowScrollY!==0)throw new Error(`Resizing the results pane must never scroll the page itself: windowScrollY=${afterGrow.windowScrollY}`);
    if(afterGrow.editorBottomOverflow>1)throw new Error(`Manuscript bottom border/rounded corners must not be clipped by the shared region after a grow drag: ${afterGrow.editorBottomOverflow}px`);

    // Reverse direction: shrinking results must return the exact same
    // amount to the manuscript.
    await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
    const beforeShrink=await textSceneGeometry();
    await dragTouch(undefined,-60);
    const afterShrink=await textSceneGeometry();
    const shrinkResultsDelta=beforeShrink.resultsHeight-afterShrink.resultsHeight;
    const shrinkEditorDelta=afterShrink.editorHeight-beforeShrink.editorHeight;
    if(shrinkResultsDelta<40)throw new Error(`Dragging the splitter up must shrink the results pane substantially: before=${beforeShrink.resultsHeight}, after=${afterShrink.resultsHeight}`);
    if(Math.abs(shrinkEditorDelta-shrinkResultsDelta)>textSceneHeightTolerance)throw new Error(`Results shrinkage must be RETURNED to the manuscript by approximately the same amount: resultsShrink=${shrinkResultsDelta}, editorGrowth=${shrinkEditorDelta}`);
    if(Math.abs(afterShrink.regionHeight-beforeShrink.regionHeight)>textSceneHeightTolerance)throw new Error(`The shared region's own total height must stay stable across the reverse drag too: before=${beforeShrink.regionHeight}, after=${afterShrink.regionHeight}`);
    if(Math.abs(afterShrink.footerTop-beforeShrink.footerTop)>textSceneHeightTolerance)throw new Error(`The sticky footer must not move during the reverse drag either: before=${beforeShrink.footerTop}, after=${afterShrink.footerTop}`);

    // Repeated grow/shrink cycles must not drift.
    let textSceneCyclePrev=await textSceneGeometry();
    for(let cycle=0;cycle<3;cycle++){
      await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
      await dragTouch(undefined,50);
      await dragTouch(undefined,-50);
      const cycleAfter=await textSceneGeometry();
      if(Math.abs(cycleAfter.resultsHeight-textSceneCyclePrev.resultsHeight)>textSceneHeightTolerance)throw new Error(`Repeated grow/shrink cycle ${cycle} drifted the results height: before=${textSceneCyclePrev.resultsHeight}, after=${cycleAfter.resultsHeight}`);
      if(Math.abs(cycleAfter.editorHeight-textSceneCyclePrev.editorHeight)>textSceneHeightTolerance)throw new Error(`Repeated grow/shrink cycle ${cycle} drifted the manuscript height: before=${textSceneCyclePrev.editorHeight}, after=${cycleAfter.editorHeight}`);
      if(Math.abs(cycleAfter.regionHeight-textSceneCyclePrev.regionHeight)>textSceneHeightTolerance)throw new Error(`Repeated grow/shrink cycle ${cycle} drifted the shared region's total height: before=${textSceneCyclePrev.regionHeight}, after=${cycleAfter.regionHeight}`);
      textSceneCyclePrev=cycleAfter;
    }

    // Scope toggling (Эта сцена -> Весь проект -> Эта сцена -> Весь проект)
    // must not drift the geometry either.
    await page.tap('#fullSceneTextFindReplace .rte-scope-btn:not(.active)'); // -> scene
    await page.waitForTimeout(60);
    const textSceneBackToScene=await textSceneGeometry();
    if(Math.abs(textSceneBackToScene.regionHeight-beforeDrag.regionHeight)>textSceneHeightTolerance)throw new Error(`Leaving project scope must not drift the shared region's total height: expected~=${beforeDrag.regionHeight}, got=${textSceneBackToScene.regionHeight}`);
    await page.tap('#fullSceneTextFindReplace .rte-scope-btn:not(.active)'); // -> project
    await page.waitForTimeout(60);
    const textSceneBackToProject=await textSceneGeometry();
    if(textSceneBackToProject.resultsHeight==null)throw new Error("Re-entering project scope must show the results pane again in Text Scene");
    if(Math.abs(textSceneBackToProject.regionHeight-beforeDrag.regionHeight)>textSceneHeightTolerance)throw new Error(`Re-entering project scope must not have drifted the shared region's own total height: before=${beforeDrag.regionHeight}, re-entered=${textSceneBackToProject.regionHeight}`);

    // Min/max clamping still applies to a touch drag -- MAX must now also
    // respect the manuscript's practical minimum instead of allowing the
    // ~26px real-phone collapse (the exact real-device defect this stage
    // fixes). This is also the baseline-failure-proof drag: unmodified
    // fcf92df has no `.rte-manuscript-region` for #textModal at all, so
    // `textSceneGeometry()` above already fails immediately there; even a
    // hypothetical partial backport that only skipped the min-height
    // floor would be caught by the assertion below.
    await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
    const beforeMaxDrag=await textSceneGeometry();
    await dragTouch(undefined,2000,20);
    const heightAfterMaxDrag=await page.$eval(".rte-project-results",el=>el.getBoundingClientRect().height);
    if(heightAfterMaxDrag>420+2)throw new Error(`Touch drag must still respect the max results height: ${heightAfterMaxDrag}`);
    const afterMaxDrag=await textSceneGeometry();
    if(afterMaxDrag.editorHeight<textSceneManuscriptMin-textSceneHeightTolerance)throw new Error(`Even an extreme drag must never crush the manuscript below its practical minimum (${textSceneManuscriptMin}px) -- this is the exact real-phone collapse-to-~26px defect: ${afterMaxDrag.editorHeight}`);
    if(Math.abs(afterMaxDrag.regionHeight-beforeMaxDrag.regionHeight)>textSceneHeightTolerance)throw new Error(`An extreme drag clamped to MAX must still keep the shared region's total height stable: before=${beforeMaxDrag.regionHeight}, after=${afterMaxDrag.regionHeight}`);
    if(Math.abs(afterMaxDrag.footerTop-beforeMaxDrag.footerTop)>textSceneHeightTolerance)throw new Error(`An extreme MAX drag must not push the sticky footer away: before=${beforeMaxDrag.footerTop}, after=${afterMaxDrag.footerTop}`);
    if(!afterMaxDrag.footerVisible)throw new Error(`The sticky footer must remain visible/reachable even at an extreme MAX drag: ${JSON.stringify(afterMaxDrag)}`);
    if(afterMaxDrag.editorBottomOverflow>1)throw new Error(`Manuscript bottom border/rounded corners must not be clipped at an extreme MAX drag: ${afterMaxDrag.editorBottomOverflow}px`);

    await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
    await dragTouch(undefined,-2000,20);
    const heightAfterMinDrag=await page.$eval(".rte-project-results",el=>el.getBoundingClientRect().height);
    if(heightAfterMinDrag<90-2)throw new Error(`Touch drag must still respect the min results height: ${heightAfterMinDrag}`);
    const afterMinDrag=await textSceneGeometry();
    if(!afterMinDrag.footerVisible)throw new Error(`The sticky footer must remain visible/reachable at an extreme MIN drag too: ${JSON.stringify(afterMinDrag)}`);

    // The resizer's own drag must not disturb the shared horizontal
    // project-results scroll model (E3.1.2/E3.1.3) or vertical browsing.
    const rowOverflowXAfterResize=await page.$eval(".rte-project-result-row",el=>getComputedStyle(el).overflowX);
    if(rowOverflowXAfterResize!=="visible")throw new Error(`Individual rows must still not be independent scroll owners after a resize: overflow-x=${rowOverflowXAfterResize}`);
    const listOverflowXAfterResize=await page.$eval(".rte-project-results",el=>getComputedStyle(el).overflowX);
    if(listOverflowXAfterResize==="hidden")throw new Error(`The shared results surface must still be horizontally scrollable after a resize: overflow-x=${listOverflowXAfterResize}`);
    const verticalScrollAfterResize=await page.$eval(".rte-project-results",el=>{const before=el.scrollTop;el.scrollTop=999;const after=el.scrollTop;return {before,after}});
    if(verticalScrollAfterResize.after<=verticalScrollAfterResize.before)throw new Error(`Vertical result-list browsing must still work after a resize: ${JSON.stringify(verticalScrollAfterResize)}`);

    await page.tap("#fullSceneTextFindReplace .rte-find-close");
    await page.tap("#closeText");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");

    // Normal open path #2: Stage E1's Navigation drawer scene tap, opening a
    // genuinely long scene -- checks internal manuscript scroll ownership.
    await page.tap("#mobileNavTrigger");
    await page.waitForFunction(()=>document.getElementById("mobileNavModal").style.display==="flex");
    await page.tap('.mobile-nav-scene:has-text("Длинная сцена")');
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    if(await page.evaluate(()=>textEditingSceneId)!=="scene-b")throw new Error("Navigation scene tap opened Text Scene for the wrong scene");

    const longModalRect=await page.$eval("#textModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(viewportSize.height-longModalRect.bottom)>geometryTolerance)throw new Error(`Long scene Text Scene must still reach the viewport bottom: bottom=${longModalRect.bottom}`);

    // The manuscript -- not the page -- owns the scroll: it must genuinely
    // exceed its own visible height, actually scroll internally, and doing
    // so must not move the page itself or introduce horizontal overflow.
    const scrollProbe=await page.evaluate(()=>{
      const editor=document.getElementById("fullSceneTextEditor");
      const before={scrollHeight:editor.scrollHeight,clientHeight:editor.clientHeight};
      editor.scrollTop=editor.scrollHeight;
      return {before,afterScrollTop:editor.scrollTop,windowScrollY:window.scrollY};
    });
    if(scrollProbe.before.scrollHeight<=scrollProbe.before.clientHeight)throw new Error("Long scene fixture did not actually exceed the editor's visible height -- test fixture too short");
    if(scrollProbe.afterScrollTop<=0)throw new Error("Manuscript did not scroll internally for a long scene");
    if(scrollProbe.windowScrollY!==0)throw new Error(`Scrolling the manuscript should not move the page itself: windowScrollY=${scrollProbe.windowScrollY}`);
    const longPageOverflow={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth)};
    if(longPageOverflow.scrollWidth>longPageOverflow.clientWidth+geometryTolerance)throw new Error(`Long scene scrolling introduced page-level horizontal overflow: ${JSON.stringify(longPageOverflow)}`);

    // Typing near the end remains practical: caret reachable via the normal
    // click+End path, insertion lands correctly, toolbar/footer stay fixed
    // (not swept into the manuscript's own scroll).
    await page.locator("#fullSceneTextEditor .ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.locator("#fullSceneTextEditor .ProseMirror").pressSequentially(" КОНЕЦ ПРОВЕРКИ.");
    if(!await page.isVisible("#fullSceneTextToolbar"))throw new Error("Toolbar must remain visible/fixed while editing near the end of a long scene");
    if(!await page.locator("#textModal .modal-actions").isVisible())throw new Error("Footer actions must remain visible/fixed while editing near the end of a long scene");
    await page.tap("#saveText");
    await page.waitForFunction(()=>data.scenes.find(s=>s.id==="scene-b").sceneText.includes("КОНЕЦ ПРОВЕРКИ."));

    await page.tap("#closeText");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");

    if(pageErrors.length)throw new Error(`Unexpected page errors: ${pageErrors.join("; ")}`);
    await page.close();
  }

  // --- Desktop: Text Scene remains an ordinary centered, non-fullscreen
  // modal -- existing behavior fully preserved. ---
  {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    page.setDefaultTimeout(5000);
    await page.addInitScript(value=>{if(sessionStorage.getItem("mobile-text-scene-desktop-seeded"))return;sessionStorage.setItem("mobile-text-scene-desktop-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
    await page.evaluate(()=>{openSceneText("scene-a")});
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");

    const modalRect=await page.$eval("#textModal .modal",el=>el.getBoundingClientRect().toJSON());
    const shellGeometry=await page.$eval("#textModal .modal",el=>{const s=getComputedStyle(el);return {width:s.width,borderRadius:s.borderRadius}});
    if(modalRect.left<=0||modalRect.top<=0)throw new Error(`Desktop Text Scene must remain a centered modal, not fullscreen: ${JSON.stringify(modalRect)}`);
    if(shellGeometry.borderRadius==="0px")throw new Error("Desktop Text Scene should keep its ordinary rounded modal corners");
    if(parseFloat(shellGeometry.width)>=1280)throw new Error(`Desktop Text Scene should not span the full viewport width: ${shellGeometry.width}`);

    // I. Desktop project-search results keep their existing clipped/
    // ellipsis presentation -- no shared horizontal scroll surface here,
    // Stage E3.1.2 is phone-only.
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click('#fullSceneTextFindReplace .rte-scope-btn:not(.active)');
    await page.locator("#fullSceneTextFindReplace .rte-find-input").fill("Текст");
    await page.waitForSelector(".rte-project-result-row");
    const desktopRowStyle=await page.$eval(".rte-project-result-row",el=>{const s=getComputedStyle(el);return {overflow:s.overflow,textOverflow:s.textOverflow}});
    if(desktopRowStyle.overflow!=="hidden"||desktopRowStyle.textOverflow!=="ellipsis")throw new Error(`Desktop result rows must keep their existing clip/ellipsis presentation, unchanged by Stage E3.1.2: ${JSON.stringify(desktopRowStyle)}`);
    const desktopListOverflow=await page.$eval(".rte-project-results",el=>({scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    if(desktopListOverflow.scrollWidth>desktopListOverflow.clientWidth)throw new Error(`Desktop results surface should have no horizontal overflow to scroll: ${JSON.stringify(desktopListOverflow)}`);

    // Stage E3.2.2: desktop mouse dragging of the results resizer must not
    // be regressed by the touch-action:none fix (touch-action only governs
    // touch/pen gesture handling, never mouse input).
    const resizerBox=await page.$eval(".rte-project-results-resizer",el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
    const desktopHeightBefore=await page.$eval(".rte-project-results",el=>el.getBoundingClientRect().height);
    await page.mouse.move(resizerBox.x,resizerBox.y);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x,resizerBox.y+80,{steps:8});
    await page.mouse.up();
    const desktopHeightAfter=await page.$eval(".rte-project-results",el=>el.getBoundingClientRect().height);
    if(Math.abs(desktopHeightAfter-desktopHeightBefore-80)>10)throw new Error(`Desktop mouse drag on the resizer must still work: before=${desktopHeightBefore}, after=${desktopHeightAfter}`);

    await page.click("#fullSceneTextFindReplace .rte-find-close");

    await page.click("#closeText");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");
    await page.close();
  }

  // Stage E3.2.10/E3.2.11: (1) Text Scene's footer wording matches the Scene Editor's
  // concise pair ("Сохранить", not "Сохранить текст") with unchanged ids/
  // handlers; "Весь текст" keeps its deliberately longer final action. (2)
  // "Весь текст" uses the phone width -- small deliberate 8px gutter instead of
  // the generic 20px backdrop padding -- with no page/modal horizontal overflow
  // and its sticky footer untouched; desktop/tablet widths unchanged.
  {
    const footerLabels=(page,modal)=>page.$$eval(`#${modal} .modal-actions button`,els=>els.map(e=>({id:e.id,text:e.textContent.trim(),primary:e.classList.contains("primary"),disabled:e.disabled})));
    const phone=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true,userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"});
    phone.setDefaultTimeout(5000);
    await phone.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await phone.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

    await phone.evaluate(()=>openSceneText("scene-a"));
    await phone.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    const textFooter=await footerLabels(phone,"textModal");
    if(JSON.stringify(textFooter.map(b=>[b.id,b.text,b.primary]))!==JSON.stringify([["closeText","Закрыть",false],["saveTextAndClose","Сохранить и закрыть",false],["saveText","Сохранить",true]]))throw new Error(`Text Scene footer must read Закрыть / Сохранить и закрыть / Сохранить with unchanged ids: ${JSON.stringify(textFooter)}`);
    // one line at the normal phone width: same button height as a single line of text
    const textBtnHeights=await phone.$$eval("#textModal .modal-actions button",els=>els.map(e=>Math.round(e.getBoundingClientRect().height)));
    if(new Set(textBtnHeights).size!==1||textBtnHeights[0]>40)throw new Error(`Text Scene footer labels must sit on one line at 412px wide: button heights ${JSON.stringify(textBtnHeights)}`);
    await phone.click("#closeText");
    await phone.waitForFunction(()=>document.getElementById("textModal").style.display==="none");

    await phone.evaluate(()=>openAllScenes());
    await phone.waitForFunction(()=>document.getElementById("allScenesModal").style.display==="flex");
    await phone.waitForSelector("#allScenesModal .rte-editor .ProseMirror");
    const allFooter=await footerLabels(phone,"allScenesModal");
    if(JSON.stringify(allFooter.map(b=>[b.id,b.text]))!==JSON.stringify([["closeAllScenes","Закрыть"],["saveAllScenesAndClose","Сохранить и закрыть"],["saveAllScenes","Сохранить все изменения"]]))throw new Error(`"Весь текст" must keep its multi-scene final action wording: ${JSON.stringify(allFooter)}`);
    const w=await phone.evaluate(()=>{
      const bd=document.getElementById("allScenesModal"),mo=bd.querySelector(".modal"),r=mo.getBoundingClientRect(),f=mo.querySelector(".modal-actions"),fr=f.getBoundingClientRect();
      mo.scrollTop=Math.floor((mo.scrollHeight-mo.clientHeight)/2);
      const fr2=f.getBoundingClientRect();
      return {vw:innerWidth,modalW:r.width,gutterL:r.left,gutterR:innerWidth-r.right,docOver:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        modalOver:mo.scrollWidth-mo.clientWidth,backdropOver:bd.scrollWidth-bd.clientWidth,scrolled:mo.scrollTop,
        footerPos:getComputedStyle(f).position,footerGap:mo.getBoundingClientRect().top+mo.clientHeight-fr2.bottom,inlineW:mo.style.width};
    });
    // Stage E3.2.11: on phone "Весь текст" is TRULY edge-to-edge -- no decorative
    // outer gutter of any size (the E3.2.10 8px value was superseded by real-
    // phone validation). Only the OUTER gutter is asserted zero; the modal's
    // internal 18px padding is content padding and is deliberately unchanged.
    if(w.gutterL>1||w.gutterR>1||Math.abs(w.modalW-w.vw)>1)throw new Error(`"Весь текст" must be edge-to-edge on phone (outer gutters <=1px, modal width == viewport): ${JSON.stringify(w)}`);
    if(w.docOver>1||w.modalOver>1||w.backdropOver>1)throw new Error(`"Весь текст" must not create horizontal overflow: ${JSON.stringify(w)}`);
    if(w.scrolled<100)throw new Error(`vacuous: the All Text modal must genuinely scroll to prove its footer is still sticky: ${JSON.stringify(w)}`);
    if(w.footerPos!=="sticky"||Math.abs(w.footerGap)>1)throw new Error(`"Весь текст" sticky footer must be unchanged (pinned while scrolled): ${JSON.stringify(w)}`);
    // The internal content padding is NOT the outer gutter and must survive.
    const internal=await phone.evaluate(()=>{const mo=document.querySelector("#allScenesModal .modal"),ed=mo.querySelector(".rte-editor").getBoundingClientRect();return {modalPad:getComputedStyle(mo).paddingLeft,editorLeft:ed.left}});
    if(internal.modalPad!=="18px"||internal.editorLeft<18)throw new Error(`"Весь текст" internal content padding must be preserved (only the outer gutter was removed): ${JSON.stringify(internal)}`);

    // Stage E3.2.11 post-search bottom band: the REAL sequence -- Find ->
    // "Весь проект" -> a result in a LATER scene -> the last scene -> next/previous
    // buttons -> close Find. Measured owner of the band: the sticky footer's
    // own `margin-top:16px` (css/modals.css), which a navigation to the last
    // scene exposes by scrolling to the end of the list. The Android-only
    // keyboard/visual-viewport behaviour cannot be driven by desktop CDP, so
    // this asserts the measurable cause and the resulting geometry only.
    const band=()=>phone.evaluate(()=>{
      const mo=document.querySelector("#allScenesModal .modal"),f=mo.querySelector(".modal-actions"),fr=f.getBoundingClientRect();
      const ctl=mo.querySelector(".rte-sticky-controls").getBoundingClientRect(),x=Math.round(innerWidth/2);
      let run=0;for(let y=Math.floor(fr.top)-1;y>ctl.bottom;y--){const e=document.elementFromPoint(x,y);if(e&&!e.closest(".all-scene-block")&&!e.closest(".rte-sticky-controls")&&!e.closest(".modal-actions"))run++;else break}
      const cards=[...mo.querySelectorAll(".all-scene-block")],last=cards[cards.length-1].getBoundingClientRect();
      const sel=getSelection().rangeCount?getSelection().getRangeAt(0).getBoundingClientRect():null;
      return {blankRun:run,atEnd:Math.round(mo.scrollTop)>=Math.round(mo.scrollHeight-mo.clientHeight)-1,scrollTop:Math.round(mo.scrollTop),
        lastCardToFooter:fr.top-last.bottom,footerPos:getComputedStyle(f).position,footerGap:mo.getBoundingClientRect().top+mo.clientHeight-fr.bottom,
        window:[ctl.bottom,fr.top],match:sel&&sel.height>0?[sel.top,sel.bottom]:null,footerMarginTop:getComputedStyle(f).marginTop};
    });
    const assertBand=(b,label,{needMatch=true}={})=>{
      if(b.blankRun>1)throw new Error(`[${label}] a blank band of ${b.blankRun}px sits directly above the sticky footer: ${JSON.stringify(b)}`);
      if(b.footerPos!=="sticky"||Math.abs(b.footerGap)>1)throw new Error(`[${label}] the footer must stay sticky/pinned: ${JSON.stringify(b)}`);
      if(needMatch){
        if(!b.match)throw new Error(`[${label}] the navigated-to match must be a real selection: ${JSON.stringify(b)}`);
        if(b.match[0]<b.window[0]-1||b.match[1]>b.window[1]+1)throw new Error(`[${label}] the target match is not revealed (hidden under the sticky controls or the footer): ${JSON.stringify(b)}`);
      }
    };
    await phone.$eval("#allScenesModal .modal",mo=>{mo.scrollTop=0});
    await phone.waitForTimeout(80);
    assertBand(await band(),"before any search",{needMatch:false});
    await phone.tap("#allScenesToolbar .rte-btn-find");
    await phone.tap("#allScenesFindReplace .rte-scope-btn:not(.active)");
    await phone.locator("#allScenesFindReplace .rte-find-input").fill(longLineKeyword);
    await phone.waitForSelector("#allScenesModal .rte-project-result-row");
    await phone.waitForTimeout(250);
    const rowsAll=phone.locator("#allScenesModal .rte-project-result-row");
    const rowTotal=await rowsAll.count();
    if(rowTotal<3)throw new Error(`fixture must give several results across scenes: ${rowTotal}`);
    const sceneOfActive=()=>phone.evaluate(()=>document.querySelector(".rte-project-result-row.active")?.closest(".rte-project-result-group")?.querySelector(".rte-project-result-scene-header")?.textContent||"");
    // a cross-scene navigation that is NOT the last scene (rows: scene c ... scene d)
    await rowsAll.first().tap();await phone.waitForTimeout(700);
    const firstScene=await sceneOfActive();
    assertBand(await band(),`after search navigation to "${firstScene}"`);
    // the LAST scene: scrolls to the end of the list -- the band's real trigger
    await rowsAll.nth(rowTotal-1).tap();await phone.waitForTimeout(700);
    const lastScene=await sceneOfActive();
    if(lastScene===firstScene)throw new Error(`fixture must navigate across scenes: ${firstScene} == ${lastScene}`);
    const atLast=await band();
    if(!atLast.atEnd)throw new Error(`vacuous: navigating to the last scene must scroll the list to its end: ${JSON.stringify(atLast)}`);
    assertBand(atLast,`after search navigation to the LAST scene "${lastScene}"`);
    if(Math.abs(atLast.lastCardToFooter)>1)throw new Error(`the last scene's card must meet the sticky footer with no reserved band: ${atLast.lastCardToFooter}px`);
    // next / previous result buttons (a key press would type into the focused editor)
    for(const [btn,label] of [[".rte-find-prev","previous"],[".rte-find-next","next"],[".rte-find-next","next (wrap)"]]){
      await phone.tap(`#allScenesFindReplace ${btn}`);await phone.waitForTimeout(600);
      assertBand(await band(),`after ${label} result`);
    }
    // closing Find/Replace
    await phone.tap("#allScenesFindReplace .rte-find-close");await phone.waitForTimeout(400);
    await phone.$eval("#allScenesModal .modal",mo=>{mo.scrollTop=mo.scrollHeight});await phone.waitForTimeout(150);
    assertBand(await band(),"after closing Find/Replace, scrolled to the end",{needMatch:false});

    // Scope: the phone-only footer/gutter rules are All-Text-only. The Scene
    // Editor's footer keeps its 16px margin-top (E3.2.9 geometry untouched).
    await phone.evaluate(()=>{forceCloseModal?.("allScenesModal")});
    await phone.evaluate(()=>editScene("scene-a"));
    await phone.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
    const sceneFooterMargin=await phone.$eval("#sceneModal .modal-actions",el=>getComputedStyle(el).marginTop);
    if(sceneFooterMargin!=="16px")throw new Error(`the Scene Editor footer margin must be unchanged (leak from the All Text rule?): ${sceneFooterMargin}`);
    await phone.close();

    // Desktop/tablet widths must not have changed (760px breakpoint only).
    for(const [vw,vh,expectW] of [[1280,800,1180],[768,1024,728]]){
      const desk=await browser.newPage({viewport:{width:vw,height:vh}});
      desk.setDefaultTimeout(5000);
      await desk.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
      for(let attempt=0;attempt<30;attempt++){try{await desk.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
      await desk.evaluate(()=>openAllScenes());
      await desk.waitForFunction(()=>document.getElementById("allScenesModal").style.display==="flex");
      const dw=await desk.$eval("#allScenesModal .modal",el=>Math.round(el.getBoundingClientRect().width));
      if(dw!==expectW)throw new Error(`"Весь текст" must keep its width at ${vw}px wide (phone-only change): expected ${expectW}, got ${dw}`);
      await desk.close();
    }
    // Edge-to-edge at the other representative phone widths (412 is covered above).
    for(const [vw,vh] of [[360,780],[375,812]]){
      const ph=await browser.newPage({viewport:{width:vw,height:vh},isMobile:true,hasTouch:true,userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"});
      ph.setDefaultTimeout(5000);
      await ph.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
      for(let attempt=0;attempt<30;attempt++){try{await ph.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
      await ph.evaluate(()=>openAllScenes());
      await ph.waitForFunction(()=>document.getElementById("allScenesModal").style.display==="flex");
      const g=await ph.evaluate(()=>{const bd=document.getElementById("allScenesModal"),mo=bd.querySelector(".modal"),r=mo.getBoundingClientRect();return {vw:innerWidth,left:r.left,right:innerWidth-r.right,width:r.width,backdropPad:getComputedStyle(bd).paddingLeft+"/"+getComputedStyle(bd).paddingRight,docOver:document.documentElement.scrollWidth-document.documentElement.clientWidth,modalOver:mo.scrollWidth-mo.clientWidth}});
      if(g.left>1||g.right>1||Math.abs(g.width-g.vw)>1||g.docOver>1||g.modalOver>1)throw new Error(`"Весь текст" must be edge-to-edge at ${vw}px wide: ${JSON.stringify(g)}`);
      await ph.close();
    }
  }

  // Stage E3.2.8: the same real-phone contract as Scene Editor, shared via
  // tools/mobile-splitter-contract.mjs (Text Scene has no outer scroll, so its
  // "outer modal did not scroll" checks hold trivially; the clipping and
  // horizontal-containment checks are the ones that bite here).
  await runSplitterContract({browser,base,surface:"text"});

  console.log("Mobile Text Scene browser tests passed");
}finally{await browser.close();server.kill()}
