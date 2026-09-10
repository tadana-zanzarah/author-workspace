// Find/Replace Stage C: focused browser coverage for the current-scene
// Find/Replace UI across all three rich-text surfaces -- standalone "Текст
// сцены" (#textModal), the regular Scene modal (#sceneModal), and "Весь
// текст" (#allScenesModal, one shared panel retargeting to whichever scene
// is active). Behavior only, not cosmetic layout -- see
// docs/find-replace-architecture.md.
//
// Corrective pass after the first user visual review: the panel is now ONE
// compact row (Find + Replace controls always shown together, no expand/
// collapse toggle) and Ctrl+F/Ctrl+H interception moved into
// js/modal-manager.js's document-capture-phase pipeline. Each surface uses
// its own dedicated scene(s) so the sections below never interfere with each
// other regardless of run order.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8097,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
const base=`http://127.0.0.1:${port}/`;

function scene(id,title,text){
  return {id,title,date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
    writingStatus:"idea",sceneText:text,included:true,status:"floating",people:{}};
}
function longSceneText(n,needle){
  return Array.from({length:n},(_,i)=>`Абзац номер ${i+1} про ${needle} и его приключения.`).join("\n");
}

const project={
  version:11,
  characters:[],profiles:{},characterLinks:[],
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],
  future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
  scenes:[
    scene("scene-standalone","Одиночная сцена","Кот сидел на окне.\nКот смотрел на улицу.\nКот молчал."),
    scene("scene-modal","Сцена модалки","Кот сидел на окне.\nКот смотрел на улицу.\nКот молчал."),
    scene("scene-all-a","Сцена А","Кот сидел на окне.\nКот смотрел на улицу.\nКот молчал."),
    scene("scene-all-b","Сцена Б","Собака лаяла во дворе."),
    scene("scene-long","Длинная сцена",longSceneText(60,"кота")),
    scene("scene-long-modal","Длинная сцена модалки",longSceneText(60,"кота")),
    scene("scene-long-all","Длинная сцена Весь текст",longSceneText(60,"кота"))
  ]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("frcs-seeded"))return;sessionStorage.setItem("frcs-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  const isOpen=async id=>page.$eval(`#${id}`,node=>node.style.display==="flex").catch(()=>false);
  const savedSceneText=id=>page.evaluate(sceneId=>JSON.parse(localStorage.getItem("novelTimelineV11")).scenes.find(s=>s.id===sceneId).sceneText,id);

  // ============================================================
  // PART 1: standalone "Текст сцены" (#textModal)
  // ============================================================
  await page.evaluate(()=>openSceneText("scene-standalone"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");

  // --- Toolbar entry point appears AFTER *** (scene-break) and BEFORE the
  // POV selector, separated from *** by a visual separator -- corrective
  // pass #3 (a bare magnifying glass was ambiguous once Replace exists too).
  {
    const order=await page.$$eval("#fullSceneTextToolbar > *",els=>els.map(el=>({tag:el.tagName,cmd:el.dataset?.cmd||null,cls:el.className})));
    const sepIndices=order.map((el,i)=>el.cls?.includes("rte-toolbar-sep")?i:-1).filter(i=>i>=0);
    const sceneBreakIndex=order.findIndex(el=>el.cmd==="scene-break");
    const findIndex=order.findIndex(el=>el.cls?.includes("rte-btn-find"));
    const povIndex=order.findIndex(el=>el.tag==="SELECT");
    if(sceneBreakIndex<0||findIndex<0||povIndex<0)throw new Error(`Could not locate scene-break/find/POV controls: ${JSON.stringify(order)}`);
    if(!(sceneBreakIndex<findIndex&&findIndex<povIndex))
      throw new Error(`Expected order ***  < Find/Replace < POV, got indices ${sceneBreakIndex},${findIndex},${povIndex}`);
    if(!sepIndices.some(i=>i>sceneBreakIndex&&i<findIndex))
      throw new Error("Expected a visual separator between *** and the Find/Replace entry");
  }
  if((await page.locator("#fullSceneTextToolbar .rte-btn-find").textContent())!=="a→z")
    throw new Error("Find/Replace toolbar entry should read \"a→z\", not a bare icon");
  if(!(await page.locator("#fullSceneTextToolbar .rte-btn-find").getAttribute("aria-label")).includes("Найти и заменить"))
    throw new Error("Find/Replace toolbar entry must have an accessible label naming the feature");

  // --- Toolbar entry point opens Find.
  if(await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Find/Replace panel must start hidden");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  if(!await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Toolbar entry point did not open the Find panel");
  if(!await page.locator("#fullSceneTextFindReplace .rte-find-input").evaluate(el=>el===document.activeElement))
    throw new Error("Opening Find must focus the Find input");
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  if(await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Close button did not close the panel");

  // --- Compact ONE-ROW layout at normal desktop width: Find input, counter,
  // prev/next, Replace input, both replace buttons, case toggle and close
  // all sit on the same visual row (same top), and BOTH find and replace
  // controls are available immediately -- no separate expand/collapse step.
  await page.setViewportSize({width:1200,height:800});
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  {
    // Same visual row, not necessarily pixel-identical tops: inputs/spans/
    // buttons have slightly different intrinsic heights even when
    // align-items:center keeps them on one flex line, so tolerate a small
    // spread rather than requiring exact equality.
    const tops=await page.$$eval("#fullSceneTextFindReplace > *",els=>els.map(el=>el.getBoundingClientRect().top));
    const spread=Math.max(...tops)-Math.min(...tops);
    if(spread>12)throw new Error(`Expected one compact row at desktop width, got a ${spread}px spread in row tops: ${JSON.stringify(tops)}`);
  }
  if(!await page.locator("#fullSceneTextFindReplace .rte-replace-input").isVisible())throw new Error("Replace input must be visible immediately, no expand step");
  if(await page.locator("#fullSceneTextFindReplace .rte-find-toggle").count())throw new Error("The old expand/collapse toggle must be gone");

  // --- Ctrl+H also opens the SAME compact panel (still focusing Find, since
  // a search term is needed before anything can be replaced).
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.locator("#fullSceneTextEditor .ProseMirror").click();
  await page.keyboard.press("Control+h");
  if(!await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Ctrl+H did not open the panel");
  if(!await page.locator("#fullSceneTextFindReplace .rte-replace-input").isVisible())throw new Error("Ctrl+H's panel must already show the Replace input");
  if(!await page.locator("#fullSceneTextFindReplace .rte-find-input").evaluate(el=>el===document.activeElement))
    throw new Error("Ctrl+H must still focus the Find input by default");

  // --- Root cause of the real-browser interception failure: event.key
  // reflects the ACTIVE KEYBOARD LAYOUT, not the physical key. On a Russian
  // ЙЦУКЕН layout, physically pressing Ctrl+F produces key:"а" (Cyrillic),
  // not "f" -- a check on event.key alone (the original Stage C code) never
  // matches for such a user, regardless of what the browser's native
  // shortcut does. The fix reads event.code ("KeyF"), which reports the
  // PHYSICAL key position regardless of layout. Simulate that exact
  // real-world case directly (Playwright's page.keyboard.press cannot
  // simulate a non-US OS keyboard layout) to pin the actual fix, not just
  // the US-layout-equivalent path already covered above.
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.locator("#fullSceneTextEditor .ProseMirror").click();
  await page.evaluate(()=>{
    const event=new KeyboardEvent("keydown",{key:"а",code:"KeyF",ctrlKey:true,bubbles:true,cancelable:true});
    document.dispatchEvent(event);
    window.__frLayoutEventPrevented=event.defaultPrevented;
  });
  if(!await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())
    throw new Error("A Cyrillic-keyboard-layout Ctrl+F (code=KeyF, key=\"а\") did not open Find -- event.key-only detection regressed");
  if(!await page.evaluate(()=>window.__frLayoutEventPrevented))
    throw new Error("The Cyrillic-layout Ctrl+F keydown was not preventDefault()-ed");

  // --- Browser Find shortcut is not stolen outside the relevant context:
  // close the panel and the modal entirely, then Ctrl+F on the bare app must
  // never open any of the three panels, and must NOT call preventDefault
  // (so the browser's own native Find remains free to open there).
  await page.keyboard.press("Escape"); // closes panel, not modal
  if(!await isOpen("textModal"))throw new Error("First Escape closed the modal instead of just the panel");
  await page.click("#closeText");
  if(await isOpen("textModal"))throw new Error("textModal did not close");
  const outsideContext=await page.evaluate(()=>{
    const event=new KeyboardEvent("keydown",{key:"f",code:"KeyF",ctrlKey:true,bubbles:true,cancelable:true});
    document.dispatchEvent(event);
    return event.defaultPrevented;
  });
  if(outsideContext)throw new Error("Ctrl+F was intercepted with no rich-text modal open -- must never steal the shortcut elsewhere");
  if(await page.locator(".rte-find-replace:not([hidden])").count())
    throw new Error("Ctrl+F opened a Find/Replace panel outside any rich-text editing context");

  // --- Type a query: counter updates, all matches + a distinguished active
  // match are decorated (never raw DOM text wrapping -- these are real
  // ProseMirror decoration spans, asserted by class only), and ordinary
  // matches are clearly visible (not just present) against the manuscript
  // background.
  await page.evaluate(()=>openSceneText("scene-standalone"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
  if((await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent())!=="1 из 3")
    throw new Error("Counter did not report 1 из 3 for a case-insensitive 3-match query");
  let allMatches=page.locator("#fullSceneTextEditor .rte-find-match");
  if(await allMatches.count()!==3)throw new Error(`Expected 3 highlighted matches, found ${await allMatches.count()}`);
  if(await page.locator("#fullSceneTextEditor .rte-find-match-active").count()!==1)
    throw new Error("Expected exactly one distinguished active match");
  {
    const [paperBg,matchBg,activeBg]=await Promise.all([
      page.locator("#fullSceneTextEditor").evaluate(el=>getComputedStyle(el).backgroundColor),
      page.locator("#fullSceneTextEditor .rte-find-match:not(.rte-find-match-active)").first().evaluate(el=>getComputedStyle(el).backgroundColor),
      page.locator("#fullSceneTextEditor .rte-find-match-active").evaluate(el=>getComputedStyle(el).backgroundColor)
    ]);
    if(matchBg===paperBg)throw new Error("Ordinary match highlight is indistinguishable from the manuscript background");
    if(matchBg===activeBg)throw new Error("Ordinary match highlight must remain visually subordinate to the active match");
  }

  // --- Panel interaction (typing a query) must never make the scene dirty.
  if(await page.evaluate(()=>trackerFor("textModal").isDirty()))
    throw new Error("Typing into the Find input incorrectly marked the scene as dirty");

  // --- Enter navigates to next match, Shift+Enter to previous; counter
  // tracks the active index.
  await page.locator("#fullSceneTextFindReplace .rte-find-input").press("Enter");
  if((await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent())!=="2 из 3")throw new Error("Enter did not advance to the next match");
  await page.locator("#fullSceneTextFindReplace .rte-find-input").press("Enter");
  if((await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent())!=="3 из 3")throw new Error("Second Enter did not advance to match 3");
  await page.locator("#fullSceneTextFindReplace .rte-find-input").press("Shift+Enter");
  if((await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent())!=="2 из 3")throw new Error("Shift+Enter did not go back to match 2");

  // --- Navigation moves the ACTUAL ProseMirror selection to the match range
  // (asserted via the editor's own state, not the browser Selection API --
  // the Find input, not the contenteditable, still holds DOM focus at this
  // point).
  await page.locator("#fullSceneTextFindReplace .rte-find-input").press("Enter"); // -> match 3
  const activeSelection=await page.evaluate(()=>{
    const {selection,doc}=sceneTextEditor.view.state;
    return doc.textBetween(selection.from,selection.to);
  });
  if(activeSelection!=="Кот"&&activeSelection!=="кот")throw new Error(`Navigating to a match did not move the editor's own selection onto it (got ${JSON.stringify(activeSelection)})`);

  // --- Editing while the panel is open refreshes matches instead of using
  // stale positions: typing more prose changes the match count live.
  await page.locator("#fullSceneTextEditor .scene-paragraph").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Кот зевнул.");
  if((await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent())!=="4 из 4"&&
     !(await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent()).endsWith("из 4"))
    throw new Error("Editing the document while Find was open did not refresh the match count to 4");

  // --- Replace current: only the active match changes, formatting (plain
  // text here) survives untouched elsewhere, and this is an ordinary editor
  // edit -- no auto-save, but it DOES make the scene dirty through the
  // existing mechanism.
  const beforeReplaceOne=await savedSceneText("scene-standalone");
  await page.fill("#fullSceneTextFindReplace .rte-replace-input","Пёс");
  const activeText=await page.locator("#fullSceneTextEditor .rte-find-match-active").textContent();
  await page.click("#fullSceneTextFindReplace .rte-replace-one");
  if(await page.locator("#fullSceneTextEditor .ProseMirror").locator(`text=${activeText}`).count()>3)
    throw new Error("Replace current seems to have replaced more than the active match");
  const bodyText=await page.locator("#fullSceneTextEditor .ProseMirror").textContent();
  if(!bodyText.includes("Пёс"))throw new Error("Replace current did not insert the replacement text");
  if((bodyText.match(/[Кк]от/g)||[]).length!==3)throw new Error("Replace current changed more than exactly one match");
  if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))throw new Error("Replace current did not mark the scene dirty through the existing mechanism");
  if(await savedSceneText("scene-standalone")!==beforeReplaceOne)throw new Error("Replace current auto-saved -- it must remain an ordinary unsaved live edit");

  // --- Replace All: one transaction, one Undo step, and formatting behavior
  // stays whatever Stage B established (plain text here, so a straightforward
  // full replacement is the correct pin).
  await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
  await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
  const beforeReplaceAll=await page.locator("#fullSceneTextEditor .ProseMirror").textContent();
  await page.click("#fullSceneTextFindReplace .rte-replace-all");
  const afterReplaceAll=await page.locator("#fullSceneTextEditor .ProseMirror").textContent();
  if(/[Кк]от/.test(afterReplaceAll))throw new Error("Replace All left an unreplaced match behind");
  if((afterReplaceAll.match(/пёс/g)||[]).length!==3)throw new Error("Replace All did not replace all three remaining matches");
  await page.click("#fullSceneTextToolbar [data-cmd=\"undo\"]");
  const afterUndo=await page.locator("#fullSceneTextEditor .ProseMirror").textContent();
  if(afterUndo!==beforeReplaceAll)throw new Error("A single Undo did not restore the ENTIRE Replace All in one step");

  // --- Closing the panel returns focus to the editor.
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  if(!await page.locator("#fullSceneTextEditor .ProseMirror").evaluate(el=>el===document.activeElement))
    throw new Error("Closing the panel did not return focus to the editor");

  // Save (not a plain close) -- the scene is genuinely dirty from the Replace
  // edits above, and closing via Cancel would correctly trigger the existing
  // discard-confirmation flow, which this test isn't exercising here.
  await page.click("#saveText");
  await page.waitForTimeout(80);

  // --- Narrow viewport: the panel wraps cleanly, never overflows
  // horizontally, and every control stays present/interactable.
  await page.evaluate(()=>openSceneText("scene-standalone"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.setViewportSize({width:420,height:800});
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  {
    const overflow=await page.locator("#fullSceneTextFindReplace").evaluate(el=>el.scrollWidth-el.clientWidth);
    if(overflow>1)throw new Error(`Find/Replace panel overflows horizontally at a narrow viewport (by ${overflow}px)`);
    const controlsVisible=await page.locator("#fullSceneTextFindReplace .rte-find-input, #fullSceneTextFindReplace .rte-replace-input, #fullSceneTextFindReplace .rte-find-close").evaluateAll(els=>els.every(el=>el.getBoundingClientRect().width>0));
    if(!controlsVisible)throw new Error("A Find/Replace control collapsed to zero width at a narrow viewport");
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");
  await page.setViewportSize({width:1200,height:800});

  // --- Scroll-to-active-match: with a long scene, navigating to a match far
  // below the initially visible area must scroll the EDITOR'S OWN internal
  // viewport (.rte-editor, overflow-y:auto) to reveal it.
  await page.evaluate(()=>openSceneText("scene-long"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","кота");
  for(let i=0;i<50;i++)await page.locator("#fullSceneTextFindReplace .rte-find-input").press("Enter");
  if((await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent())!=="51 из 60")
    throw new Error("Expected to have navigated to match 51 of 60");
  {
    const editorScrollTop=await page.locator("#fullSceneTextEditor").evaluate(el=>el.scrollTop);
    if(editorScrollTop<=0)throw new Error("Navigating to a below-the-fold match did not scroll the editor's internal viewport at all");
    const visible=await page.evaluate(()=>{
      const editor=document.getElementById("fullSceneTextEditor");
      const active=editor.querySelector(".rte-find-match-active");
      if(!active)return false;
      const a=active.getBoundingClientRect(),e=editor.getBoundingClientRect();
      return a.top>=e.top-1&&a.bottom<=e.bottom+1;
    });
    if(!visible)throw new Error("The active match is still not within the editor's visible viewport after navigating to it");
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  // ============================================================
  // PART 2: regular Scene modal (#sceneModal)
  // ============================================================
  await page.evaluate(()=>editScene("scene-modal"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");

  await page.locator("#sceneTextEditor .ProseMirror").click();
  await page.keyboard.press("Meta+f");
  if(!await page.locator("#sceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Meta+F did not open Find in the Scene modal");
  await page.keyboard.press("Meta+h");
  if(!await page.locator("#sceneTextFindReplace .rte-replace-input").isVisible())throw new Error("Meta+H did not show the Replace input in the Scene modal");

  // --- Typing a query must not dirty UNRELATED fields either (title stays
  // untouched/clean) -- the Find/Replace panel's own inputs are excluded from
  // the modal's blanket dirty-tracking scan.
  await page.fill("#sceneTextFindReplace .rte-find-input","кот");
  if(await page.evaluate(()=>trackerFor("sceneModal").isDirty()))
    throw new Error("Searching inside the Scene modal incorrectly dirtied the whole scene form");

  // --- Escape closes the panel, not the modal; a second Escape then closes
  // the modal via the normal (undirtied, so no discard prompt) path.
  await page.keyboard.press("Escape");
  if(await page.locator("#sceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Escape did not close the Scene modal's panel");
  if(!await isOpen("sceneModal"))throw new Error("First Escape incorrectly closed the Scene modal itself");
  await page.keyboard.press("Escape");
  if(await isOpen("sceneModal"))throw new Error("Second Escape did not fall through to the normal modal-close behavior");

  // --- Scroll-to-active-match inside the Scene modal's own bounded,
  // internally-scrolling editor (#sceneModal .rte-editor{height:320px}).
  await page.evaluate(()=>editScene("scene-long-modal"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  await page.click("#sceneTextToolbar .rte-btn-find");
  await page.fill("#sceneTextFindReplace .rte-find-input","кота");
  for(let i=0;i<50;i++)await page.locator("#sceneTextFindReplace .rte-find-input").press("Enter");
  {
    const editorScrollTop=await page.locator("#sceneTextEditor").evaluate(el=>el.scrollTop);
    if(editorScrollTop<=0)throw new Error("Scene modal: navigating to a below-the-fold match did not scroll its internal editor viewport");
  }
  await page.click("#sceneTextFindReplace .rte-find-close");
  if(await page.evaluate(()=>trackerFor("sceneModal").isDirty()))
    throw new Error("Searching/navigating in the Scene modal must not leave it dirty");
  await page.click("#cancelScene");
  await page.waitForTimeout(80);
  if(await isOpen("sceneModal"))throw new Error("Cancel did not close the (undirtied) Scene modal");

  // ============================================================
  // PART 3: "Весь текст" (#allScenesModal) -- one shared panel, retargeting
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesModal .rte-editor .ProseMirror");

  if(await page.locator("#allScenesModal .rte-find-replace").count()!==1)
    throw new Error("\"Весь текст\" must mount exactly ONE shared Find/Replace panel, never one per scene");

  const sceneEditor=id=>page.locator(`#allSceneEditor-${id} .ProseMirror`);
  await sceneEditor("scene-all-a").click({clickCount:1});
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.fill("#allScenesFindReplace .rte-find-input","кот");
  if((await page.locator("#allScenesFindReplace .rte-find-count").textContent())!=="1 из 3")
    throw new Error("Shared panel did not report Scene A's own 3 matches");
  if(await sceneEditor("scene-all-a").locator(".rte-find-match").count()!==3)
    throw new Error("Scene A's editor did not receive the match decorations");

  // --- Clicking a panel control (e.g. the case-sensitivity toggle) must not
  // retarget the active scene via editor blur -- same class of issue T2
  // already solved for the shared formatting toolbar.
  await page.click("#allScenesFindReplace .rte-find-case");
  if(await page.evaluate(()=>allScenesEditorGroup.getActiveSceneId())!=="scene-all-a")
    throw new Error("Clicking a Find/Replace panel control incorrectly changed the active scene");
  await page.click("#allScenesFindReplace .rte-find-case"); // toggle back off for the rest of this section

  // --- Focusing another scene retargets the SAME shared controller: matches
  // recompute for the newly active scene, and stale highlights from the
  // previously active scene are cleaned up. This is EXPECTED Stage C
  // current-scene-only behavior, not a bug to widen -- project-wide "Весь
  // проект" scope is explicitly Stage D's job.
  await sceneEditor("scene-all-b").click({clickCount:1});
  if((await page.locator("#allScenesFindReplace .rte-find-count").textContent())!=="0 из 0")
    throw new Error("Panel did not recompute to Scene B's own (zero) matches after retargeting");
  if(await sceneEditor("scene-all-a").locator(".rte-find-match").count()!==0)
    throw new Error("Stale highlights were left behind on the previously active Scene A after retargeting to Scene B");
  if(await page.evaluate(()=>allScenesEditorGroup.getActiveSceneId())!=="scene-all-b")
    throw new Error("Focusing Scene B's editor did not retarget the active scene");

  // --- Replace All in "Весь текст" only ever touches the current ACTIVE
  // scene (project-wide scope is explicitly NOT part of Stage C).
  await sceneEditor("scene-all-a").click({clickCount:1});
  await page.fill("#allScenesFindReplace .rte-find-input","кот");
  await page.fill("#allScenesFindReplace .rte-replace-input","пёс");
  await page.click("#allScenesFindReplace .rte-replace-all");
  const sceneAText=await sceneEditor("scene-all-a").textContent();
  const sceneBText=await sceneEditor("scene-all-b").textContent();
  if(/[Кк]от/.test(sceneAText))throw new Error("Replace All left an unreplaced match in Scene A");
  if(!sceneBText.includes("Собака"))throw new Error("Replace All in \"Весь текст\" must never touch a scene other than the active one");

  // --- No auto-save from any of this: nothing has been persisted to
  // localStorage yet, only after the modal's own explicit Save.
  if((await savedSceneText("scene-all-a")).includes("пёс"))throw new Error("\"Весь текст\" Find/Replace auto-saved instead of waiting for the explicit Save button");
  await page.click("#saveAllScenes");
  await page.waitForTimeout(120);
  if(!(await savedSceneText("scene-all-a")).includes("пёс"))throw new Error("The explicit Save did not persist the Replace All edit");

  // --- Sticky behavior: the shared toolbar + Find/Replace panel stick
  // TOGETHER as one control area while manuscript scenes scroll underneath,
  // and never overlap each other.
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesModal .rte-editor .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  {
    const wrapperPosition=await page.locator("#allScenesModal .rte-sticky-controls").evaluate(el=>getComputedStyle(el).position);
    if(wrapperPosition!=="sticky")throw new Error("The shared toolbar + Find/Replace wrapper must be position:sticky in \"Весь текст\"");
    await page.locator("#allScenesModal .modal").evaluate(el=>{el.scrollTop=400});
    await page.waitForTimeout(50);
    const toolbarRect=await page.locator("#allScenesToolbar").evaluate(el=>el.getBoundingClientRect());
    const panelRect=await page.locator("#allScenesFindReplace").evaluate(el=>el.getBoundingClientRect());
    if(toolbarRect.top>50)throw new Error("Sticky toolbar scrolled away with the manuscript instead of staying pinned");
    if(panelRect.top<toolbarRect.bottom-1)throw new Error("Sticky Find/Replace panel overlaps the sticky toolbar");
    if(panelRect.top>toolbarRect.bottom+4)throw new Error("Sticky Find/Replace panel is not immediately beneath the sticky toolbar");
  }

  console.log("find-replace current-scene browser tests passed");
}finally{await browser.close();server.kill()}
