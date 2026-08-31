import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
const project={version:11,characters:[{id:"char-zayn",name:"Зейн"},{id:"char-mira",name:"Мира"}],profiles:{},
  chapters:[
    {id:"chapter-unassigned",title:"Без главы",collapsed:false},
    {id:"chapter-two",title:"Глава два",collapsed:false},
    {id:"chapter-empty",title:"Пустая глава",collapsed:false}
  ],locations:[],tags:[],future:{},
  scenes:[
    // Зейн добавлен как участник через новый селектор без текста действия — именно так
    // родился баг: раньше такой участник пропадал из поиска/фильтров/сохранения.
    {id:"scene-1",title:"Утро",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],writingStatus:"idea",sceneText:"Обычное утро",included:true,status:"floating",people:{"char-zayn":emptyPerson()}},
    {id:"scene-2",title:"Вечер",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],writingStatus:"idea",sceneText:"Сегодня очень скучно",included:true,status:"floating",people:{}},
    {id:"scene-3",title:"Ночь",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"draft",sceneText:"Тихая ночь",included:true,status:"floating",people:{"char-mira":{action:"спит",legacyState:"",relationChanges:{},visibleRelations:[]}}},
    {id:"scene-4",title:"Рассвет",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{"char-mira":{action:"смотрит в окно",legacyState:"",relationChanges:{},visibleRelations:[]}}}
  ]};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("scene-search-filter-seeded"))return;sessionStorage.setItem("scene-search-filter-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  const visibleTitles=async()=>page.evaluate(()=>getVisibleSceneEntries().map(({scene})=>scene.title));
  const search=async text=>{await page.fill("#projectSearch",text);await page.waitForTimeout(250)};
  const clearFilters=async()=>{await page.click("#clearFilters");await page.waitForTimeout(150)};

  // 1) Text search on scene body text.
  await search("скучно");
  let titles=await visibleTitles();
  if(titles.join(",")!=="Вечер")throw new Error(`Scene-text search matched the wrong set: ${titles.join(",")}`);

  // Title search.
  await search("Рассвет");
  titles=await visibleTitles();
  if(titles.join(",")!=="Рассвет")throw new Error(`Scene-title search matched the wrong set: ${titles.join(",")}`);

  // 2) Character participant search — including a participant with NO narrative content yet.
  // This is the exact real-world bug: a participant added via the scene modal's selector but
  // never given action text used to be silently invisible to search and to save().
  await search("Зейн");
  titles=await visibleTitles();
  if(titles.join(",")!=="Утро")throw new Error(`Participant-name search should find only the scene with Зейн, got: ${titles.join(",")}`);
  const persistedZaynScene=await page.evaluate(()=>data.scenes.find(s=>s.id==="scene-1").people["char-zayn"]);
  if(!persistedZaynScene)throw new Error("Content-less participant must remain persisted in scene.people");

  // Character filter dropdown must agree with the search box (same underlying membership rule).
  await search("");
  await page.click("#filterCharacter");
  await page.waitForSelector("#filterCharacterPopover:not([hidden])");
  await page.click('#filterCharacterList [role="option"][data-value="char-zayn"]');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  titles=await visibleTitles();
  if(titles.join(",")!=="Утро")throw new Error(`Character filter dropdown disagrees with search semantics: ${titles.join(",")}`);
  const sidebarZaynCount=await page.evaluate(()=>document.querySelector('#sideCharacters button[onclick*="char-zayn"] .sidebar-count').textContent.trim());
  if(sidebarZaynCount!=="1")throw new Error(`Sidebar participant count should reflect real membership (1), got ${sidebarZaynCount}`);
  await page.click("#clearFilters");

  // 3) Matched scenes stay, non-matched are hidden — verified positively (Мира scenes hidden while Зейн active).
  await search("Зейн");
  titles=await visibleTitles();
  if(titles.includes("Ночь")||titles.includes("Рассвет"))throw new Error("Non-matching scenes leaked into the visible set");

  // 4) Zero-result search shows a filtered-empty message, not the true empty-project state.
  await search("нет-такого-текста-нигде");
  titles=await visibleTitles();
  if(titles.length!==0)throw new Error("Expected zero matches for a nonsense query");
  const summaryZero=await page.evaluate(()=>({hidden:document.getElementById("filterSummary").hidden,text:document.getElementById("filterSummary").textContent,noResults:document.getElementById("filterSummary").classList.contains("no-results")}));
  if(summaryZero.hidden||!summaryZero.noResults||!summaryZero.text.includes("ничего не найдено"))throw new Error(`Filter summary did not report zero results: ${JSON.stringify(summaryZero)}`);
  await page.click('[data-view="cards"]');
  const cardsEmptyText=await page.evaluate(()=>document.getElementById("board").textContent);
  if(!cardsEmptyText.includes("Ничего не найдено")||cardsEmptyText.includes("Сцен пока нет"))throw new Error(`Cards view should show the filtered-empty message, not the true empty-project state: ${cardsEmptyText}`);

  // Result-count indicator when there ARE matches (bug #2: user must see how many scenes matched).
  await search("Зейн");
  const summaryFound=await page.evaluate(()=>document.getElementById("filterSummary").textContent);
  if(!/Найдено сцен:\s*1\s*из\s*4/.test(summaryFound))throw new Error(`Filter summary should report "1 из 4": ${summaryFound}`);

  // 5) A chapter that HAS scenes, all hidden by the active filter, must not show the true
  //    "Сцен пока нет" empty-state/drop-target (this was the exact reported bug #4).
  await page.click('[data-view="list"]');
  await page.waitForSelector(".compact-chapter-group");
  const chapterTwoTail=await page.evaluate(()=>{
    const group=document.querySelector('.compact-chapter-group[data-chapter-id="chapter-two"]');
    const rows=[...group.querySelectorAll("tr.compact-drop-position")];
    const tail=rows.at(-1);
    return {isTrueEmpty:tail.classList.contains("compact-empty-drop"),isFilteredEmpty:tail.classList.contains("compact-filtered-empty"),text:tail.textContent};
  });
  if(chapterTwoTail.isTrueEmpty)throw new Error("Chapter with real (filtered-out) scenes must not render the true empty-state row");
  if(!chapterTwoTail.isFilteredEmpty||chapterTwoTail.text.includes("Сцен пока нет"))throw new Error(`Filtered-out chapter should show a distinct filtered-empty row: ${JSON.stringify(chapterTwoTail)}`);

  // 6) A genuinely empty chapter (zero scenes at all) keeps the real empty-state even while filters are active.
  const emptyChapterTail=await page.evaluate(()=>{
    const group=document.querySelector('.compact-chapter-group[data-chapter-id="chapter-empty"]');
    const rows=[...group.querySelectorAll("tr.compact-drop-position")];
    const tail=rows.at(-1);
    return {isTrueEmpty:tail.classList.contains("compact-empty-drop"),text:tail.textContent};
  });
  if(!emptyChapterTail.isTrueEmpty||!emptyChapterTail.text.includes("Сцен пока нет"))throw new Error(`Genuinely empty chapter lost its true empty-state while filtered: ${JSON.stringify(emptyChapterTail)}`);

  // 7) DnD is disabled while a filter/search is active, with an app-native (non-alert) explanation,
  //    and is re-enabled once filters are cleared.
  const dndWhileFiltered=await page.evaluate(()=>{
    const handle=document.querySelector(".compact-drag-handle");
    return {disabled:handle.disabled,title:handle.title,noticeVisible:document.querySelector(".compact-dnd-notice")?.offsetParent!==null};
  });
  if(!dndWhileFiltered.disabled||!dndWhileFiltered.title||!dndWhileFiltered.noticeVisible)throw new Error(`DnD should be disabled with a visible explanation while filtered: ${JSON.stringify(dndWhileFiltered)}`);
  await page.evaluate(()=>{window.alert=()=>{throw new Error("window.alert() must never be used to explain disabled DnD")}});
  await clearFilters();
  const dndAfterClear=await page.evaluate(()=>{
    const handle=document.querySelector(".compact-drag-handle");
    return {disabled:handle.disabled,searchValue:document.getElementById("projectSearch").value,characterValue:filters.character.length};
  });
  if(dndAfterClear.disabled||dndAfterClear.searchValue!==""||dndAfterClear.characterValue!==0)throw new Error(`Clearing filters (Сбросить) should restore DnD and reset all fields: ${JSON.stringify(dndAfterClear)}`);

  // 8) Combination of existing filters must still AND together correctly.
  const chooseFilter=async(suffix,value)=>{
    await page.click(`#filter${suffix}`);
    await page.waitForSelector(`#filter${suffix}Popover:not([hidden])`);
    await page.click(`#filter${suffix}List [role="option"][data-value="${value}"]`);
  };
  await chooseFilter("Chapter","chapter-two");
  await chooseFilter("Writing","draft");
  await page.waitForTimeout(150);
  titles=await visibleTitles();
  if(titles.join(",")!=="Ночь")throw new Error(`Chapter+writing-status combination filter regressed: ${titles.join(",")}`);
  await clearFilters();

  console.log("Scene search/filter (local mode) browser tests passed");
}finally{await browser.close();server.kill()}
