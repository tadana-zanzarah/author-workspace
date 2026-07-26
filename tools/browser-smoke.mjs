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
  const restored=JSON.parse(localStorage.getItem("novelTimelineV11"));
  return {version:restored.version,title:restored.scenes[0]?.title,banner:document.getElementById("storageBanner").textContent};
});
await fallbackContext.close();
if(corruptFallback.version!==11 || corruptFallback.title!=="Восстановленная сцена") throw new Error("Резервная V10 не восстановила повреждённую V11");

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

const result={
  title:await page.title(),
  migration,
  persisted,
  filtersOpened:await page.locator("#filterChapter option").count()>1,
  profileOpened:true,
  exportFile:download.suggestedFilename(),
  corruptFallback,
  corruptProtected,
  errors
};
console.log(JSON.stringify(result,null,2));
await browser.close();
if(errors.length) process.exitCode=2;
