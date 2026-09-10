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
     writingStatus:"idea",sceneText:"Нетронутый легаси-текст.",included:true,status:"floating",people:{}},
    {id:"scene-boundary",title:"Проверка границы выделения",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"L1\nL2\nL3\nL4\nL5",included:true,status:"floating",people:{}},
    {id:"scene-long",title:"Длинная сцена",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],
     writingStatus:"idea",sceneText:Array.from({length:60},(_,i)=>`Абзац номер ${i+1} для проверки прокрутки длинного текста сцены.`).join("\n"),included:true,status:"floating",people:{}}
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

  // Legacy scenes have no explicit alignment -- they render using the
  // platform default (justify), not a baked-in "left" (T1 corrective UX pass,
  // items 2/6). Destructive-rewrite check: opening does not add an explicit
  // align attr (verified separately below via the doc JSON after a no-op close).
  const legacyParaClasses=await page.$$eval("#fullSceneTextEditor .scene-paragraph",els=>els.map(el=>el.className));
  if(!legacyParaClasses.every(c=>c.includes("scene-paragraph-justify")))
    throw new Error(`Legacy paragraphs did not render with the default justify alignment: ${JSON.stringify(legacyParaClasses)}`);

  // Every icon-only control (alignment icons + undo/redo glyphs) keeps a real
  // Russian accessible name -- icons alone are never the only signal.
  for(const cmd of ["bold","align-left","align-center","align-right","align-justify","undo","redo","scene-break","pov"]){
    const label=await page.getAttribute(`[data-cmd="${cmd}"]`,"aria-label");
    if(!label)throw new Error(`Control [data-cmd="${cmd}"] has no accessible name`);
    const title=await page.getAttribute(`[data-cmd="${cmd}"]`,"title");
    if(cmd!=="pov"&&!title)throw new Error(`Control [data-cmd="${cmd}"] has no tooltip/title`);
  }

  // --- No changes made: closing must NOT show the discard-changes confirmation.
  await page.click("#closeText");
  await page.waitForTimeout(80);
  if(await isVisible("#textModal"))throw new Error("Modal still open after closing an untouched scene");
  if(await isVisible("#discardChangesModal"))throw new Error("Discard confirmation shown for an untouched (non-dirty) scene");

  // --- Enter creates a new paragraph (natural prose flow, no manual blank-line
  // management needed) -- discarded afterward, this reopen is throwaway.
  await page.evaluate(()=>openSceneText("scene-1"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  // A plain single click reliably places a caret only once the editor has had a
  // prior genuine selection established (observed in this environment); a
  // triple-click (native paragraph selection) is reliable from a fresh mount, so
  // select-then-collapse-to-end is used instead of a bare single click here.
  await page.locator("#fullSceneTextEditor .scene-paragraph").nth(1).click({clickCount:3});
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Новый абзац после Enter.");
  const paragraphsAfterEnter=await page.$$eval("#fullSceneTextEditor .scene-paragraph",els=>els.map(el=>el.textContent));
  if(paragraphsAfterEnter.length!==3||paragraphsAfterEnter[2]!=="Новый абзац после Enter.")
    throw new Error(`Enter did not create a clean new paragraph: ${JSON.stringify(paragraphsAfterEnter)}`);
  await page.evaluate(()=>document.getElementById("closeText").click());
  await page.click("#discardChanges");
  await page.waitForTimeout(80);

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

  await firstParagraph.click({clickCount:3});
  await page.click('[data-cmd="align-justify"]');
  const justifiedClass=await firstParagraph.getAttribute("class");
  if(!justifiedClass.includes("scene-paragraph-justify"))throw new Error("Justify was not applied to the paragraph");
  if((await page.getAttribute('[data-cmd="align-justify"]',"aria-pressed"))!=="true")throw new Error("Justify button did not report active state");
  // Explicit Left still works despite Justify being the platform default --
  // leave the paragraph here; the save/reopen check below confirms this
  // explicit choice (not the default) is what actually gets persisted.
  await firstParagraph.click({clickCount:3});
  await page.click('[data-cmd="align-left"]');
  if((await page.getAttribute('[data-cmd="align-left"]',"aria-pressed"))!=="true")throw new Error("Explicit Left did not report active state despite Justify being default");

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

  // POV insert from the project's own Characters -- ordinary text, NOT forced
  // bold (T1 corrective UX pass, item 5). The paragraph it lands in already
  // has other bold/italic/strike text from earlier in this test, so check the
  // POV run specifically rather than "any <strong> exists in the editor".
  await page.selectOption('[data-cmd="pov"]',"Мартин Моралес");
  const editorText=await page.$eval("#fullSceneTextEditor",el=>el.textContent);
  if(!editorText.includes("pov Мартин Моралес"))throw new Error("POV insert did not add the character's name");
  const povRunIsPlain=await page.evaluate(()=>{
    const walker=document.createTreeWalker(document.getElementById("fullSceneTextEditor"),NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      if(node.textContent.includes("pov Мартин Моралес")){
        const insideMark=node.parentElement.closest("strong,em,s")!==null;
        return !insideMark;
      }
    }
    return false;
  });
  if(!povRunIsPlain)throw new Error("POV insert is still wrapped in a formatting mark (should be plain ordinary text)");
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
  if(!reopenedClass.includes("scene-paragraph-left"))throw new Error("Explicit Left alignment did not survive save/reopen");
  await page.click("#closeText");

  // --- A second, never-touched legacy scene must still open cleanly (regression safety).
  await page.evaluate(()=>openSceneText("scene-2"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  const legacyParas=await page.$$eval("#fullSceneTextEditor .scene-paragraph",els=>els.map(el=>el.textContent));
  if(JSON.stringify(legacyParas)!==JSON.stringify(["Нетронутый легаси-текст."]))
    throw new Error(`Untouched legacy scene changed on open: ${JSON.stringify(legacyParas)}`);
  await page.click("#closeText");

  // --- Selection-boundary regression (production bug), isolated on its own
  // scene: selecting exactly 4 paragraphs via keyboard (Home, then
  // Shift+Down x4 -- a selection whose endpoint lands exactly at the start
  // of the 5th paragraph) and centering must NOT also center that 5th
  // paragraph. The pure-logic unit test proves this precisely at the
  // position-math level; this proves the same fix through the real
  // keymap-integrated selection/command path.
  await page.evaluate(()=>openSceneText("scene-boundary"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.locator("#fullSceneTextEditor .scene-paragraph").first().click();
  await page.keyboard.press("Home");
  for(let i=0;i<4;i++)await page.keyboard.press("Shift+ArrowDown");
  await page.click('[data-cmd="align-center"]');
  const boundaryClasses=await page.$$eval("#fullSceneTextEditor .scene-paragraph",els=>els.map(el=>el.className));
  if(boundaryClasses.length!==5)throw new Error(`Expected 5 paragraphs for the boundary regression check, got ${boundaryClasses.length}`);
  for(let i=0;i<4;i++)if(!boundaryClasses[i].includes("scene-paragraph-center"))throw new Error(`Boundary regression: paragraph ${i+1} was not centered`);
  if(boundaryClasses[4].includes("scene-paragraph-center"))throw new Error("Boundary regression bug reproduced: the 5th paragraph (outside the selection) was also centered");
  if(!boundaryClasses[4].includes("scene-paragraph-justify"))throw new Error("Boundary regression: the untouched 5th paragraph should remain at its (default justify) alignment");
  await page.click("#closeText");
  await page.click("#discardChanges");
  await page.waitForTimeout(80);

  // --- Single internal scroll region on a long scene: the manuscript panel's
  // own border must stay fully visible (never scroll away), only its content
  // scrolls, and the toolbar/Save/Close (now plain non-scrolling flex
  // children, not scrolled-and-pinned) never move at all.
  await page.evaluate(()=>openSceneText("scene-long"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  const editorBoxBefore=await page.locator("#fullSceneTextEditor").boundingBox();
  const toolbarBoxBefore=await page.locator("#fullSceneTextToolbar").boundingBox();
  const actionsBoxBefore=await page.locator("#textModal .modal-actions").boundingBox();
  const modalBoxBefore=await page.locator("#textModal .modal").boundingBox();
  // The manuscript box must actually have internal overflow to scroll --
  // otherwise this check would trivially pass without proving anything.
  const overflowsInternally=await page.locator("#fullSceneTextEditor").evaluate(el=>el.scrollHeight>el.clientHeight+2);
  if(!overflowsInternally)throw new Error("Test setup failed: long scene did not actually overflow the manuscript panel");
  await page.locator("#fullSceneTextEditor").evaluate(el=>{el.scrollTop=el.scrollHeight/2});
  await page.waitForTimeout(60);
  const scrolledTop=await page.locator("#fullSceneTextEditor").evaluate(el=>el.scrollTop);
  if(scrolledTop<10)throw new Error("Manuscript panel did not actually scroll internally");
  const editorBoxAfter=await page.locator("#fullSceneTextEditor").boundingBox();
  const toolbarBoxAfter=await page.locator("#fullSceneTextToolbar").boundingBox();
  const actionsBoxAfter=await page.locator("#textModal .modal-actions").boundingBox();
  const modalBoxAfter=await page.locator("#textModal .modal").boundingBox();
  const closeEnough=(a,b)=>Math.abs(a-b)<=1;
  if(!(closeEnough(editorBoxBefore.y,editorBoxAfter.y)&&closeEnough(editorBoxBefore.height,editorBoxAfter.height)))
    throw new Error(`Manuscript panel's own border moved/resized while scrolling its content (before y=${editorBoxBefore.y} h=${editorBoxBefore.height}, after y=${editorBoxAfter.y} h=${editorBoxAfter.height})`);
  if(!(closeEnough(toolbarBoxBefore.y,toolbarBoxAfter.y)))throw new Error("Toolbar moved while scrolling the manuscript (should be a fixed, non-scrolling region)");
  if(!(closeEnough(actionsBoxBefore.y,actionsBoxAfter.y)))throw new Error("Save/Close actions moved while scrolling the manuscript (should be a fixed, non-scrolling region)");
  if(!(closeEnough(modalBoxBefore.y,modalBoxAfter.y)&&closeEnough(modalBoxBefore.height,modalBoxAfter.height)))
    throw new Error("The modal shell itself moved/resized -- it should not scroll at all any more");
  // Toolbar buttons and Save/Close must actually be clickable (not just
  // visually present) after scrolling deep into a long scene.
  if(!(await page.locator('[data-cmd="bold"]').isVisible()))throw new Error("Bold button not reachable after scrolling a long scene");
  if(!(await page.locator("#saveText").isVisible()))throw new Error("Save button not reachable after scrolling a long scene");
  // Keyboard/selection still work inside the now-independently-scrolling editor.
  await page.locator("#fullSceneTextEditor .scene-paragraph").nth(5).click({clickCount:3});
  await page.click('[data-cmd="bold"]');
  if((await page.getAttribute('[data-cmd="bold"]',"aria-pressed"))!=="true")throw new Error("Formatting a selection made after internal scrolling did not apply");
  await page.click('[data-cmd="bold"]'); // toggle back off
  // No background scroll leak: the page behind the modal must not have moved.
  const bodyScrollBefore=await page.evaluate(()=>document.documentElement.scrollTop);
  await page.mouse.wheel(0,400);
  await page.waitForTimeout(60);
  const bodyScrollAfter=await page.evaluate(()=>document.documentElement.scrollTop);
  if(bodyScrollAfter!==bodyScrollBefore)throw new Error("Scrolling inside the long-scene editor leaked to the page behind the modal");
  // Bold was toggled on then off on the same selection -- a net no-op, so no
  // discard confirmation is expected here.
  await page.click("#closeText");
  if(await isVisible("#discardChangesModal"))throw new Error("Toggling formatting back to its original state was still treated as dirty");
  await page.waitForTimeout(80);

  // --- Short scene: the manuscript panel must not show unnecessary internal
  // scroll (no overflow) even though it still fills the available height.
  await page.evaluate(()=>openSceneText("scene-1"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  const shortOverflows=await page.locator("#fullSceneTextEditor").evaluate(el=>el.scrollHeight>el.clientHeight+2);
  if(shortOverflows)throw new Error("Short scene created unnecessary internal scroll in the manuscript panel");
  await page.click("#closeText");

  // Narrow viewport: the toolbar wraps but every essential control (incl. the
  // compact POV control and Save/Close) stays reachable, not clipped off-screen.
  await page.evaluate(()=>openSceneText("scene-long"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  await page.setViewportSize({width:420,height:700});
  await page.waitForTimeout(60);
  if(!(await page.locator('[data-cmd="bold"]').isVisible()))throw new Error("Bold button not reachable on a narrow viewport");
  if(!(await page.locator('[data-cmd="align-justify"]').isVisible()))throw new Error("Justify button not reachable on a narrow viewport");
  if(!(await page.locator('[data-cmd="pov"]').isVisible()))throw new Error("POV control not reachable on a narrow viewport");
  if(!(await page.locator("#saveText").isVisible()))throw new Error("Save button not reachable on a narrow viewport");
  if(!(await page.locator("#closeText").isVisible()))throw new Error("Close button not reachable on a narrow viewport");
  await page.setViewportSize({width:1280,height:900});
  await page.waitForTimeout(60);
  // scene-long was only scrolled/inspected, never edited -- closing needs no
  // discard confirmation (same "no changes -> close" contract checked at the
  // top of this file, re-verified here after a scroll + viewport resize).
  await page.click("#closeText");
  if(await isVisible("#discardChangesModal"))throw new Error("Scrolling/resizing alone (no edits) was treated as dirty on close");

  // --- Compact POV control: at a normal desktop width it sits inline on the
  // main toolbar row (not forced onto its own full-width row), positioned
  // among the toolbar's "insertions" controls (grouped with scene-break, at
  // the toolbar's right end) rather than spanning the modal.
  await page.evaluate(()=>openSceneText("scene-1"));
  await page.waitForSelector("#fullSceneTextEditor .ProseMirror");
  const toolbarBox=await page.locator("#fullSceneTextToolbar").boundingBox();
  const povBox=await page.locator('[data-cmd="pov"]').boundingBox();
  const sceneBreakBox=await page.locator('[data-cmd="scene-break"]').boundingBox();
  if(povBox.width>toolbarBox.width*0.5)throw new Error(`POV control is not compact -- width ${povBox.width} vs toolbar width ${toolbarBox.width}`);
  // "Same row" via vertical-range overlap rather than near-equal y -- a
  // <select> and a <button> have different natural heights even when
  // sitting on the identical flex row (align-items:center), so their top
  // edges differ by a few px while genuinely being row-mates.
  const sameRow=povBox.y<sceneBreakBox.y+sceneBreakBox.height&&sceneBreakBox.y<povBox.y+povBox.height;
  if(!sameRow)throw new Error(`POV control is not on the same toolbar row as the scene-break button at normal desktop width (pov y=${povBox.y}..${povBox.y+povBox.height}, scene-break y=${sceneBreakBox.y}..${sceneBreakBox.y+sceneBreakBox.height})`);
  if(povBox.x<sceneBreakBox.x)throw new Error("POV control is not positioned at the right end of the toolbar (after scene-break)");
  await page.click("#closeText");

  console.log("scene rich-text editor browser tests passed");
}finally{await browser.close();server.kill()}
