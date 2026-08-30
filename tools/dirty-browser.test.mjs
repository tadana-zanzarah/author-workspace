import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
const project={version:11,characters:[{id:"character-a",name:"Анна"}],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",photos:[],hidden:{},initialRelations:{}}},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-two",title:"Глава 2",collapsed:false}],locations:[{id:"location-a",name:"Дом",description:""},{id:"location-b",name:"Парк",description:""}],tags:[{id:"tag-a",name:"тест"},{id:"tag-b",name:"другой"}],future:{},scenes:[{id:"scene-a",title:"Исходная",date:"2026-01-01",time:"10:00",dateReview:false,chapterId:"chapter-unassigned",locationId:"location-a",tags:["tag-a"],writingStatus:"draft",sceneText:"Сохранённый текст",included:true,status:"fixed",people:{"character-a":{action:"Входит",relationChanges:{},visibleRelations:[]}}},{id:"scene-b",title:"Вторая",date:"",time:"",dateReview:false,chapterId:"chapter-two",locationId:"",tags:[],writingStatus:"idea",sceneText:"Второй текст",included:true,status:"floating",people:{}}]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
const visible=id=>page.locator(`#${id}`).isVisible();

await page.evaluate(()=>editScene("scene-a"));
await page.click("#cancelScene");
if(await visible("discardChangesModal"))throw new Error("чистая сцена потребовала подтверждение");
await page.evaluate(()=>editScene("scene-a"));await page.fill("#sceneTitle","Черновик");
if(!await page.evaluate(()=>hasDirtyForms()&&window.__dirtyBeforeUnload===true))throw new Error("dirty scene не активировала beforeunload");
await page.evaluate(()=>document.getElementById("cancelScene").click());if(!await visible("discardChangesModal"))throw new Error("Отмена dirty-сцены не показала guard");
await page.click("#continueEditing");if(await page.inputValue("#sceneTitle")!=="Черновик"||!await visible("sceneModal"))throw new Error("Продолжить редактирование потеряло draft");
await page.evaluate(()=>document.getElementById("cancelScene").click());await page.click("#discardChanges");if(await visible("sceneModal"))throw new Error("discard не закрыл сцену");
if((await page.evaluate(()=>data.scenes[0].title))!=="Исходная")throw new Error("discard изменил модель");

await page.evaluate(()=>editScene("scene-a"));await page.fill("#sceneDate","2026-02-02");await page.keyboard.press("Escape");if(!await visible("discardChangesModal"))throw new Error("Escape обошёл guard");await page.keyboard.press("Escape");if(!await visible("sceneModal")||await visible("discardChangesModal"))throw new Error("Escape подтверждения закрыл редактор");await page.evaluate(()=>document.getElementById("cancelScene").click());await page.click("#discardChanges");
await page.evaluate(()=>editScene("scene-a"));await page.fill("#sceneTitle","Backdrop draft");await page.evaluate(()=>document.getElementById("sceneModal").click());if(!await visible("discardChangesModal"))throw new Error("backdrop обошёл guard");await page.click("#continueEditing");
await page.evaluate(()=>{editScene("scene-b")});if(!await visible("discardChangesModal")||await page.inputValue("#sceneTitle")!=="Backdrop draft")throw new Error("переход к другой сцене уничтожил draft");await page.click("#discardChanges");await page.waitForTimeout(20);if(await page.inputValue("#sceneTitle")!=="Вторая")throw new Error("подтверждённый переход не открыл другую сцену");await page.click("#cancelScene");

