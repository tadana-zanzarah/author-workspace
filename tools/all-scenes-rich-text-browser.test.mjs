// T2: focused coverage for "Весь текст" (#allScenesModal) now mounting one
// independent rich-text editor per visible Scene (js/editor/scene-editor-
// controller.js's createSceneEditorGroup) behind exactly ONE shared toolbar,
// replacing the old per-scene <textarea class="all-scene-text">. Covers the
// architectural requirements: one shared toolbar targeting whichever Scene
// last had focus, formatting never leaking across Scene boundaries, and the
// "only write Scenes that actually changed" save strategy (including a
// formatting-only change counting as a real change, and a no-edit Save
// producing zero writes at all).
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8093,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
const base=`http://127.0.0.1:${port}/`;

const richBoldDoc={type:"doc",content:[{type:"paragraph",attrs:{align:null},content:[{type:"text",marks:[{type:"strong"}],text:"Уже жирный текст."}]}]};

const project={
  version:11,
  characters:[],profiles:{},characterLinks:[],
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],
  future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
  scenes:[
    {id:"scene-a",title:"Сцена А",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Текст сцены А.",included:true,status:"floating",people:{}},
    {id:"scene-b",title:"Сцена Б",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Текст сцены Б.",included:true,status:"floating",people:{}},
    {id:"scene-c-untouched",title:"Нетронутая сцена",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Эта сцена никогда не редактируется в тесте.",included:true,status:"floating",people:{}},
    {id:"scene-rich",title:"Уже с форматированием",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Уже жирный текст.",sceneTextDoc:richBoldDoc,included:true,status:"floating",people:{}},
    {id:"scene-dangerous",title:"Опасный текст",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"<b>жирный</b> легаси-текст",included:true,status:"floating",people:{}}
  ]
};

function freshProject(){return JSON.parse(JSON.stringify(project))}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("asrt-seeded"))return;sessionStorage.setItem("asrt-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},freshProject());
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // Same inline-style check idiom used across this suite for modal open/close --
  // see tools/scene-rich-text-editor-browser.test.mjs's own comment on the
  // app's allow-discrete modal close-fade transition.
  const isOpen=async id=>page.$eval(`#${id}`,node=>node.style.display==="flex").catch(()=>false);
  const savedProject=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
  const sceneEditor=id=>page.locator(`#allSceneEditor-${id} .ProseMirror`);

  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesModal .rte-editor .ProseMirror");

  // --- Multiple scene editors mount correctly; existing rich-text and legacy
  // scenes all render side by side.
  const editorIds=await page.$$eval("#allScenesModal .rte-editor",els=>els.map(el=>el.dataset.sceneId));
  if(JSON.stringify(editorIds)!==JSON.stringify(["scene-a","scene-b","scene-c-untouched","scene-rich","scene-dangerous"]))
    throw new Error(`Unexpected mounted scene set/order: ${JSON.stringify(editorIds)}`);
  if(await sceneEditor("scene-rich").locator("strong").textContent()!=="Уже жирный текст.")
    throw new Error("Pre-existing sceneTextDoc formatting was not preserved in \"Весь текст\"");
  const dangerousText=await sceneEditor("scene-dangerous").textContent();
  if(!dangerousText.includes("<b>жирный</b>"))throw new Error("Legacy dangerous-looking text was not preserved literally");
  if(await sceneEditor("scene-dangerous").locator("strong").count())throw new Error("Literal <b> text was auto-interpreted as a bold mark");

  // --- Exactly ONE shared toolbar, not one per scene.
  const toolbarCount=await page.locator("#allScenesModal .rte-toolbar").count();
  if(toolbarCount!==1)throw new Error(`Expected exactly one shared toolbar, found ${toolbarCount}`);

  // --- No-edit Save produces zero writes: nothing touched yet.
  await page.click("#saveAllScenes");
  await page.waitForTimeout(120);
  if(await isOpen("allScenesModal"))throw new Error("All Scenes modal stayed open after a no-op Save");
  let saved=await savedProject();
  if(JSON.stringify(saved.scenes)!==JSON.stringify(freshProject().scenes))
    throw new Error("A no-edit Save changed scene data -- expected zero writes");

  // --- Reopen: toolbar targets whichever scene last had focus, and switching
  // scenes updates both the command target and the reported active state.
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesModal .rte-editor .ProseMirror");
  // Baseline captured from the app's own already-normalized in-memory model
  // (not the raw seed fixture) -- commitDataChange's save pipeline normalizes
  // the whole project object on every save regardless of which scenes were
  // actually touched (e.g. filling in an explicit sceneTextDoc:null default),
  // same as it always has; that's unrelated to this surface's own "only write
  // changed scenes" guarantee, which is what these untouched-scene checks
  // below are actually verifying.
  const untouchedBaseline=await page.evaluate(()=>JSON.stringify(data.scenes.find(s=>s.id==="scene-c-untouched")));
  const richBaseline=await page.evaluate(()=>JSON.stringify(data.scenes.find(s=>s.id==="scene-rich")));
  await sceneEditor("scene-a").click({clickCount:3});
  await page.click('#allScenesToolbar [data-cmd="bold"]');
  if((await page.getAttribute('#allScenesToolbar [data-cmd="bold"]',"aria-pressed"))!=="true")
    throw new Error("Bold did not apply to the focused Scene A editor through the shared toolbar");
  if(await sceneEditor("scene-a").locator("strong").textContent()!=="Текст сцены А.")
    throw new Error("Bold mark not actually applied inside Scene A's own editor");

  // Switching focus to Scene B updates the toolbar's active state to B's
  // (unformatted) state, NOT still showing Scene A's bold as active.
  await sceneEditor("scene-b").click({clickCount:3});
  if((await page.getAttribute('#allScenesToolbar [data-cmd="bold"]',"aria-pressed"))!=="false")
    throw new Error("Toolbar still reported Scene A's bold state after focus moved to Scene B");
  await page.click('#allScenesToolbar [data-cmd="italic"]');
  if(await sceneEditor("scene-b").locator("em").textContent()!=="Текст сцены Б.")
    throw new Error("Italic did not apply to Scene B after switching focus to it");

  // --- Formatting cannot leak across scene boundaries: A stays bold-only
  // (no italic), B stays italic-only (no bold).
  if(await sceneEditor("scene-a").locator("em").count())throw new Error("Italic leaked into Scene A");
  if(await sceneEditor("scene-b").locator("strong").count())throw new Error("Bold leaked into Scene B");

  // Undo targets only the active (Scene B) editor, not Scene A.
  await page.click('#allScenesToolbar [data-cmd="undo"]');
  if(await sceneEditor("scene-b").locator("em").count())throw new Error("Undo did not revert Scene B's italic");
  if(await sceneEditor("scene-a").locator("strong").count()!==1)throw new Error("Undo (targeting Scene B) incorrectly affected Scene A's bold");

  // Re-apply italic to Scene B so both A (bold) and B (italic) are changed
  // going into the save below, then add a genuine prose edit to Scene B too.
  await sceneEditor("scene-b").click({clickCount:3});
  await page.click('#allScenesToolbar [data-cmd="italic"]');
  await page.locator("#allSceneEditor-scene-b .scene-paragraph").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Добавлено.");

  // --- Save: only the two changed scenes (formatting-only A, prose+formatting
  // B) are written; scene-c-untouched, scene-rich and scene-dangerous (never
  // focused this session) must come out byte-identical.
  await page.click("#saveAllScenes");
  await page.waitForTimeout(120);
  if(await isOpen("allScenesModal"))throw new Error("All Scenes modal stayed open after Save");
  saved=await savedProject();
  const savedA=saved.scenes.find(s=>s.id==="scene-a"),savedB=saved.scenes.find(s=>s.id==="scene-b");
  if(!savedA.sceneTextDoc||JSON.stringify(savedA.sceneTextDoc).indexOf('"strong"')<0)throw new Error("Scene A's formatting-only change was not saved");
  if(savedA.sceneText!=="Текст сцены А.")throw new Error("Scene A's plain text should be unchanged by a formatting-only edit");
  if(!savedB.sceneText.includes("Добавлено."))throw new Error("Scene B's prose edit was not saved");
  if(JSON.stringify(savedB.sceneTextDoc).indexOf('"em"')<0)throw new Error("Scene B's formatting change was not saved");
  if(JSON.stringify(saved.scenes.find(s=>s.id==="scene-c-untouched"))!==untouchedBaseline)
    throw new Error("An untouched scene was rewritten by Save (should generate zero mutation for it)");
  if(JSON.stringify(saved.scenes.find(s=>s.id==="scene-rich"))!==richBaseline)
    throw new Error("An untouched already-rich scene was rewritten by Save");

  // --- Failure handling does not silently lose unsaved editor state. Local-mode
  // analog of a cloud mutation failure (same technique tools/dirty-browser.test.mjs
  // uses): forcing localStorage writes to throw makes commitDataChange fail, so
  // saveAllScenes must leave the modal open, dirty, and every editor (including
  // the one just typed into) still mounted with its content intact.
  await page.evaluate(()=>openAllScenes());
  await page.waitForSelector("#allScenesModal .rte-editor .ProseMirror");
  await page.locator("#allSceneEditor-scene-c-untouched .scene-paragraph").click({clickCount:3});
  await page.keyboard.type("Текст, который не должен потеряться при ошибке сохранения.");
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("quota","QuotaExceededError")};window.__restoreAllScenesStorage=()=>Storage.prototype.setItem=original});
  await page.click("#saveAllScenes");
  await page.waitForTimeout(120);
  if(!await isOpen("allScenesModal"))throw new Error("All Scenes modal closed despite a save failure -- editor state would be lost");
  if(!await page.evaluate(()=>trackerFor("allScenesModal").isDirty()))throw new Error("Save failure incorrectly cleared the dirty state");
  const survivedText=await page.locator("#allSceneEditor-scene-c-untouched .ProseMirror").textContent();
  if(!survivedText.includes("Текст, который не должен потеряться"))
    throw new Error("Unsaved edit was lost from the still-mounted editor after a save failure");
  await page.evaluate(()=>__restoreAllScenesStorage());
  await page.click("#saveAllScenes");
  await page.waitForTimeout(120);
  if(await isOpen("allScenesModal"))throw new Error("Successful retry after a save failure did not close the modal");
  saved=await savedProject();
  if(!saved.scenes.find(s=>s.id==="scene-c-untouched").sceneText.includes("Текст, который не должен потеряться"))
    throw new Error("Successful retry after a save failure did not persist the edit");

  console.log("all scenes rich-text browser tests passed");
}finally{await browser.close();server.kill()}
