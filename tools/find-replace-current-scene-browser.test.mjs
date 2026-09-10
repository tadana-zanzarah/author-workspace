// Find/Replace Stage C: focused browser coverage for the first working
// current-scene Find/Replace UI across all three rich-text surfaces --
// standalone "Текст сцены" (#textModal), the regular Scene modal
// (#sceneModal), and "Весь текст" (#allScenesModal, one shared panel
// retargeting to whichever scene is active). Behavior only, not cosmetic
// layout -- see docs/find-replace-architecture.md. Each surface uses its own
// dedicated scene(s) so the three sections below never interfere with each
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
    scene("scene-all-b","Сцена Б","Собака лаяла во дворе.")
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

  // --- Toolbar entry point opens Find (all 3 surfaces get the same check;
  // this one first).
  if(await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Find/Replace panel must start hidden");
  await page.click("#fullSceneTextToolbar .rte-btn-find");
  if(!await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Toolbar entry point did not open the Find panel");
  if(!await page.locator("#fullSceneTextFindReplace .rte-find-input").evaluate(el=>el===document.activeElement))
    throw new Error("Opening Find must focus the Find input");
  await page.click("#fullSceneTextFindReplace .rte-find-close");
  if(await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Close button did not close the panel");

  // --- Ctrl+F opens Find, Ctrl+H opens Replace (expanded replace row), both
  // inside the relevant editor context.
  await page.locator("#fullSceneTextEditor .ProseMirror").click();
  await page.keyboard.press("Control+f");
  if(!await page.locator("#fullSceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Ctrl+F did not open Find");
  if(await page.locator("#fullSceneTextFindReplace .rte-replace-row").isVisible())throw new Error("Ctrl+F must not also expand the Replace row");
  await page.keyboard.press("Control+h");
  if(!await page.locator("#fullSceneTextFindReplace .rte-replace-row").isVisible())throw new Error("Ctrl+H did not expand the Replace row");
  if(!await page.locator("#fullSceneTextFindReplace .rte-find-input").evaluate(el=>el===document.activeElement))
    throw new Error("Ctrl+H must still focus the Find input by default, not the Replace input");

  // --- Browser Find shortcut is not stolen outside the relevant context:
  // close the panel and the modal entirely, then Ctrl+F on the bare app must
  // never open any of the three panels.
  await page.keyboard.press("Escape"); // closes panel, not modal
  if(!await isOpen("textModal"))throw new Error("First Escape closed the modal instead of just the panel");
  await page.click("#closeText");
  if(await isOpen("textModal"))throw new Error("textModal did not close");
  await page.keyboard.press("Control+f");
  if(await page.locator(".rte-find-replace:not([hidden])").count())
    throw new Error("Ctrl+F opened a Find/Replace panel outside any rich-text editing context");

  // --- Type a query: counter updates, all matches + a distinguished active
  // match are decorated (never raw DOM text wrapping -- these are real
  // ProseMirror decoration spans, asserted by class only).
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
  // point, and ProseMirror does not force its selection into the visible
  // browser selection for an unfocused view) and calls scrollIntoView() as
  // part of that same dispatch.
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
  await page.click("#fullSceneTextFindReplace .rte-find-toggle");
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

  // ============================================================
  // PART 2: regular Scene modal (#sceneModal)
  // ============================================================
  await page.evaluate(()=>editScene("scene-modal"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");

  await page.locator("#sceneTextEditor .ProseMirror").click();
  await page.keyboard.press("Meta+f");
  if(!await page.locator("#sceneTextFindReplace.rte-find-replace").isVisible())throw new Error("Meta+F did not open Find in the Scene modal");
  await page.keyboard.press("Meta+h");
  if(!await page.locator("#sceneTextFindReplace .rte-replace-row").isVisible())throw new Error("Meta+H did not expand Replace in the Scene modal");

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
  // previously active scene are cleaned up.
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
  await page.click("#allScenesFindReplace .rte-find-toggle");
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

  console.log("find-replace current-scene browser tests passed");
}finally{await browser.close();server.kill()}