await page.evaluate(()=>openSceneText("scene-a"));await page.fill("#fullSceneText","Большой текст\n".repeat(200));await page.evaluate(()=>document.getElementById("textModal").click());await page.click("#continueEditing");if(!(await page.inputValue("#fullSceneText")).startsWith("Большой"))throw new Error("текст потерян после отмены закрытия");await page.evaluate(()=>document.getElementById("closeText").click());await page.click("#discardChanges");
await page.evaluate(()=>openAllScenes());await page.locator('.all-scene-text[data-scene-id="scene-a"]').fill("Общий черновик");await page.evaluate(()=>document.getElementById("closeAllScenes").click());if(!await visible("discardChangesModal"))throw new Error("Все сцены не защищены");await page.click("#continueEditing");await page.click("#saveAllScenes");if(await page.evaluate(()=>hasDirtyForms()))throw new Error("Сохранить все не очистило dirty");

await page.click("#projectMenu > summary");await page.click("#manageChars");await page.click("#addChar");await page.fill("#pf_name","Черновой герой");await page.evaluate(()=>{profileDraftPhotos.push({id:"dirty-photo",source:{kind:"data-url",value:"data:image/png;base64,AAAA"},crop:{x:.5,y:.5,zoom:1},alt:""});renderProfilePhotos();syncBeforeUnload()});await page.evaluate(()=>document.getElementById("cancelProfile").click());if(!await visible("discardChangesModal"))throw new Error("анкета/фото не защищены");await page.click("#discardChanges");if(await page.evaluate(()=>data.characters.some(item=>item.name==="Новый персонаж"||item.name==="Черновой герой")))throw new Error("отмена оставила пустого персонажа");await page.click("#closeChars");

await page.evaluate(()=>openLocationsManager());await page.locator('.location-name-input[data-draft-id="location-a"]').fill("Новый дом");await page.locator('.location-row:has([data-draft-id="location-b"]) button.danger').click();await page.click("#confirmActionConfirm");
if(await page.inputValue('.location-name-input[data-draft-id="location-a"]')!=="Новый дом")throw new Error("удаление соседней локации потеряло draft");
if(await page.evaluate(()=>data.locations.find(item=>item.id==="location-a").name)!=="Дом")throw new Error("staged delete закоммитил изменения до Save");
await page.click("#saveLocations");await page.waitForFunction(()=>!trackerFor("locationsModal").isDirty());
if(await page.evaluate(()=>data.locations.find(item=>item.id==="location-a")?.name)!=="Новый дом"||await page.evaluate(()=>data.locations.some(item=>item.id==="location-b")))throw new Error("сохранение не применило переименование и удаление локации");
await page.click("#closeLocations");
await page.evaluate(()=>openTagsManager());await page.locator('.tag-name-input[data-draft-id="tag-a"]').fill("Новый тег");await page.locator('.tag-manager-row:has([data-draft-id="tag-b"]) button.danger').click();await page.click("#confirmActionConfirm");
if(await page.inputValue('.tag-name-input[data-draft-id="tag-a"]')!=="Новый тег")throw new Error("удаление соседнего тега потеряло draft");
await page.click("#saveTags");await page.waitForFunction(()=>!trackerFor("tagsModal").isDirty());
if(await page.evaluate(()=>data.tags.find(item=>item.id==="tag-a")?.name)!=="Новый тег"||await page.evaluate(()=>data.tags.some(item=>item.id==="tag-b")))throw new Error("сохранение не применило переименование и удаление тега");
await page.click("#closeTags");

await page.evaluate(()=>editScene("scene-a"));await page.fill("#sceneTitle","Ошибка и повтор");await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("quota","QuotaExceededError")};window.__restoreDirtyStorage=()=>Storage.prototype.setItem=original});await page.click("#saveScene");if(!await visible("sceneModal")||!await page.evaluate(()=>trackerFor("sceneModal").isDirty()))throw new Error("save failure закрыл или очистил dirty scene");await page.evaluate(()=>__restoreDirtyStorage());await page.click("#saveScene");if(await visible("sceneModal")||await page.evaluate(()=>hasDirtyForms()||window.__dirtyBeforeUnload===true))throw new Error("успешный retry не очистил dirty/beforeunload");

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("dirty-state browser integration tests: OK");await browser.close();
