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
