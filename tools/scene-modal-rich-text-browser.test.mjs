// T2: focused coverage for the regular Scene modal (#sceneModal) now using the
// same ProseMirror rich-text editor as #textModal (reused via mountSceneEditor,
// see js/editor/scene-editor-controller.js) instead of a plain <textarea>.
// Deep coverage of formatting commands/undo/redo/alignment/POV/scene-break
// already exists in tools/scene-rich-text-editor-browser.test.mjs (T1, against
// #textModal) -- this file focuses on what's NEW for this surface: reusing the
// same editor inside a form with many other fields, save/dirty-tracking
// wiring, and legacy/coexistence safety.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8092,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
const base=`http://127.0.0.1:${port}/`;

const richBoldDoc={type:"doc",content:[{type:"paragraph",attrs:{align:null},content:[{type:"text",marks:[{type:"strong"}],text:"Уже отформатированный текст."}]}]};

const project={
  version:11,
  characters:[{id:"char-1",name:"Мартин",surname:"Моралес"}],
  profiles:{"char-1":{id:"char-1",characterId:"char-1",name:"Мартин",surname:"Моралес",photos:[],favorites:[],hobbies:[],birthday:{year:"",month:"",day:""},hidden:{},initialRelations:{}}},
  characterLinks:[],
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],
  future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
  scenes:[
    {id:"scene-legacy",title:"Легаси сцена",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Первый абзац.\nВторой абзац.",included:true,status:"floating",people:{}},
    {id:"scene-dangerous",title:"Опасный текст",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"<b>жирный</b> и <script>alert(1)</script>",included:true,status:"floating",people:{}},
    {id:"scene-rich",title:"Уже с форматированием",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Уже отформатированный текст.",sceneTextDoc:richBoldDoc,included:true,status:"floating",people:{}},
    {id:"scene-long",title:"Длинная сцена",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:Array.from({length:60},(_,i)=>`Абзац номер ${i+1} для проверки прокрутки длинного текста сцены.`).join("\n"),included:true,status:"floating",people:{}}
  ]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("smrt-seeded"))return;sessionStorage.setItem("smrt-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // Checks the inline style the app itself sets rather than a computed-style-based
  // visibility check -- see tools/scene-rich-text-editor-browser.test.mjs's own
  // comment on the app's allow-discrete modal close-fade transition.
  const isOpen=async id=>page.$eval(`#${id}`,node=>node.style.display==="flex").catch(()=>false);

  // --- 1. Rich text loads: legacy scene opens with one paragraph per line.
  await page.evaluate(()=>editScene("scene-legacy"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  const legacyParas=await page.$$eval("#sceneTextEditor .scene-paragraph",els=>els.map(el=>el.textContent));
  if(JSON.stringify(legacyParas)!==JSON.stringify(["Первый абзац.","Второй абзац."]))
    throw new Error(`Legacy scene text not preserved paragraph-for-paragraph: ${JSON.stringify(legacyParas)}`);

  // --- No changes: closing must not show the discard-changes confirmation
  // (the real risk this surface introduces -- an accidental false-positive
  // dirty flag from converting the legacy text through the editor on open).
  await page.click("#cancelScene");
  await page.waitForTimeout(80);
  if(await isOpen("sceneModal"))throw new Error("Scene modal still open after Cancel on an untouched scene");
  if(await isOpen("discardChangesModal"))throw new Error("Discard confirmation shown for an untouched (non-dirty) scene");

  // --- 2. Formatting commands work through this surface's own toolbar/editor ids.
  await page.evaluate(()=>editScene("scene-legacy"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  const firstPara=page.locator("#sceneTextEditor .scene-paragraph").first();
  await firstPara.click({clickCount:3});
  await page.click('#sceneTextToolbar [data-cmd="bold"]');
  if((await page.getAttribute('#sceneTextToolbar [data-cmd="bold"]',"aria-pressed"))!=="true")
    throw new Error("Bold did not apply through the Scene modal's own toolbar");
  if(await page.$eval("#sceneTextEditor strong",el=>el.textContent)!=="Первый абзац.")
    throw new Error("Bold mark not applied to the selected text");

  // --- 3. Formatting-only change is detected as dirty.
  if(!await page.evaluate(()=>trackerFor("sceneModal").isDirty()))
    throw new Error("Formatting-only change in the Scene modal was not detected as dirty");

  // Alignment and undo also reach the same editor through this toolbar.
  await page.click('#sceneTextToolbar [data-cmd="align-center"]');
  const firstParaClass=await firstPara.getAttribute("class");
  if(!firstParaClass.includes("scene-paragraph-center"))throw new Error("Alignment command did not apply");
  await page.click('#sceneTextToolbar [data-cmd="undo"]');
  const afterUndoClass=await firstPara.getAttribute("class");
  if(afterUndoClass.includes("scene-paragraph-center"))throw new Error("Undo through the Scene modal's toolbar did not revert alignment");

  // --- 4. Save, then reopen: formatting survives.
  await page.click("#saveScene");
  await page.waitForTimeout(120);
  if(await isOpen("sceneModal"))throw new Error("Scene modal did not close after Save");
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
  const savedLegacy=saved.scenes.find(s=>s.id==="scene-legacy");
  if(!savedLegacy.sceneTextDoc||savedLegacy.sceneTextDoc.type!=="doc")throw new Error("sceneTextDoc was not persisted from the Scene modal");
  if(!savedLegacy.sceneText.includes("Первый абзац."))throw new Error("Plain-text projection lost prose on save");

  await page.evaluate(()=>editScene("scene-legacy"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  if(await page.$eval("#sceneTextEditor strong",el=>el.textContent)!=="Первый абзац.")
    throw new Error("Bold formatting did not survive save/reopen through the Scene modal");
  await page.click("#cancelScene");
  await page.waitForTimeout(80);

  // --- Legacy safety: literal <b>/<script> text stays literal data, never
  // interpreted as structure, through this surface too (same guarantee T1
  // already proved for #textModal -- loadSceneDocument is shared, unchanged).
  await page.evaluate(()=>editScene("scene-dangerous"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  const dangerousText=await page.$eval("#sceneTextEditor",el=>el.textContent);
  if(!dangerousText.includes("<b>жирный</b>")||!dangerousText.includes("<script>alert(1)</script>"))
    throw new Error(`Legacy dangerous-looking text was not preserved literally: ${dangerousText}`);
  if(await page.$("#sceneTextEditor strong"))throw new Error("Literal <b> text was auto-interpreted as a bold mark");
  await page.click("#cancelScene");
  await page.waitForTimeout(80);

  // --- Existing rich-text scenes keep their formatting when opened here too
  // (coexistence across surfaces, T2's removed stale-doc guard no longer needed).
  await page.evaluate(()=>editScene("scene-rich"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  if(await page.$eval("#sceneTextEditor strong",el=>el.textContent)!=="Уже отформатированный текст.")
    throw new Error("Pre-existing sceneTextDoc formatting was not preserved when opened in the Scene modal");
  // Untouched open+close of an already-rich scene must not re-write it or mark it dirty.
  await page.click("#cancelScene");
  await page.waitForTimeout(80);
  if(await isOpen("discardChangesModal"))throw new Error("Opening an untouched already-rich scene was treated as dirty");
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
  if(JSON.stringify(saved.scenes.find(s=>s.id==="scene-rich").sceneTextDoc)!==JSON.stringify(richBoldDoc))
    throw new Error("Untouched open/close mutated the pre-existing sceneTextDoc");

  // --- Corrective regression (user visual review): a long scene must scroll
  // INSIDE the bounded #sceneTextEditor viewport, not grow the editor
  // (and therefore the whole modal) indefinitely. Before this fix, .rte-editor
  // had no height cap in #sceneModal and simply grew with content, pushing
  // the toolbar/other fields/Save button arbitrarily far down the modal's own
  // (separate, intentional) whole-modal scroll.
  await page.evaluate(()=>editScene("scene-long"));
  await page.waitForSelector("#sceneTextEditor .ProseMirror");
  const editorBox=await page.locator("#sceneTextEditor").boundingBox();
  if(editorBox.height>360)throw new Error(`Scene modal editor is not height-bounded for a long scene: ${editorBox.height}px`);
  const overflowsInternally=await page.locator("#sceneTextEditor").evaluate(el=>el.scrollHeight>el.clientHeight+2);
  if(!overflowsInternally)throw new Error("Test setup failed: long scene did not actually overflow the bounded editor viewport");
  // Toolbar stays a plain, non-sticky flex child in this modal (unlike the
  // shared "Весь текст" toolbar, which is intentionally sticky) -- unaffected
  // by this fix, checked here to lock the requirement explicitly.
  const toolbarPosition=await page.locator("#sceneTextToolbar").evaluate(el=>getComputedStyle(el).position);
  if(toolbarPosition==="sticky")throw new Error("Scene modal toolbar must stay non-sticky (unlike \"Весь текст\")");
  // Scrolling inside the editor must not move the toolbar above it or the
  // Save/Cancel footer below it -- the outer #sceneModal .modal scroll and
  // the inner .rte-editor scroll are two independent regions.
  const toolbarBoxBefore=await page.locator("#sceneTextToolbar").boundingBox();
  const actionsBoxBefore=await page.locator("#sceneModal .modal-actions").boundingBox();
  await page.locator("#sceneTextEditor").evaluate(el=>{el.scrollTop=el.scrollHeight/2});
  await page.waitForTimeout(60);
  const scrolledTop=await page.locator("#sceneTextEditor").evaluate(el=>el.scrollTop);
  if(scrolledTop<10)throw new Error("Scene modal editor did not actually scroll internally");
  const toolbarBoxAfter=await page.locator("#sceneTextToolbar").boundingBox();
  const actionsBoxAfter=await page.locator("#sceneModal .modal-actions").boundingBox();
  const closeEnough=(a,b)=>Math.abs(a-b)<=1;
  if(!closeEnough(toolbarBoxBefore.y,toolbarBoxAfter.y))throw new Error("Scene modal toolbar moved while scrolling inside the editor");
  if(!closeEnough(actionsBoxBefore.y,actionsBoxAfter.y))throw new Error("Scene modal Save/Cancel footer moved while scrolling inside the editor");
  await page.click("#cancelScene");
  await page.waitForTimeout(80);
  if(await isOpen("discardChangesModal"))throw new Error("Scrolling inside a long scene's editor alone (no edits) was treated as dirty");

  console.log("scene modal rich-text browser tests passed");
}finally{await browser.close();server.kill()}
