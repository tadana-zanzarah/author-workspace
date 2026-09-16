import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Long enough that the editor's own internal scroll region genuinely exceeds
// a phone viewport's visible height -- see the scroll-ownership check below.
const longText=Array.from({length:120},(_,i)=>`Абзац номер ${i+1}. `+"Текст сцены для проверки длинной прокрутки на телефоне. ".repeat(5)).join("\n\n");

// Stage E3.1.1: one long, unbroken (no line breaks) sentence containing a
// unique keyword -- a project-search result snippet built from this is
// reliably wider than a phone viewport, reproducing the real-phone
// unreachable-overflow defect in the result row.
const longLineKeyword="ГОРИЗОНТМАРКЕР";
const longLine=`Это очень длинное предложение с ключевым словом ${longLineKeyword} которое должно выходить далеко за пределы ширины экрана телефона и не помещаться в одну строку результата поиска совсем никак.`;

const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false}],locations:[],tags:[],future:{},scenes:[
  {id:"scene-a",title:"Короткая сцена",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:"Текст А",included:true,status:"floating",people:{}},
  {id:"scene-b",title:"Длинная сцена",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:longText,included:true,status:"floating",people:{}},
  {id:"scene-c",title:"Сцена с длинной строкой",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:longLine,included:true,status:"floating",people:{}}
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

    // Stage E3.1.1 real-phone microfix: a project-search result snippet
    // wider than the phone viewport must be horizontally reachable via the
    // result ROW's own scroll (the narrowest correct scroll owner -- see
    // css/editor.css's comment on `.rte-project-result-row`), while the
    // outer Text Scene surface, the page, and the manuscript editor must
    // NOT gain horizontal scroll as a side effect.
    await page.evaluate(()=>openSceneText("scene-c"));
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
    await page.tap("#fullSceneTextToolbar .rte-btn-find");
    await page.tap('#fullSceneTextFindReplace .rte-scope-btn:not(.active)');
    await page.locator("#fullSceneTextFindReplace .rte-find-input").fill("ГОРИЗОНТМАРКЕР");
    await page.waitForSelector(".rte-project-result-row");

    const rowOverflow=await page.$eval(".rte-project-result-row",el=>({scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    if(rowOverflow.scrollWidth<=rowOverflow.clientWidth)throw new Error(`Project result row fixture did not actually overflow horizontally -- test fixture too short: ${JSON.stringify(rowOverflow)}`);
    // The computed overflow-x value is what actually governs whether a real
    // touch drag can scroll this element -- `overflow:hidden` still accepts
    // a PROGRAMMATIC scrollLeft assignment in Chromium (scrollIntoView-style
    // scrolling works even on hidden-overflow elements), so checking that
    // scrollLeft merely "moves" is not sufficient to prove real swipe access;
    // it passed even against the unfixed CSS. overflow-x must genuinely be
    // auto/scroll, not hidden, for a touch drag to reach the rest of the text.
    const rowOverflowX=await page.$eval(".rte-project-result-row",el=>getComputedStyle(el).overflowX);
    if(rowOverflowX==="hidden")throw new Error(`Project result row must be touch-scrollable (overflow-x auto/scroll), not clipped: overflow-x=${rowOverflowX}`);
    const rowScrollProbe=await page.$eval(".rte-project-result-row",el=>{el.scrollLeft=200;return el.scrollLeft});
    if(rowScrollProbe<=0)throw new Error("Project result row did not scroll horizontally when scrollLeft was set");

    // Contained: the results LIST (the row's own scroll-parent), the Text
    // Scene outer surface, and the page must not have moved/gained scroll.
    const resultsListScrollLeft=await page.$eval(".rte-project-results",el=>{const before=el.scrollLeft;el.scrollLeft=999;const after=el.scrollLeft;el.scrollLeft=before;return after});
    if(resultsListScrollLeft!==0)throw new Error(`The results list itself must not scroll horizontally, only individual rows: scrollLeft=${resultsListScrollLeft}`);
    const outerModalRect=await page.$eval("#textModal .modal",el=>el.getBoundingClientRect().toJSON());
    if(Math.abs(viewportSize.width-outerModalRect.right)>geometryTolerance||Math.abs(outerModalRect.left-0)>geometryTolerance)throw new Error(`Text Scene's outer surface must not gain horizontal scroll/offset from the result row: ${JSON.stringify(outerModalRect)}`);
    const pageOverflowAfterResultScroll={scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth),clientWidth:await page.evaluate(()=>document.documentElement.clientWidth),windowScrollX:await page.evaluate(()=>window.scrollX)};
    if(pageOverflowAfterResultScroll.scrollWidth>pageOverflowAfterResultScroll.clientWidth+geometryTolerance)throw new Error(`Result-row scroll leaked into page-level horizontal overflow: ${JSON.stringify(pageOverflowAfterResultScroll)}`);
    if(pageOverflowAfterResultScroll.windowScrollX!==0)throw new Error(`Result-row scroll must not move the page itself: windowScrollX=${pageOverflowAfterResultScroll.windowScrollX}`);

    // Normal vertical scroll of the editor itself is unaffected by this
    // fix (different element, orthogonal axis).
    const editorScrollProbe=await page.$eval("#fullSceneTextEditor",el=>{const before=el.scrollTop;el.scrollTop=el.scrollHeight;const after=el.scrollTop;el.scrollTop=before;return {before,after}});
    if(editorScrollProbe.after<0)throw new Error("Editor vertical scroll should be unaffected by the result-row horizontal scroll fix");

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

    await page.click("#closeText");
    await page.waitForFunction(()=>document.getElementById("textModal").style.display==="none");
    await page.close();
  }

  console.log("Mobile Text Scene browser tests passed");
}finally{await browser.close();server.kill()}
