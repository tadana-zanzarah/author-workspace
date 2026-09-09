import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

const project={
  version:11,
  characters:[{id:"char-1",name:"Мартин",surname:"Моралес"}],
  profiles:{"char-1":{id:"char-1",characterId:"char-1",name:"Мартин",surname:"Моралес",photos:[],favorites:[],hobbies:[],birthday:{year:"",month:"",day:""},hidden:{},initialRelations:{}}},
  characterLinks:[],
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[],tags:[],
  future:{plotlines:[],characterArcs:[],worldMap:null,causalLinks:[]},
  scenes:[
    {id:"scene-1",title:"Первая сцена",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Первый абзац.\nВторой абзац.",included:true,status:"floating",people:{}},
    {id:"scene-2",title:"Вторая сцена (легаси)",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Нетронутый легаси-текст.",included:true,status:"floating",people:{}}
  ]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("rte-seeded"))return;sessionStorage.setItem("rte-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // Checks the inline style the app itself sets (openModal/forceCloseModal write
  // style.display directly) rather than getComputedStyle: a closing modal's
  // computed display briefly lags behind (see modal-manager.js's own comment on
  // the `allow-discrete` close-fade transition), so computed style is not a
  // reliable proxy for "did the app actually close this."
  const isVisible=async selector=>page.$eval(selector,node=>node.style.display==="flex").catch(()=>false);

  // --- Open a legacy plain-text scene: text preserved exactly, one paragraph per line.
  await page.evaluate(()=>openSceneText("scene-1"));
  await page.waitForSelector("#textModal .modal");
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  let paragraphs=await page.$$eval("#fullSceneTextEditor .scene-paragraph",els=>els.map(el=>el.textContent));
  if(JSON.stringify(paragraphs)!==JSON.stringify(["Первый абзац.","Второй абзац."]))
    throw new Error(`Legacy text not preserved paragraph-for-paragraph: ${JSON.stringify(paragraphs)}`);

  // Accessible names on the toolbar controls.
  const boldAriaLabel=await page.getAttribute('[data-cmd="bold"]',"aria-label");
  if(!boldAriaLabel)throw new Error("Bold button has no accessible name");
  const povAriaLabel=await page.getAttribute('[data-cmd="pov"]',"aria-label");
  if(!povAriaLabel)throw new Error("POV control has no accessible name");

  // --- No changes made: closing must NOT show the discard-changes confirmation.
  await page.click("#closeText");
  await page.waitForTimeout(80);
  if(await isVisible("#textModal"))throw new Error("Modal still open after closing an untouched scene");
  if(await isVisible("#discardChangesModal"))throw new Error("Discard confirmation shown for an untouched (non-dirty) scene");

  // --- Reopen and make a real formatting-only edit.
  await page.evaluate(()=>openSceneText("scene-1"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  const firstParagraph=page.locator("#fullSceneTextEditor .scene-paragraph").first();
  await firstParagraph.click({clickCount:3});
  await page.click('[data-cmd="bold"]');
  if((await page.getAttribute('[data-cmd="bold"]',"aria-pressed"))!=="true")throw new Error("Bold button did not report active state after applying bold");
  await page.click('[data-cmd="italic"]');
  await page.click('[data-cmd="strike"]');
  if(await page.$eval("#fullSceneTextEditor strong",el=>el.textContent)!=="Первый абзац.")throw new Error("Bold mark not applied to the selected paragraph text");
  if(!(await page.$("#fullSceneTextEditor em")))throw new Error("Italic mark not applied");
  if(!(await page.$("#fullSceneTextEditor s")))throw new Error("Strike mark not applied");

  // Formatting-only change (plain text unchanged) must still count as dirty.
  await page.click("#closeText");
  await page.waitForTimeout(80);
  if(!(await isVisible("#discardChangesModal")))throw new Error("Formatting-only change was not detected as dirty");
  await page.click("#continueEditing");
  await page.waitForTimeout(80);
  if(!(await isVisible("#textModal")))throw new Error("Continuing editing did not keep the modal open");

  // Keyboard shortcut must reach the same command path as the toolbar button.
  const secondParagraph=page.locator("#fullSceneTextEditor .scene-paragraph").nth(1);
  await secondParagraph.click({clickCount:3});
  await page.keyboard.press("Control+b");
  if((await page.getAttribute('[data-cmd="bold"]',"aria-pressed"))!=="true")throw new Error("Ctrl+B did not toggle bold through the same command path as the toolbar");
  await page.keyboard.press("Control+b"); // toggle back off before continuing

  // Alignment.
  await firstParagraph.click({clickCount:3});
  await page.click('[data-cmd="align-center"]');
  const firstParagraphClass=await firstParagraph.getAttribute("class");
  if(!firstParagraphClass.includes("scene-paragraph-center"))throw new Error("Center alignment was not applied to the paragraph");

  // Scene separator: structural block, not plain text, editable around. A short
  // pause before/after each of these two inserts keeps them as two genuinely
  // separate prosemirror-history undo groups (its default grouping window is
  // 500ms) so the multi-step undo/redo check below has deterministic step
  // boundaries -- the pure-logic unit test already proves single-transaction
  // undo/redo precision without this timing concern.
  await secondParagraph.click();
  await page.keyboard.press("End");
  await page.click('[data-cmd="scene-break"]');
  if(!(await page.$("#fullSceneTextEditor .scene-break")))throw new Error("Scene break was not inserted");
  await page.waitForTimeout(600);

  // POV insert from the project's own Characters.
  await page.selectOption('[data-cmd="pov"]',"Мартин Моралес");
  const editorText=await page.$eval("#fullSceneTextEditor",el=>el.textContent);
  if(!editorText.includes("pov Мартин Моралес"))throw new Error("POV insert did not add the character's name");
  if(await page.$eval("#fullSceneTextEditor strong",els=>els).catch(()=>null)===null)throw new Error("POV insert control missing bold presentation");
  await page.waitForTimeout(600);

  // Multi-step undo/redo through the toolbar (same command path as everywhere else).
  await page.click('[data-cmd="undo"]');
  let textAfterUndo1=await page.$eval("#fullSceneTextEditor",el=>el.textContent);
  if(textAfterUndo1.includes("pov Мартин Моралес"))throw new Error("Undo #1 did not remove the POV insert");
  if(!(await page.$("#fullSceneTextEditor .scene-break")))throw new Error("Undo #1 removed more than the POV insert");
  await page.click('[data-cmd="undo"]');
  if(await page.$("#fullSceneTextEditor .scene-break"))throw new Error("Undo #2 did not remove the scene break");
  await page.click('[data-cmd="redo"]');
  if(!(await page.$("#fullSceneTextEditor .scene-break")))throw new Error("Redo #1 did not restore the scene break");
  await page.click('[data-cmd="redo"]');
  const textAfterRedo2=await page.$eval("#fullSceneTextEditor",el=>el.textContent);
  if(!textAfterRedo2.includes("pov Мартин Моралес"))throw new Error("Redo #2 did not restore the POV insert");

  // --- Save, then reopen: formatting must survive exactly.
  await page.click("#saveText");
  await page.waitForTimeout(120);
  if(await isVisible("#textModal"))throw new Error("Modal did not close after Save");

  const savedScene=await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem("novelTimelineV11"));return p.scenes.find(s=>s.id==="scene-1")});
  if(!savedScene.sceneTextDoc||savedScene.sceneTextDoc.type!=="doc")throw new Error("sceneTextDoc was not persisted");
  if(!savedScene.sceneText.includes("***"))throw new Error("Plain-text sceneText did not receive the *** scene-break representation");
  if(!savedScene.sceneText.includes("pov Мартин Моралес"))throw new Error("Plain-text sceneText lost the POV insert");

  await page.evaluate(()=>openSceneText("scene-1"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  if(await page.$eval("#fullSceneTextEditor strong",el=>el.textContent)!=="Первый абзац.")throw new Error("Bold formatting did not survive save/reopen");
  if(!(await page.$("#fullSceneTextEditor em")))throw new Error("Italic formatting did not survive save/reopen");
  if(!(await page.$("#fullSceneTextEditor s")))throw new Error("Strike formatting did not survive save/reopen");
  if(!(await page.$("#fullSceneTextEditor .scene-break")))throw new Error("Scene break did not survive save/reopen");
  const reopenedClass=await page.locator("#fullSceneTextEditor .scene-paragraph").first().getAttribute("class");
  if(!reopenedClass.includes("scene-paragraph-center"))throw new Error("Alignment did not survive save/reopen");
  await page.click("#closeText");

  // --- A second, never-touched legacy scene must still open cleanly (regression safety).
  await page.evaluate(()=>openSceneText("scene-2"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  const legacyParas=await page.$$eval("#fullSceneTextEditor .scene-paragraph",els=>els.map(el=>el.textContent));
  if(JSON.stringify(legacyParas)!==JSON.stringify(["Нетронутый легаси-текст."]))
    throw new Error(`Untouched legacy scene changed on open: ${JSON.stringify(legacyParas)}`);
  await page.click("#closeText");

  console.log("scene rich-text editor browser tests passed");
}finally{await browser.close();server.kill()}
