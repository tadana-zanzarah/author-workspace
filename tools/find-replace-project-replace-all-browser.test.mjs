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
    scene("all-live","ВсеЖивая","chapter-1","Кот в живой сцене.")
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

    await page.click("#fullSceneTextFindReplace .rte-replace-all");
    await page.waitForTimeout(150);

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
    await page.waitForTimeout(150);

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

  console.log("find-replace project-replace-all browser tests: OK");
}finally{
  await browser.close();
  server.kill();
}
