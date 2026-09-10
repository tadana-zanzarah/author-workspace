// Find/Replace Stage D1: browser coverage for project-wide search, results,
// and navigation across all three rich-text surfaces. Stage C's own current-
// scene behavior is already covered by
// tools/find-replace-current-scene-browser.test.mjs (re-run alongside this
// file, unmodified, to confirm no regression) -- this file focuses on what's
// NEW: the scope toggle, project search coverage/ordering, live-vs-persisted
// resolution, navigation (mounted and unmounted targets), stale revalidation,
// and the project-scope Replace lockout. See docs/find-replace-architecture.md.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8098,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
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
    scene("scene-standalone","Приём","chapter-1","Кот сидел на окне."),
    scene("scene-excluded","После бала","chapter-unassigned","Здесь тоже был кот.",{included:false}),
    scene("scene-modal-target","В модалке","chapter-1","Кот заглянул в модалку."),
    scene("scene-all","В общем тексте","chapter-1","Кот гулял по общему тексту."),
    // included:false so this scene is never mounted anywhere -- not even in
    // "Весь текст" -- making it a genuine case-B navigation target.
    scene("scene-unmounted","Нигде не открыта","chapter-unassigned","Кот нигде не открыт.",{included:false})
  ]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("frps-seeded"))return;sessionStorage.setItem("frps-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  const isOpen=async id=>page.$eval(`#${id}`,node=>node.style.display==="flex").catch(()=>false);
  const rawProject=()=>page.evaluate(()=>localStorage.getItem("novelTimelineV11"));

  // ============================================================
  // PART 1: scope toggle exists on all three surfaces.
  // ============================================================
  await page.evaluate(()=>openSceneText("scene-standalone"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  if(await page.locator("#fullSceneTextFindReplace .rte-scope-toggle").count()!==1)
    throw new Error("Standalone Текст сцены is missing the scope toggle");
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  await page.evaluate(()=>editScene("scene-modal-target"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  await page.click("#sceneTextToolbar .rte-btn-find");
  if(await page.locator("#sceneTextFindReplace .rte-scope-toggle").count()!==1)
    throw new Error("Scene modal is missing the scope toggle");
  await page.click("#sceneTextFindReplace .rte-find-close");
  await page.keyboard.press("Escape");

  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  if(await page.locator("#allScenesFindReplace .rte-scope-toggle").count()!==1)
    throw new Error("Весь текст is missing the scope toggle");

  // ============================================================
  // PART 2: project search coverage/ordering/counts, from "Весь текст".
  // "Весь текст" only ever MOUNTS included scenes -- scene-excluded and
  // scene-unmounted are never in this modal's own DOM at all, which is
  // exactly what makes this the right surface to prove project search does
  // NOT depend on "Весь текст" mounting every scene (product brief section
  // 11) and does NOT filter by scene.included (section 2).
  // ============================================================
  await page.click('#allScenesFindReplace .rte-scope-project');
  await page.fill("#allScenesFindReplace .rte-find-input","кот");
  await page.waitForTimeout(50);

  const summaryText=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
  if(!/5\s*совпадени/.test(summaryText)||!/5\s*сцен/.test(summaryText))
    throw new Error(`Expected 5 matches across 5 scenes, got summary: ${summaryText}`);

  const groupHeaders=await page.locator("#allScenesModal .rte-project-results .rte-project-result-scene-header").allTextContents();
  if(!groupHeaders.some(h=>h.includes("После бала")))
    throw new Error("Excluded scene (included:false) must still appear in project results");
  if(!groupHeaders.some(h=>h.includes("Нигде не открыта")))
    throw new Error("A scene never mounted in \"Весь текст\" must still appear in project results");
  // Canonical order: chapter-1's scenes (Приём, В модалке, В общем тексте) before
  // chapter-unassigned's (После бала, Нигде не открыта), each in their own
  // stored scene order.
  const order=groupHeaders.map(h=>h.split("Сцена: ")[1]);
  const expectedOrder=["Приём","В модалке","В общем тексте","После бала","Нигде не открыта"];
  if(JSON.stringify(order)!==JSON.stringify(expectedOrder))
    throw new Error(`Expected canonical chapter/scene order ${JSON.stringify(expectedOrder)}, got ${JSON.stringify(order)}`);

  // --- Snippet highlighting: the matched segment is a <mark>, real source
  // text, not raw HTML injection.
  const firstRowMarkText=await page.locator("#allScenesModal .rte-project-results .rte-project-result-row").first().locator("mark").textContent();
  if(firstRowMarkText.toLowerCase()!=="кот")throw new Error(`Expected the highlighted snippet segment to be the matched text, got ${JSON.stringify(firstRowMarkText)}`);

  // --- Project-scope Replace lockout: Заменить/Заменить все are disabled
  // with an explanatory title, but the Replace INPUT itself stays usable.
  if(!await page.locator("#allScenesFindReplace .rte-replace-one").isDisabled())
    throw new Error("Заменить must be disabled while scope is Весь проект");
  if(!await page.locator("#allScenesFindReplace .rte-replace-all").isDisabled())
    throw new Error("Заменить все must be disabled while scope is Весь проект");
  if(await page.locator("#allScenesFindReplace .rte-replace-input").isDisabled())
    throw new Error("The Replace input itself must remain usable in project scope");
  await page.fill("#allScenesFindReplace .rte-replace-input","пёс");
  if((await page.locator("#allScenesFindReplace .rte-replace-input").inputValue())!=="пёс")
    throw new Error("Typing into the Replace input must still work in project scope");

  // ============================================================
  // PART 3: navigation to an ALREADY-MOUNTED scene within the SAME "Весь
  // текст" group (case A) -- selects the exact match, stays in this modal,
  // and the project results/query survive (no remount happened).
  // ============================================================
  {
    // The row belonging to the "В общем тексте" group specifically.
    const targetRow=page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"В общем тексте"}).locator(".rte-project-result-row").first();
    await targetRow.click();
    await page.waitForTimeout(50);
    if(!await isOpen("allScenesModal"))throw new Error("Navigating to an already-mounted scene must not close/replace the current modal");
    const selection=await page.evaluate(()=>{
      const editor=document.getElementById("allSceneEditor-scene-all").querySelector(".ProseMirror");
      return document.activeElement===editor||editor.contains(document.activeElement);
    });
    if(!selection)throw new Error("Navigating to an already-mounted project result did not focus that scene's own editor");
    // Query/results must still be showing -- the shared group controller was
    // retargeted, not destroyed/recreated.
    if((await page.locator("#allScenesFindReplace .rte-find-input").inputValue())!=="кот")
      throw new Error("Project search query was lost after navigating within the same surface");
  }

  // ============================================================
  // PART 5: live refresh -- editing the currently-attached scene's own text
  // while project scope is active updates the result count (no stale count).
  // Runs BEFORE part 4 below deliberately: navigating to a scene that isn't
  // mounted anywhere closes this modal (see part 4's own comment), so
  // anything that wants to keep using allScenesModal's own panel has to
  // happen first.
  // ============================================================
  {
    await page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"В общем тексте"}).locator(".rte-project-result-row").first().click();
    await page.waitForTimeout(50);
    const beforeSummary=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
    await page.locator("#allSceneEditor-scene-all .ProseMirror").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Ещё один кот.");
    await page.waitForTimeout(80);
    const afterSummary=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
    if(afterSummary===beforeSummary)throw new Error("Editing the active scene's own text while project scope is open did not refresh the result count");
    if(!/6\s*совпадени/.test(afterSummary))throw new Error(`Expected the total to grow to 6 after adding one more "кот", got: ${afterSummary}`);
  }

  // ============================================================
  // PART 4: navigation to an UNMOUNTED scene (scene-unmounted, never open
  // anywhere) from "Весь текст" -- case B, delegates through
  // openSceneText/openSceneForEditing. This app already enforces "exactly
  // one rich-text editing surface open at a time" (js/dirty-state.js's
  // requestEditorTransition force-closes whatever editing surface is
  // currently open before opening a different one, existing pre-D1
  // behavior, not something this stage changes) -- so opening the standalone
  // Текст сцены modal for a genuinely different, unmounted scene closes
  // allScenesModal rather than stacking on top of it. That means this
  // specific cross-surface case does NOT preserve the originating panel's
  // search context -- a documented, accepted D1 limitation (see product
  // brief section 10: "use the smallest safe behavior and report the
  // limitation" when full panel persistence isn't possible without a larger
  // redesign) -- this part only verifies the navigation itself still lands
  // correctly. Part 5 above left allScenesModal genuinely dirty (it typed
  // into scene-all's own live text), so this transition also exercises the
  // existing discard-confirmation prompt (js/dirty-state.js) -- confirming
  // discard here is correct: this test's own PART 5 assertions already ran
  // before this point, so nothing this test still needs is lost.
  // ============================================================
  {
    const targetRow=page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"Нигде не открыта"}).locator(".rte-project-result-row").first();
    await targetRow.click();
    await page.waitForTimeout(100);
    if(await isOpen("discardChangesModal"))await page.click("#discardChanges");
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    if(!await isOpen("textModal"))throw new Error("Navigating to an unmounted scene must open the standalone Текст сцены modal via openSceneForEditing");
    if(await isOpen("allScenesModal"))throw new Error("Expected the pre-existing single-editing-surface transition to close the originating modal (see this part's own comment)");
    if((await page.locator("#textModalTitle").textContent())!=="Нигде не открыта")
      throw new Error("The opened standalone modal must target the exact scene the result pointed at");
    const selectedText=await page.evaluate(()=>{
      const {selection,doc}=sceneTextEditor.view.state;
      return doc.textBetween(selection.from,selection.to);
    });
    if(selectedText.toLowerCase()!=="кот")throw new Error(`Expected the opened scene's selection to land on the match, got ${JSON.stringify(selectedText)}`);
    await page.click("#closeText");
    if(await isOpen("textModal"))throw new Error("Standalone modal did not close");
  }

  // ============================================================
  // PART 6: case-sensitive toggle affects project results too.
  // ============================================================
  await page.evaluate(()=>openSceneText("scene-standalone"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.click("#fullSceneTextFindReplace .rte-scope-project");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","Кот");
  await page.waitForTimeout(50);
  const caseInsensitiveSummary=await page.locator("#textModal .rte-project-results .rte-project-results-summary").textContent();
  await page.click("#fullSceneTextFindReplace .rte-find-case");
  await page.waitForTimeout(50);
  const caseSensitiveSummary=await page.locator("#textModal .rte-project-results .rte-project-results-summary").textContent();
  if(caseInsensitiveSummary===caseSensitiveSummary)
    throw new Error("Toggling case-sensitivity must change project-wide match counts (lowercase \"кот\" only appears case-insensitively across scenes here, capital \"Кот\" appears in fewer)");

  // ============================================================
  // PART 7: no DB/network write occurs merely from project search/navigation
  // -- everything above (search, scope toggling, navigation, case toggle)
  // must never have changed the persisted project.
  // ============================================================
  const finalRaw=await rawProject();
  const finalParsed=JSON.parse(finalRaw);
  const originalScenesTexts=Object.fromEntries(project.scenes.map(s=>[s.id,s.sceneText]));
  for(const s of finalParsed.scenes){
    if(s.id==="scene-all")continue; // PART 5 deliberately typed into this scene's own live editor
    if(s.sceneText!==originalScenesTexts[s.id])
      throw new Error(`Scene ${s.id} was persisted with unexpected changes from project search/navigation alone`);
  }

  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  console.log("find-replace-project-search-browser.test.mjs: all assertions passed");
}finally{
  await browser.close();
  server.kill();
}
