import {createRequire} from "node:module";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});

const project={version:11,characters:[{id:"character-a",name:"Анна"}],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",photos:[],hidden:{},initialRelations:{}}},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],scenes:[{id:"scene-a",title:"Исходная сцена",date:"2026-01-01",time:"10:00",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],writingStatus:"draft",sceneText:"Текст",included:true,status:"fixed",people:{}}]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});

const activeInside=id=>page.evaluate(modalId=>document.getElementById(modalId).contains(document.activeElement),id);
const activeId=()=>page.evaluate(()=>document.activeElement?.id||document.activeElement?.getAttribute("data-action")||document.activeElement?.tagName);

const modalContract=await page.evaluate(()=>{
  const modals=[...document.querySelectorAll(".modal-backdrop")];
  const ids=[...document.querySelectorAll("[id]")].map(node=>node.id);
  return {
    invalid:modals.filter(modal=>!/[dialog|alertdialog]/.test(modal.getAttribute("role")||"")||modal.getAttribute("aria-modal")!=="true"||!document.getElementById(modal.getAttribute("aria-labelledby")||"")).map(modal=>modal.id),
    duplicateIds:[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))],
    hiddenActive:modals.filter(modal=>modal.style.display!=="flex"&&modal.getAttribute("aria-hidden")!=="true").map(modal=>modal.id)
  };
});
if(modalContract.invalid.length)throw new Error(`Нарушен ARIA-контракт: ${modalContract.invalid.join(", ")}`);
if(modalContract.duplicateIds.length)throw new Error(`Повторяются ID: ${modalContract.duplicateIds.join(", ")}`);
if(modalContract.hiddenActive.length)throw new Error(`Скрытые модали не исключены из accessibility tree: ${modalContract.hiddenActive.join(", ")}`);
const staticNames=await page.evaluate(()=>{
  const hasName=control=>!!(control.getAttribute("aria-label")||control.getAttribute("aria-labelledby")||control.labels?.length||control.title);
  const controls=[...document.querySelectorAll(".modal-backdrop input:not([type=hidden]),.modal-backdrop select,.modal-backdrop textarea")];
  const iconButtons=[...document.querySelectorAll("button")].filter(button=>/^[×↑↓←→‹›▸▾✓+＋\s]+$/.test(button.textContent.trim()));
  return {unnamed:controls.filter(control=>!hasName(control)).map(control=>control.id||control.className),unnamedIcons:iconButtons.filter(button=>!hasName(button)).map(button=>button.outerHTML.slice(0,100))};
});
if(staticNames.unnamed.length)throw new Error(`Нет accessible name у полей: ${staticNames.unnamed.join(", ")}`);
if(staticNames.unnamedIcons.length)throw new Error(`Нет accessible name у icon-only кнопок: ${staticNames.unnamedIcons.join(", ")}`);

await page.locator('[data-scene-id="scene-a"] button').filter({hasText:"Изменить"}).focus();
const opener=await activeId();
await page.keyboard.press("Enter");
if(!await activeInside("sceneModal"))throw new Error("Фокус не переведён в scene modal");
const first=await activeId();
const firstTabbable=await page.evaluate(()=>getFocusableElements(document.getElementById("sceneModal"))[0]?.id);
await page.locator("#saveScene").focus();await page.keyboard.press("Tab");
if(!await activeInside("sceneModal")||await activeId()!==firstTabbable)throw new Error("Tab не зациклен в scene modal");
await page.keyboard.press("Shift+Tab");
if(!await activeInside("sceneModal")||await activeId()!=="saveScene")throw new Error("Shift+Tab не зациклен в scene modal");
if(!await page.evaluate(()=>document.querySelector("header")?.inert===true&&document.querySelector(".app-shell")?.inert===true))throw new Error("Фон не стал inert");
await page.click("#cancelScene");
if(await activeId()!==opener)throw new Error("Фокус не вернулся к opener сцены");

await page.locator('[data-scene-id="scene-a"] button').filter({hasText:"Изменить"}).focus();await page.keyboard.press("Enter");
await page.fill("#sceneTitle","Черновик");await page.keyboard.press("Escape");
if(!await activeInside("discardChangesModal"))throw new Error("Фокус не перешёл в discard confirmation");
if(await activeId()!=="continueEditing")throw new Error("Discard confirmation не выбрал безопасное действие");
await page.locator("#discardChanges").focus();await page.keyboard.press("Tab");
if(await activeId()!=="continueEditing")throw new Error("Tab не зациклен в discard confirmation");
await page.keyboard.press("Escape");
if(!await activeInside("sceneModal"))throw new Error("Escape confirmation не вернул фокус в редактор");
await page.keyboard.press("Escape");await page.click("#discardChanges");
if(await activeId()!==opener)throw new Error("Discard не вернул фокус к opener сцены");

await page.click("#projectMenu > summary");await page.locator("#manageChars").focus();const charsOpener=await activeId();await page.keyboard.press("Enter");
const profileOpener=page.locator("#profilesGrid button").filter({hasText:"Открыть анкету"}).first();await profileOpener.focus();await page.keyboard.press("Enter");
if(!await activeInside("profileEditorModal"))throw new Error("Фокус не перешёл в редактор анкеты");
await page.click("#cancelProfile");if(!await activeInside("charsModal"))throw new Error("Закрытие анкеты не вернуло фокус в characters modal");
await page.click("#closeChars");if(await activeId()!=="SUMMARY")throw new Error("Закрытие characters modal не вернуло фокус к Navigation summary");

const modalReturnCases=[
  ["#manageChapters","chaptersModal","#closeChapters"],
  ["#manageLocations","locationsModal","#closeLocations"],
  ["#manageTags","tagsModal","#closeTags"],
  ["#openSortScenes","sortScenesModal","#closeSortScenes"]
];
for(const [openerSelector,modalId,closerSelector] of modalReturnCases){
  await page.evaluate(()=>document.getElementById("projectMenu").open=true);const openerElement=page.locator(openerSelector);await openerElement.focus();await page.keyboard.press("Enter");
  if(!await activeInside(modalId))throw new Error(`Фокус не вошёл в ${modalId}`);
  await page.click(closerSelector);const actual=await activeId();if(actual!=="SUMMARY")throw new Error(`Фокус не вернулся из ${modalId} к Navigation summary: ${actual}`);
}

await page.locator('[data-scene-id="scene-a"] button').filter({hasText:"Текст"}).focus();const textOpener=await activeId();await page.keyboard.press("Enter");
if(await activeId()!=="fullSceneText")throw new Error("Полный текст не получил initial focus");await page.click("#closeText");if(await activeId()!==textOpener)throw new Error("Полный текст не вернул focus");
await page.evaluate(()=>quickEditChapter("scene-a"));if(!await activeInside("quickFieldModal"))throw new Error("Quick field не получил focus");await page.click("#cancelQuickField");

const recoveryContext=await browser.newContext(),recoveryPage=await recoveryContext.newPage();
await recoveryPage.addInitScript(()=>{localStorage.setItem("novelTimelineV11","{broken");localStorage.setItem("novelTimelineV10",JSON.stringify({version:10,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],scenes:[]}))});
await recoveryPage.goto(`${base}?local=1`,{waitUntil:"networkidle"});await recoveryPage.waitForSelector("#recoveryModal",{state:"visible"});
if(!await recoveryPage.evaluate(()=>document.getElementById("recoveryModal").contains(document.activeElement)&&document.querySelector("header").inert))throw new Error("Recovery modal не управляет focus/background");
await recoveryContext.close();

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("accessibility browser integration tests: OK");
await browser.close();
