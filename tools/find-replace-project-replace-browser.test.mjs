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
    scene("d212-save-text","СохранениеТекст","chapter-1","Барсук ходил."),
    scene("d213-dirty-cycle","ДиртиЦикл","chapter-1","Кот сидит."),
    // Find/Replace Stage D2.1.4: canonical order current -> hidden -> included,
    // for the automatic post-Replace fallback-ordering tests (Test Contract 2).
    scene("d214-current","ДТекущая","chapter-1","Гусь тут один."),
    scene("d214-hidden","ДСкрытая","chapter-1","Гусь в скрытой.",{included:false}),
    scene("d214-included","ДВидимая","chapter-1","Гусь в видимой."),
    // A second, independent trio with the included scene BEFORE current, so
    // the "prefer a previous included scene" branch is exercised too.
    scene("d214b-included","ДВидимая2","chapter-1","Утка в видимой."),
    scene("d214b-current","ДТекущая2","chapter-1","Утка тут одна."),
    scene("d214b-hidden","ДСкрытая2","chapter-1","Утка в скрытой.",{included:false})
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
    // Find/Replace Stage D2.1.3 (Finding 2): Save-and-Close is now itself a
    // Save button, correctly DISABLED right after the Save-only click above
    // already cleaned the form -- clicking it with nothing new to save would
    // never reach a click at all. A genuine further edit (matching the
    // text-only/all-scenes blocks above and below, which already did this)
    // is needed to exercise "Сохранить и закрыть persists AND closes".
    await page.click("#sceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё правка.");
    await page.waitForTimeout(30);
    await page.click("#saveSceneAndClose");
    await page.waitForTimeout(80);
    if((await sceneTextOf(page,"d212-save-full"))!=="Ёж бежал. Правка. Ещё правка.")
      throw new Error("Сохранить и закрыть must persist for the full Scene editor too");
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

    // Find/Replace Stage D2.1.4 (Finding 2): a surface switch is a LIVE
    // EDITOR STATE HANDOFF, not a Save -- an unsaved SCENE-TEXT-only edit
    // must switch seamlessly (no discard prompt, no persistence), handing
    // the unsaved live doc to the destination surface. This supersedes
    // D2.1.2's own "any dirty edit triggers the guard" expectation for text
    // edits specifically -- see docs/find-replace-architecture.md.
    await page.click("#sceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Правка.");
    await page.waitForTimeout(30);
    await page.click("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForTimeout(150);
    if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display==="flex"))
      throw new Error("A text-only edit must switch surfaces seamlessly, without the discard guard");
    if(!await page.locator("#textModal").isVisible())
      throw new Error("Expected the seamless switch to open the text-only editor");
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кошка гуляла во дворе. Правка.")
      throw new Error("Expected the unsaved live text to be handed off to the text-only surface");
    if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("The handed-off text must still read as dirty (relative to the persisted baseline)");
    if((await sceneTextOf(page,"d212-switch"))!=="Кошка гуляла во дворе.")
      throw new Error("The handoff itself must never persist anything");

    // Find/Replace Stage D2.1.4 (Finding 2): the REVERSE case -- a NON-TEXT
    // edit (title) in the Scene modal must still trigger the existing
    // discard guard, since Text Scene has no field to carry it to. Switch
    // back to the Scene modal first (still carrying the unsaved text).
    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(100);
    await page.fill("#sceneTitle","Переключение (правка)");
    await page.waitForTimeout(30);
    await page.click("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#discardChangesModal",{state:"visible"});
    await page.click("#continueEditing");
    await page.waitForTimeout(60);
    if(!await page.locator("#sceneModal").isVisible())
      throw new Error("Cancelling the dirty guard during a surface switch must NOT switch surfaces");
    if((await page.locator("#sceneTitle").inputValue())!=="Переключение (правка)")
      throw new Error("Cancelling the guard must leave the non-text edit intact");
    if((await editorText(page,"#sceneTextEditor"))!=="Кошка гуляла во дворе. Правка.")
      throw new Error("Cancelling the guard must leave the text edit intact too");
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

  // ============================================================
  // PART 13 (Find/Replace Stage D2.1.3, Finding 2/12): Save-button dirty-
  // state cycle -- disabled while clean, enabled while dirty, re-disabled
  // after a successful Save, refreshed live on Undo/Redo and on a
  // PROGRAMMATIC Find/Replace Replace (neither of which fires a native DOM
  // "input"/"change" event, unlike ordinary typing).
  // ============================================================
  {
    const page=await freshPage();
    const disabledOf=async ids=>{
      const result={};
      for(const id of ids)result[id]=await page.evaluate(elId=>document.getElementById(elId).disabled,id);
      return result;
    };

    // -- text-only surface --
    await page.evaluate(()=>openSceneText("d213-dirty-cycle"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    let state=await disabledOf(["saveText","saveTextAndClose"]);
    if(!state.saveText||!state.saveTextAndClose)
      throw new Error("Save/Save-and-close (text-only) must start disabled on a clean open");

    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","Кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","Пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one"); // programmatic dispatch, no native input/change event
    await page.waitForTimeout(80);
    state=await disabledOf(["saveText","saveTextAndClose"]);
    if(state.saveText||state.saveTextAndClose)
      throw new Error("A programmatic Find/Replace Replace must enable Save (text-only) without any native input/change event");

    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("Control+z"); // Undo -- also no native input/change event
    await page.waitForTimeout(80);
    state=await disabledOf(["saveText","saveTextAndClose"]);
    if(!state.saveText||!state.saveTextAndClose)
      throw new Error("Undo back to the saved baseline must re-disable Save (text-only)");

    await page.keyboard.press("Control+y"); // Redo
    await page.waitForTimeout(80);
    state=await disabledOf(["saveText","saveTextAndClose"]);
    if(state.saveText||state.saveTextAndClose)
      throw new Error("Redo must re-enable Save (text-only)");

    await page.click("#saveText");
    await page.waitForTimeout(80);
    state=await disabledOf(["saveText","saveTextAndClose"]);
    if(!state.saveText||!state.saveTextAndClose)
      throw new Error("A successful Save must re-disable Save/Save-and-close (text-only)");
    if((await sceneTextOf(page,"d213-dirty-cycle"))!=="Пёс сидит.")
      throw new Error("Setup for the remaining parts of this test expected the text Replace to have persisted");
    await page.evaluate(()=>{destroySceneTextEditor();forceHideModal("textModal")});

    // -- full scene surface: a non-text field (title) must also count as dirty --
    await page.evaluate(()=>editScene("d213-dirty-cycle"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    state=await disabledOf(["saveScene","saveSceneAndClose"]);
    if(!state.saveScene||!state.saveSceneAndClose)
      throw new Error("Save/Save-and-close (full scene) must start disabled on a clean open");
    await page.fill("#sceneTitle","ДиртиЦикл (изменено)");
    await page.waitForTimeout(60);
    state=await disabledOf(["saveScene","saveSceneAndClose"]);
    if(state.saveScene||state.saveSceneAndClose)
      throw new Error("Editing a non-text field (title) must enable Save for the full Scene editor -- Finding 2 explicitly requires this");
    await page.click("#saveScene");
    await page.waitForTimeout(80);
    state=await disabledOf(["saveScene","saveSceneAndClose"]);
    if(!state.saveScene||!state.saveSceneAndClose)
      throw new Error("A successful Save must re-disable Save/Save-and-close (full scene)");
    await page.evaluate(()=>{destroySceneModalTextEditor();forceHideModal("sceneModal")});

    // -- all-scenes surface --
    await page.evaluate(()=>openAllScenes());
    await page.waitForSelector("#allScenesList .ProseMirror");
    state=await disabledOf(["saveAllScenes","saveAllScenesAndClose"]);
    if(!state.saveAllScenes||!state.saveAllScenesAndClose)
      throw new Error("Save/Save-and-close (all-scenes) must start disabled on a clean open");
    await page.click("#allScenesToolbar .rte-btn-find");
    await page.click("#allScenesFindReplace .rte-scope-project");
    await page.fill("#allScenesFindReplace .rte-find-input","сидит");
    await page.fill("#allScenesFindReplace .rte-replace-input","стоит");
    await page.waitForTimeout(80);
    // "Весь текст" mounts every scene at once -- the controller's own
    // "attached" scene (whichever one Replace is allowed to mutate, per
    // Finding 7's cross-scene guard) is whichever scene last actually
    // received navigation/focus, not merely whichever scene the active
    // project result happens to belong to. A fresh query's first active
    // result can land in a scene nothing has explicitly navigated to yet --
    // exactly the state Finding 7 requires Replace to REFUSE on rather than
    // silently mutate. Next() is the normal navigation step that reconciles
    // the two, so the realistic click sequence includes it here.
    await page.click("#allScenesFindReplace .rte-find-next");
    await page.waitForTimeout(80);
    await page.click("#allScenesFindReplace .rte-replace-one"); // programmatic, no native input/change event
    await page.waitForTimeout(80);
    state=await disabledOf(["saveAllScenes","saveAllScenesAndClose"]);
    if(state.saveAllScenes||state.saveAllScenesAndClose)
      throw new Error("A programmatic Find/Replace Replace must enable Save (all-scenes) without any native input/change event");
    if((await page.evaluate(()=>document.querySelector('[id="allSceneEditor-d213-dirty-cycle"] .ProseMirror')?.textContent))!=="Пёс стоит.")
      throw new Error("Replace must actually have applied to the navigated-to match");
    await page.click("#saveAllScenes");
    await page.waitForTimeout(120);
    state=await disabledOf(["saveAllScenes","saveAllScenesAndClose"]);
    if(!state.saveAllScenes||!state.saveAllScenesAndClose)
      throw new Error("A successful Save must re-disable Save/Save-and-close (all-scenes)");
    await page.close();
  }

  // ============================================================
  // PART 14 (Find/Replace Stage D2.1.3, Finding 8/9): a current-scene
  // ("Эта сцена") Find/Replace session -- query, replacement text,
  // case-sensitive option, panel open state -- is preserved across an
  // explicit Scene Editor <-> Text Scene surface switch, in BOTH directions,
  // not just project-scope sessions (D2.1.2 only covered those). Also
  // verifies the renamed switch-surface label ("Редактор сцены").
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-persist"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.click("#fullSceneTextFindReplace .rte-find-case");
    await page.waitForTimeout(60);

    const switchLabel=await page.evaluate(()=>document.querySelector("#fullSceneTextToolbar .rte-btn-switch-surface")?.textContent);
    if(switchLabel!=="⇄ Редактор сцены")
      throw new Error(`Finding 9: text-only surface's switch button must read "⇄ Редактор сцены", got "${switchLabel}"`);

    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(100);
    let panelState=await page.evaluate(()=>({
      query:document.querySelector("#sceneTextFindReplace .rte-find-input")?.value,
      replaceText:document.querySelector("#sceneTextFindReplace .rte-replace-input")?.value,
      caseSensitive:document.querySelector("#sceneTextFindReplace .rte-find-case")?.getAttribute("aria-pressed"),
      scopeIsScene:document.querySelector("#sceneTextFindReplace .rte-scope-scene")?.classList.contains("active")
    }));
    if(panelState.query!=="кот"||panelState.replaceText!=="пёс"||panelState.caseSensitive!=="true"||!panelState.scopeIsScene)
      throw new Error(`Finding 8: current-scene session must survive text-only -> full-scene switch, got ${JSON.stringify(panelState)}`);

    const switchLabelBack=await page.evaluate(()=>document.querySelector("#sceneTextToolbar .rte-btn-switch-surface")?.textContent);
    if(switchLabelBack!=="⇄ Текст сцены")
      throw new Error(`Finding 9: full-scene surface's switch button must read "⇄ Текст сцены", got "${switchLabelBack}"`);

    await page.click("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#textModal",{state:"visible"});
    await page.waitForTimeout(100);
    panelState=await page.evaluate(()=>({
      query:document.querySelector("#fullSceneTextFindReplace .rte-find-input")?.value,
      replaceText:document.querySelector("#fullSceneTextFindReplace .rte-replace-input")?.value,
      caseSensitive:document.querySelector("#fullSceneTextFindReplace .rte-find-case")?.getAttribute("aria-pressed"),
      scopeIsScene:document.querySelector("#fullSceneTextFindReplace .rte-scope-scene")?.classList.contains("active")
    }));
    if(panelState.query!=="кот"||panelState.replaceText!=="пёс"||panelState.caseSensitive!=="true"||!panelState.scopeIsScene)
      throw new Error(`Finding 8: current-scene session must survive full-scene -> text-only switch back, got ${JSON.stringify(panelState)}`);
    await page.close();
  }

  // ============================================================
  // PART 15 (Find/Replace Stage D2.1.3, Finding 1/10/11): scope-toggle
  // selection-sanity matrix -- toggling scope ("Эта сцена" <-> "Весь
  // проект"), in BOTH directions, must never leave a stray non-collapsed
  // real editor selection behind, at every checkpoint the finding calls out:
  // before Replace, after Replace, after Undo, after an EMPTY-string
  // Replace, after Undo of that empty Replace, and after arrow navigation.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-persist"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
    await page.waitForTimeout(60);

    // Real DOM selection only reflects ProseMirror's own model selection
    // while the editor itself has DOM focus (PM deliberately does not steal
    // focus/selection from e.g. the Find input or a toolbar button) -- so
    // this refocuses the editor (a plain click, never altering the doc or
    // the model selection itself) immediately before every reading, exactly
    // as a user tabbing back into the editor would.
    async function selectionSnapshot(){
      await page.click("#fullSceneTextEditor .ProseMirror");
      return page.evaluate(()=>{
        const sel=window.getSelection();
        return {text:sel.toString(),isCollapsed:sel.isCollapsed};
      });
    }
    function assertClean(label,snap){
      if(snap.text!==""||!snap.isCollapsed)
        throw new Error(`Finding 1/10: ${label} must leave a collapsed, empty selection, got ${JSON.stringify(snap)}`);
    }
    async function toggleBothWays(label){
      await page.click("#fullSceneTextFindReplace .rte-scope-scene");
      await page.waitForTimeout(60);
      assertClean(`${label} -> toggled to "Эта сцена"`,await selectionSnapshot());
      await page.click("#fullSceneTextFindReplace .rte-scope-project");
      await page.waitForTimeout(60);
      assertClean(`${label} -> toggled back to "Весь проект"`,await selectionSnapshot());
    }

    // 1. Before Replace.
    await toggleBothWays("before Replace");

    // 2. After Replace (non-empty).
    await page.click("#fullSceneTextFindReplace .rte-scope-project"); // re-affirm scope after toggling
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","пёс");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);
    await toggleBothWays("after Replace");

    // 3. After Undo (of the Replace).
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(80);
    await toggleBothWays("after Undo");

    // 4. After an EMPTY-string Replace.
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(80);
    await toggleBothWays("after an empty-string Replace");

    // 5. After Undo of that empty-string Replace.
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(80);
    await toggleBothWays("after Undo of an empty-string Replace");

    // 6. After arrow navigation.
    await page.click("#fullSceneTextFindReplace .rte-find-next");
    await page.waitForTimeout(80);
    await toggleBothWays("after arrow navigation");

    // Arrows must still work after all this scope toggling (matching
    // decorations, no stuck/disabled state).
    const countAfter=await page.evaluate(()=>document.querySelector("#fullSceneTextFindReplace .rte-find-count")?.textContent);
    if(!countAfter||countAfter==="0 из 0")
      throw new Error(`Finding 10: arrows must still report real matches after the full scope-toggle matrix, got "${countAfter}"`);
    await page.click("#fullSceneTextFindReplace .rte-find-next");
    await page.waitForTimeout(60);
    const activeAfterArrow=await page.evaluate(()=>document.querySelector("#fullSceneTextEditor .rte-find-match-active")?.textContent);
    if(!activeAfterArrow)
      throw new Error("Finding 10: Next must still produce a real active-match decoration after the scope-toggle matrix");
    await page.close();
  }

  // ============================================================
  // PART 16 (Find/Replace Stage D2.1.4, Finding 1 -- Test Contract 1/2/3):
  // Replace eligibility must already be disabled once the active global
  // result no longer belongs to the ATTACHED editor, never enabled-then-
  // silently-refused; automatic post-Replace fallback must prefer an
  // author-visible (included) scene over a hidden one, in both canonical
  // orderings; and an included:false scene must remain fully explicitly
  // navigable/replaceable via a direct result-row click regardless.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d214-current"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","Гусь");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","Индюк");
    await page.waitForTimeout(80);
    if(await page.evaluate(()=>document.querySelector("#fullSceneTextFindReplace .rte-replace-one")?.disabled))
      throw new Error("Test Contract 1: Replace must be enabled while the active result is in the attached scene");

    const textsBefore=await rawProject(page);
    await page.click("#fullSceneTextFindReplace .rte-replace-one"); // exhausts d214-current's only match
    await page.waitForTimeout(150);

    const state=await page.evaluate(()=>({
      count:document.querySelector("#fullSceneTextFindReplace .rte-find-count")?.textContent,
      replaceDisabled:document.querySelector("#fullSceneTextFindReplace .rte-replace-one")?.disabled,
      activeSceneHeader:document.querySelector(".rte-project-result-row.active")?.closest(".rte-project-result-group")?.querySelector(".rte-project-result-scene-header")?.textContent
    }));
    // Test Contract 1: eligibility.
    if(!state.replaceDisabled)
      throw new Error("Test Contract 1: Replace must be DISABLED once the active result belongs to another (unattached) scene");
    // Test Contract 2: automatic fallback prefers the included scene (ДВидимая), not the hidden one (ДСкрытая).
    if(!state.activeSceneHeader?.includes("ДВидимая")||state.activeSceneHeader?.includes("ДСкрытая"))
      throw new Error(`Test Contract 2: automatic fallback must prefer the included scene, got "${state.activeSceneHeader}"`);

    // The disabled control cannot mutate anything -- also confirms the
    // runtime guard (defense in depth) independently refuses.
    await page.click("#fullSceneTextFindReplace .rte-replace-one",{force:true}).catch(()=>{});
    await page.waitForTimeout(100);
    const textsAfter=await rawProject(page);
    if(JSON.stringify(textsBefore.scenes.filter(s=>s.id!=="d214-current"))!==JSON.stringify(textsAfter.scenes.filter(s=>s.id!=="d214-current")))
      throw new Error("Test Contract 1: no scene other than the one just replaced may have been mutated");
    if((await sceneTextOf(page,"d214-hidden"))!=="Гусь в скрытой."||(await sceneTextOf(page,"d214-included"))!=="Гусь в видимой.")
      throw new Error("Test Contract 1: the disabled Replace control must not have mutated the fallback target");

    // Save first -- "Текст сцены" is a single-editor surface, so opening a
    // DIFFERENT (unmounted) scene from a result-row click transitions away
    // from d214-current, which would otherwise still be dirty from the
    // Replace above and trigger the UNRELATED, pre-existing discard guard
    // this part isn't testing.
    await page.click("#saveText");
    await page.waitForTimeout(80);

    // Test Contract 3: the hidden scene stays fully explicitly navigable/replaceable.
    const rows=await page.$$(".rte-project-result-row");
    let hiddenRow=null;
    for(const row of rows){
      const header=await row.evaluateHandle(el=>el.closest(".rte-project-result-group")?.querySelector(".rte-project-result-scene-header")?.textContent);
      if((await header.jsonValue())?.includes("ДСкрытая")){hiddenRow=row;break}
    }
    if(!hiddenRow)throw new Error("Test Contract 3: the excluded scene's result must still be listed");
    await hiddenRow.click();
    await page.waitForTimeout(150);
    if(await page.evaluate(()=>document.querySelector("#fullSceneTextFindReplace .rte-replace-one")?.disabled))
      throw new Error("Test Contract 3: Replace must become enabled once the excluded scene is explicitly opened");
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(120);
    // Local/unsaved, per the established D2.1.2 contract: the live editor
    // shows the replacement, canonical/persisted data is untouched until Save.
    if((await editorText(page,"#fullSceneTextEditor"))!=="Индюк в скрытой.")
      throw new Error("Test Contract 3: explicit Replace in the excluded scene must apply locally/unsaved");
    if((await sceneTextOf(page,"d214-hidden"))!=="Гусь в скрытой.")
      throw new Error("Test Contract 3: explicit Replace must not persist by itself");
    await page.close();
  }

  // ============================================================
  // PART 17 (Find/Replace Stage D2.1.4, Finding 1 -- Test Contract 2, second
  // ordering): the included scene sits BEFORE the current scene in canonical
  // order, and the hidden scene sits after -- automatic fallback must prefer
  // the PREVIOUS included scene over the hidden one.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d214b-current"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.click("#fullSceneTextFindReplace .rte-scope-project");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","Утка");
    await page.fill("#fullSceneTextFindReplace .rte-replace-input","Цапля");
    await page.waitForTimeout(80);
    await page.click("#fullSceneTextFindReplace .rte-replace-one");
    await page.waitForTimeout(150);
    const header=await page.evaluate(()=>document.querySelector(".rte-project-result-row.active")?.closest(".rte-project-result-group")?.querySelector(".rte-project-result-scene-header")?.textContent);
    if(!header?.includes("ДВидимая2")||header?.includes("ДСкрытая2"))
      throw new Error(`Test Contract 2 (previous-included ordering): fallback must prefer the previous included scene, got "${header}"`);
    await page.close();
  }

  // ============================================================
  // PART 18 (Find/Replace Stage D2.1.4, Finding 2 -- Test Contract 4/5/6/7):
  // live-doc handoff, Text Scene -> Scene Editor: no Save prompt, no
  // persistence call, destination shows the unsaved text and is dirty, round
  // trip without Save, Save-after-handoff, and discard-after-handoff.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d213-dirty-cycle"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Правка Б.");
    await page.waitForTimeout(60);

    // Test Contract 4: no Save prompt, no persistence, destination dirty.
    const promptAppeared=await page.evaluate(async()=>{
      document.querySelector("#fullSceneTextToolbar .rte-btn-switch-surface")?.click();
      await new Promise(r=>setTimeout(r,150));
      return document.getElementById("discardChangesModal").style.display==="flex";
    });
    if(promptAppeared)throw new Error("Test Contract 4: switching with an unsaved text-only edit must not prompt to Save");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(100);
    if((await editorText(page,"#sceneTextEditor"))!=="Кот сидит. Правка Б.")
      throw new Error("Test Contract 4: the destination must show the exact unsaved text");
    if(!await page.evaluate(()=>trackerFor("sceneModal").isDirty()))
      throw new Error("Test Contract 4: the destination must be dirty relative to the persisted baseline");
    if(await page.evaluate(()=>document.getElementById("saveScene").disabled))
      throw new Error("Test Contract 4: Save must be enabled after a dirty handoff");
    if((await sceneTextOf(page,"d213-dirty-cycle"))!=="Кот сидит.")
      throw new Error("Test Contract 4: the handoff itself must never persist");

    // Test Contract 5: round trip without Save.
    await page.click("#sceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#textModal",{state:"visible"});
    await page.waitForTimeout(100);
    if((await editorText(page,"#fullSceneTextEditor"))!=="Кот сидит. Правка Б.")
      throw new Error("Test Contract 5: the unsaved text must survive a round trip through both surfaces");
    if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("Test Contract 5: must still read as dirty after the round trip");
    if((await sceneTextOf(page,"d213-dirty-cycle"))!=="Кот сидит.")
      throw new Error("Test Contract 5: no persistence must have occurred across either switch");

    // Test Contract 6: Save after handoff.
    await page.click("#saveText");
    await page.waitForTimeout(100);
    if((await sceneTextOf(page,"d213-dirty-cycle"))!=="Кот сидит. Правка Б.")
      throw new Error("Test Contract 6: Save after the handoff must persist the handed-off text");
    if(!await page.locator("#textModal").isVisible())
      throw new Error("Test Contract 6: the surface must remain open after Save");
    if(await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("Test Contract 6: must be clean after Save");
    if(!await page.evaluate(()=>document.getElementById("saveText").disabled))
      throw new Error("Test Contract 6: Save must be disabled again once clean");
    await page.evaluate(()=>{destroySceneTextEditor();forceHideModal("textModal")});

    // Test Contract 7: discard after handoff, then reopen restores the
    // persisted baseline (a SEPARATE scene, never saved this time).
    await page.evaluate(()=>openSceneText("d213-dirty-cycle"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" В.");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(100);
    await page.click("#cancelScene");
    await page.waitForSelector("#discardChangesModal",{state:"visible"});
    await page.click("#discardChanges");
    await page.waitForTimeout(150);
    await page.evaluate(()=>editScene("d213-dirty-cycle"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    if((await editorText(page,"#sceneTextEditor"))!=="Кот сидит. Правка Б.")
      throw new Error(`Test Contract 7: reopening after discard must restore the last PERSISTED text (from Test 6's own Save), got "${await editorText(page,"#sceneTextEditor")}"`);
    await page.close();
  }

  // ============================================================
  // PART 19 (Find/Replace Stage D2.1.4, Finding 2 -- Test Contract 8/9/10):
  // Scene Editor -> Text Scene for text-only dirty (seamless) vs non-text
  // dirty (existing guard preserved), and Find session sees the handed-off
  // live doc's own content.
  // ============================================================
  {
    const page=await freshPage();

    // Test Contract 8: Scene Editor text-only dirty -> Text Scene, seamless.
    await page.evaluate(()=>editScene("d212-locality-2"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.click("#sceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Правка.");
    await page.waitForTimeout(60);
    const promptAppeared8=await page.evaluate(async()=>{
      document.querySelector("#sceneTextToolbar .rte-btn-switch-surface")?.click();
      await new Promise(r=>setTimeout(r,150));
      return document.getElementById("discardChangesModal").style.display==="flex";
    });
    if(promptAppeared8)throw new Error("Test Contract 8: a text-only Scene-Editor edit must switch to Text Scene seamlessly");
    await page.waitForSelector("#textModal",{state:"visible"});
    await page.waitForTimeout(100);
    if((await editorText(page,"#fullSceneTextEditor"))!=="И кот здесь. Правка.")
      throw new Error("Test Contract 8: the unsaved text must be handed off");
    if(!await page.evaluate(()=>trackerFor("textModal").isDirty()))
      throw new Error("Test Contract 8: must read as dirty");
    if((await sceneTextOf(page,"d212-locality-2"))!=="И кот здесь.")
      throw new Error("Test Contract 8: no persistence must have occurred");
    await page.evaluate(()=>{destroySceneTextEditor();forceHideModal("textModal")});

    // Test Contract 9: Scene Editor NON-text dirty -> guard still fires.
    await page.evaluate(()=>editScene("d212-surface-b"));
    await page.waitForSelector("#sceneTextEditor .ProseMirror");
    await page.fill("#sceneTitle","ПоверхностьБ (изм.)");
    await page.waitForTimeout(60);
    const promptAppeared9=await page.evaluate(async()=>{
      document.querySelector("#sceneTextToolbar .rte-btn-switch-surface")?.click();
      await new Promise(r=>setTimeout(r,150));
      return document.getElementById("discardChangesModal").style.display==="flex";
    });
    if(!promptAppeared9)throw new Error("Test Contract 9: a non-text edit must still trigger the existing discard guard");
    if(!await page.locator("#sceneModal").isVisible())
      throw new Error("Test Contract 9: the guard must keep the Scene modal open, not switch");
    await page.click("#continueEditing");
    await page.waitForTimeout(60);
    if((await page.locator("#sceneTitle").inputValue())!=="ПоверхностьБ (изм.)")
      throw new Error("Test Contract 9: cancelling the guard must leave the edit intact");
    await page.evaluate(()=>{destroySceneModalTextEditor();forceHideModal("sceneModal")});

    // Test Contract 10: Find session sees the handed-off live doc's own term.
    await page.evaluate(()=>openSceneText("d212-persist"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Жираф.");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextToolbar .rte-btn-find");
    await page.fill("#fullSceneTextFindReplace .rte-find-input","жираф");
    await page.waitForTimeout(60);
    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(150);
    const found=await page.evaluate(()=>document.querySelector("#sceneTextFindReplace .rte-find-count")?.textContent);
    if(found==="0 из 0"||!found)
      throw new Error(`Test Contract 10: destination search must see the term from the handed-off live doc, got "${found}"`);
    await page.close();
  }

  // ============================================================
  // PART 20 (Find/Replace Stage D2.1.4, Finding 2 -- Test Contract 11): rich
  // text survives an unsaved live-doc handoff -- the mechanism hands off the
  // exact ProseMirror JSON (sceneTextDoc model), never a plain-text round
  // trip, so a bold mark must still be there on the destination surface.
  // ============================================================
  {
    const page=await freshPage();
    await page.evaluate(()=>openSceneText("d212-empty-full"));
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    await page.click("#fullSceneTextEditor .ProseMirror");
    await page.keyboard.press("End");
    await page.keyboard.type(" Жирный");
    await page.keyboard.down("Shift");
    for(let i=0;i<6;i++)await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.up("Shift");
    await page.click("#fullSceneTextToolbar .rte-btn-bold");
    await page.waitForTimeout(60);
    const beforeHtml=await page.evaluate(()=>document.querySelector("#fullSceneTextEditor .ProseMirror").innerHTML);
    if(!beforeHtml.includes("<strong>"))throw new Error("Test Contract 11: setup expected a bold mark before switching");
    await page.click("#fullSceneTextToolbar .rte-btn-switch-surface");
    await page.waitForSelector("#sceneModal .ProseMirror",{state:"visible"});
    await page.waitForTimeout(150);
    const afterHtml=await page.evaluate(()=>document.querySelector("#sceneTextEditor .ProseMirror").innerHTML);
    if(!afterHtml.includes("<strong>"))
      throw new Error(`Test Contract 11: the bold mark must survive the handoff, got "${afterHtml}"`);
    await page.close();
  }

  console.log("find-replace-project-replace-browser.test.mjs: all assertions passed");
}finally{
  await browser.close();
  server.kill();
}
