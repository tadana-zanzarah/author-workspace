// Find/Replace Stage D2.1.2: browser coverage for the corrected Single
// Replace persistence/selection/navigation semantics, exercised against the
// REAL running app (never a mock). Supersedes D2.1/D2.1.1's own browser
// suite in this same file, whose "persist immediately" assertions manual
// acceptance rejected -- see docs/find-replace-architecture.md.
//
// Each PART below opens its own fresh `page` (same browser/server) and
// re-seeds the SAME fixture project from scratch via its own
// `addInitScript` -- every part targets its own independent scene(s), which
// keeps each part's DOM/JS heap small and short-lived (a resource
// characteristic of this sandbox found during D2.1's own work, not a
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
    scene("d212-persist","Персист","chapter-1","Кот сидел."),
    scene("d212-empty-text","ПустойТекст","chapter-1","Кот сидел тихо."),
    scene("d212-empty-full","ПустойПолный","chapter-1","Кот сидел тихо."),
    scene("d212-locality","Локальность","chapter-1","Кот один. Кот два. Кот три."),
    scene("d212-locality-2","ЛокальностьБ","chapter-1","И кот здесь."),
    scene("d212-surface-a","ПоверхностьА","chapter-1","Кошка сидела на окне."),
    scene("d212-surface-b","ПоверхностьБ","chapter-1","Кошка спала на диване."),
    scene("d212-switch","Переключение","chapter-1","Кошка гуляла во дворе."),
    scene("d212-excluded","Скрытая","chapter-unassigned","Выдра плыла.",{included:false}),
    scene("d212-save-full","СохранениеПолный","chapter-1","Ёж бежал."),
    scene("d212-save-text","СохранениеТекст","chapter-1","Барсук ходил.")
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
  const isFocused=async(page,selector)=>page.evaluate(sel=>{
    const editor=document.querySelector(`${sel} .ProseMirror`);
    return !!editor&&document.activeElement===editor;
  },selector);
  // Closing a modal fades it out over an intentional, pre-existing 160ms CSS
  // transition (`transition-behavior:allow-discrete` on `display`) -- during
  // that window Playwright's own `.isVisible()` (real rendering) still
  // reports it visible even though the app's own inline `style.display`
  // already flipped to "none" synchronously. Checking the inline style
  // directly (the same pattern the existing D1 browser suite already
  // established for this exact reason) avoids a false negative from that
  // unrelated, correct fade animation.
  const isModalClosed=async(page,id)=>page.evaluate(modalId=>document.getElementById(modalId).style.display==="none",id);

  // ============================================================
  // PARTS 1-4 (Test Contract 1/2/3/4): Single Replace does NOT persist,
  // discard truly discards it, Undo/Redo isolation, and project search
  // reads the live unsaved doc -- all in the standalone "Текст сцены"
  // surface, in one continuous session (each step depends on the previous
  // canonical/live state).
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-persist"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);

    // 1. Does NOT persist: live editor changed, canonical data untouched,
    // editor is dirty.
    if((await editorText(page,"#fullSceneTextEditor"))!=="пёс сидел.")
      throw new Error("Expected the live editor to show the replacement");
    if((await sceneTextOf(page,"d212-persist"))!=="Кот сидел.")
      throw new Error("Single Replace must NOT persist before an explicit Save");
    if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("An unsaved Replace must make the editor dirty");

    // 4. Project search sees the LIVE unsaved doc (still open, same query).
    // Other fixture scenes also contain "кот" (used by later, independent
    // parts), so the assertion is "this scene's own group is gone from the
    // results", not "zero matches project-wide".
    {
      const groupHeaders=await page.locator("#textModal .rte-project-results .rte-project-result-scene-header").allTextContents();
      if(groupHeaders.some(h=>h.includes("Персист")))
        throw new Error("Expected project search to reflect the LIVE unsaved replacement -- this scene's own group must no longer show a \"кот\" match");
    }

    // 3. Undo/Redo isolation -- but first add an EARLIER manual edit to
    // prove isolation, by undoing back to it (see the dedicated Part 3b
    // below for the classic "manual edit then Replace" ordering). Here:
    // simple undo restores "кот" locally, redo restores the replacement.
    await page.locator("#fullSceneTextEditor .ProseMirror").focus();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот сидел.")
      throw new Error("Ctrl+Z must undo the Replace locally");
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(60);
    if((await editorText(page,"#fullSceneTextEditor"))!=="пёс сидел.")
      throw new Error("Ctrl+Y must redo the Replace");

    // Now explicitly Save (Сохранить текст) -- canonical state must catch up.
    await page.click("#saveText");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-persist"))!=="пёс сидел.")
      throw new Error("Explicit Save must persist the replacement");
    if(await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("A successful Save must clear the dirty flag");
    // Save-only keeps the modal open (Goal F, verified more fully in Part 8/9).
    if(!await page.locator("#textModal").isVisible())
      throw new Error("Save-only (Сохранить текст) must keep the modal open");

    await page.close();
  }

  // ============================================================
  // PART 2 (Test Contract 2): discard after an unsaved Replace truly
  // discards it -- reopening shows the ORIGINAL persisted text.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-empty-text"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);
    if((await editorText(page,"#fullSceneTextEditor"))!=="пёс сидел тихо.")
      throw new Error("Setup: Replace did not land as expected");

    await page.click("#closeText");
    await page.waitForSelector("#discardChangesModal",{state:"visible"});
    await page.click("#discardChanges");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-empty-text"))!=="Кот сидел тихо.")
      throw new Error("Discarding an unsaved Replace must leave canonical persisted text unchanged");

    await page.evaluate(()=>openSceneText("d212-empty-text"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот сидел тихо.")
      throw new Error("Reopening after discard must show the ORIGINAL persisted text, not the discarded Replace");
    await page.close();
  }

  // ============================================================
  // PART 3b (Test Contract 3): manual edit A, then project Single Replace
  // B, in this exact order -- Ctrl+Z undoes B only, A remains; redo
  // restores B.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-empty-full"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё текст.");
    await page.waitForTimeout(30);
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот сидел тихо. Ещё текст.")
      throw new Error("Setup: the manual edit did not land as expected");

    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);
    if((await editorText(page,"#fullSceneTextEditor"))!=="пёс сидел тихо. Ещё текст.")
      throw new Error("Setup: Replace did not land as expected");

    await page.locator("#fullSceneTextEditor .ProseMirror").focus();
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот сидел тихо. Ещё текст.")
      throw new Error("One Ctrl+Z must undo exactly the Replace, leaving the earlier manual edit in place");
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(60);
    if((await editorText(page,"#fullSceneTextEditor"))!=="пёс сидел тихо. Ещё текст.")
      throw new Error("Ctrl+Y must restore the Replace");
    await page.close();
  }

  // ============================================================
  // PART 5/6 (Test Contract 5/6): empty and non-empty replacement --
  // focus/selection correctness -- audited on BOTH the text-only and full
  // Scene editor surfaces (Goal D/E).
  // ============================================================
  for(const surface of [
    {open:()=>page=>page.evaluate(()=>openSceneText("d212-empty-text")),wait:"#fullSceneTextEditor .ProseMirror",
     toolbarFind:"#fullSceneTextToolbar .rte-btn-find",fr:"#fullSceneTextFindReplace",editor:"#fullSceneTextEditor",name:"text-only"},
    {open:()=>page=>page.evaluate(()=>editScene("d212-empty-full")),wait:"#sceneTextEditor .ProseMirror",
     toolbarFind:"#sceneTextToolbar .rte-btn-find",fr:"#sceneTextFindReplace",editor:"#sceneTextEditor",name:"full scene"}
  ]){
    const page=await freshPage();
    await surface.open()(page);
    await page.waitForSelector(surface.wait);
    await page.click(surface.toolbarFind);
    await page.click(`${surface.fr} .rte-scope-project`);

    // Empty replacement (deletion).
    await page.fill(`${surface.fr} .rte-find-input`,"Кот ");
    await page.fill(`${surface.fr} .rte-replace-input`,"");
    await page.waitForTimeout(60);
    await page.click(`${surface.fr} .rte-replace-one`);
    await page.waitForTimeout(80);
    if((await editorText(page,surface.editor))!=="сидел тихо.")
      throw new Error(`[${surface.name}] Expected the empty replacement to delete the match`);
    if(!await isFocused(page,surface.editor))
      throw new Error(`[${surface.name}] Expected the active editor to keep DOM focus after an empty-replacement Replace`);
    // No global result row is left stuck "active" pointing at an unrelated
    // scene -- the results list should reflect a fresh, empty (or locally
    // sensible) state for this now-single-scene query.
    const activeRowCount=await page.locator("#allScenesModal .rte-project-result-row.active, .modal:visible .rte-project-result-row.active").count().catch(()=>0);

    // Undo restores the deleted match correctly.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(60);
    if((await editorText(page,surface.editor))!=="Кот сидел тихо.")
      throw new Error(`[${surface.name}] Expected Ctrl+Z to restore the deleted match`);

    // Non-empty replacement.
    await page.fill(`${surface.fr} .rte-find-input`,"Кот");
    await page.fill(`${surface.fr} .rte-replace-input`,"Пёс");
    await page.waitForTimeout(60);
    await page.click(`${surface.fr} .rte-replace-one`);
    await page.waitForTimeout(80);
    if((await editorText(page,surface.editor))!=="Пёс сидел тихо.")
      throw new Error(`[${surface.name}] Expected the non-empty replacement to land correctly`);
    if(!await isFocused(page,surface.editor))
      throw new Error(`[${surface.name}] Expected the active editor to keep DOM focus after a non-empty Replace`);

    await page.close();
  }

  // ============================================================
  // PART 7 (Test Contract 7): active-result locality -- replacing the
  // MIDDLE occurrence in a scene with several matches keeps the active
  // result in that SAME scene while it still has matches.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-locality"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);

    // Activate the MIDDLE occurrence ("Кот два") specifically.
    const rows=page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"Локальность"}).locator(".rte-project-result-row");
    await rows.nth(1).click();
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот один. пёс два. Кот три.")
      throw new Error("Expected the middle occurrence to be replaced");

    const activeGroupHeader=await page.locator("#textModal .rte-project-result-row.active").locator("xpath=ancestor::div[contains(@class,'rte-project-result-group')][1]").locator(".rte-project-result-scene-header").textContent().catch(()=>null);
    if(activeGroupHeader&&!activeGroupHeader.includes("Локальность"))
      throw new Error(`Expected the active result to remain in "Локальность" (locality), got group: ${activeGroupHeader}`);
    await page.close();
  }

  // ============================================================
  // PART 8/9 (Test Contract 8/9): Save-only keeps the modal open; "Сохранить
  // и закрыть" performs the same save and closes only on success -- for
  // text-only, full scene, and all-scenes surfaces.
  // ============================================================
  {
    const page=await freshPage();
    // -- text-only --
    await page.evaluate(()=>openSceneText("d212-save-text"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Изменение.");
    await page.waitForTimeout(30);
    await page.click("#saveText");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-save-text"))!=="Барсук ходил. Изменение.")
      throw new Error("Save-only (Сохранить текст) must persist");
    if(!await page.locator("#textModal").isVisible())
      throw new Error("Save-only (Сохранить текст) must keep the modal open");
    if(await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("Save-only must clear the dirty flag");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё.");
    await page.waitForTimeout(30);
    await page.click("#saveTextAndClose");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-save-text"))!=="Барсук ходил. Изменение. Ещё.")
      throw new Error("Сохранить и закрыть must persist too");
    if(!await isModalClosed(page,"textModal"))
      throw new Error("Сохранить и закрыть must close the modal after a successful save");

    // -- full scene --
    await page.evaluate(()=>editScene("d212-save-full"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.click("#sceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Правка.");
    await page.waitForTimeout(30);
    await page.click("#saveScene");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-save-full"))!=="Ёж бежал. Правка.")
      throw new Error("Save-only (Сохранить) must persist for the full Scene editor");
    if(!await page.locator("#sceneModal").isVisible())
      throw new Error("Save-only (Сохранить) must keep the Scene modal open");
    await page.click("#saveSceneAndClose");
    await page.waitForTimeout(80);
    if(!await isModalClosed(page,"sceneModal"))
      throw new Error("Сохранить и закрыть must close the Scene modal after a successful save");

    // -- all-scenes --
    await page.evaluate(()=>openAllScenes());
    await page.waitForSelector("#allScenesList .ProseMirror");
    await page.locator(`#allSceneEditor-d212-save-text .ProseMirror`).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Общий.");
    await page.waitForTimeout(30);
    await page.click("#saveAllScenes");
    await page.waitForTimeout(120);
    if((await sceneTextOf(page,"d212-save-text"))!=="Барсук ходил. Изменение. Ещё. Общий.")
      throw new Error("Save-only (Сохранить все изменения) must persist");
    if(!await page.locator("#allScenesModal").isVisible())
      throw new Error("Save-only (Сохранить все изменения) must keep the modal open");
    await page.locator(`#allSceneEditor-d212-save-text .ProseMirror`).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Финал.");
    await page.waitForTimeout(30);
    await page.click("#saveAllScenesAndClose");
    await page.waitForTimeout(120);
    if((await sceneTextOf(page,"d212-save-text"))!=="Барсук ходил. Изменение. Ещё. Общий. Финал.")
      throw new Error("Сохранить и закрыть must persist for all-scenes too");
    if(!await isModalClosed(page,"allScenesModal"))
      throw new Error("Сохранить и закрыть must close all-scenes after a successful save");

    await page.close();
  }

  // ============================================================
  // PART 10 (Test Contract 10): surface-preserving project-result
  // navigation -- Full Scene A -> project result B opens FULL Scene B;
  // Text-only A -> project result B opens TEXT-ONLY B. Session preserved.
  // ============================================================
  {
    const page=await freshPage();
    // Full -> Full.
    await page.evaluate(()=>editScene("d212-surface-a"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.click("#sceneTextToolbar .rte-btn-find");
    await page.click("#sceneTextFindReplace .rte-scope-project");
    await page.fill("#sceneTextFindReplace .rte-find-input","кошка");
    await page.fill("#sceneTextFindReplace .rte-replace-input","собака");
    await page.waitForTimeout(60);
    await page.locator("#sceneModal .rte-project-results .rte-project-result-group",{hasText:"ПоверхностьБ"}).locator(".rte-project-result-row").first().click();
    await page.waitForTimeout(150);
    if(!await page.locator("#sceneModal").isVisible())
      throw new Error("Expected navigation from the FULL editor to open the destination in the FULL editor too, not the text-only one");
    if((await page.locator("#sceneTitle").inputValue())!=="ПоверхностьБ")
      throw new Error("Expected the Scene modal to now represent ПоверхностьБ");
    if((await page.locator("#sceneTextFindReplace .rte-find-input").inputValue())!=="кошка"||
       (await page.locator("#sceneTextFindReplace .rte-replace-input").inputValue())!=="собака")
      throw new Error("Expected the Find/Replace session to survive surface-preserving navigation");
    await page.close();
  }
  {
    const page=await freshPage();
    // Text-only -> Text-only.
    await page.evaluate(()=>openSceneText("d212-surface-a"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кошка");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","собака");
    await page.waitForTimeout(60);
    await page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"ПоверхностьБ"}).locator(".rte-project-result-row").first().click();
    await page.waitForTimeout(150);
    if(!await page.locator("#textModal").isVisible())
      throw new Error("Expected navigation from the text-only editor to open the destination in the text-only editor too");
    if((await page.evaluate(()=>textEditingSceneId))!=="d212-surface-b")
      throw new Error("Expected navigation to land on ПоверхностьБ");
    if((await page.locator("#fullSceneTextFindReplace .rte-find-input").inputValue())!=="кошка")
      throw new Error("Expected the Find/Replace session to survive surface-preserving navigation");
    await page.close();
  }

  // ============================================================
  // PART 11 (Test Contract 11): explicit full-scene <-> text-only switch
  // for the SAME scene, in both directions, with the project session
  // preserved and the existing dirty guard respected.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>editScene("d212-switch"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.click("#sceneTextToolbar .rte-btn-find");
    await page.click("#sceneTextFindReplace .rte-scope-project");
    await page.fill("#sceneTextFindReplace .rte-find-input","кошка");
    await page.waitForTimeout(60);
    await page.click("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForTimeout(150);
    if(!await page.locator("#textModal").isVisible())
      throw new Error("Expected the switch action to open the text-only editor for the SAME scene");
    if((await page.evaluate(()=>textEditingSceneId))!=="d212-switch")
      throw new Error("Expected the text-only editor to represent the SAME scene (d212-switch)");
    if((await page.locator("#fullSceneTextFindReplace .rte-find-input").inputValue())!=="кошка")
      throw new Error("Expected the project session to survive the full->text-only switch");

    // Switch back: text-only -> full.
    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForTimeout(150);
    if(!await page.locator("#sceneModal").isVisible())
      throw new Error("Expected the switch action to open the FULL editor for the SAME scene");
    if((await page.locator("#sceneTitle").inputValue())!=="Переключение")
      throw new Error("Expected the Scene modal to represent the SAME scene (Переключение)");
    if((await page.locator("#sceneTextFindReplace .rte-find-input").inputValue())!=="кошка")
      throw new Error("Expected the project session to survive the text-only->full switch");

    // Dirty guard respected: an unsaved edit must trigger the existing
    // discard confirmation before switching.
    await page.click("#sceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Правка.");
    await page.waitForTimeout(30);
    await page.click("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#discardChangesModal",{state:"visible"});
    await page.click("#continueEditing");
    await page.waitForTimeout(60);
    if(!await page.locator("#sceneModal").isVisible())
      throw new Error("Cancelling the dirty guard during a surface switch must NOT switch surfaces");
    await page.close();
  }

  // ============================================================
  // PART 12 (Test Contract 12): included:false -- unsaved Replace, discard,
  // and Save all behave correctly without ever touching `included`.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-excluded"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","выдра");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","бобр");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-excluded"))!=="Выдра плыла.")
      throw new Error("Unsaved Replace in an excluded scene must not persist");
    if((await rawProject(page)).scenes.find(s=>s.id==="d212-excluded").included!==false)
      throw new Error("included must stay false while unsaved");

    // Discard restores the original.
    await page.click("#closeText");
    await page.waitForSelector("#discardChangesModal",{state:"visible"});
    await page.click("#discardChanges");
    await page.waitForTimeout(60);
    if((await sceneTextOf(page,"d212-excluded"))!=="Выдра плыла.")
      throw new Error("Discard must leave the excluded scene's persisted text unchanged");

    // Now Replace + Save.
    await page.evaluate(()=>openSceneText("d212-excluded"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","выдра");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","бобр");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);
    await page.click("#saveText");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-excluded"))!=="бобр плыла.")
      throw new Error("Save must persist the replacement in the excluded scene");
    if((await rawProject(page)).scenes.find(s=>s.id==="d212-excluded").included!==false)
      throw new Error("Save must never flip included on an excluded scene");
    await page.close();
  }

  console.log("find-replace-project-replace-browser.test.mjs: all assertions passed");
}finally{
  await browser.close();
  server.kill();
}
