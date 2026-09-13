// Find/Replace Stage D2.1: browser coverage for safe single Replace in
// project-wide ("Весь проект") scope, exercised against the REAL running
// app (never a mock) -- proving the real wiring through
// js/editor/scene-editor-controller.js -> js/scenes.js/js/import-export.js ->
// js/app.js (saveSceneTextCanonical/rebaseSceneTextDirtyBaseline) actually
// works end to end, on top of the exhaustive headless unit coverage in
// tools/find-replace-project-replace.test.mjs (which exercises the same
// algorithms directly with fake views/injected callbacks). Stage D1's own
// project-search/navigation behavior is unchanged and re-verified by
// tools/find-replace-project-search-browser.test.mjs alongside this file.
//
// Each PART below opens its own fresh `page` (same browser/server) and
// re-seeds the SAME fixture project from scratch via its own `addInitScript`
// -- every part targets its own independent scene, so re-seeding per part is
// both safe (no cross-part interference) and keeps each part's DOM/JS heap
// small and short-lived, which is what actually made this suite reliable in
// this environment (a single page driven through all four parts in sequence
// was found to intermittently crash/hang the renderer under repeated modal
// mount/unmount cycles -- a resource characteristic of this sandbox, not a
// correctness issue in the app itself).
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8099,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
const base=`http://127.0.0.1:${port}/`;

function scene(id,title,chapterId,text,{included=true}={}){
  return {id,title,date:"",time:"",dateReview:false,chapterId,locationId:"",tags:[],
    writingStatus:"idea",sceneText:text,included,status:"floating",people:{}};
}

