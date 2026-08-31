import {createRequire} from "node:module";
const require = createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium} = require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
});

const freshContext = await browser.newContext();
const freshPage = await freshContext.newPage();
const freshErrors=[];
freshPage.on("pageerror",error=>freshErrors.push(error.message));
await freshPage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await freshPage.waitForSelector(".workspace-empty-state");
const freshProject=await freshPage.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
if(freshProject.characters.length||freshProject.scenes.length||freshProject.locations.length||freshProject.tags.length)throw new Error("Fresh install не пуст");
if(/Рене|Зейн|Реми|Арман/.test(JSON.stringify(freshProject)))throw new Error("Fresh install содержит персональные demo-данные");
await freshPage.locator(".workspace-empty-state button",{hasText:"Создать персонажа"}).click();
await freshPage.waitForSelector("#charsModal",{state:"visible"});
await freshPage.click("#addChar");
await freshPage.waitForSelector("#profileEditorModal",{state:"visible"});
await freshPage.fill("#pf_name","Первый персонаж");
await freshPage.click("#saveProfile");
await freshPage.click("#closeChars");
await freshPage.evaluate(()=>openChaptersManager());
await freshPage.click("#addChapter");
await freshPage.click("#saveChapters");
await freshPage.waitForFunction(()=>!trackerFor("chaptersModal").isDirty());
await freshPage.click("#closeChapters");
await freshPage.click("#addFirst");
await freshPage.fill("#sceneTitle","Первая сцена");
await freshPage.selectOption("#sceneChapter",{label:"Глава 1"});
await freshPage.selectOption("#sceneWritingStatus","draft");
await freshPage.click("#addSceneParticipant");
await freshPage.fill(".p-action","Участвует в первой сцене");
await freshPage.click("#saveScene");
const freshBeforeReload=await freshPage.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
if(freshBeforeReload.scenes[0].chapterId!==freshBeforeReload.chapters[1].id||freshBeforeReload.scenes[0].writingStatus!=="draft")throw new Error("Fresh create lost chapter or writing status before reload");
await freshPage.evaluate(id=>editScene(id),freshBeforeReload.scenes[0].id);
if(await freshPage.inputValue("#sceneChapter")!==freshBeforeReload.chapters[1].id||await freshPage.inputValue("#sceneWritingStatus")!=="draft")throw new Error("Scene re-edit did not preserve chapter/status");
await freshPage.click("#cancelScene");
await freshPage.reload({waitUntil:"networkidle"});
const freshPersisted=await freshPage.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
if(freshPersisted.characters[0]?.name!=="Первый персонаж"||freshPersisted.scenes[0]?.title!=="Первая сцена"||freshPersisted.chapters[1]?.title!=="Глава 1")throw new Error("Первые сущности не сохранились");
if(freshPersisted.scenes[0].chapterId!==freshPersisted.chapters[1].id||!freshPersisted.scenes[0].people[freshPersisted.characters[0].id])throw new Error("Глава или персонаж не назначены первой сцене");
if(freshPersisted.scenes[0].writingStatus!=="draft")throw new Error("Статус Черновик не сохранился после reload");
if(freshErrors.length)throw new Error(`Ошибки fresh UI: ${freshErrors.join(" | ")}`);
await freshContext.close();

const noCharacterContext=await browser.newContext();
const noCharacterPage=await noCharacterContext.newPage();
await noCharacterPage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await noCharacterPage.locator(".workspace-empty-state button",{hasText:"Создать сцену"}).click();
await noCharacterPage.fill("#sceneTitle","Сцена без персонажей");
await noCharacterPage.click("#saveScene");
const noCharacterProject=await noCharacterPage.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
if(noCharacterProject.characters.length!==0||noCharacterProject.scenes.length!==1)throw new Error("Сцену нельзя создать без персонажей");
await noCharacterContext.close();

