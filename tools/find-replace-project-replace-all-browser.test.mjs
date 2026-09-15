// Find/Replace Stage D2.2.1: browser coverage for project-wide Replace All,
// exercised against the REAL running app (never a mock) -- see
// docs/find-replace-architecture.md's "Stage D2.2.1" section for the full
// contract. Headless coverage (fresh-plan protection, conflict abort,
// atomicity call counts, no-op, failure semantics) already lives in
// tools/find-replace-project-replace-all.test.mjs; this file proves the
// essentials that need a real DOM/EditorView: a real multi-scene commit that
// actually reaches local storage in one project save, an excluded scene
// participating, and a mounted-but-unsaved scene's live edits surviving into
// the committed text.
//
// Same harness/fixture-seeding pattern as tools/find-replace-project-
// replace-browser.test.mjs: each PART opens its own fresh `page` and re-seeds
// the SAME fixture project from scratch, so every part's DOM/JS heap stays
// small and independent.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8100,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
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
    scene("all-1","Все1","chapter-1","Кот один."),
    scene("all-2","Все2","chapter-1","И кот здесь тоже."),
    scene("all-hidden","ВсеСкрытая","chapter-unassigned","Кот в скрытой сцене.",{included:false}),
    scene("all-unrelated","ВсеНеСвязана","chapter-1","Собака лает."),
    scene("all-live","ВсеЖивая","chapter-1","Кот в живой сцене."),
    scene("hbug-discard","БагОбнаружен","chapter-1","Кот сидел."),
    scene("hbug-switch","БагПереключение","chapter-1","Кот в переключении."),
    scene("hbug-after-replace","БагПослеЗамены","chapter-1","Кот после замены.")
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

  // Find/Replace Stage D2.2.2: the shared confirmation helpers every
  // "Заменить все" click in project scope now needs -- js/modal-manager.js's
  // generic showConfirmAction()/#confirmActionModal, never a bespoke dialog.
  const confirmDialogInfo=async page=>page.evaluate(()=>{
    const modal=document.getElementById("confirmActionModal");
    return {
      visible:modal?.style.display==="flex",
      role:modal?.getAttribute("role"),
      title:document.getElementById("confirmActionTitle")?.textContent||"",
      description:document.getElementById("confirmActionDescription")?.textContent||"",
      confirmLabel:document.getElementById("confirmActionConfirm")?.textContent||"",
      cancelLabel:document.getElementById("confirmActionCancel")?.textContent||"",
      activeElementId:document.activeElement?.id||null
    };
  });
  async function confirmProjectReplaceAll(page){
    await page.waitForSelector("#confirmActionModal",{state:"visible"});
    await page.click("#confirmActionConfirm");
    await page.waitForTimeout(150);
  }
  async function cancelProjectReplaceAll(page){
    await page.waitForSelector("#confirmActionModal",{state:"visible"});
    await page.click("#confirmActionCancel");
    await page.waitForTimeout(80);
  }

  // ============================================================
  // PART 1: basic multi-scene Replace All -- every affected scene lands in
  // ONE project save (localStorage reflects all of them after one click),
  // an excluded scene participates, an unrelated scene is untouched, and a
  // fresh project search afterward shows zero remaining matches.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("all-unrelated"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);

    if(await page.isDisabled("#fullSceneTextFindReplace .rte-replace-all"))
      throw new Error("Заменить все must be enabled in project scope once matches exist");

    // Find/Replace Stage D2.2.2 (Test Requirements 1/2/3): clicking
    // "Заменить все" must open the confirmation BEFORE any write, showing
    // the FRESH replacement count and affected scene count -- every scene in
    // the WHOLE fixture project containing "кот" (7: all-1/all-2/all-hidden/
    // all-live/hbug-discard/hbug-switch/hbug-after-replace -- the excluded
    // all-hidden scene IS counted, all-unrelated is NOT), proper dialog
    // semantics, and zero canonical mutation yet.
    await page.click("#fullSceneTextFindReplace .rte-replace-all");
    const dialog=await confirmDialogInfo(page);
    if(!dialog.visible)throw new Error("Заменить все must open a confirmation dialog before any write");
    if(dialog.role!=="alertdialog")throw new Error(`Expected role="alertdialog", got ${dialog.role}`);
    if(!dialog.title.includes("Заменить во всём проекте"))throw new Error(`Unexpected confirmation title: ${dialog.title}`);
    if(!dialog.description.includes("Будет выполнено 7 замен (7 сцен)"))
      throw new Error(`Expected the fresh replacement/scene counts (7 matches, 7 scenes) in the confirmation body, got: ${dialog.description}`);
    if(!dialog.description.includes("Ctrl+Z"))throw new Error("Confirmation must state the operation cannot be undone with Ctrl+Z");
    if(!dialog.description.toLowerCase().includes("исключ"))throw new Error("Confirmation must state the operation includes scenes excluded from the general text");
    if(!dialog.description.toLowerCase().includes("несохранённые"))throw new Error("Confirmation must warn that unsaved live text in open scenes will also be saved");
    if(dialog.confirmLabel!=="Заменить и сохранить")throw new Error(`Unexpected confirm label: ${dialog.confirmLabel}`);
    if(dialog.cancelLabel!=="Отмена")throw new Error(`Unexpected cancel label: ${dialog.cancelLabel}`);
    if(dialog.activeElementId!=="confirmActionCancel")throw new Error(`Expected initial focus on the SAFE (Cancel) action, got #${dialog.activeElementId}`);
    if((await sceneTextOf(page,"all-1"))!=="Кот один.")
      throw new Error("Zero writes must have happened before the user answers the confirmation");

    await confirmProjectReplaceAll(page);

    if((await sceneTextOf(page,"all-1"))!=="пёс один.")
      throw new Error("Expected all-1 to be replaced");
    if((await sceneTextOf(page,"all-2"))!=="И пёс здесь тоже.")
      throw new Error("Expected all-2 to be replaced");
    if((await sceneTextOf(page,"all-hidden"))!=="пёс в скрытой сцене.")
      throw new Error("An included:false scene must still participate in Replace All");
    if((await sceneTextOf(page,"all-unrelated"))!=="Собака лает.")
      throw new Error("An unrelated scene (no match) must be left completely untouched");
    if((await sceneTextOf(page,"all-live"))!=="пёс в живой сцене.")
      throw new Error("Expected all-live to be replaced (not yet mounted for this part)");

    // Fresh search afterward: the summary must report zero remaining matches
    // for the now-replaced query, never a stale/fabricated count.
    const summaryText=await page.locator("#fullSceneTextFindReplace ~ .rte-project-results-wrapper .rte-project-results-hint").innerText();
    if(!summaryText.includes("Совпадений не найдено"))
      throw new Error(`Expected a fresh empty-results summary after Replace All, got: ${summaryText}`);
  }

  // ============================================================
  // PART 2: a mounted scene with UNSAVED live text -- Replace All must plan
  // against the live doc (never the stale persisted one), so the author's
  // own pending edit survives into the committed result, and the mounted
  // editor itself is synchronized to show the final committed content.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("all-live"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    // An unsaved live edit that adds a SECOND occurrence of the query --
    // never saved before Replace All runs.
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё один кот пришёл.");
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот в живой сцене. Ещё один кот пришёл.")
      throw new Error("Setup: expected the unsaved live edit to be present before Replace All");
    if((await sceneTextOf(page,"all-live"))!=="Кот в живой сцене.")
      throw new Error("Setup: the live edit must not be persisted yet");

    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-all");
    // Test Requirement 6: the confirmation must warn about unsaved live
    // text specifically, and it must not have persisted anything by itself.
    const dialog=await confirmDialogInfo(page);
    if(!dialog.description.toLowerCase().includes("несохранённые"))
      throw new Error("Confirmation must warn about unsaved live content before it is included/persisted");
    if((await sceneTextOf(page,"all-live"))!=="Кот в живой сцене.")
      throw new Error("Opening the confirmation must not itself persist the unsaved live edit");
    await confirmProjectReplaceAll(page);

    const expected="пёс в живой сцене. Ещё один пёс пришёл.";
    if((await sceneTextOf(page,"all-live"))!==expected)
      throw new Error(`Expected the unsaved live edit to survive into the committed text; got: ${await sceneTextOf(page,"all-live")}`);
    if((await editorText(page,"#fullSceneTextEditor"))!==expected)
      throw new Error("The mounted editor itself must be synchronized to the final committed content");
    // The other, untouched scenes still got their own replacement too --
    // Replace All is still whole-project, not scoped to the mounted one.
    if((await sceneTextOf(page,"all-1"))!=="пёс один.")
      throw new Error("Expected all-1 to be replaced in the same batch");
  }

  // ============================================================
  // PART 3 (D2.2.1 corrective pass -- manual acceptance regression): the
  // exact reported bug. An unsaved edit in "Текст сцены", then the ORDINARY
  // "discard unsaved changes and open elsewhere" confirmation (NOT the
  // same-scene seamless switch button) to open the SAME scene in the Scene
  // modal -- this app's existing, accepted "closing just hides the modal"
  // pattern leaves the old textModal mount registered, genuinely disagreeing
  // in content with the fresh sceneModal one. Project Replace All must NOT
  // report a false conflict for this, and must succeed correctly using the
  // fresh, visible content.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("hbug-discard"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Незаписанный текст.");

    // Generic dirty-guard navigation to the Scene modal for the SAME scene
    // -- fire-and-forget (the awaited promise only resolves after the
    // discard confirmation is answered).
    await page.evaluate(()=>{window.__editScenePromise=editScene("hbug-discard")});
    await page.waitForSelector("#discardChangesModal",{state:"visible"});
    await page.click("#discardChanges");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(150);

    await page.click("#sceneTextToolbar .rte-btn-find");
    await page.click("#sceneTextFindReplace .rte-scope-project");
    await page.fill("#sceneTextFindReplace .rte-find-input","кот");
    await page.fill("#sceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#sceneTextFindReplace .rte-replace-all");
    await confirmProjectReplaceAll(page);

    const statusText=await page.evaluate(()=>{
      const el=document.querySelector("#sceneTextFindReplace ~ .rte-project-results-wrapper .rte-project-replace-status");
      return el?{hidden:el.hidden,text:el.textContent}:null;
    });
    if(statusText&&!statusText.hidden)
      throw new Error(`Expected NO false conflict from the orphaned, closed textModal registration; got status: ${JSON.stringify(statusText)}`);
    if((await sceneTextOf(page,"hbug-discard"))!=="пёс сидел.")
      throw new Error(`Expected Replace All to succeed using the fresh, visible content; got: ${await sceneTextOf(page,"hbug-discard")}`);
  }

  // ============================================================
  // PART 4: the SAME-scene seamless surface switch (Текст сцены <-> Редактор
  // сцены), in both directions, must never itself leave a stale/conflicting
  // registration -- confirming the switch button's own destroy-then-create
  // ordering stays correct, and that Project Replace All works cleanly
  // immediately afterward on both surfaces.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("hbug-switch"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(150);
    await page.click("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror",{state:"visible"});
    await page.waitForTimeout(150);
    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(150);

    await page.click("#sceneTextToolbar .rte-btn-find");
    await page.click("#sceneTextFindReplace .rte-scope-project");
    await page.fill("#sceneTextFindReplace .rte-find-input","кот");
    await page.fill("#sceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#sceneTextFindReplace .rte-replace-all");
    await confirmProjectReplaceAll(page);

    const statusText=await page.evaluate(()=>{
      const el=document.querySelector("#sceneTextFindReplace ~ .rte-project-results-wrapper .rte-project-replace-status");
      return el?{hidden:el.hidden,text:el.textContent}:null;
    });
    if(statusText&&!statusText.hidden)
      throw new Error(`Repeated same-scene seamless switching must never leave a false conflict; got status: ${JSON.stringify(statusText)}`);
    if((await sceneTextOf(page,"hbug-switch"))!=="пёс в переключении.")
      throw new Error(`Expected Replace All to succeed after repeated switching; got: ${await sceneTextOf(page,"hbug-switch")}`);
  }

  // ============================================================
  // PART 5: a successful Project Replace All, followed immediately by the
  // same-scene seamless switch, must remain safe -- the post-commit mounted-
  // view synchronization must not itself leave a stray registration, and a
  // SECOND Replace All attempt right after switching must still work cleanly
  // (no false conflict from the just-completed commit's own bookkeeping).
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("hbug-after-replace"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-all");
    await confirmProjectReplaceAll(page);
    if((await sceneTextOf(page,"hbug-after-replace"))!=="пёс после замены.")
      throw new Error("Setup: expected the first Replace All to succeed");

    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(150);
    if((await editorText(page,"#sceneTextEditor"))!=="пёс после замены.")
      throw new Error("Handoff after a successful Replace All must carry the committed content, not stale pre-commit text");

    await page.click("#sceneTextToolbar .rte-btn-find");
    await page.click("#sceneTextFindReplace .rte-scope-project");
    await page.fill("#sceneTextFindReplace .rte-find-input","пёс");
    await page.fill("#sceneTextFindReplace .rte-replace-input","волк");
    await page.waitForTimeout(60);
    await page.click("#sceneTextFindReplace .rte-replace-all");
    await confirmProjectReplaceAll(page);
    const statusText=await page.evaluate(()=>{
      const el=document.querySelector("#sceneTextFindReplace ~ .rte-project-results-wrapper .rte-project-replace-status");
      return el?{hidden:el.hidden,text:el.textContent}:null;
    });
    if(statusText&&!statusText.hidden)
      throw new Error(`A second Replace All right after a post-commit handoff must not false-conflict; got: ${JSON.stringify(statusText)}`);
    if((await sceneTextOf(page,"hbug-after-replace"))!=="волк после замены.")
      throw new Error(`Expected the second Replace All to succeed; got: ${await sceneTextOf(page,"hbug-after-replace")}`);
  }

  // ============================================================
  // PART 6 (D2.2.2): Cancel -- zero writes, unsaved live content preserved,
  // dirty state preserved, focus restored to the safe action's opener, and
  // the Find/Replace panel remains fully usable afterward (a second,
  // confirmed Replace All right after a Cancel still works).
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("all-1"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    // An unsaved live edit, present before Cancel and expected to survive it.
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё текст.");
    const beforeText=await editorText(page,"#fullSceneTextEditor");
    const wasDirty=await page.evaluate(()=>trackerFor("textModal").isDirty());
    if(!wasDirty)throw new Error("Setup: the unsaved edit must register as dirty before Cancel");

    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-all");
    await cancelProjectReplaceAll(page);

    if((await sceneTextOf(page,"all-1"))!=="Кот один.")
      throw new Error("Cancel must perform zero canonical writes");
    if((await editorText(page,"#fullSceneTextEditor"))!==beforeText)
      throw new Error("Cancel must leave the unsaved live edit exactly as it was");
    if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("Cancel must not alter dirty state -- the scene must still report dirty from the unsaved edit");
    const focusedAfterCancel=await page.evaluate(()=>document.activeElement?.classList?.contains("rte-replace-all"));
    if(!focusedAfterCancel)
      throw new Error("Focus must be restored to the button that opened the confirmation after Cancel");

    // The Find/Replace session remains usable: a confirmed Replace All
    // right after a Cancel still works correctly.
    await page.click("#fullSceneTextFindReplace .rte-replace-all");
    await confirmProjectReplaceAll(page);
    if((await sceneTextOf(page,"all-1"))!=="пёс один. Ещё текст.")
      throw new Error(`Expected the post-Cancel confirmed Replace All to succeed, including the still-unsaved edit; got: ${await sceneTextOf(page,"all-1")}`);
  }

  // ============================================================
  // PART 7 (D2.2.2, Test Requirement 12): current-scene Replace All
  // ("Эта сцена" scope) must NOT show the project-wide confirmation at all,
  // and must remain directly undoable through ordinary ProseMirror Undo.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("all-1"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    // Scope defaults to "Эта сцена" -- no need to switch.
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-all");
    await page.waitForTimeout(150);

    if(await page.evaluate(()=>document.getElementById("confirmActionModal")?.style.display==="flex"))
      throw new Error("Current-scene Replace All must never show the project-wide confirmation dialog");
    if((await editorText(page,"#fullSceneTextEditor"))!=="пёс один.")
      throw new Error("Current-scene Replace All must still apply immediately, unconfirmed");
    // Undoable through ordinary ProseMirror Ctrl+Z, unlike Project Replace
    // All -- click back into the editor first (the "Заменить все" button
    // itself holds keyboard focus right after the click, same as any other
    // button; a real user clicking back into their manuscript before
    // pressing Ctrl+Z is the realistic path this exercises).
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот один.")
      throw new Error("Current-scene Replace All must remain directly undoable through normal Ctrl+Z");
  }

  console.log("find-replace project-replace-all browser tests: OK");
}finally{
  await browser.close();
  server.kill();
}
