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

/* ---------- Location Gallery + Profile: create/edit/save/delete lifecycle ---------- */

await page.evaluate(()=>openLocationGallery());

// A: create modal starts empty with a placeholder; Submit disabled until a name is entered.
await page.click("#addLocation");
if(!await visible("createLocationModal"))throw new Error("A: создание локации не открыло app-native модаль");
if(await page.inputValue("#createLocationName")!=="")throw new Error("A: поле названия новой локации не пустое");
if(await page.getAttribute("#createLocationName","placeholder")!=="Название локации")throw new Error("A: нет плейсхолдера у новой локации");
if(await page.isDisabled("#createLocationSubmit")!==true)throw new Error("A: Создать не отключён при пустом имени");

// D: Submit enabled once a meaningful change occurred (name entered).
await page.fill("#createLocationName","Кабинет");
if(await page.isDisabled("#createLocationSubmit")!==false)throw new Error("D: Создать не включился после ввода имени");
await page.click("#createLocationSubmit");
await page.waitForSelector("#createLocationModal",{state:"hidden"});
if(!await page.evaluate(()=>data.locations.some(l=>l.name==="Кабинет")))throw new Error("новая локация не попала в data после создания");
// successful create opens the new Location's Profile directly, in READ mode (not an edit form).
if(!await visible("locationProfileModal"))throw new Error("создание локации не открыло её профиль");
if(await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden)!==true)throw new Error("Profile новой локации открылся не в read mode");
if(await page.textContent("#locationProfileTitle")!=="Кабинет")throw new Error("профиль новой локации не показывает её название");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// C: Save disabled on a freshly-entered, unedited Edit mode.
await page.evaluate(()=>openLocationProfile("location-a"));
if(await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden)!==true)throw new Error("Profile не открылся в read mode");
if(await page.locator("#locProfileName").isVisible())throw new Error("read mode показывает постоянно видимый input названия");
if(await page.locator("#locationProfileSave").isVisible())throw new Error("read mode показывает постоянно видимую кнопку Save");
await page.click("#locationProfileEdit");
if(await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden)!==false)throw new Error("«Редактировать» не переключил профиль в edit mode");
if(!await page.isDisabled("#locationProfileSave"))throw new Error("C: Save не отключён на чистом профиле");

// G: leaving a dirty edit (Cancel) must not silently persist; discard confirmation is app-native,
// and it returns to READ mode rather than closing the whole Profile.
await page.fill("#locProfileName","Гостиная");
if(await page.isDisabled("#locationProfileSave"))throw new Error("правка названия не включила Save");
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
if(!await visible("discardChangesModal"))throw new Error("G: отмена dirty-редактирования не показала подтверждение");
if(await page.evaluate(()=>locationById("location-a").name)!=="Дом")throw new Error("G: черновик локации был сохранён без подтверждения Save");
await page.click("#discardChanges");
if(!await visible("locationProfileModal"))throw new Error("G: discard закрыл весь профиль локации вместо возврата в read mode");
if(await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden)!==true)throw new Error("G: discard не вернул профиль локации в read mode");

// F: a failed Save preserves the draft and keeps edit mode open with an app-native error.
await page.click("#locationProfileEdit");
await page.fill("#locProfileName","Гараж");
await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("quota","QuotaExceededError")};window.__restoreManagerStorage=()=>Storage.prototype.setItem=original});
await page.click("#locationProfileSave");
if(!await visible("locationProfileModal"))throw new Error("F: неудачное сохранение закрыло профиль");
if(await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden)!==false)throw new Error("F: неудачное сохранение вышло из edit mode");
if(!await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()))throw new Error("F: неудачное сохранение очистило dirty-состояние");
if(await page.inputValue("#locProfileName")!=="Гараж")throw new Error("F: неудачное сохранение потеряло введённое имя");
if(!(await page.textContent("#locationProfileStatus"))?.trim())throw new Error("F: нет app-native сообщения об ошибке сохранения");
await page.evaluate(()=>__restoreManagerStorage());

// E: a successful Save shows success feedback, then returns to READ mode with refreshed data.
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileStatus")?.textContent?.includes("Локация сохранена"));
if(!await visible("locationProfileModal"))throw new Error("E: успешное сохранение закрыло весь профиль, ожидался usable modal");
await page.waitForFunction(()=>!trackerFor("locationProfileModal").isDirty());
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true);
if(await page.evaluate(()=>locationById("location-a").name)!=="Гараж")throw new Error("E: переименование не попало в data после сохранения");
if(await page.textContent("#locationProfileTitle")!=="Гараж")throw new Error("E: read mode не показывает обновлённое название после сохранения");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// M: delete confirmation uses the app-native modal (no browser confirm) and preserves domain semantics (scene becomes unlocated).
await page.locator('.location-card[data-location-id="location-a"] button.danger-quiet').click();
if(!await visible("confirmActionModal"))throw new Error("M: удаление локации не показало app-native подтверждение");
if(!(await page.textContent("#confirmActionDescription"))?.includes("Гараж"))throw new Error("M: подтверждение не называет удаляемую локацию");
await page.click("#confirmActionConfirm");
await page.waitForFunction(()=>!data.locations.some(l=>l.id==="location-a"));
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
