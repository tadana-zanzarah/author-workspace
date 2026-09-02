import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
let unexpectedDialogs=0;page.on("dialog",dialog=>{unexpectedDialogs++;dialog.dismiss()});

const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-two",title:"Глава 2",collapsed:false}],locations:[{id:"location-a",name:"Дом",description:""}],tags:[{id:"tag-a",name:"старый"}],future:{},scenes:[{id:"scene-a",title:"Исходная",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"location-a",tags:["tag-a"],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{}}]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
const visible=id=>page.locator(`#${id}`).isVisible();

/* ---------- Locations manager: staged create/save lifecycle ---------- */

await page.evaluate(()=>openLocationsManager());

// C: Save disabled while clean.
if(!await page.isDisabled("#saveLocations"))throw new Error("C: Save не отключён на чистой форме");

// A: new draft row starts empty with a placeholder, not a fake default value.
await page.click("#addLocation");
const firstDraftId=await page.locator(".location-name-input").last().getAttribute("data-draft-id");
const firstDraftInput=page.locator(`.location-name-input[data-draft-id="${firstDraftId}"]`);
if(await firstDraftInput.inputValue()!=="")throw new Error("A: новая локация не пустая");
if(await firstDraftInput.getAttribute("placeholder")!=="Название локации")throw new Error("A: нет плейсхолдера у новой локации");

// D: Save enabled once a meaningful change occurred (row added).
if(await page.isDisabled("#saveLocations"))throw new Error("D: Save не включился после добавления строки");

// B: typing into the first draft, then adding a second draft row, must not lose the first draft's text.
await firstDraftInput.fill("Кабинет");
await page.click("#addLocation");
if(await firstDraftInput.inputValue()!=="Кабинет")throw new Error("B: второй черновик стёр первый (Кабинет)");

// G: closing a dirty manager must not silently persist; discard confirmation is app-native.
await page.click("#closeLocations");
if(!await visible("discardChangesModal"))throw new Error("G: закрытие dirty-менеджера не показало подтверждение");
if(await page.evaluate(()=>data.locations.length)!==1)throw new Error("G: черновик локаций был сохранён без подтверждения Save");
await page.click("#discardChanges");
if(await visible("locationsModal"))throw new Error("G: discard не закрыл менеджер локаций");

// F: a failed Save preserves the draft and keeps the modal open with an app-native error.
await page.evaluate(()=>openLocationsManager());
await page.click("#addLocation");
const failDraftId=await page.locator(".location-name-input").last().getAttribute("data-draft-id");
await page.locator(`.location-name-input[data-draft-id="${failDraftId}"]`).fill("Гараж");
await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("quota","QuotaExceededError")};window.__restoreManagerStorage=()=>Storage.prototype.setItem=original});
await page.click("#saveLocations");
if(!await visible("locationsModal"))throw new Error("F: неудачное сохранение закрыло менеджер");
if(!await page.evaluate(()=>trackerFor("locationsModal").isDirty()))throw new Error("F: неудачное сохранение очистило dirty-состояние");
if(await page.locator(`.location-name-input[data-draft-id="${failDraftId}"]`).inputValue()!=="Гараж")throw new Error("F: неудачное сохранение потеряло введённое имя");
if(!(await page.textContent("#locationsSaveStatus"))?.trim())throw new Error("F: нет app-native сообщения об ошибке сохранения");
await page.evaluate(()=>__restoreManagerStorage());

// E: a successful Save returns the manager to a clean state with success feedback, and keeps it open.
await page.click("#saveLocations");
await page.waitForFunction(()=>!trackerFor("locationsModal").isDirty());
if(!await visible("locationsModal"))throw new Error("E: успешное сохранение закрыло менеджер, ожидалось usable modal");
if(await page.isDisabled("#saveLocations")!==true)throw new Error("E: Save не вернулся в disabled после успешного сохранения");
if(!(await page.textContent("#locationsSaveStatus"))?.includes("Локации сохранены"))throw new Error("E: нет success feedback после сохранения");
if(!await page.evaluate(()=>data.locations.some(l=>l.name==="Гараж")))throw new Error("E: новая локация не попала в data после сохранения");

