// Regression coverage for the design/scene-surfaces-visual-system branch:
// distributing the already-accepted warm/editorial visual system (see
// character-surfaces-visual-system-browser.test.mjs for the Character
// Gallery/Profile precedent) to Create/Edit Scene and All Scenes/full text.
// Deep functional coverage for participants, relationships, chronology,
// position/ordering and dirty-state guards already exists in sibling
// *-browser.test.mjs files — this file checks the NEW visual/structural
// contract plus that none of that existing functionality regressed as a
// side effect of the DOM/CSS restructuring.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8091,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});

const project={
  version:11,
  characters:[{id:"char-1",name:"Анна",sortOrder:1000},{id:"char-2",name:"Борис",sortOrder:2000},{id:"char-3",name:"Вера",sortOrder:3000}],
  profiles:{
    "char-1":{id:"char-1",characterId:"char-1",name:"Анна",hidden:{},initialRelations:{}},
    "char-2":{id:"char-2",characterId:"char-2",name:"Борис",hidden:{},initialRelations:{}},
    "char-3":{id:"char-3",characterId:"char-3",name:"Вера",hidden:{},initialRelations:{}}
  },
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава первая",collapsed:false},{id:"chapter-two",title:"Глава вторая",collapsed:false}],
  locations:[{id:"loc-1",name:"Дом"}],
  tags:[],
  scenes:[
    {id:"scene-1",title:"Первая встреча",date:"2026-01-05",time:"10:00",dateReview:false,chapterId:"chapter-one",locationId:"loc-1",tags:[],
     writingStatus:"draft",sceneText:"Текст первой сцены.",included:true,status:"fixed",
     people:{"char-1":{action:"смотрит в окно",relationChanges:{"char-2":"друзья"},visibleRelations:["char-2"],legacyState:""}}},
    {id:"scene-2",title:"Вторая сцена",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],
     writingStatus:"idea",sceneText:"Текст второй сцены для проверки чтения.",included:true,status:"floating",people:{}}
  ],
  future:{}
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.setDefaultTimeout(8000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(value=>{if(sessionStorage.getItem("scene-surfaces-seeded"))return;sessionStorage.setItem("scene-surfaces-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}

  const sectionTitles=async()=>page.evaluate(()=>[...document.querySelectorAll("#sceneModal .scene-section-title")].map(el=>el.textContent.trim()));
  const fieldIds=["sceneDate","sceneTime","sceneTitle","sceneChapter","sceneLocation","sceneTagInput","sceneWritingStatus","sceneText","sceneIncluded","sceneStatus","sceneParticipantSelect","addSceneParticipant","scenePersons","saveScene","cancelScene","quickAddLocation"];

  // ================= 1+2+4+5. CREATE — structure/hierarchy/field survival =================
  await page.click("#addFirst");
  if(!await page.locator("#sceneModal").isVisible())throw new Error("Create Scene modal did not open");
  const createSections=await sectionTitles();
  if(JSON.stringify(createSections)!==JSON.stringify(["Время и хронология","Текст сцены","Персонажи"]))
    throw new Error(`Unexpected Create Scene section titles: ${JSON.stringify(createSections)}`);
  const missingCreate=await page.evaluate(ids=>ids.filter(id=>!document.getElementById(id)),fieldIds);
  if(missingCreate.length)throw new Error(`Scene fields missing in Create: ${missingCreate.join(", ")}`);
  // 2. Core metadata (chapter select) precedes the text section in DOM order.
  const domOrderOk=await page.evaluate(()=>!!(document.getElementById("sceneChapter").compareDocumentPosition(document.getElementById("sceneText"))&Node.DOCUMENT_POSITION_FOLLOWING));
  if(!domOrderOk)throw new Error("Core metadata (Глава) does not precede Текст сцены in DOM order");
  // 3. Scene text reachable in the first viewport at 1440x900 without scrolling the modal.
  await page.evaluate(()=>{document.querySelector("#sceneModal .modal").scrollTop=0});
  const textInViewport=await page.locator("#sceneText").evaluate(el=>{const r=el.getBoundingClientRect();return r.top>0&&r.top<window.innerHeight});
  if(!textInViewport)throw new Error("Scene text is not reachable in the first viewport at 1440x900");
  // 5. Field-caption wording preserved (writing status vs placement status stay distinct).
  const captions=await page.evaluate(()=>({
    writing:document.getElementById("sceneWritingStatus").closest("label").querySelector(".field-caption").textContent.trim(),
    placement:document.getElementById("sceneStatus").closest("label").querySelector(".field-caption").textContent.trim()
  }));
  if(captions.writing!=="Статус написания")throw new Error(`Writing status caption changed: ${captions.writing}`);
  if(captions.placement!=="Статус сцены")throw new Error(`Placement status caption changed: ${captions.placement}`);

  // ================= 6. NO ACCIDENTAL BROWSER BLUE =================
  await page.locator("#sceneDate").focus();
  const dateFocus=await page.evaluate(()=>{const el=document.getElementById("sceneDate"),cs=getComputedStyle(el);return {outlineStyle:cs.outlineStyle,outlineColor:cs.outlineColor}});
  const blueOutlines=["rgb(58, 110, 168)","rgb(0, 0, 238)","rgb(0, 122, 255)","rgb(66, 133, 244)"];
  if(dateFocus.outlineStyle==="none")throw new Error("Scene date field lost its focus-visible outline");
  if(blueOutlines.includes(dateFocus.outlineColor))throw new Error(`Scene date focus ring is still browser-blue: ${dateFocus.outlineColor}`);
  const includedAccent=await page.evaluate(()=>getComputedStyle(document.getElementById("sceneIncluded")).accentColor);
  if(includedAccent!=="rgb(95, 65, 40)")throw new Error(`Include checkbox accent is not the brand color: ${includedAccent}`);

  // ================= 20. NO HORIZONTAL OVERFLOW (three breakpoints) =================
  for(const width of [1440,1200,1024]){
    await page.setViewportSize({width,height:900});
    const overflow=await page.locator("#sceneModal .modal").evaluate(el=>el.scrollWidth>el.clientWidth+1);
    if(overflow)throw new Error(`Scene modal has horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:1440,height:900});

  // ================= 7+9+10. PARTICIPANTS/ACTIONS/RELATIONSHIPS =================
  await page.selectOption("#sceneParticipantSelect","char-3");
  await page.click("#addSceneParticipant");
  if(await page.locator('.person-block[data-participant-id="char-3"]').count()!==1)throw new Error("Adding a participant did not create a person-block");
  // Avatar (fallback initials) now renders next to the participant name.
  if(!await page.locator('.person-block[data-participant-id="char-3"] .person-block-header .matrix-avatar-fallback').count())
    throw new Error("Participant avatar is missing from the person-block header");
  await page.fill('.person-block[data-participant-id="char-3"] .p-action',"молчит");
  const relInput=page.locator('.rel-value[data-char-id="char-3"][data-target-id="char-1"]');
  await relInput.fill("незнакомы");
  if(!await page.locator('.person-block[data-participant-id="char-3"] .relation-row.explicit').count())
    throw new Error("Editing a relation value did not mark the row explicit");

  // 8. Remove an empty participant (no confirmation needed — no content yet).
  await page.selectOption("#sceneParticipantSelect","char-2");
  await page.click("#addSceneParticipant");
  await page.click('.person-block[data-participant-id="char-2"] button.danger');
  if(await page.locator('.person-block[data-participant-id="char-2"]').count()!==0)throw new Error("Removing an empty participant did not remove its person-block");

  // ================= 15. DIRTY STATE =================
  await page.fill("#sceneTitle","Черновик новой сцены");
  if(!await page.evaluate(()=>hasDirtyForms()))throw new Error("Editing the scene form did not mark it dirty");
  await page.click("#cancelScene");
  if(!await page.locator("#discardChangesModal").isVisible())throw new Error("Dirty close guard did not appear on Cancel");
  await page.click("#discardChanges");
  if(await page.locator("#sceneModal").isVisible())throw new Error("Scene modal did not close after discarding");

  // ================= 13. CREATE SAVE =================
  await page.click("#addFirst");
  await page.fill("#sceneTitle","Новая сцена из теста");
  await page.selectOption("#sceneChapter","chapter-one");
  await page.click("#saveScene");
  if(await page.locator("#sceneModal").isVisible())throw new Error("Scene modal stayed open after Create save");
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
  if(!saved.scenes.some(s=>s.title==="Новая сцена из теста"))throw new Error("New scene was not persisted");
  // Clean up this throwaway fixture scene so the later All Scenes ordering
  // checks (against the original two-scene/two-chapter fixture) stay simple.
  await page.evaluate(()=>commitDataChange(next=>{next.scenes=next.scenes.filter(s=>s.title!=="Новая сцена из теста")}));

  // ================= 1+9+10+14. EDIT — same visual system + persisted content =================
  await page.evaluate(()=>editScene("scene-1"));
  await page.waitForSelector("#sceneModal .modal");
  const editSections=await sectionTitles();
  if(JSON.stringify(editSections)!==JSON.stringify(createSections))throw new Error("Edit Scene does not share Create Scene's section structure");
  if(await page.locator('.person-block[data-participant-id="char-1"] .p-action').inputValue()!=="смотрит в окно")
    throw new Error("Existing participant action did not reload correctly");
  if(!await page.locator('.person-block[data-participant-id="char-1"] .relation-row.explicit').count())
    throw new Error("Existing explicit relation did not reload as explicit");
  await page.fill("#sceneTitle","Первая встреча (изменено)");
  await page.click("#saveScene");
  if(await page.locator("#sceneModal").isVisible())throw new Error("Scene modal stayed open after Edit save");
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
  if(saved.scenes.find(s=>s.id==="scene-1")?.title!=="Первая встреча (изменено)")throw new Error("Edited scene title was not persisted");

  // ================= 16+17+18+19+20. ALL SCENES =================
  await page.click("#allScenesBtn");
  if(!await page.locator("#allScenesModal").isVisible())throw new Error("All Scenes modal did not open");
  await page.waitForSelector("#allScenesModal .all-scene-block");
  const chapterTitles=await page.evaluate(()=>[...document.querySelectorAll("#allScenesModal .all-scene-chapter-title")].map(el=>el.textContent.trim()));
  if(JSON.stringify(chapterTitles)!==JSON.stringify(["Глава первая","Глава вторая"]))
    throw new Error(`All Scenes chapter hierarchy/order wrong: ${JSON.stringify(chapterTitles)}`);
  const sceneOrder=await page.evaluate(()=>[...document.querySelectorAll("#allScenesModal .all-scene-text")].map(el=>el.dataset.sceneId));
  if(JSON.stringify(sceneOrder)!==JSON.stringify(["scene-1","scene-2"]))throw new Error(`All Scenes scene order wrong: ${JSON.stringify(sceneOrder)}`);
  const textTypography=await page.evaluate(()=>{
    const cs=getComputedStyle(document.querySelector("#allScenesModal .all-scene-text"));
    return {fontFamily:cs.fontFamily,lineHeight:cs.lineHeight};
  });
  if(!/Georgia/.test(textTypography.fontFamily))throw new Error(`All Scenes text is not the editorial serif face: ${textTypography.fontFamily}`);
  for(const width of [1440,1200,1024]){
    await page.setViewportSize({width,height:900});
    const overflow=await page.locator("#allScenesModal .modal").evaluate(el=>el.scrollWidth>el.clientWidth+1);
    if(overflow)throw new Error(`All Scenes modal has horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:1440,height:900});
  // 12. Sticky footer stays visible and does not swallow the last scene block when scrolled to bottom.
  await page.evaluate(()=>{const m=document.querySelector("#allScenesModal .modal");m.scrollTop=m.scrollHeight});
  if(!await page.locator("#saveAllScenes").isVisible())throw new Error("All Scenes sticky footer Save button is not visible after scrolling to bottom");
  const lastBlockBottom=await page.locator("#allScenesModal .all-scene-block").last().evaluate(el=>el.getBoundingClientRect().bottom);
  const footerTop=await page.locator("#allScenesModal .sticky-modal-footer").evaluate(el=>el.getBoundingClientRect().top);
  if(lastBlockBottom>footerTop+1)throw new Error("All Scenes sticky footer overlaps the last scene block");
  // 18. Save All persists an edited scene text.
  await page.fill('#allScenesModal .all-scene-text[data-scene-id="scene-2"]',"Отредактированный текст второй сцены.");
  await page.click("#saveAllScenes");
  if(await page.locator("#allScenesModal").isVisible())throw new Error("All Scenes modal stayed open after Save All");
  saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
  if(saved.scenes.find(s=>s.id==="scene-2")?.sceneText!=="Отредактированный текст второй сцены.")throw new Error("Save All did not persist the edited scene text");

  if(errors.length)throw new Error(`Console/page errors during test: ${errors.join(" | ")}`);
  console.log("Scene surfaces visual system browser tests: OK");
}finally{await browser.close();server.kill()}
