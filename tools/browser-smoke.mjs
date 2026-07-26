import {createRequire} from "node:module";
const require = createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium} = require("playwright");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
});
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

await page.goto("http://127.0.0.1:8000/",{waitUntil:"networkidle"});
await page.waitForSelector("#board");
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

await page.selectOption("#filterChapter","chapter-one");
await page.dispatchEvent("#filterChapter","change");
if(await page.inputValue("#filterChapter")!=="chapter-one") throw new Error("Быстрый выбор главы не сохранил выбранное значение");

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
await fallbackPage.goto("http://127.0.0.1:8000/",{waitUntil:"networkidle"});
const corruptFallback=await fallbackPage.evaluate(()=>{
  return {
    originalPreserved:localStorage.getItem("novelTimelineV11")==="{broken",
    writesDisabled:storageWriteEnabled===false,
    candidateSource:startupLoadInfo.candidates[0]?.key,
    banner:document.getElementById("storageBanner").textContent
  };
});
await fallbackContext.close();
if(!corruptFallback.originalPreserved || !corruptFallback.writesDisabled || corruptFallback.candidateSource!=="novelTimelineV10") throw new Error("Повреждённая V11 была перезаписана резервной базой");

const fatalContext=await browser.newContext();
const fatalPage=await fatalContext.newPage();
await fatalPage.addInitScript(()=>localStorage.setItem("novelTimelineV11","{broken"));
await fatalPage.goto("http://127.0.0.1:8000/",{waitUntil:"networkidle"});
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
await structurePage.goto("http://127.0.0.1:8000/",{waitUntil:"networkidle"});
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
await quotaPage.goto("http://127.0.0.1:8000/",{waitUntil:"networkidle"});
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

const result={
  title:await page.title(),
  migration,
  persisted,
  filtersOpened:await page.locator("#filterChapter option").count()>1,
  profileOpened:true,
  exportFile:download.suggestedFilename(),
  rejectedImportPreserved:true,
  importRoundTrip,
  corruptFallback,
  corruptProtected,
  invalidStructure,
  quotaRollback,
  errors
};
console.log(JSON.stringify(result,null,2));
await browser.close();
if(errors.length) process.exitCode=2;