const context = await browser.newContext({acceptDownloads:true});
const page = await context.newPage();
const errors = [];
page.on("pageerror",error=>errors.push(`pageerror: ${error.message}`));
page.on("console",message=>{ if(message.type()==="error") errors.push(`console: ${message.text()}`); });
page.on("requestfailed",request=>errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));

await page.addInitScript(()=>{
  if(sessionStorage.getItem("smoke-seeded"))return;
  sessionStorage.setItem("smoke-seeded","1");
  localStorage.removeItem("novelTimelineV11");
  localStorage.setItem("novelTimelineV10",JSON.stringify({
    version:10,
    characters:["Анна","Борис"],
    profiles:{Анна:{name:"Анна",initialRelations:{Борис:"друзья"}}},
    chapters:[
      {id:"chapter-unassigned",title:"Без главы",collapsed:false},
      {id:"chapter-one",title:"Глава 1",collapsed:false}
    ],
    locations:[{id:"location-home",name:"Дом"}],
    tags:[{id:"tag-test",name:"тест"}],
    scenes:[{
      date:"2026-07-01",time:"10:00",title:"Исходная сцена",chapterId:"chapter-one",
      locationId:"location-home",tags:["tag-test"],writingStatus:"draft",sceneText:"Первый текст",
      included:true,status:"fixed",people:{Анна:{action:"Входит",relationChanges:{Борис:"доверяет"},visibleRelations:["Борис"]}}
    }]
  }));
});

await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await page.waitForSelector("#board");
if(await page.locator("#recoveryModal").isVisible()){
  await page.locator('input[name="recoveryCandidate"]').first().check();
  page.once("dialog",dialog=>dialog.accept());
  await page.click("#applyRecovery");
  await page.waitForSelector("#recoveryModal",{state:"hidden"});
}
const migration = await page.evaluate(()=>{
  const data=JSON.parse(localStorage.getItem("novelTimelineV11"));
  const scene=data.scenes[0];
  return {
    version:data.version,
    sceneHasId:!!scene.id,
    characterIds:data.characters.map(c=>c.id),
    peopleKeys:Object.keys(scene.people),
    profileKeys:Object.keys(data.profiles)
  };
});
if(migration.version!==11 || !migration.sceneHasId) throw new Error("Миграция V10→V11 не завершилась");
if(!migration.peopleKeys.every(id=>migration.characterIds.includes(id))) throw new Error("Люди сцены не переведены на characterId");

await page.click("#addFirst");
await page.fill("#sceneTitle","Новая тестовая сцена");
await page.fill("#sceneDate","2026-07-02");
await page.selectOption("#sceneChapter","chapter-one");
await page.fill("#sceneText","Тестовый текст сцены");
await page.click("#saveScene");
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("novelTimelineV11")).scenes.some(s=>s.title==="Новая тестовая сцена"));

const newSceneId = await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")).scenes.find(s=>s.title==="Новая тестовая сцена").id);
await page.evaluate(id=>editScene(id),newSceneId);
await page.fill("#sceneTitle","Сцена после редактирования");
await page.click("#saveScene");
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("novelTimelineV11")).scenes.some(s=>s.title==="Сцена после редактирования"));

await page.click("#filterChapter");
await page.waitForSelector("#filterChapterPopover:not([hidden])");
await page.click('#filterChapterList [role="option"][data-value="chapter-one"]');
if(await page.evaluate(()=>filters.chapter)!=="chapter-one") throw new Error("Быстрый выбор главы не сохранил выбранное значение");
await page.click("#clearFilters");