// M: delete confirmation uses the app-native modal (no browser confirm) and preserves domain semantics (scene becomes unlocated).
await page.locator('.location-row:has([data-draft-id="location-a"]) button.danger').click();
if(!await visible("confirmActionModal"))throw new Error("M: удаление локации не показало app-native подтверждение");
if(!(await page.textContent("#confirmActionDescription"))?.includes("Дом"))throw new Error("M: подтверждение не называет удаляемую локацию");
await page.click("#confirmActionConfirm");
await page.click("#saveLocations");
await page.waitForFunction(()=>!trackerFor("locationsModal").isDirty());
if(await page.evaluate(()=>data.locations.some(l=>l.id==="location-a")))throw new Error("M: локация не была удалена после сохранения");
if(await page.evaluate(()=>data.scenes.find(s=>s.id==="scene-a").locationId)!=="")throw new Error("M: сцена не стала 'без локации' после удаления её локации");
await page.click("#closeLocations");

/* ---------- Tags manager: staged create, no browser prompt, canonicalization ---------- */

// H: no browser prompt on tag create; tag canonicalization/dedup (L) still applies.
await page.evaluate(()=>openTagsManager());
await page.click("#addTag");
const tagDraftIdOne=await page.locator(".tag-name-input").last().getAttribute("data-draft-id");
await page.locator(`.tag-name-input[data-draft-id="${tagDraftIdOne}"]`).fill("#Романтика");
await page.click("#addTag");
const tagDraftIdTwo=await page.locator(".tag-name-input").last().getAttribute("data-draft-id");
await page.locator(`.tag-name-input[data-draft-id="${tagDraftIdTwo}"]`).fill("романтика");
await page.click("#saveTags");
await page.waitForFunction(()=>!trackerFor("tagsModal").isDirty());
const romanceTags=await page.evaluate(()=>data.tags.filter(t=>t.name.toLocaleLowerCase("ru")==="романтика"));
if(romanceTags.length!==1)throw new Error(`L: canonicalization/dedup не сработала, найдено тегов: ${romanceTags.length}`);
if(unexpectedDialogs>0)throw new Error(`H: обнаружен браузерный диалог (${unexpectedDialogs}) при создании тега`);
await page.click("#closeTags");

/* ---------- Quick-create location from the Scene modal ---------- */

await page.evaluate(()=>editScene("scene-a"));
await page.fill("#sceneTitle","Черновик сцены для quick-create");
const quickOpener=page.locator("#quickAddLocation");
await quickOpener.click();
if(!await visible("quickLocationModal"))throw new Error("I: quick-create локации не открыла app-native модаль");
if(!await visible("sceneModal"))throw new Error("N: sceneModal был закрыт при открытии вложенной quick-create модали");
if(await page.isDisabled("#quickLocationCreate")!==true)throw new Error("Create должен быть отключён при пустом имени");
await page.fill("#quickLocationName","Чердак");
if(await page.isDisabled("#quickLocationCreate")!==false)throw new Error("Create не включился после ввода имени");

// K: repeated submit creates exactly one location (single-flight guard).
await page.evaluate(()=>{document.getElementById("quickLocationCreate").click();document.getElementById("quickLocationCreate").click()});
await page.waitForSelector("#quickLocationModal",{state:"hidden"});
const atticLocations=await page.evaluate(()=>data.locations.filter(l=>l.name==="Чердак"));
if(atticLocations.length!==1)throw new Error(`K: повторный submit создал ${atticLocations.length} локаций вместо одной`);

// J: created location is selected in the scene and the scene draft (title) survived.
if(await page.inputValue("#sceneLocation")!==atticLocations[0].id)throw new Error("J: новая локация не выбрана в сцене");
if(await page.inputValue("#sceneTitle")!=="Черновик сцены для quick-create")throw new Error("J: черновик сцены потерян после quick-create");

// N: focus returned to the opener and sceneModal keeps its own focus trap usable.
if(!await visible("sceneModal"))throw new Error("N: sceneModal не остался открытым после quick-create");
const focusedAfterQuickCreate=await page.evaluate(()=>document.activeElement?.id);
if(focusedAfterQuickCreate!=="quickAddLocation")throw new Error(`N: фокус не вернулся к opener quick-create (получено: ${focusedAfterQuickCreate})`);

if(unexpectedDialogs>0)throw new Error(`I: обнаружен браузерный диалог (${unexpectedDialogs}) при quick-create локации`);
await page.click("#cancelScene");
await page.click("#discardChanges");

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("manager save UX browser integration tests: OK");
await browser.close();