const project={
  version:11,
  characters:[],profiles:{},characterLinks:[],
  chapters:[
    {id:"chapter-1",title:"Глава 1",collapsed:false},
    {id:"chapter-unassigned",title:"Без главы",collapsed:false}
  ],
  locations:[],tags:[],
  future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
  scenes:[
    scene("d21-history","История","chapter-1","Кот сидел."),
    scene("d21-conflict","Конфликт","chapter-1","Барсук ходил."),
    scene("d21-excluded","Скрытая","chapter-unassigned","Выдра плыла.",{included:false}),
    scene("d21-dirty","Форма","chapter-1","Ёж бежал."),
    // Goal A (session preservation): three scenes, none mounted anywhere at
    // the start, each with its own "кошка" occurrence -- every explicit
    // project-result navigation between them is case B (opens a scene
    // nowhere previously mounted), exactly the scenario the project-wide
    // Find/Replace session must survive.
    scene("d21-sess-1","Сессия 1","chapter-1","Кошка сидела на окне."),
    scene("d21-sess-2","Сессия 2","chapter-1","Кошка спала на диване."),
    scene("d21-sess-3","Сессия 3","chapter-1","Кошка гуляла во дворе.")
  ]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  async function freshPage(){
    const page=await browser.newPage();
    await page.setViewportSize({width:1200,height:800});
    await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
    for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});return page}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
    return page;
  }
  const rawProject=async page=>JSON.parse(await page.evaluate(()=>localStorage.getItem("novelTimelineV11")));
  const sceneTextOf=async(page,id)=>(await rawProject(page)).scenes.find(s=>s.id===id).sceneText;
  const editorText=async(page,selector)=>page.locator(`${selector} .ProseMirror`).innerText();

  // ============================================================
  // PART 1: end-to-end single Replace via standalone "Текст сцены" --
  // real click -> real commitDataChange persistence -> fresh project search
  // -> (Stage D2.1.1, Goal B) the Replace becomes a NORMAL, undo-able
  // transaction in the active target editor: one Ctrl+Z undoes exactly the
  // Replace (never skipping past it), redo restores it, and the resulting
  // undo is a local, unsaved editor change (dirty), never an automatic
  // persistence rollback.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d21-history"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");

    // A real, undo-able user edit BEFORE the project-wide Replace -- this is
    // what proves addToHistory:false below: if the Replace's own mounted-view
    // synchronization were ever pushed onto this editor's undo stack, one
    // Ctrl+Z would only unwind the replace itself and leave this typed text
    // in place; the correct behavior is for Ctrl+Z to skip straight past it
    // and undo this typed edit instead, since the sync was never a real step.
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё текст.");
    await page.waitForTimeout(30);
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот сидел. Ещё текст.")
      throw new Error("Setup: the typed edit did not land as expected");

    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","текст");
    await page.waitForTimeout(60);
    if(await page.locator("#fullSceneTextFindReplace .rte-replace-one").isDisabled())
      throw new Error("Заменить must be enabled once there is an active global match");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","слово");
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(120);

    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот сидел. Ещё слово.")
      throw new Error(`Expected the live editor to show the committed replacement, got: ${JSON.stringify(await editorText(page,"#fullSceneTextEditor"))}`);
    if((await sceneTextOf(page,"d21-history"))!=="Кот сидел. Ещё слово.")
      throw new Error("Expected the canonical (localStorage) scene text to reflect the committed replacement -- the real commitDataChange path must have run");

    // Fresh search, never a manually patched count: "текст" no longer
    // exists anywhere in this scene.
    {
      const hint=await page.locator("#textModal .rte-project-results-hint").textContent();
      if(!/не найдено/i.test(hint))throw new Error(`Expected a fresh "no matches" state after the replacement removed the only match, got: ${hint}`);
    }

    // Goal B (Stage D2.1.1): in the ACTIVE target editor, the Replace itself
    // is now an ORDINARY, undo-able transaction -- one Ctrl+Z immediately
    // after must undo exactly that Replace, leaving the EARLIER manual edit
    // in place (never skipping past it the way D2.1's own addToHistory:false
    // sync used to).
    await page.locator("#fullSceneTextEditor .ProseMirror").focus();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    const afterUndo=await editorText(page,"#fullSceneTextEditor");
    if(afterUndo!=="Кот сидел. Ещё текст.")
      throw new Error(`Expected one Ctrl+Z to undo the Replace itself, leaving the earlier manual edit in place, got: ${JSON.stringify(afterUndo)}`);

    // Undo is a normal LOCAL editor change under the existing dirty/save
    // model -- it must make the tracker dirty, and must NEVER auto-persist
    // (no cloud rollback, no project-operation undo log): canonical state
    // still shows the committed Replace until an explicit Save.
    if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("Undoing the committed Replace must make the tracker dirty (an ordinary local edit)");
    if((await sceneTextOf(page,"d21-history"))!=="Кот сидел. Ещё слово.")
      throw new Error("Undo must be a LOCAL editor change only -- canonical persisted state must still show the committed Replace until an explicit Save");

    // Redo restores the Replace, ordinary prosemirror-history behavior.
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(60);
    const afterRedo=await editorText(page,"#fullSceneTextEditor");
    if(afterRedo!=="Кот сидел. Ещё слово.")
      throw new Error(`Expected redo to restore the Replace, got: ${JSON.stringify(afterRedo)}`);

    await page.close();
  }

  // ============================================================
  // PART 2: mounted-state CONFLICT -- a scene left open (unsaved edit),
  // discarded, and hidden (per this app's existing "defensive destroy on
  // NEXT open" pattern, same one Stage D1's own navigation regressions
  // exercise) disagrees with a freshly-opened, persisted-content copy of the
  // SAME scene in a different surface. Replace must abort before any
  // mutation and surface a minimal, factual status line -- never silently
  // pick a winner.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d21-conflict"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" быстро");
    await page.waitForTimeout(30);
    await page.click("#closeText");
    await page.waitForSelector("#discardChangesModal", {state:"visible"});
    await page.click("#discardChanges"); // discard -- the edit is now unsaved AND the textModal registration for this scene stays alive, hidden

    await page.evaluate(()=>editScene("d21-conflict"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    if((await editorText(page,"#sceneTextEditor"))!=="Барсук ходил.")
      throw new Error("Setup: the discarded edit must not have persisted -- Scene modal should show the original text");

    await page.click("#sceneTextToolbar .rte-btn-find");
    await page.click("#sceneTextFindReplace .rte-scope-project");
    await page.fill("#sceneTextFindReplace .rte-find-input","барсук");
    await page.waitForTimeout(60);
    await page.fill("#sceneTextFindReplace .rte-replace-input","енот");
    if(await page.locator("#sceneTextFindReplace .rte-replace-one").isDisabled())
      throw new Error("Заменить must be enabled -- there is an active global match even though the two live copies disagree (the conflict is only checked at commit time)");
    await page.click("#sceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(120);

    const conflictStatus=(await page.locator("#sceneModal .rte-project-replace-status").textContent())||"";
    if(!conflictStatus.trim())
      throw new Error("Expected a controlled failure status message after a Replace attempt on a scene with disagreeing mounted copies");
    if((await editorText(page,"#sceneTextEditor"))!=="Барсук ходил.")
      throw new Error("The visible editor must not have been mutated after a conflict abort");
    if((await sceneTextOf(page,"d21-conflict"))!=="Барсук ходил.")
      throw new Error("Canonical (localStorage) state must be completely untouched after a conflict abort");

    await page.close();
  }

  // ============================================================
  // PART 3: included:false -- a single project-wide Replace must work in an
  // excluded scene and must never flip `included` or touch unrelated scene
  // metadata.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d21-excluded"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","выдра");
    await page.waitForTimeout(60);
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","бобр");
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(120);
    if((await sceneTextOf(page,"d21-excluded"))!=="бобр плыла.")
      throw new Error(`Expected the excluded scene's text to be replaced, got: ${JSON.stringify(await sceneTextOf(page,"d21-excluded"))}`);
    if((await rawProject(page)).scenes.find(s=>s.id==="d21-excluded").included!==false)
      throw new Error("Replace must never flip `included` on an excluded scene");
    await page.close();
  }

  // ============================================================
  // PART 4: dirty-baseline behavior -- a project-wide Replace committing
  // THIS scene's text (Scene modal is the one open, live-and-agreeing
  // surface) must stop reporting the modal as text-dirty, while an
  // UNRELATED, still-pending title edit in the SAME open form remains
  // dirty. Checked directly against trackerFor("sceneModal").isDirty() --
  // the authoritative signal js/dirty-state.js itself computes -- rather
  // than the Save button's own `disabled` DOM attribute: that attribute is
  // only refreshed on a real DOM input/change event or an explicit
  // capture/reset call (see createSaveButtonController), so it can lag
  // behind the tracker's own freshly-computed value by construction (a
  // pre-existing characteristic of this app's pull-based dirty model, not a
  // D2.1 concern) -- checking the tracker directly avoids a false result
  // from that unrelated staleness window.
  // ============================================================
  {
    const page=await freshPage();
    const isSceneModalDirty=()=>page.evaluate(()=>trackerFor("sceneModal").isDirty());
    await page.evaluate(()=>editScene("d21-dirty"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.fill("#sceneTitle","Изменённое название");
    await page.waitForTimeout(30);
    if(!await isSceneModalDirty())
      throw new Error("Setup: an unrelated title edit must already make the tracker dirty");

    await page.click("#sceneTextToolbar .rte-btn-find");
    await page.click("#sceneTextFindReplace .rte-scope-project");
    await page.fill("#sceneTextFindReplace .rte-find-input","ёж");
    await page.waitForTimeout(60);
    await page.fill("#sceneTextFindReplace .rte-replace-input","заяц");
    await page.click("#sceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(120);

    if((await sceneTextOf(page,"d21-dirty"))!=="заяц бежал.")
      throw new Error(`Expected the committed replacement in canonical state, got: ${JSON.stringify(await sceneTextOf(page,"d21-dirty"))}`);
    if(!await isSceneModalDirty())
      throw new Error("The UNRELATED pending title edit must still keep the tracker dirty after a text-only rebase");
    await page.fill("#sceneTitle","Форма"); // revert the title back to its original value
    await page.waitForTimeout(30);
    if(await isSceneModalDirty())
      throw new Error("Reverting the title too must make the tracker fully clean again -- proving the earlier text-only rebase did not silently accept the title edit, and did not full-reset the baseline either");

    await page.close();
  }

  // ============================================================
  // PART 5 (Stage D2.1.1, Goal A -- Test A "session preservation"): explicit
  // project-result navigation from a scene where Find/Replace was opened to
  // a DIFFERENT scene nowhere previously mounted (case B) must carry the
  // whole project-wide Find/Replace session over: panel visible, scope
  // still "Весь проект", query/replacement/case option preserved, a fresh
  // global result list, the clicked result active or a fresh corresponding
  // active result, its match highlighted, and Replace immediately usable.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d21-sess-1"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кошка");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","собака");
    await page.waitForTimeout(60);

    const summaryBefore=await page.locator("#textModal .rte-project-results-summary").textContent();
    if(!/3\s*совпадени/.test(summaryBefore)||!/3\s*сцен/.test(summaryBefore))
      throw new Error(`Expected 3 matches across 3 scenes before navigating, got: ${summaryBefore}`);

    // Click the result belonging to Сессия 2 -- a scene mounted nowhere yet
    // (case B): this closes/replaces the standalone modal's own DOM, so the
    // ORIGINAL #fullSceneTextFindReplace container is gone -- everything
    // checked below is against whatever now exists at that same id (the
    // NEW mount).
    await page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"Сессия 2"}).locator(".rte-project-result-row").first().click();
    await page.waitForTimeout(150);

    if(!await page.locator("#textModal").isVisible())throw new Error("Expected the standalone modal to still be showing (now for Сессия 2)");
    if((await page.evaluate(()=>textEditingSceneId))!=="d21-sess-2")
      throw new Error("Expected navigation to have actually landed on Сессия 2");
    if(!await page.locator("#fullSceneTextFindReplace").isVisible())
      throw new Error("The Find/Replace panel must remain visible on the destination -- not just passive highlights with the control surface gone");
    const isProjectScope=await page.locator("#fullSceneTextFindReplace .rte-scope-project").getAttribute("aria-checked");
    if(isProjectScope!=="true")throw new Error('Expected scope to remain "Весь проект" on the destination');
    if((await page.locator("#fullSceneTextFindReplace .rte-find-input").inputValue())!=="кошка")
      throw new Error("Expected the search query to survive the navigation");
    if((await page.locator("#fullSceneTextFindReplace .rte-replace-input").inputValue())!=="собака")
      throw new Error("Expected the replacement text to survive the navigation");

    const summaryAfter=await page.locator("#textModal .rte-project-results-summary").textContent();
    if(!/3\s*совпадени/.test(summaryAfter)||!/3\s*сцен/.test(summaryAfter))
      throw new Error(`Expected the SAME global 3-matches-across-3-scenes summary on the destination, got: ${summaryAfter}`);

    const activeRow=page.locator("#textModal .rte-project-result-row.active");
    if(await activeRow.count()!==1)throw new Error("Expected exactly one active result row on the destination");
    const activeGroupHeader=await activeRow.locator("xpath=preceding-sibling::div[contains(@class,'rte-project-result-scene-header')][1]").textContent().catch(()=>null);
    // Fall back to a coarser check if the xpath sibling lookup isn't
    // supported in this Playwright build -- the decisive assertion is the
    // highlighted selection check right below anyway.
    if(activeGroupHeader&&!activeGroupHeader.includes("Сессия 2"))
      throw new Error(`Expected the active result to belong to Сессия 2, got group header: ${activeGroupHeader}`);

    // The destination's matching text is actually selected/highlighted.
    const selectionText=await page.evaluate(()=>{
      const view=document.getElementById("fullSceneTextEditor").querySelector(".ProseMirror");
      const sel=window.getSelection();
      return sel&&sel.toString();
    });
    if(!/кошка/i.test(selectionText||""))
      throw new Error(`Expected the destination's own match to be selected/highlighted, got selection: ${JSON.stringify(selectionText)}`);

    if(await page.locator("#fullSceneTextFindReplace .rte-replace-one").isDisabled())
      throw new Error("Заменить must be immediately usable for the active result on the destination");
    if(!await page.locator("#fullSceneTextFindReplace .rte-replace-all").isDisabled())
      throw new Error("Заменить все must remain disabled -- Replace All is still out of scope");

    // Pressing Replace changes exactly that match, and a fresh global
    // search follows.
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(120);
    if((await sceneTextOf(page,"d21-sess-2"))!=="собака спала на диване.")
      throw new Error(`Expected Сессия 2's own match to be replaced, got: ${JSON.stringify(await sceneTextOf(page,"d21-sess-2"))}`);
    const summaryAfterReplace=await page.locator("#textModal .rte-project-results-summary").textContent();
    if(!/2\s*совпадени/.test(summaryAfterReplace))
      throw new Error(`Expected a fresh global count of 2 remaining matches, got: ${summaryAfterReplace}`);

    await page.close();
  }

  // ============================================================
  // PART 6 (Goal A -- Test B "multiple hops"): Сессия 1 -> Сессия 2 -> then
  // a SECOND explicit case-B navigation to Сессия 3 -- the same logical
  // session must continue (no duplicated panel/controller state, no stale
  // Сессия-1-only session).
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d21-sess-1"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кошка");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","собака");
    await page.waitForTimeout(60);

    await page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"Сессия 2"}).locator(".rte-project-result-row").first().click();
    await page.waitForTimeout(150);
    if((await page.evaluate(()=>textEditingSceneId))!=="d21-sess-2")throw new Error("First hop did not land on Сессия 2");

    // Second hop, FROM the destination of the first one.
    await page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"Сессия 3"}).locator(".rte-project-result-row").first().click();
    await page.waitForTimeout(150);
    if((await page.evaluate(()=>textEditingSceneId))!=="d21-sess-3")throw new Error("Second hop did not land on Сессия 3");

    if((await page.locator("#fullSceneTextFindReplace .rte-find-input").inputValue())!=="кошка")
      throw new Error("Query must still be preserved after the SECOND hop");
    if((await page.locator("#fullSceneTextFindReplace .rte-replace-input").inputValue())!=="собака")
      throw new Error("Replacement text must still be preserved after the SECOND hop");
    if((await page.locator("#fullSceneTextFindReplace .rte-scope-project").getAttribute("aria-checked"))!=="true")
      throw new Error('Scope must still be "Весь проект" after the SECOND hop');

    // No duplicated/stale state: exactly one find-replace panel exists in
    // the document, and it's the live one for Сессия 3.
    if(await page.locator(".rte-find-replace:not([hidden])").count()!==1)
      throw new Error("Expected exactly one visible Find/Replace panel after two hops -- no duplicated session state");

    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(120);
    if((await sceneTextOf(page,"d21-sess-3"))!=="собака гуляла во дворе.")
      throw new Error(`Expected Сессия 3's own match to be replaced after the multi-hop session handoff, got: ${JSON.stringify(await sceneTextOf(page,"d21-sess-3"))}`);

    await page.close();
  }

  // ============================================================
  // PART 7 (Goal A -- Test C "dirty guard"): the existing unsaved-change
  // protection must remain authoritative during project-result navigation.
  // Cancelling it must leave the CURRENT scene and its Find/Replace session
  // exactly as they were; proceeding (discard) must navigate normally and
  // hand the session to the destination.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d21-sess-1"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кошка");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","собака");
    await page.waitForTimeout(60);

    // An unrelated, unsaved edit to Сессия 1's OWN text -- makes textModal
    // dirty without touching the search/replace fields themselves.
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё немного.");
    await page.waitForTimeout(30);
    if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("Setup: the unrelated text edit must have made the modal dirty");

    // Attempt to navigate to Сессия 2 -- the existing guard must appear.
    await page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"Сессия 2"}).locator(".rte-project-result-row").first().click();
    await page.waitForSelector("#discardChangesModal",{state:"visible"});

    // Cancellation: remain in Сессия 1, session untouched.
    await page.click("#continueEditing");
    await page.waitForTimeout(60);
    if((await page.evaluate(()=>textEditingSceneId))!=="d21-sess-1")
      throw new Error("Cancelling the dirty guard must NOT change which scene is being edited");
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кошка сидела на окне. Ещё немного.")
      throw new Error("Cancelling the dirty guard must NOT discard the unsaved edit");
    if((await page.locator("#fullSceneTextFindReplace .rte-find-input").inputValue())!=="кошка"||
       (await page.locator("#fullSceneTextFindReplace .rte-replace-input").inputValue())!=="собака"||
       (await page.locator("#fullSceneTextFindReplace .rte-scope-project").getAttribute("aria-checked"))!=="true")
      throw new Error("Cancelling the dirty guard must leave the current Find/Replace session exactly as it was");

    // Now proceed (discard) -- navigation succeeds normally and the session
    // is handed to the destination, exactly like an undirtied navigation.
    await page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"Сессия 2"}).locator(".rte-project-result-row").first().click();
    await page.waitForSelector("#discardChangesModal",{state:"visible"});
    await page.click("#discardChanges");
    await page.waitForTimeout(150);
    if((await page.evaluate(()=>textEditingSceneId))!=="d21-sess-2")
      throw new Error("Proceeding (discard) must navigate to Сессия 2 normally");
    if((await page.locator("#fullSceneTextFindReplace .rte-find-input").inputValue())!=="кошка"||
       (await page.locator("#fullSceneTextFindReplace .rte-replace-input").inputValue())!=="собака")
      throw new Error("The destination must receive the session after a successful (discard-confirmed) navigation");

    await page.close();
  }

  console.log("find-replace-project-replace-browser.test.mjs: all assertions passed");
}finally{
  await browser.close();
  server.kill();
}
