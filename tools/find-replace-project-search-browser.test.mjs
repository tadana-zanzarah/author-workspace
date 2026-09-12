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
    // "Весь текст" -- making it a genuine case-B navigation target. THREE
    // "кот" occurrences (final D1 hardening pass, item 5) so the destination-
    // decoration regression below can actually distinguish "every match got
    // the normal treatment" from "only the active one did".
    scene("scene-unmounted","Нигде не открыта","chapter-unassigned","Кот нигде не открыт. Но кот здесь был. И еще один кот заходил.",{included:false}),
    // Corrective pass (manual-test regression fix): a dedicated scene, using
    // a word that never appears anywhere else in this fixture ("пса", never
    // "кот"), for the caret-relative-initial-activation tests below --
    // keeping it fully independent of every "кот"-based assertion above.
    scene("scene-caret","Каретка","chapter-1",Array.from({length:10},(_,i)=>`Абзац ${i+1} про пса.`).join("\n")),
    // Second corrective pass: two dedicated scenes sharing a word that
    // appears nowhere else in this fixture ("рысь"), for the cross-scene
    // navigation-origin tests below -- kept fully independent of every
    // "кот"/"пса"-based assertion above/below. Different surrounding
    // templates here purely for readability in test output -- NOT (any
    // longer) a workaround for anything: the final D1 hardening pass removed
    // ProseMirror Node#eq/doc-content comparison as a scene-identity
    // mechanism entirely (see find-replace-controller.js's `attachedSceneId`),
    // so two scenes could now share byte-for-byte identical prose here too
    // and remain fully distinguishable -- that exact scenario has its own
    // dedicated coverage below (scene-twin-a/b).
    scene("scene-lynx-a","Рысь А","chapter-1",Array.from({length:10},(_,i)=>`Абзац ${i+1} про рысь.`).join("\n")),
    scene("scene-lynx-b","Рысь Б","chapter-1",Array.from({length:10},(_,i)=>`Запись ${i+1}: снова рысь видна.`).join("\n")),
    // Final D1 hardening pass (item 4): two DIFFERENT scenes with a
    // deliberately BYTE-FOR-BYTE IDENTICAL rich-text document -- exactly the
    // case ProseMirror Node#eq could never distinguish. "барсук" appears
    // nowhere else in this fixture, keeping this fully independent of every
    // other assertion.
    scene("scene-twin-a","Твин А","chapter-1",Array.from({length:10},(_,i)=>`Абзац ${i+1} про барсука.`).join("\n")),
    scene("scene-twin-b","Твин Б","chapter-1",Array.from({length:10},(_,i)=>`Абзац ${i+1} про барсука.`).join("\n")),
    // Final D1 fix (item 3/8C): two MOUNTED (included:true) scenes sharing a
    // word that appears nowhere else ("выдра"), plus a third, EXCLUDED scene
    // sharing that same word -- the exact shape needed to prove "Весь
    // текст"'s project-scope arrows wrap only across the two MOUNTED scenes
    // and never land on (or open) the excluded one, even though it is a
    // genuine project result.
    scene("scene-arrow-mounted-1","Выдра А","chapter-1","Тут была выдра."),
    scene("scene-arrow-mounted-2","Выдра Б","chapter-1","И тут тоже выдра была."),
    scene("scene-arrow-unmounted","Выдра нигде","chapter-unassigned","Выдра здесь не открыта.",{included:false}),
    // Final D1 fix (item 3/8D/8E): one mounted scene with THREE occurrences
    // of a word appearing nowhere else ("тюлен"), for proving standalone/
    // Scene-modal project-scope arrows wrap WITHIN this one scene only, plus
    // an excluded sibling sharing the same word that arrows must never reach.
    scene("scene-arrow-standalone","Тюлень","chapter-1",Array.from({length:3},(_,i)=>`Абзац ${i+1} про тюленя.`).join("\n")),
    scene("scene-arrow-standalone-excluded","Тюлень нигде","chapter-unassigned","Тюлень тоже здесь, но нигде.",{included:false}),
    // D1.1 fix (arrow-counter denominator): two MOUNTED scenes with a word
    // appearing nowhere else ("гепард") -- 1 match + 2 matches -- plus one
    // EXCLUDED scene with FIFTY occurrences of the same word, never mounted
    // anywhere. Mirrors the task's own "53 global, 3 navigable" example
    // exactly: "Весь текст"'s own navigation domain is these two mounted
    // scenes only (3 matches total), while the project-wide total is 53.
    scene("scene-counter-mounted-1","Гепард А","chapter-1","Гепард пробежал мимо."),
    scene("scene-counter-mounted-2","Гепард Б","chapter-1","И снова гепард появился здесь. Гепард не унимался."),
    scene("scene-counter-many-off","Гепард нигде","chapter-unassigned",Array.from({length:50},(_,i)=>`Гепард номер ${i+1}.`).join("\n"),{included:false}),
    // D1.1 fix (edge case F -- zero navigable, nonzero global): a word
    // ("морж") that appears ONLY in an excluded scene -- never in any scene
    // mounted in "Весь текст", and never in the dedicated standalone scene
    // used below -- so the navigation domain is empty on both surfaces while
    // the project result set is not.
    scene("scene-counter-off-only","Морж нигде","chapter-unassigned","Морж лежал на льду.",{included:false})
  ]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.setViewportSize({width:1200,height:800});
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
  // 7 = scene-standalone(1) + scene-excluded(1) + scene-modal-target(1) +
  // scene-all(1) + scene-unmounted(3, see its own fixture comment above).
  if(!/7\s*совпадени/.test(summaryText)||!/5\s*сцен/.test(summaryText))
    throw new Error(`Expected 7 matches across 5 scenes, got summary: ${summaryText}`);

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
    if(!/8\s*совпадени/.test(afterSummary))throw new Error(`Expected the total to grow to 8 after adding one more "кот", got: ${afterSummary}`);
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

    // Final D1 hardening pass (item 2/5): the destination editor (a BRAND
    // NEW mountSceneEditor() call, with its own independent, closed
    // find-replace-controller instance -- completely unconnected to the
    // ORIGINATING "Весь текст" controller that drove this navigation) must
    // still receive the exact same Stage C/D1 decoration treatment as an
    // already-mounted scene: every one of this scene's own 3 "кот" matches
    // decorated normally, and the one just navigated to (the first
    // occurrence, since ".first()" was clicked above) carrying the strong
    // active-match class -- reusing find-replace-decorations.js's own
    // buildMatchDecorations, never a second highlighting system.
    {
      const decorationCounts=await page.evaluate(()=>{
        const editor=document.getElementById("fullSceneTextEditor");
        return {
          all:editor.querySelectorAll(".rte-find-match").length,
          active:editor.querySelectorAll(".rte-find-match-active").length
        };
      });
      if(decorationCounts.all!==3)
        throw new Error(`Expected all 3 "кот" matches in the destination scene decorated, got ${decorationCounts.all}`);
      if(decorationCounts.active!==1)
        throw new Error(`Expected exactly one active-match decoration in the destination scene, got ${decorationCounts.active}`);
      const activeText=await page.locator("#fullSceneTextEditor .rte-find-match-active").textContent();
      if(activeText.toLowerCase()!=="кот")
        throw new Error(`Expected the active decoration's own text to be exactly "кот", got ${JSON.stringify(activeText)}`);
    }

    // Focus independence: moving focus away from the destination editor
    // (into its own Find input) must not alter the decoration state at all.
    await page.click("#fullSceneTextFindReplace .rte-find-input").catch(()=>{});
    await page.waitForTimeout(60);
    {
      const afterBlur=await page.evaluate(()=>{
        const editor=document.getElementById("fullSceneTextEditor");
        return {
          all:editor.querySelectorAll(".rte-find-match").length,
          active:editor.querySelectorAll(".rte-find-match-active").length
        };
      });
      if(afterBlur.all!==3||afterBlur.active!==1)
        throw new Error(`Losing focus must not change the destination scene's decoration state, got ${JSON.stringify(afterBlur)}`);
    }

    // An arbitrary user selection spanning a match must coexist with the
    // decoration state exactly like it already does for already-mounted
    // scenes (second corrective pass) -- never clearing it.
    await page.locator("#fullSceneTextEditor .scene-paragraph").first().click();
    await page.keyboard.press("Home");
    await page.keyboard.down("Shift");
    await page.keyboard.press("End");
    await page.keyboard.up("Shift");
    await page.waitForTimeout(60);
    {
      const duringSelection=await page.evaluate(()=>{
        const editor=document.getElementById("fullSceneTextEditor");
        return editor.querySelectorAll(".rte-find-match").length;
      });
      if(duringSelection!==3)
        throw new Error(`An arbitrary user selection must not remove the destination scene's match decorations, got ${duringSelection}`);
    }

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

  // ============================================================
  // PART 8 (corrective pass, manual-test regressions): project-scope
  // decorations must cover EVERY mounted scene the result includes -- not
  // just the currently-attached view -- with the same accepted Stage C
  // strong/dim treatment, surviving focus loss, and correctly reapplied
  // across scope switches. This is the fix for the regression where
  // switching to "Весь проект" used to simply clear decorations and never
  // show anything in their place.
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","кот");
  await page.waitForTimeout(80);

  const mountedSceneIds=["scene-standalone","scene-modal-target","scene-all"];
  async function decorationCounts(){
    const out={};
    for(const id of mountedSceneIds){
      out[id]={
        matches:await page.locator(`#allSceneEditor-${id} .rte-find-match`).count(),
        active:await page.locator(`#allSceneEditor-${id} .rte-find-match-active`).count()
      };
    }
    return out;
  }
  {
    const counts=await decorationCounts();
    for(const id of mountedSceneIds){
      if(counts[id].matches<1)
        throw new Error(`Scene ${id} has no project-scope match decorations (regression: switching to Весь проект used to clear ALL decorations and never reapply them)`);
    }
    const totalActive=mountedSceneIds.reduce((sum,id)=>sum+counts[id].active,0);
    if(totalActive!==1)throw new Error(`Expected exactly ONE strong active-match decoration across every mounted scene, got ${totalActive}: ${JSON.stringify(counts)}`);
  }

  // --- Decorations must survive losing editor DOM focus (e.g. clicking back
  // into the Find input).
  {
    const before=await decorationCounts();
    await page.click("#allScenesFindReplace .rte-find-input");
    await page.waitForTimeout(50);
    const after=await decorationCounts();
    if(JSON.stringify(before)!==JSON.stringify(after))
      throw new Error(`Losing editor focus must not clear/alter project-scope decorations (before=${JSON.stringify(before)}, after=${JSON.stringify(after)})`);
  }

  // --- Clicking a result in a DIFFERENT mounted scene moves the strong
  // "active" decoration there while every other mounted scene's own matches
  // stay highlighted (dim) -- never disappearing -- and the real editor
  // selection is EXACTLY the matched text, never a larger range/paragraph
  // (the other manual-test regression this pass fixes).
  {
    const targetRow=page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"В модалке"}).locator(".rte-project-result-row").first();
    await targetRow.click();
    await page.waitForTimeout(80);
    const counts=await decorationCounts();
    if(counts["scene-modal-target"].active!==1)throw new Error("The active decoration did not move to the newly navigated-to scene");
    for(const id of mountedSceneIds){
      if(counts[id].matches<1)throw new Error(`Scene ${id} lost its decorations after navigating to a different scene's result`);
    }
    const totalActive=mountedSceneIds.reduce((sum,id)=>sum+counts[id].active,0);
    if(totalActive!==1)throw new Error(`Expected exactly one active decoration after navigating, got ${totalActive}`);

    // The active decoration span is built from the exact same {from,to} the
    // real editor selection was set to (find-replace-navigation.js's
    // selectAndReveal uses one single resolved match for both) -- checking
    // its own rendered text is a reliable, focus-timing-independent way to
    // confirm the target range is EXACTLY the matched text, never a larger
    // one (a real ProseMirror `Decoration.inline(from,to,...)` renders a
    // span containing precisely the [from,to) text, so an oversized range
    // would show up here just as directly as in the real selection).
    const activeDecorationText=await page.locator("#allSceneEditor-scene-modal-target .rte-find-match-active").textContent();
    if(activeDecorationText.toLowerCase()!=="кот")
      throw new Error(`Expected the active match range to be EXACTLY "кот", got a range of length ${activeDecorationText.length}: ${JSON.stringify(activeDecorationText)}`);
    const focusedWithinTarget=await page.evaluate(()=>{
      const editor=document.getElementById("allSceneEditor-scene-modal-target").querySelector(".ProseMirror");
      return document.activeElement===editor||editor.contains(document.activeElement);
    });
    if(!focusedWithinTarget)throw new Error("Navigating to a project result did not focus that scene's own editor");
  }

  // --- Scope switching: leaving "Весь проект" clears every project
  // decoration everywhere (not just the attached view) and restores
  // ordinary current-scene highlighting for the attached scene; returning to
  // project scope re-applies project decorations across every mounted
  // participating scene again.
  {
    await page.click("#allScenesFindReplace .rte-scope-scene");
    await page.waitForTimeout(80);
    const counts=await decorationCounts();
    if(counts["scene-modal-target"].matches!==1)
      throw new Error("Leaving project scope must still show ordinary current-scene highlighting on the attached view");
    for(const id of mountedSceneIds.filter(x=>x!=="scene-modal-target")){
      if(counts[id].matches!==0)throw new Error(`Leaving project scope must clear decorations on scene ${id}, which is not the attached view`);
    }
    await page.click("#allScenesFindReplace .rte-scope-project");
    await page.waitForTimeout(80);
    const restored=await decorationCounts();
    for(const id of mountedSceneIds){
      if(restored[id].matches<1)throw new Error(`Re-entering project scope did not re-decorate scene ${id}`);
    }
  }

  // --- Item 6: the Replace lockout must read as a plain factual "not
  // available here", never a promised/coming-soon feature announcement.
  {
    const title=await page.locator("#allScenesFindReplace .rte-replace-one").getAttribute("title");
    if(/будет доступн|после подтвержден/i.test(title))
      throw new Error(`Replace-lockout title must not read like a promised upcoming-feature announcement, got: ${JSON.stringify(title)}`);
  }

  // ============================================================
  // PART 9 (corrective pass): opening Find/initiating a search activates the
  // match at/after the current caret, never blindly match #1 -- current-
  // scene surface first.
  // ============================================================
  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  await page.evaluate(()=>openSceneText("scene-caret"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.locator("#fullSceneTextEditor .scene-paragraph",{hasText:"Абзац 6"}).click();
  await page.keyboard.press("Home"); // caret at paragraph 6's own start, immediately before its "пса"
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","пса");
  await page.waitForTimeout(80);
  {
    const count=await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent();
    if(count!=="6 из 10")throw new Error(`Expected caret-relative activation to start at match 6 of 10, got: ${count}`);
    if(await page.locator("#fullSceneTextEditor .rte-find-match").count()!==10)
      throw new Error("Caret-relative activation must not reduce the full highlighted match set -- every match stays visible");
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  // --- Same caret-relative policy for "Весь проект": the initial active
  // result is the caret-relative one WITHIN whatever scene is currently
  // open, not always the first result overall.
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.locator("#allSceneEditor-scene-caret .scene-paragraph",{hasText:"Абзац 6"}).click();
  await page.keyboard.press("Home");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","пса");
  await page.waitForTimeout(80);
  {
    const count=await page.locator("#allScenesFindReplace .rte-find-count").textContent();
    if(count!=="6 из 10")throw new Error(`Expected project-scope caret-relative activation to start at 6 из 10, got: ${count}`);
    if(await page.locator("#allSceneEditor-scene-caret .rte-find-match-active").count()!==1)
      throw new Error("Project-scope caret-relative activation did not mark the caret-relative match active in its own editor");
  }

  // ============================================================
  // PART 10 (corrective pass): result-pane default sizing (~6 rows) and the
  // user-draggable resize handle -- min/max bounded, never resizes the
  // whole modal.
  // ============================================================
  await page.locator("#allScenesModal .modal").evaluate(el=>{el.scrollTop=0});
  await page.fill("#allScenesFindReplace .rte-find-input","кот"); // a query with a populated, multi-row result list
  await page.waitForTimeout(80);
  const resultsBox=page.locator("#allScenesModal .rte-project-results");
  await resultsBox.scrollIntoViewIfNeeded();
  const defaultHeight=await resultsBox.evaluate(el=>el.getBoundingClientRect().height);
  if(Math.abs(defaultHeight-140)>2)
    throw new Error(`Expected the default result-pane height to be ~140px (~4 rows), got ${defaultHeight}`);

  const resizer=page.locator("#allScenesModal .rte-project-results-resizer");
  {
    const handleBox=await resizer.boundingBox();
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2+120,{steps:5});
    await page.mouse.up();
    await page.waitForTimeout(50);
  }
  const grownHeight=await resultsBox.evaluate(el=>el.getBoundingClientRect().height);
  if(grownHeight<defaultHeight+80)throw new Error(`Dragging the resizer down should have grown the result pane, got ${grownHeight} from a default of ${defaultHeight}`);

  const modalHeightBefore=await page.locator("#allScenesModal .modal").evaluate(el=>el.getBoundingClientRect().height);
  {
    const handleBox=await resizer.boundingBox(); // re-fetch: the resizer itself moved down after the grow above
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2+1000,{steps:5});
    await page.mouse.up();
    await page.waitForTimeout(50);
  }
  const clampedHeight=await resultsBox.evaluate(el=>el.getBoundingClientRect().height);
  if(clampedHeight>420+2)throw new Error(`Result-pane height must clamp to its max even when dragged far past it, got ${clampedHeight}`);
  const modalHeightAfter=await page.locator("#allScenesModal .modal").evaluate(el=>el.getBoundingClientRect().height);
  if(Math.abs(modalHeightAfter-modalHeightBefore)>2)
    throw new Error(`Resizing the result pane must never resize the whole modal (before=${modalHeightBefore}, after=${modalHeightAfter})`);

  // ============================================================
  // PART 11 (corrective pass): sticky/layout regression. "Весь текст"'s
  // shared toolbar+Find/Replace wrapper must still stick and stay pinned
  // even with the (now resizable) result pane visible beneath it; the
  // standalone "Текст сцены" modal's manuscript editor must keep a
  // reasonable working height and its Save/Close actions must stay
  // reachable -- the result pane must never squeeze that fixed-height flex
  // column the way it did before this fix pass.
  // ============================================================
  {
    const sticky=page.locator("#allScenesModal .rte-sticky-controls");
    if((await sticky.evaluate(el=>getComputedStyle(el).position))!=="sticky")
      throw new Error("The shared toolbar+Find/Replace wrapper must remain position:sticky in \"Весь текст\"");
    await page.locator("#allScenesModal .modal").evaluate(el=>{el.scrollTop=500});
    await page.waitForTimeout(50);
    const top=await sticky.evaluate(el=>el.getBoundingClientRect().top);
    if(top>50)throw new Error("Sticky toolbar/panel scrolled away with the manuscript instead of staying pinned");
  }
  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  await page.evaluate(()=>openSceneText("scene-caret"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.click("#fullSceneTextFindReplace .rte-scope-project");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","пса");
  await page.waitForTimeout(80);
  {
    const editorHeight=await page.locator("#fullSceneTextEditor").evaluate(el=>el.getBoundingClientRect().height);
    if(editorHeight<250)throw new Error(`The manuscript editor must keep a reasonable working height alongside the results pane, got ${editorHeight}px (this is the "sticky behavior disappeared" regression)`);
    if(!await page.locator("#saveText").isVisible())throw new Error("Save button must stay visible/reachable with the results pane open");
    if(!await page.locator("#closeText").isVisible())throw new Error("Close button must stay visible/reachable with the results pane open");
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  // ============================================================
  // PART 12 (second corrective pass, item 1/7A/7F): Find Next/Previous must
  // follow the LIVE caret, not the stored active index -- across all three
  // surfaces. Pattern for each: open Find, advance a couple of times (so the
  // stored index is somewhere that would give a WRONG answer if blindly
  // incremented), manually move the caret to a specific different
  // paragraph, then confirm Next lands on THAT paragraph's own match, not
  // "old index + 1".
  // ============================================================
  await page.evaluate(()=>openSceneText("scene-lynx-a"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","рысь");
  await page.waitForTimeout(80);
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.locator("#fullSceneTextEditor .scene-paragraph",{hasText:"Абзац 7 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent();
    if(count!=="7 из 10")throw new Error(`Standalone "Текст сцены": expected Next after a manual caret move to paragraph 7 to land on match 7 (not old-index+1), got ${count}`);
  }
  // Same-position Next again (no further caret move) must simply advance by
  // one -- proves the controller's OWN navigation-caused selection is
  // correctly read back as "current" next time, not reinterpreted as a new
  // arbitrary user position (item 5).
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#fullSceneTextFindReplace .rte-find-count").textContent();
    if(count!=="8 из 10")throw new Error(`Standalone "Текст сцены": a second, plain Next (no manual caret move) must advance by exactly one, got ${count}`);
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  await page.evaluate(()=>editScene("scene-lynx-a"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  await page.click("#sceneTextToolbar .rte-btn-find");
  await page.fill("#sceneTextFindReplace .rte-find-input","рысь");
  await page.waitForTimeout(80);
  await page.click("#sceneTextFindReplace .rte-find-next");
  await page.click("#sceneTextFindReplace .rte-find-next");
  await page.locator("#sceneTextEditor .scene-paragraph",{hasText:"Абзац 7 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#sceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#sceneTextFindReplace .rte-find-count").textContent();
    if(count!=="7 из 10")throw new Error(`Scene modal: expected Next after a manual caret move to paragraph 7 to land on match 7, got ${count}`);
  }
  await page.click("#sceneTextFindReplace .rte-find-close");
  await page.click("#cancelScene");
  await page.waitForTimeout(80);

  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.locator("#allSceneEditor-scene-lynx-a .ProseMirror").click();
  await page.click("#allScenesToolbar .rte-btn-find"); // scope defaults to "Эта сцена"
  await page.fill("#allScenesFindReplace .rte-find-input","рысь");
  await page.waitForTimeout(80);
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.locator("#allSceneEditor-scene-lynx-a .scene-paragraph",{hasText:"Абзац 7 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#allScenesFindReplace .rte-find-count").textContent();
    if(count!=="7 из 10")throw new Error(`"Весь текст" (current-scene scope): expected Next after a manual caret move to paragraph 7 to land on match 7, got ${count}`);
  }

  // ============================================================
  // PART 13 (second corrective pass, item 2/7B/7C/7F): project scope
  // navigation origin follows the caret -- same scene first, then a
  // genuinely different mounted scene, confirmed against canonical project
  // order (scene-lynx-a before scene-lynx-b, both chapter-1, array order).
  // ============================================================
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","рысь");
  await page.waitForTimeout(80);
  {
    const summary=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
    if(!/20\s*совпадени/.test(summary))throw new Error(`Expected 20 "рысь" matches (10 in each of scene-lynx-a/b), got: ${summary}`);
  }
  // 7B: same scene (scene-lynx-a), caret earlier than the current active match.
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.click("#allScenesFindReplace .rte-find-next"); // advance a few times within scene-lynx-a
  await page.locator("#allSceneEditor-scene-lynx-a .scene-paragraph",{hasText:"Абзац 2 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#allScenesFindReplace .rte-find-count").textContent();
    if(count!=="2 из 20")throw new Error(`Project scope, same scene: expected Next after moving the caret earlier (paragraph 2) to land on scene-lynx-a's own match 2 (2 из 20), got ${count}`);
    if(await page.locator("#allSceneEditor-scene-lynx-a .rte-find-match-active").count()!==1)
      throw new Error("Project scope, same scene: the active decoration must be on scene-lynx-a");
    if(await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match-active").count()!==0)
      throw new Error("Project scope, same scene: scene-lynx-b must not show an active decoration");
  }
  // 7C: cross-scene -- move the caret into scene-lynx-b entirely; Next/
  // Previous must continue from THERE in canonical order, never jumping
  // back to scene-lynx-a merely because the stored index still points there.
  await page.locator("#allSceneEditor-scene-lynx-b .scene-paragraph",{hasText:"Запись 2:"}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#allScenesFindReplace .rte-find-count").textContent();
    if(count!=="12 из 20")throw new Error(`Project scope, cross-scene: expected Next after moving the caret into scene-lynx-b (paragraph 2) to land on its own match 2 (12 из 20, i.e. flat position 10+2), got ${count}`);
    if(await page.locator("#allSceneEditor-scene-lynx-a .rte-find-match-active").count()!==0)
      throw new Error("Project scope, cross-scene: must NOT jump back to scene-lynx-a merely because the stored index used to point there");
    if(await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match-active").count()!==1)
      throw new Error("Project scope, cross-scene: the active decoration must be on scene-lynx-b");
  }
  await page.click("#allScenesFindReplace .rte-find-prev");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#allScenesFindReplace .rte-find-count").textContent();
    if(count!=="11 из 20")throw new Error(`Project scope, cross-scene Previous: expected to move back to scene-lynx-b's own match 1 (11 из 20), got ${count}`);
  }
  // A further Previous must cross the canonical-order boundary BACK into
  // scene-lynx-a's own LAST match (10 из 20) -- proves ordering is respected
  // in both directions, not just "stay in whichever scene is focused".
  await page.click("#allScenesFindReplace .rte-find-prev");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#allScenesFindReplace .rte-find-count").textContent();
    if(count!=="10 из 20")throw new Error(`Project scope, cross-scene Previous: expected to cross back into scene-lynx-a's own last match (10 из 20), got ${count}`);
  }

  // ============================================================
  // PART 14 (second corrective pass, item 3/4/7D): highlight stability --
  // the active match's strong decoration must not depend on focus or on
  // whether the caret is inside it, and an arbitrary user selection spanning
  // a match must never remove the underlying decoration.
  // ============================================================
  await page.click("#allScenesFindReplace .rte-find-next"); // back to scene-lynx-b's own match 1 (11 из 20)
  await page.waitForTimeout(30);
  const classesBefore=await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match-active").getAttribute("class");
  // Move focus away from the editor entirely (into the Find input) --
  // active-match styling must be identical, not a paler/different class.
  await page.click("#allScenesFindReplace .rte-find-input");
  await page.waitForTimeout(60);
  const classesAfterFocusLoss=await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match-active").getAttribute("class");
  if(classesBefore!==classesAfterFocusLoss)
    throw new Error(`Active-match decoration class must not change when focus moves away from the editor (before=${classesBefore}, after=${classesAfterFocusLoss})`);
  if(await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match").count()<1)
    throw new Error("Losing editor focus must not remove ordinary match decorations either");

  // Moving the caret away from the active match (without navigating) must
  // not change which match carries the active class.
  await page.locator("#allSceneEditor-scene-lynx-b .scene-paragraph",{hasText:"Запись 5:"}).click();
  await page.waitForTimeout(60);
  const activeCountAfterCaretMove=await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match-active").count();
  if(activeCountAfterCaretMove!==1)
    throw new Error(`Moving the caret away (without pressing Next/Previous) must not add/remove the active-match decoration, got ${activeCountAfterCaretMove} active decorations`);
  const classesAfterCaretMove=await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match-active").getAttribute("class");
  if(classesAfterCaretMove!==classesBefore)
    throw new Error("Moving the caret away from the active match must not change its decoration class");

  // An arbitrary user text SELECTION spanning a match must not clear the
  // decoration underneath it -- select the whole "Запись 5" paragraph
  // (which contains its own match) via a real double-click + Home/Shift+End
  // keyboard selection, then confirm every decoration is still present.
  const matchCountBeforeSelection=await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match").count();
  await page.locator("#allSceneEditor-scene-lynx-b .scene-paragraph",{hasText:"Запись 5:"}).click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(60);
  const selectedText=await page.evaluate(()=>window.getSelection().toString());
  if(!selectedText.includes("рысь"))throw new Error(`Test setup problem: the made selection did not actually span the match text, got ${JSON.stringify(selectedText)}`);
  const matchCountDuringSelection=await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match").count();
  if(matchCountDuringSelection!==matchCountBeforeSelection)
    throw new Error(`An arbitrary user selection spanning a match must not remove any match decoration (before=${matchCountBeforeSelection}, during=${matchCountDuringSelection})`);
  // Collapse the selection (click elsewhere) -- decorations must still be
  // intact afterward too, with no recomputation/focus-change required.
  await page.locator("#allScenesFindReplace .rte-find-input").click();
  await page.waitForTimeout(60);
  const matchCountAfterCollapsing=await page.locator("#allSceneEditor-scene-lynx-b .rte-find-match").count();
  if(matchCountAfterCollapsing!==matchCountBeforeSelection)
    throw new Error(`Match decorations must remain intact after collapsing/moving away a user selection (before=${matchCountBeforeSelection}, after=${matchCountAfterCollapsing})`);

  // The visual mechanism behind the above: a scoped ::selection override so
  // the browser's own native selection color never competes with/hides the
  // decoration's background -- confirmed registered in the stylesheets
  // (pixel-level rendering isn't practically assertable here, but the rule
  // actually being present is the concrete, checkable half of "removed the
  // native-selection coupling instead of stacking more CSS on top").
  const hasScopedSelectionRules=await page.evaluate(()=>{
    let matchRule=false,activeRule=false;
    for(const sheet of document.styleSheets){
      let rules;
      try{rules=sheet.cssRules}catch{continue}
      for(const rule of rules){
        if(!rule.selectorText)continue;
        if(rule.selectorText.includes(".rte-find-match::selection"))matchRule=true;
        if(rule.selectorText.includes(".rte-find-match-active::selection"))activeRule=true;
      }
    }
    return {matchRule,activeRule};
  });
  if(!hasScopedSelectionRules.matchRule||!hasScopedSelectionRules.activeRule)
    throw new Error(`Expected scoped ::selection rules for .rte-find-match/.rte-find-match-active, got: ${JSON.stringify(hasScopedSelectionRules)}`);

  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  // ============================================================
  // PART 15 (final D1 hardening pass, item 3/4): scene identity must come
  // from sceneId, never from ProseMirror document content -- two DIFFERENT
  // scenes (scene-twin-a/b) sharing a BYTE-FOR-BYTE IDENTICAL document must
  // remain fully distinguishable for caret-origin resolution, project Next/
  // Previous, and decoration targeting.
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","барсука");
  await page.waitForTimeout(80);
  {
    const summary=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
    if(!/20\s*совпадени/.test(summary))throw new Error(`Expected 20 "барсука" matches (10 in each of scene-twin-a/b, identical docs), got: ${summary}`);
  }
  // Caret movement in scene-twin-b (NOT scene-twin-a, despite identical
  // content) must be recognized as scene-twin-b.
  await page.locator("#allSceneEditor-scene-twin-b .scene-paragraph",{hasText:"Абзац 3 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  if(await page.evaluate(()=>allScenesEditorGroup.getActiveSceneId())!=="scene-twin-b")
    throw new Error("Focusing scene-twin-b's own editor must retarget the active scene to scene-twin-b, not its identical twin");
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await page.locator("#allScenesFindReplace .rte-find-count").textContent();
    // scene-twin-a occupies flat positions 1-10, scene-twin-b 11-20 (canonical
    // order = array order here, both chapter-1) -- scene-twin-b's own match 3
    // is therefore global position 13.
    if(count!=="13 из 20")throw new Error(`Expected Next after moving the caret into scene-twin-b (paragraph 3) to land on ITS OWN match 3 (13 из 20), got ${count} -- a wrong answer here means scene identity fell back to document-content comparison`);
    if(await page.locator("#allSceneEditor-scene-twin-a .rte-find-match-active").count()!==0)
      throw new Error("The identical-content TWIN scene (scene-twin-a) must never receive the active decoration meant for scene-twin-b");
    if(await page.locator("#allSceneEditor-scene-twin-b .rte-find-match-active").count()!==1)
      throw new Error("scene-twin-b must receive its own active decoration");
  }
  // Clicking a result row for scene-twin-a specifically must navigate to
  // scene-twin-a, never its identical twin.
  await page.locator("#allScenesModal .rte-project-result-group",{hasText:"Твин А"}).locator(".rte-project-result-row").nth(6).click();
  await page.waitForTimeout(60);
  {
    if(await page.locator("#allSceneEditor-scene-twin-a .rte-find-match-active").count()!==1)
      throw new Error("Clicking a scene-twin-a result must navigate to scene-twin-a");
    if(await page.locator("#allSceneEditor-scene-twin-b .rte-find-match-active").count()!==0)
      throw new Error("Clicking a scene-twin-a result must NOT leave/move the active decoration on its identical twin");
    if(await page.evaluate(()=>allScenesEditorGroup.getActiveSceneId())!=="scene-twin-a")
      throw new Error("Clicking a scene-twin-a result must retarget the active scene to scene-twin-a");
  }
  await page.click("#allScenesFindReplace .rte-find-close");

  // ============================================================
  // PART 16 (final D1 hardening pass, item 1/6): the complete search UI in
  // "Весь текст" (toolbar + scope/query controls + project-results pane +
  // its resize divider) behaves as ONE sticky region -- scrolling the
  // manuscript must never make the result list disappear, and resizing the
  // pane must correctly grow/shrink the amount of sticky vertical space.
  // Deliberately avoids brittle pixel-perfect assertions: only the layout
  // CONTRACT (results stay within the viewport after a big scroll; the
  // sticky region's own rendered height tracks a resize) is checked.
  // ============================================================
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","рысь");
  await page.waitForTimeout(80);
  {
    const resultsVisibleBefore=await page.locator("#allScenesModal .rte-project-results").isVisible();
    if(!resultsVisibleBefore)throw new Error("Project results must be visible right after opening project scope with a matching query");
  }
  await page.locator("#allScenesModal .modal").evaluate(el=>{el.scrollTop=800});
  await page.waitForTimeout(60);
  {
    const stickyPosition=await page.locator("#allScenesModal .rte-sticky-controls").evaluate(el=>getComputedStyle(el).position);
    if(stickyPosition!=="sticky")throw new Error("The sticky search region must remain position:sticky");
    const resultsRect=await page.locator("#allScenesModal .rte-project-results").evaluate(el=>el.getBoundingClientRect());
    const viewportHeight=await page.evaluate(()=>window.innerHeight);
    if(resultsRect.top<0||resultsRect.bottom>viewportHeight)
      throw new Error(`After scrolling the manuscript significantly, the project-results pane must still be fully within the viewport (the sticky-region contract), got rect ${JSON.stringify(resultsRect)} in a ${viewportHeight}px-tall viewport`);
    // The manuscript itself must still be genuinely scrollable underneath --
    // i.e. the scroll we just performed actually moved content, this isn't a
    // no-op container.
    const scrollTop=await page.locator("#allScenesModal .modal").evaluate(el=>el.scrollTop);
    if(scrollTop<700)throw new Error(`Expected the manuscript to have actually scrolled underneath the sticky region, got scrollTop=${scrollTop}`);
  }
  // Resizing the results pane must correctly update the sticky region's own
  // rendered height -- proof that the resizer and the sticky fix compose
  // correctly rather than fighting each other.
  {
    const stickyHeightBefore=await page.locator("#allScenesModal .rte-sticky-controls").evaluate(el=>el.getBoundingClientRect().height);
    const resizer=page.locator("#allScenesModal .rte-project-results-resizer");
    const handleBox=await resizer.boundingBox();
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x+handleBox.width/2,handleBox.y+handleBox.height/2+100,{steps:5});
    await page.mouse.up();
    await page.waitForTimeout(60);
    const stickyHeightAfter=await page.locator("#allScenesModal .rte-sticky-controls").evaluate(el=>el.getBoundingClientRect().height);
    if(stickyHeightAfter<stickyHeightBefore+80)
      throw new Error(`Growing the results pane by ~100px must grow the sticky region's own rendered height correspondingly, got ${stickyHeightBefore} -> ${stickyHeightAfter}`);
    // Standalone "Текст сцены"/Scene modal must be unaffected by this --
    // they have no .rte-sticky-controls wrapper at all, so this is purely a
    // "Весь текст" layout change, never a general modal redesign.
    if(await page.locator("#textModal .rte-sticky-controls").count()!==0)
      throw new Error("Standalone Текст сцены must not have gained a sticky-controls wrapper");
    if(await page.locator("#sceneModal .rte-sticky-controls").count()!==0)
      throw new Error("Scene modal must not have gained a sticky-controls wrapper");
  }
  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  // ============================================================
  // PART 17 (Stage D1 final fix, item 6): the sticky search region in "Весь
  // текст" must be ONE continuous visual block -- no gap between the
  // toolbar/Find-Replace row and the project-results pane once the pane is
  // actually showing (scope="Весь проект" with a matching query), where the
  // bug (a transparent ~10px slit with manuscript text visible through it
  // while scrolling) previously showed up. Checked directly via layout
  // geometry, not a screenshot diff -- the exact contract asked for.
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","рысь");
  await page.waitForTimeout(80);
  {
    const resultsVisible=await page.locator("#allScenesModal .rte-project-results-wrapper").isVisible();
    if(!resultsVisible)throw new Error("Project results wrapper must be visible with a matching query -- precondition for this gap check");
    const {findReplaceBottom,resultsWrapperTop,stickyBottom,resultsWrapperBottom}=await page.evaluate(()=>{
      const findReplace=document.querySelector("#allScenesFindReplace.rte-find-replace")||document.getElementById("allScenesFindReplace");
      const resultsWrapper=document.querySelector("#allScenesModal .rte-project-results-wrapper");
      const sticky=document.querySelector("#allScenesModal .rte-sticky-controls");
      return {
        findReplaceBottom:findReplace.getBoundingClientRect().bottom,
        resultsWrapperTop:resultsWrapper.getBoundingClientRect().top,
        resultsWrapperBottom:resultsWrapper.getBoundingClientRect().bottom,
        stickyBottom:sticky.getBoundingClientRect().bottom
      };
    });
    const gap=resultsWrapperTop-findReplaceBottom;
    if(Math.abs(gap)>1)
      throw new Error(`Expected the Find/Replace row and the project-results pane to sit flush together (no manuscript-visible gap between them), got a ${gap}px gap`);
    // The sticky wrapper's own bottom edge must end exactly where its last
    // visible child (the results pane) ends -- proves the trailing spacing
    // moved to the wrapper itself rather than leaving a second, separate gap
    // stacked on top of this one (the "no big blank strip" requirement).
    const trailing=stickyBottom-resultsWrapperBottom;
    if(trailing<8||trailing>14)
      throw new Error(`Expected exactly one ~10px trailing gap after the sticky region (from .rte-sticky-controls' own padding-bottom), got ${trailing}px`);
  }
  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  // ============================================================
  // PART 18 (Stage D1 final fix, item 2/8G): pure search/navigation/
  // decoration activity must never mark a clean scene/modal dirty -- opening
  // Find, switching scope, typing a query (which dispatches decorations
  // across every mounted matching scene), clicking an already-mounted
  // project result (case A: activate + select + reveal), and clicking an
  // UNMOUNTED one (case B: opens a brand-new standalone editor with fallback
  // decorations) must all leave every dirty tracker involved reporting
  // isDirty()===false throughout, since none of them ever change `doc`.
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  {
    const dirtyAfterOpen=await page.evaluate(()=>trackerFor("allScenesModal").isDirty());
    if(dirtyAfterOpen)throw new Error("Merely opening \"Весь текст\" must not mark it dirty");
  }
  await page.click("#allScenesToolbar .rte-btn-find");
  {
    const dirtyAfterFindOpen=await page.evaluate(()=>trackerFor("allScenesModal").isDirty());
    if(dirtyAfterFindOpen)throw new Error("Opening the Find panel must not mark the modal dirty");
  }
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","кот");
  await page.waitForTimeout(100);
  {
    const dirtyAfterSearch=await page.evaluate(()=>trackerFor("allScenesModal").isDirty());
    if(dirtyAfterSearch)throw new Error("Switching scope and typing a project-scope query (and its resulting cross-scene decorations) must not mark the modal dirty");
  }
  // Case A: click an already-mounted result (В общем тексте / scene-all).
  await page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"В общем тексте"}).locator(".rte-project-result-row").first().click();
  await page.waitForTimeout(60);
  {
    const dirtyAfterMountedClick=await page.evaluate(()=>trackerFor("allScenesModal").isDirty());
    if(dirtyAfterMountedClick)throw new Error("Navigating to an already-mounted project result (selection + reveal + decorations only) must not mark the modal dirty");
  }
  // Case B: click the unmounted result (Нигде не открыта / scene-unmounted)
  // -- opens the standalone modal via openSceneForEditing; the DESTINATION's
  // own tracker must also read clean (only a selection + fallback
  // decorations were dispatched there, never a doc edit).
  await page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"Нигде не открыта"}).locator(".rte-project-result-row").first().click();
  await page.waitForTimeout(100);
  if(await isOpen("discardChangesModal"))await page.click("#discardChanges");
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  {
    const dirtyAfterUnmountedNav=await page.evaluate(()=>trackerFor("textModal").isDirty());
    if(dirtyAfterUnmountedNav)throw new Error("Opening an unmounted scene via a project result click (selection + fallback decorations only) must not mark the destination dirty");
  }
  await page.click("#closeText");

  // ============================================================
  // PART 19 (Stage D1 final fix, item 1/7A/7B, CRITICAL): repeated
  // navigation to the SAME unmounted scene, across at least two full open/
  // close/reopen cycles, must never leave an orphaned backdrop or a second,
  // invisibly-stuck-open modal underneath the one the user can see. This is
  // the exact manual-test repro: "Весь текст" -> click an unmounted project
  // result -> standalone opens -> close it -> reopen "Весь текст" -> search
  // again -> click the SAME unmounted result again. Root cause (see
  // find-replace-navigation.js/mounted-scene-registry.js): a stale, hidden
  // registration surviving this app's existing "destroy-before-create"
  // pattern used to be reported as a safe case-A target, so re-navigating to
  // it called `activate()` directly (re-showing the same already-closed
  // modal) instead of going through the real open flow that closes whatever
  // is currently open FIRST -- leaving both backdrops at display:flex at
  // once. Audits the FULL modal stack + every modal element's own computed
  // display after each open AND each close, not just the one modal expected
  // to be affected, so an orphan anywhere would be caught regardless of id.
  // ============================================================
  // Audits the actual inline `style.display` (the application's own real,
  // immediate open/closed state) rather than getComputedStyle -- closing a
  // modal deliberately fades it out over 160ms (css/modals.css's
  // `.modal-backdrop{transition:display 160ms allow-discrete}`, an accepted,
  // pre-existing UX feature, not something this pass touches), during which
  // getComputedStyle still reports "flex" for the closing modal even though
  // its inline style (and modalStack/dirty-tracker bookkeeping) already
  // correctly say "none"/closed -- checking the inline style is what avoids
  // a false positive against that intentional fade.
  async function modalAudit(){
    return page.evaluate(()=>({
      stackIds:window.modalStack.map(entry=>entry.modal.id),
      visibleBackdrops:[...document.querySelectorAll(".modal-backdrop")].filter(el=>el.style.display==="flex").map(el=>el.id)
    }));
  }
  for(let round=1;round<=2;round++){
    await page.evaluate(()=>openAllScenes());
    await page.waitForSelector("#allScenesList .ProseMirror");
    await page.click("#allScenesToolbar .rte-btn-find");
    await page.click("#allScenesFindReplace .rte-scope-project");
    await page.fill("#allScenesFindReplace .rte-find-input","кот");
    await page.waitForTimeout(80);
    await page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"Нигде не открыта"}).locator(".rte-project-result-row").first().click();
    await page.waitForTimeout(100);
    if(await isOpen("discardChangesModal"))await page.click("#discardChanges");
    await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
    {
      const audit=await modalAudit();
      if(audit.stackIds.length!==1||audit.stackIds[0]!=="textModal")
        throw new Error(`Round ${round}: expected exactly one modal ("textModal") on the stack after navigating to the unmounted scene, got ${JSON.stringify(audit.stackIds)}`);
      if(audit.visibleBackdrops.length!==1||audit.visibleBackdrops[0]!=="textModal")
        throw new Error(`Round ${round}: expected exactly one visible backdrop ("textModal"), got ${JSON.stringify(audit.visibleBackdrops)} -- an orphaned backdrop means the previously-open modal was never actually closed`);
      // The destination must be genuinely usable, not just present in the
      // DOM -- exactly the "controls unclickable"/"invisible overlay"
      // symptom manual testing reported.
      const editorInteractive=await page.evaluate(()=>{
        const editor=document.getElementById("fullSceneTextEditor").querySelector(".ProseMirror");
        const rect=editor.getBoundingClientRect();
        return editor.offsetParent!==null&&rect.width>0&&rect.height>0&&getComputedStyle(document.getElementById("textModal")).pointerEvents!=="none";
      });
      if(!editorInteractive)throw new Error(`Round ${round}: destination editor is not visible/interactive`);
      if(!await page.locator("#closeText").isVisible())throw new Error(`Round ${round}: destination modal's own Close control is not clickable`);
    }
    await page.click("#closeText");
    await page.waitForTimeout(60);
    {
      const audit=await modalAudit();
      if(audit.stackIds.length!==0)throw new Error(`Round ${round}: expected an empty modal stack after closing, got ${JSON.stringify(audit.stackIds)}`);
      if(audit.visibleBackdrops.length!==0)throw new Error(`Round ${round}: expected no visible backdrop after closing, got ${JSON.stringify(audit.visibleBackdrops)}`);
    }
  }

  // ============================================================
  // PART 20 (Stage D1 final fix, item 3/4/8C, 8F): "Весь текст" project-scope
  // Next/Previous must wrap ONLY across scenes currently MOUNTED in this
  // modal (scene-arrow-mounted-1/2), and must never land on -- or open -- an
  // excluded/unmounted scene sharing the same query (scene-arrow-unmounted),
  // even though that scene legitimately appears in the results list itself.
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","выдра");
  await page.waitForTimeout(80);
  {
    const summary=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
    if(!/3\s*совпадени/.test(summary))throw new Error(`Expected 3 "выдра" matches total (2 mounted + 1 excluded), got: ${summary}`);
    if(await page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"Выдра нигде"}).count()!==1)
      throw new Error("The excluded scene must still appear as its own group in the project results list");
  }
  const activeSceneAmong=async ids=>{
    for(const id of ids){
      if(await page.locator(`#allSceneEditor-${id} .rte-find-match-active`).count()>0)return id;
    }
    return null;
  };
  // Item 4/8F: moving the caret into scene-arrow-mounted-1 (a currently
  // MOUNTED, visible scene) redefines the arrow-navigation origin to it.
  await page.locator("#allSceneEditor-scene-arrow-mounted-1 .scene-paragraph").click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const active=await activeSceneAmong(["scene-arrow-mounted-1","scene-arrow-mounted-2"]);
    if(active!=="scene-arrow-mounted-1")throw new Error(`Expected Next from the start of scene-arrow-mounted-1's own paragraph to land on its own match, active scene was: ${active}`);
    if(!await isOpen("allScenesModal")||await isOpen("textModal"))
      throw new Error("Arrow navigation must never open a different modal, even when a scene not in the visible domain shares the query");
  }
  // A further Next must move to the OTHER mounted scene, never to the
  // excluded one, and must never open any other surface to get there.
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const active=await activeSceneAmong(["scene-arrow-mounted-1","scene-arrow-mounted-2"]);
    if(active!=="scene-arrow-mounted-2")throw new Error(`Expected the next Next to move to scene-arrow-mounted-2, active scene was: ${active}`);
    if(!await isOpen("allScenesModal")||await isOpen("textModal"))
      throw new Error("Next must not have opened the excluded scene's standalone modal");
  }
  // Item 3's own worked example: from the LAST visible match, Next must wrap
  // to the FIRST visible match (never spill into the excluded scene, which
  // is exactly what raw canonical-order stepping over the whole project
  // would have hit next).
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const active=await activeSceneAmong(["scene-arrow-mounted-1","scene-arrow-mounted-2"]);
    if(active!=="scene-arrow-mounted-1")throw new Error(`Expected Next to wrap back to scene-arrow-mounted-1 (never into the excluded scene), active scene was: ${active}`);
  }
  // And Previous from the FIRST visible match must wrap to the LAST visible
  // match (scene-arrow-mounted-2) -- the task's own explicit example,
  // exercised in the Previous direction too.
  await page.click("#allScenesFindReplace .rte-find-prev");
  await page.waitForTimeout(30);
  {
    const active=await activeSceneAmong(["scene-arrow-mounted-1","scene-arrow-mounted-2"]);
    if(active!=="scene-arrow-mounted-2")throw new Error(`Expected Previous from the first visible match to wrap to the LAST visible match (scene-arrow-mounted-2), active scene was: ${active}`);
    if(!await isOpen("allScenesModal")||await isOpen("textModal"))
      throw new Error("Previous must not have opened any other modal either");
  }
  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  // ============================================================
  // PART 21 (Stage D1 final fix, item 3/8D): standalone "Текст сцены"
  // project-scope Next/Previous must wrap WITHIN the one currently open
  // scene only, and must never reach (or open) a different scene sharing the
  // same query -- including the excluded sibling that legitimately appears
  // in the results list.
  // ============================================================
  await page.evaluate(()=>openSceneText("scene-arrow-standalone"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.click("#fullSceneTextFindReplace .rte-scope-project");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","тюлен");
  await page.waitForTimeout(80);
  {
    const summary=await page.locator("#textModal .rte-project-results .rte-project-results-summary").textContent();
    if(!/4\s*совпадени/.test(summary))throw new Error(`Expected 4 "тюлен" matches total (3 in this scene + 1 excluded), got: ${summary}`);
  }
  await page.locator("#fullSceneTextEditor .scene-paragraph",{hasText:"Абзац 1 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  // Three Nexts from paragraph 1's own match walk 1->2->3; a FOURTH must wrap
  // back to paragraph 1 -- never spill into the excluded sibling scene.
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const activeText=await page.locator("#fullSceneTextEditor .rte-find-match-active").locator("xpath=..").textContent();
    if(!/Абзац 1\b/.test(activeText))throw new Error(`Expected the 4th Next to wrap back to paragraph 1 (within-scene wrap only), got paragraph text: ${JSON.stringify(activeText)}`);
    if(!await isOpen("textModal")||await isOpen("allScenesModal")||await isOpen("sceneModal"))
      throw new Error("Standalone project-scope Next must never open a different surface/scene");
  }
  // Previous from paragraph 1 must wrap to paragraph 3 (the scene's own LAST
  // match), not to the excluded scene.
  await page.click("#fullSceneTextFindReplace .rte-find-prev");
  await page.waitForTimeout(30);
  {
    const activeText=await page.locator("#fullSceneTextEditor .rte-find-match-active").locator("xpath=..").textContent();
    if(!/Абзац 3\b/.test(activeText))throw new Error(`Expected Previous from paragraph 1 to wrap to paragraph 3 (this scene's own last match), got: ${JSON.stringify(activeText)}`);
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  // ============================================================
  // PART 22 (Stage D1 final fix, item 3/8E): the Scene modal must behave
  // exactly like standalone above -- same scene, same query, same wrap-
  // within-scene-only contract, on the OTHER single-editor surface.
  // ============================================================
  await page.evaluate(()=>editScene("scene-arrow-standalone"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  await page.click("#sceneTextToolbar .rte-btn-find");
  await page.click("#sceneTextFindReplace .rte-scope-project");
  await page.fill("#sceneTextFindReplace .rte-find-input","тюлен");
  await page.waitForTimeout(80);
  await page.locator("#sceneTextEditor .scene-paragraph",{hasText:"Абзац 3 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#sceneTextFindReplace .rte-find-prev");
  await page.waitForTimeout(30);
  {
    const activeText=await page.locator("#sceneTextEditor .rte-find-match-active").locator("xpath=..").textContent();
    if(!/Абзац 2\b/.test(activeText))throw new Error(`Scene modal: expected Previous from paragraph 3 to land on paragraph 2, got: ${JSON.stringify(activeText)}`);
  }
  // Two more Previous presses wrap 2->1->3 (this scene's own last match) --
  // never into the excluded sibling scene.
  await page.click("#sceneTextFindReplace .rte-find-prev");
  await page.click("#sceneTextFindReplace .rte-find-prev");
  await page.waitForTimeout(30);
  {
    const activeText=await page.locator("#sceneTextEditor .rte-find-match-active").locator("xpath=..").textContent();
    if(!/Абзац 3\b/.test(activeText))throw new Error(`Scene modal: expected wrapping Previous to land back on paragraph 3 (within-scene wrap only), got: ${JSON.stringify(activeText)}`);
    if(!await isOpen("sceneModal")||await isOpen("textModal")||await isOpen("allScenesModal"))
      throw new Error("Scene modal project-scope Previous must never open a different surface/scene");
  }
  await page.click("#sceneTextFindReplace .rte-find-close");
  await page.click("#cancelScene");

  // ============================================================
  // PART 23 (D1.1 fix): the arrow counter next to ↑/↓ in "Весь текст" must
  // show the CURRENT SURFACE's own navigation domain as its denominator
  // (2 mounted scenes, 3 matches total: 1 + 2), never the project-wide total
  // (53, with 50 more in an excluded scene) -- and wrapping must happen at
  // that same domain size, never spilling past it toward the raw total.
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","гепард");
  await page.waitForTimeout(80);
  {
    const summary=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
    if(!/53\s*совпадени/.test(summary))throw new Error(`Expected 53 "гепард" matches total (1 + 2 mounted, 50 excluded), got: ${summary}`);
    if(!/3\s*сцен/.test(summary))throw new Error(`Expected 3 affected scenes, got: ${summary}`);
    if(!summary.includes("ещё 50 вне «Весь текст»"))
      throw new Error(`Expected the summary to report the 50 off-surface matches by name, got: ${summary}`);
  }
  await page.locator("#allSceneEditor-scene-counter-mounted-1 .scene-paragraph").click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  const readCount=async selector=>page.locator(selector).textContent();
  // The exact STARTING numerator depends on canonical order/caret resolution
  // (not what this part is testing) -- what matters is the denominator is
  // always 3 (never 53), and that three more presses form exactly one full
  // wrap cycle back to the numerator the arrows started this test on.
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  const firstCount=await readCount("#allScenesFindReplace .rte-find-count");
  if(!/из 3$/.test(firstCount))throw new Error(`Expected the arrow counter's denominator to be 3 (domain-relative, not the project-wide 53), got: ${firstCount}`);
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  const secondCount=await readCount("#allScenesFindReplace .rte-find-count");
  if(secondCount===firstCount||!/из 3$/.test(secondCount))
    throw new Error(`Expected a different numerator (still "N из 3") after a second Next, got ${firstCount} -> ${secondCount}`);
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  const thirdCount=await readCount("#allScenesFindReplace .rte-find-count");
  if(!/из 3$/.test(thirdCount))throw new Error(`Expected "N из 3" after a third Next, got: ${thirdCount}`);
  // A fourth Next must complete exactly one full cycle of the 3-match domain
  // and land back on the SAME numerator the first Next showed -- never
  // "4 из 3", never spilling into the excluded scene's 50 matches, and never
  // opening any other modal.
  await page.click("#allScenesFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await readCount("#allScenesFindReplace .rte-find-count");
    if(count!==firstCount)throw new Error(`Expected a 4th Next to wrap back to the same "${firstCount}" the arrows started on (a full 3-match cycle), got: ${count}`);
    if(await isOpen("textModal"))throw new Error("Arrow navigation must never have opened the excluded scene's standalone modal");
  }
  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  // ============================================================
  // PART 24 (D1.1 fix): standalone "Текст сцены" -- same contract, but the
  // domain is "just this one scene" (3 matches) while the project-wide total
  // is 4 (1 more in an excluded sibling scene). The off-surface suffix must
  // NOT appear here at all -- this surface is not "Весь текст".
  // ============================================================
  await page.evaluate(()=>openSceneText("scene-arrow-standalone"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.click("#fullSceneTextFindReplace .rte-scope-project");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","тюлен");
  await page.waitForTimeout(80);
  {
    const summary=await page.locator("#textModal .rte-project-results .rte-project-results-summary").textContent();
    if(!/4\s*совпадени/.test(summary))throw new Error(`Expected 4 "тюлен" matches total, got: ${summary}`);
    if(summary.includes("вне «Весь текст»"))
      throw new Error(`Standalone "Текст сцены" is not "Весь текст" -- the off-surface suffix must never appear there, got: ${summary}`);
  }
  await page.locator("#fullSceneTextEditor .scene-paragraph",{hasText:"Абзац 1 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await readCount("#fullSceneTextFindReplace .rte-find-count");
    if(count!=="1 из 3")throw new Error(`Expected "1 из 3" (this scene's own domain, not the project-wide 4), got: ${count}`);
  }
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  if((await readCount("#fullSceneTextFindReplace .rte-find-count"))!=="3 из 3")
    throw new Error(`Expected "3 из 3" after two more Nexts`);
  await page.click("#fullSceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  if((await readCount("#fullSceneTextFindReplace .rte-find-count"))!=="1 из 3")
    throw new Error(`Expected the counter to wrap back to "1 из 3"`);
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  // ============================================================
  // PART 25 (D1.1 fix): the Scene modal must behave exactly like standalone
  // above for the counter too.
  // ============================================================
  await page.evaluate(()=>editScene("scene-arrow-standalone"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  await page.click("#sceneTextToolbar .rte-btn-find");
  await page.click("#sceneTextFindReplace .rte-scope-project");
  await page.fill("#sceneTextFindReplace .rte-find-input","тюлен");
  await page.waitForTimeout(80);
  {
    const summary=await page.locator("#sceneModal .rte-project-results .rte-project-results-summary").textContent();
    if(summary.includes("вне «Весь текст»"))
      throw new Error(`Scene modal is not "Весь текст" -- the off-surface suffix must never appear there, got: ${summary}`);
  }
  await page.locator("#sceneTextEditor .scene-paragraph",{hasText:"Абзац 1 "}).click();
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  await page.click("#sceneTextFindReplace .rte-find-next");
  await page.waitForTimeout(30);
  {
    const count=await readCount("#sceneTextFindReplace .rte-find-count");
    if(count!=="1 из 3")throw new Error(`Scene modal: expected "1 из 3" (domain-relative), got: ${count}`);
  }
  await page.click("#sceneTextFindReplace .rte-find-close");
  await page.click("#cancelScene");

  // ============================================================
  // PART 26 (D1.1 fix, edge case F): zero matches in the current navigation
  // domain while the project has matches elsewhere -- the arrow controls
  // must not pretend there is a navigable result (counter reads "0 из 0",
  // arrows disabled), and the global project result row must remain usable.
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","морж");
  await page.waitForTimeout(80);
  {
    const count=await readCount("#allScenesFindReplace .rte-find-count");
    if(count!=="0 из 0")throw new Error(`"Весь текст": expected "0 из 0" when nothing in the current domain matches, got: ${count}`);
    if(!await page.locator("#allScenesFindReplace .rte-find-next").isDisabled())
      throw new Error("Next must be disabled when the navigation domain has zero matches");
    if(!await page.locator("#allScenesFindReplace .rte-find-prev").isDisabled())
      throw new Error("Previous must be disabled when the navigation domain has zero matches");
    const summary=await page.locator("#allScenesModal .rte-project-results .rte-project-results-summary").textContent();
    if(!/1\s*совпадени/.test(summary))throw new Error(`Expected the global project result to still report the 1 "морж" match, got: ${summary}`);
    if(!summary.includes("ещё 1 вне «Весь текст»"))
      throw new Error(`Expected the summary to report that single match as off-surface, got: ${summary}`);
    if(await page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"Морж нигде"}).count()!==1)
      throw new Error("The off-surface project result row must remain present and usable even though the arrows cannot reach it");
  }
  await page.click("#allScenesFindReplace .rte-find-close");
  await page.click("#closeAllScenes");

  await page.evaluate(()=>openSceneText("scene-counter-mounted-1"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.click("#fullSceneTextFindReplace .rte-scope-project");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","морж");
  await page.waitForTimeout(80);
  {
    const count=await readCount("#fullSceneTextFindReplace .rte-find-count");
    if(count!=="0 из 0")throw new Error(`Standalone: expected "0 из 0" when this scene has no matches of its own, got: ${count}`);
    if(!await page.locator("#fullSceneTextFindReplace .rte-find-next").isDisabled())
      throw new Error("Standalone: Next must be disabled when the navigation domain has zero matches");
    if(await page.locator("#textModal .rte-project-results .rte-project-result-group",{hasText:"Морж нигде"}).count()!==1)
      throw new Error("Standalone: the off-surface project result row must remain present and usable");
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  // ============================================================
  // PART 27 (D1.1 fix, edge case E): an explicit click on an off-surface
  // project result from "Весь текст" must still open/navigate correctly
  // (no regression of the repeated-unmounted-scene modal fix from 35f1c60),
  // and the DESTINATION surface's own arrow counter must reflect ITS OWN
  // navigation domain (this scene's 3 "кот" matches), never the project-wide
  // total, and never the off-surface suffix (this destination isn't "Весь
  // текст" either).
  // ============================================================
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesList .ProseMirror");
  await page.click("#allScenesToolbar .rte-btn-find");
  await page.click("#allScenesFindReplace .rte-scope-project");
  await page.fill("#allScenesFindReplace .rte-find-input","кот");
  await page.waitForTimeout(80);
  await page.locator("#allScenesModal .rte-project-results .rte-project-result-group",{hasText:"Нигде не открыта"}).locator(".rte-project-result-row").first().click();
  await page.waitForTimeout(100);
  if(await isOpen("discardChangesModal"))await page.click("#discardChanges");
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  if(!await isOpen("textModal")||await isOpen("allScenesModal"))
    throw new Error("Explicit off-surface click must still open the standalone modal and close the originating one (existing accepted behavior)");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  await page.click("#fullSceneTextFindReplace .rte-scope-project");
  await page.fill("#fullSceneTextFindReplace .rte-find-input","кот");
  await page.waitForTimeout(80);
  {
    const count=await readCount("#fullSceneTextFindReplace .rte-find-count");
    if(count!=="1 из 3")throw new Error(`Destination surface: expected its own counter to read "1 из 3" (its own domain), got: ${count}`);
    const summary=await page.locator("#textModal .rte-project-results .rte-project-results-summary").textContent();
    if(summary.includes("вне «Весь текст»"))
      throw new Error(`Destination surface is standalone, not "Весь текст" -- must never show the off-surface suffix, got: ${summary}`);
  }
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  await page.click("#closeText");

  console.log("find-replace-project-search-browser.test.mjs: all assertions passed");
}finally{
  await browser.close();
  server.kill();
}