const dndResult=await page.evaluate(()=>{
  commitDataChange(next=>{
    while(next.scenes.length<32){const n=next.scenes.length+1;next.scenes.push({id:`long-scene-${n}`,title:`Long ${n}`,date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}})}
  });
  const viewport=document.querySelector(".workspace-viewport");viewport.scrollTop=0;
  const first=data.scenes[0],handle=document.querySelector(`[data-scene-id="${first.id}"] .drag-handle`);
  dragStart({currentTarget:handle,preventDefault(){},dataTransfer:{effectAllowed:"",setData(){}}},first.id);
  const rect=viewport.getBoundingClientRect();
  for(let i=0;i<20;i++)autoscrollSceneViewport(rect.bottom-2);
  const down=viewport.scrollTop;
  viewport.scrollTop=viewport.scrollHeight;
  for(let i=0;i<20;i++)autoscrollSceneViewport(rect.top+2);
  const up=viewport.scrollTop<viewport.scrollHeight-viewport.clientHeight;
  const target=data.scenes[data.scenes.length-1],row=document.querySelector(`[data-scene-id="${target.id}"]`);
  dropScene({preventDefault(){},currentTarget:row,clientY:row.getBoundingClientRect().bottom},target.id);
  const persisted=JSON.parse(localStorage.getItem("novelTimelineV11"));
  return {down,up,last:data.scenes.at(-1)?.id,persistedLast:persisted.scenes.at(-1)?.id,controlsDraggable:[...document.querySelectorAll(".scene-row input,.scene-row button")].some(node=>node.draggable)};
});
if(dndResult.down<=0||!dndResult.up)throw new Error(`Timeline edge autoscroll failed: ${JSON.stringify(dndResult)}`);
if(dndResult.last!==dndResult.persistedLast||dndResult.controlsDraggable)throw new Error(`Timeline DnD persistence/controls failed: ${JSON.stringify(dndResult)}`);

await page.click("#projectMenu > summary");
await page.click("#openSortScenes");
const rows=page.locator("[data-sort-scene-id]");
if(await rows.count()>=2) await rows.nth(1).dragTo(rows.nth(0));
await page.click("#closeSortScenes");

await page.reload({waitUntil:"networkidle"});
const persisted = await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")).scenes.some(s=>s.title==="Сцена после редактирования"));
if(!persisted) throw new Error("Сцена не сохранилась после перезагрузки");

await page.click("#projectMenu > summary");
await page.click("#manageChars");
await page.waitForSelector("#charsModal",{state:"visible"});
await page.locator("#profilesGrid button").filter({hasText:"Открыть анкету"}).first().click();
await page.waitForSelector("#profileEditorModal",{state:"visible"});
await page.click("#cancelProfile");
await page.click("#closeChars");

const downloadPromise=page.waitForEvent("download");
await page.click("#projectMenu > summary");
await page.click("#exportBtn");
const download=await downloadPromise;
if(!download.suggestedFilename().endsWith(".json")) throw new Error("Экспорт не создал JSON");

const beforeRejectedImport=await page.evaluate(()=>localStorage.getItem("novelTimelineV11"));
await page.setInputFiles("#importInput",{name:"invalid.json",mimeType:"application/json",buffer:Buffer.from("{}")});
await page.waitForTimeout(50);
if(await page.evaluate(()=>localStorage.getItem("novelTimelineV11"))!==beforeRejectedImport)throw new Error("Критический импорт заменил текущий проект");

const successfulImport=JSON.parse(beforeRejectedImport);
successfulImport.extraRoundTrip={preserved:true};
successfulImport.scenes[0].extraSceneField="keep";
page.once("dialog",dialog=>dialog.accept());
await page.setInputFiles("#importInput",{name:"valid.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(successfulImport))});
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("novelTimelineV11")).extraRoundTrip?.preserved===true);
const importRoundTrip=await page.evaluate(()=>{
  const saved=JSON.parse(localStorage.getItem("novelTimelineV11"));
  return {root:saved.extraRoundTrip?.preserved,scene:saved.scenes[0]?.extraSceneField};
});
if(!importRoundTrip.root||importRoundTrip.scene!=="keep")throw new Error("Импорт не сохранил неизвестные поля");

