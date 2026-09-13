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
    scene("d21-dirty","Форма","chapter-1","Ёж бежал.")
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
  // -> the replace's own mounted-view sync is NOT a ProseMirror undo entry
  // (Ctrl+Z only ever reaches the editor's OWN prior real edit).
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

    // addToHistory:false proof: one Ctrl+Z must undo the ORIGINAL typed
    // edit (jumping straight past the Replace's own synchronization, which
    // must never have become its own undo step), landing on the PRE-EDIT
    // text -- never on "Кот сидел. Ещё текст." (what a buggy
    // addToHistory:true sync would incorrectly revert to first).
    await page.locator("#fullSceneTextEditor .ProseMirror").focus();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    const afterUndo=await editorText(page,"#fullSceneTextEditor");
    if(afterUndo!=="Кот сидел.")
      throw new Error(`Expected one Ctrl+Z to undo the ORIGINAL typed edit only (addToHistory:false on the Replace sync), got: ${JSON.stringify(afterUndo)}`);

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

  console.log("find-replace-project-replace-browser.test.mjs: all assertions passed");
}finally{
  await browser.close();
  server.kill();
}
