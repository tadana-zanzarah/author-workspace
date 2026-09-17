import {createRequire} from "node:module";
import {spawn} from "node:child_process";

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
    const rowWidths=await page.$$eval(".rte-project-result-row",els=>els.map(el=>el.getBoundingClientRect().width));
    if(new Set(rowWidths.map(w=>Math.round(w))).size<2)throw new Error(`Rows built from different-length source text must have different own-box widths, not a shared clamped width: ${JSON.stringify(rowWidths)}`);
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
    await page.click("#fullSceneTextFindReplace .rte-find-close");

    await page.click("#closeText");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");
    await page.close();
  }

  console.log("Mobile Text Scene browser tests passed");
}finally{await browser.close();server.kill()}