const fallbackContext=await browser.newContext();
const fallbackPage=await fallbackContext.newPage();
await fallbackPage.addInitScript(()=>{
  localStorage.setItem("novelTimelineV11","{broken");
  localStorage.setItem("novelTimelineV10",JSON.stringify({
    version:10,characters:["Миграция"],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"}],
    locations:[],tags:[],scenes:[{title:"Восстановленная сцена",people:{Миграция:{action:"Есть"}}}]
  }));
});
await fallbackPage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await fallbackPage.waitForSelector("#recoveryModal",{state:"visible"});
const corruptFallback=await fallbackPage.evaluate(()=>{
  return {
    originalPreserved:localStorage.getItem("novelTimelineV11")==="{broken",
    writesDisabled:storageWriteEnabled===false,
    candidateSource:startupLoadInfo.candidates[0]?.key,
    banner:document.getElementById("storageBanner").textContent
  };
});
await fallbackPage.locator('input[name="recoveryCandidate"]').check();
await fallbackPage.evaluate(()=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(key==="novelTimelineV11")throw new DOMException("quota","QuotaExceededError");return original.call(this,key,value)};
  globalThis.__restoreSetItem=()=>{Storage.prototype.setItem=original};
});
fallbackPage.once("dialog",dialog=>dialog.accept());
await fallbackPage.click("#applyRecovery");
const recoveryFailure=await fallbackPage.evaluate(()=>(
  {primary:localStorage.getItem("novelTimelineV11"),modalOpen:document.getElementById("recoveryModal").style.display==="flex",memoryBlocked:data.readOnlyRecovery===true,banner:document.getElementById("storageBanner").textContent,backupKeys:Object.keys(localStorage).filter(key=>key.startsWith("novelTimelineV11-recovery-backup-")).length}
));
await fallbackPage.evaluate(()=>globalThis.__restoreSetItem());
if(recoveryFailure.primary!=="{broken"||!recoveryFailure.modalOpen||!recoveryFailure.memoryBlocked||recoveryFailure.backupKeys<1||!/не удалось сохранить/i.test(recoveryFailure.banner))throw new Error("Ошибка восстановления создала ложное успешное состояние");
fallbackPage.once("dialog",dialog=>dialog.accept());
await fallbackPage.click("#applyRecovery");
await fallbackPage.waitForSelector("#recoveryModal",{state:"hidden"});
const recoverySuccess=await fallbackPage.evaluate(()=>(
  {version:JSON.parse(localStorage.getItem("novelTimelineV11")).version,writesEnabled:storageWriteEnabled,backupKeys:Object.keys(localStorage).filter(key=>key.startsWith("novelTimelineV11-recovery-backup-")).length}
));
await fallbackContext.close();
if(!corruptFallback.originalPreserved || !corruptFallback.writesDisabled || corruptFallback.candidateSource!=="novelTimelineV10") throw new Error("Повреждённая V11 была перезаписана резервной базой");
if(recoverySuccess.version!==11||!recoverySuccess.writesEnabled||recoverySuccess.backupKeys<1)throw new Error("Успешное восстановление не завершилось безопасно");

const fatalContext=await browser.newContext();
const fatalPage=await fatalContext.newPage();
await fatalPage.addInitScript(()=>localStorage.setItem("novelTimelineV11","{broken"));
await fatalPage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
const corruptProtected=await fatalPage.evaluate(()=>({
  originalPreserved:localStorage.getItem("novelTimelineV11")==="{broken",
  writesDisabled:storageWriteEnabled===false,
  banner:document.getElementById("storageBanner").textContent
}));
await fatalContext.close();
if(!corruptProtected.originalPreserved || !corruptProtected.writesDisabled) throw new Error("Повреждённые данные были перезаписаны");

const structureContext=await browser.newContext();
const structurePage=await structureContext.newPage();
await structurePage.addInitScript(()=>localStorage.setItem("novelTimelineV11","{}"));
await structurePage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
const invalidStructure=await structurePage.evaluate(()=>({
  originalPreserved:localStorage.getItem("novelTimelineV11")==="{}",
  writesDisabled:storageWriteEnabled===false,
  recoveryDownloadVisible:!document.getElementById("downloadProblemRaw").hidden
}));
await structureContext.close();
if(!invalidStructure.originalPreserved||!invalidStructure.writesDisabled||!invalidStructure.recoveryDownloadVisible)throw new Error("{} не был безопасно заблокирован");

const quotaContext=await browser.newContext();
const quotaPage=await quotaContext.newPage();
await quotaPage.addInitScript(project=>localStorage.setItem("novelTimelineV11",JSON.stringify(project)),{
  version:11,characters:[{id:"character-a",name:"А"}],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"А",initialRelations:{}}},
  chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]
});
await quotaPage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await quotaPage.click("#addFirst");
await quotaPage.fill("#sceneTitle","Не должна сохраниться");
await quotaPage.evaluate(()=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(){const error=new DOMException("quota","QuotaExceededError");throw error};
  globalThis.__restoreSetItem=()=>{Storage.prototype.setItem=original};
});
await quotaPage.click("#saveScene");
const quotaRollback=await quotaPage.evaluate(()=>({
  memoryScenes:data.scenes.length,
  modalOpen:document.getElementById("sceneModal").style.display==="flex",
  storedScenes:JSON.parse(localStorage.getItem("novelTimelineV11")).scenes.length
}));
await quotaPage.evaluate(()=>globalThis.__restoreSetItem());
await quotaContext.close();
if(quotaRollback.memoryScenes!==0||quotaRollback.storedScenes!==0||!quotaRollback.modalOpen)throw new Error("Ошибка квоты не откатила создание сцены");

const failureContext=await browser.newContext();
const failurePage=await failureContext.newPage();
await failurePage.addInitScript(()=>localStorage.setItem("novelTimelineV11",JSON.stringify({version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"},{id:"chapter-two",title:"Глава 2"}],locations:[],tags:[],future:{},scenes:[{id:"scene-a",title:"A",date:"2026-01-01",time:"10:00",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],people:{}},{id:"scene-b",title:"B",date:"2026-01-02",time:"10:00",dateReview:true,chapterId:"chapter-two",locationId:"",tags:[],people:{}}]})));
await failurePage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
const beforeFailures=await failurePage.evaluate(()=>localStorage.getItem("novelTimelineV11"));
await failurePage.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("quota","QuotaExceededError")};globalThis.__restoreSetItem=()=>Storage.prototype.setItem=original});
const dateFailure=await failurePage.evaluate(()=>{quickUpdate("scene-a","date","2026-01-03");return {memory:data.scenes[0].date,stored:JSON.parse(localStorage.getItem("novelTimelineV11")).scenes[0].date,banner:document.getElementById("storageBanner").textContent}});
const confirmFailure=await failurePage.evaluate(()=>{confirmSceneDate("scene-b");return {review:data.scenes[1].dateReview,stored:JSON.parse(localStorage.getItem("novelTimelineV11")).scenes[1].dateReview}});
const chapterFailure=await failurePage.evaluate(()=>{quickFieldState={sceneId:"scene-a",field:"chapterId"};document.getElementById("quickFieldSelect").innerHTML='<option value="chapter-two">Глава 2</option>';document.getElementById("quickFieldSelect").value="chapter-two";document.getElementById("saveQuickField").click();return {chapter:data.scenes[0].chapterId,modalState:quickFieldState!==null}});
const dragFailure=await failurePage.evaluate(()=>{draggedSceneId="scene-a";const row=document.querySelector('[data-scene-id="scene-b"]');dropScene({preventDefault(){},currentTarget:row,clientY:0},"scene-b");return {order:data.scenes.map(s=>s.id),review:data.scenes[0].dateReview}});
await failurePage.evaluate(()=>globalThis.__restoreSetItem());
if(dateFailure.memory!=="2026-01-01"||dateFailure.stored!=="2026-01-01"||!/не сохранено/i.test(dateFailure.banner))throw new Error("Ошибка записи даты не откатилась");
if(confirmFailure.review!==true||confirmFailure.stored!==true)throw new Error("Ошибка подтверждения даты не откатилась");
if(chapterFailure.chapter!=="chapter-unassigned"||!chapterFailure.modalState)throw new Error("Ошибка смены главы закрыла редактор или изменила состояние");
if(dragFailure.order.join(",")!=="scene-a,scene-b"||dragFailure.review!==false)throw new Error("Ошибка drag-and-drop изменила активное состояние");
if(await failurePage.evaluate(()=>localStorage.getItem("novelTimelineV11"))!==beforeFailures)throw new Error("Failure-path изменил localStorage");
await failureContext.close();

const duplicateContext=await browser.newContext();
const duplicatePage=await duplicateContext.newPage();
await duplicatePage.addInitScript(()=>{localStorage.setItem("novelTimelineV11","{broken");localStorage.setItem("novelTimelineV10",JSON.stringify({version:10,characters:[{name:"Алекс",surname:"Первый"},{name:"Алекс",surname:"Второй"}],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[{title:"Выбор",chapterId:"chapter-unassigned",people:{Алекс:{action:"есть",relationChanges:{},visibleRelations:[]}}}]}))});
await duplicatePage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await duplicatePage.locator('input[name="recoveryCandidate"]').check();
const unresolvedBlocked=await duplicatePage.locator("#applyRecovery").isDisabled();
await duplicatePage.locator("[data-recovery-path]").selectOption({index:2});
const manualReady=!(await duplicatePage.locator("#applyRecovery").isDisabled());
await duplicatePage.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==="novelTimelineV11")throw new DOMException("quota","QuotaExceededError");return original.call(this,key,value)};globalThis.__restoreSetItem=()=>Storage.prototype.setItem=original});
duplicatePage.once("dialog",dialog=>dialog.accept());await duplicatePage.click("#applyRecovery");
const manualFailure=await duplicatePage.evaluate(()=>({primary:localStorage.getItem("novelTimelineV11"),blocked:data.readOnlyRecovery===true,modalOpen:document.getElementById("recoveryModal").style.display==="flex",message:document.getElementById("storageBanner").textContent}));
await duplicatePage.evaluate(()=>globalThis.__restoreSetItem());
duplicatePage.once("dialog",dialog=>dialog.accept());await duplicatePage.click("#applyRecovery");
const manualResolved=await duplicatePage.evaluate(()=>{const saved=JSON.parse(localStorage.getItem("novelTimelineV11"));return {people:Object.keys(saved.scenes[0].people),characters:saved.characters.map(c=>({id:c.id,surname:c.surname}))}});
await duplicateContext.close();
if(!unresolvedBlocked||!manualReady||manualFailure.primary!=="{broken"||!manualFailure.blocked||!manualFailure.modalOpen||manualResolved.people[0]!==manualResolved.characters[1].id)throw new Error("Ручное разрешение одинаковых имён не сработало безопасно");

const result={
  title:await page.title(),
  migration,
  persisted,
  filtersOpened:await (async()=>{
    await page.click("#filterChapter");
    await page.waitForSelector("#filterChapterPopover:not([hidden])");
    const count=await page.locator('#filterChapterList [role="option"]').count();
    await page.keyboard.press("Escape");
    return count>1;
  })(),
  profileOpened:true,
  exportFile:download.suggestedFilename(),
  rejectedImportPreserved:true,
  importRoundTrip,
  corruptFallback,
  recoveryFailure,
  recoverySuccess,
  corruptProtected,
  invalidStructure,
  quotaRollback,
  failurePaths:{dateFailure,confirmFailure,chapterFailure,dragFailure},
  manualMigration:{unresolvedBlocked,manualReady,manualFailure,manualResolved},
  errors
};
console.log(JSON.stringify(result,null,2));
await browser.close();
if(errors.length) process.exitCode=2;
