// Location Gallery/Profile corrective-pass regression: read-mode-first Profile, edit-mode
// entry/exit, empty-description affordance, bounded "Scenes here" for many scenes, Gallery
// card layout (no cover band), delete affordance visibility, and search result states.
import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});

const locations=[
  {id:"loc-empty",name:"Пустой чердак",description:""},
  {id:"loc-one",name:"Один разговор",description:"Короткая сцена у окна."},
  {id:"loc-seven",name:"Мастерская",description:""},
  {id:"loc-many",name:"Вокзал",description:"Оживлённое место, полное прощаний."}
];
const scenes=[
  {id:"scene-one-1",title:"Разговор у окна",date:"2026-01-01",time:"09:00",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-one",tags:[],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{}},
  ...Array.from({length:7},(_,i)=>({id:`scene-seven-${i+1}`,title:`Мастерская сцена ${i+1}`,date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-seven",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}})),
  ...Array.from({length:25},(_,i)=>({id:`scene-many-${i+1}`,title:`Вокзал сцена ${i+1}`,date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-many",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}}))
];
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
const visible=id=>page.locator(`#${id}`).isVisible();

/* ---------- Profile: READ MODE first ---------- */

await page.evaluate(()=>openLocationProfile("loc-one"));
const initial=await page.evaluate(()=>({
  editHidden:document.getElementById("locationProfileEditView").hidden,
  nameVisible:document.getElementById("locProfileName").offsetParent!==null,
  saveVisible:document.getElementById("locationProfileSave").offsetParent!==null,
  deleteVisible:document.getElementById("locationProfileDelete").offsetParent!==null,
  title:document.getElementById("locationProfileTitle").textContent,
  summaryText:document.getElementById("locationProfileSummary").textContent.trim()
}));
if(!initial.editHidden)throw new Error("Profile должен открываться в READ MODE, а не сразу как форма редактирования");
if(initial.nameVisible)throw new Error("read mode не должен показывать постоянно видимый input названия");
if(initial.saveVisible)throw new Error("read mode не должен показывать постоянно видимую кнопку Save");
if(initial.deleteVisible)throw new Error("read mode не должен показывать Delete как главное действие профиля");
if(initial.title!=="Один разговор")throw new Error("read mode header не показывает название локации");
if(!initial.summaryText.includes("Короткая сцена у окна."))throw new Error("read mode summary не показывает описание как читаемый текст");

/* ---------- Edit mode: entry, clean cancel, dirty cancel ---------- */

await page.click("#locationProfileEdit");
const entered=await page.evaluate(()=>({editHidden:document.getElementById("locationProfileEditView").hidden,nameValue:document.getElementById("locProfileName").value}));
if(entered.editHidden)throw new Error("«Редактировать» должен переключать профиль в EDIT MODE");
if(entered.nameValue!=="Один разговор")throw new Error("edit mode не подставил текущее название в поле");

await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
const cleanCancel=await page.evaluate(()=>({editHidden:document.getElementById("locationProfileEditView").hidden,modalVisible:getComputedStyle(document.getElementById("locationProfileModal")).display!=="none"}));
if(!cleanCancel.editHidden||!cleanCancel.modalVisible)throw new Error("чистая (без правок) отмена редактирования должна тихо вернуть в read mode, не закрывая Profile и не спрашивая подтверждение");

await page.click("#locationProfileEdit");
await page.fill("#locProfileName","Изменённое имя (черновик)");
if(!await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()))throw new Error("правка в edit mode не пометила профиль dirty");
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
if(!await visible("discardChangesModal"))throw new Error("dirty-state protection должен сработать при попытке выйти из edit mode с несохранёнными правками");
await page.click("#discardChanges");
const afterDiscard=await page.evaluate(()=>({name:locationById("loc-one").name,editHidden:document.getElementById("locationProfileEditView").hidden}));
if(afterDiscard.name!=="Один разговор")throw new Error("discard не должен был изменить сохранённые данные локации");
if(!afterDiscard.editHidden)throw new Error("после discard профиль должен вернуться в read mode");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- Empty description: compact, actionable state ---------- */

await page.evaluate(()=>openLocationProfile("loc-empty"));
const emptyDesc=await page.evaluate(()=>({
  hasPlaceholder:!!document.querySelector("#locationProfileSummary .location-profile-description-empty"),
  summaryHeight:document.getElementById("locationProfileSummary").getBoundingClientRect().height
}));
if(!emptyDesc.hasPlaceholder)throw new Error("пустое описание должно показывать компактную понятную подсказку, не пустое место");
if(emptyDesc.summaryHeight>60)throw new Error(`пустое описание зарезервировало слишком большой блок: ${emptyDesc.summaryHeight}px`);
await page.click("#locationProfileSummary .location-profile-description-empty");
if(await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden))throw new Error("клик по 'Описание пока не добавлено' должен вести в edit mode");
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- Scenes here: 0 / 1 / ~7 / many, bounded not ever-growing ---------- */

await page.evaluate(()=>openLocationProfile("loc-empty"));
const zeroScenesText=await page.locator("#locationProfileScenes").textContent();
if(!zeroScenesText.includes("пока нет сцен"))throw new Error("0 сцен: ожидался понятный компактный empty state");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

await page.evaluate(()=>openLocationProfile("loc-one"));
if(await page.locator("#locationProfileScenes .location-profile-scene-row").count()!==1)throw new Error("ожидалась ровно 1 сцена для loc-one");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

await page.evaluate(()=>openLocationProfile("loc-seven"));
if(await page.locator("#locationProfileScenes .location-profile-scene-row").count()!==7)throw new Error("ожидалось 7 сцен для loc-seven");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

await page.evaluate(()=>openLocationProfile("loc-many"));
const many=await page.evaluate(()=>{
  const container=document.getElementById("locationProfileScenes");
  const modal=document.querySelector("#locationProfileModal .modal");
  return {
    rowCount:container.querySelectorAll(".location-profile-scene-row").length,
    scrollable:container.scrollHeight>container.clientHeight,
    modalHeight:modal.getBoundingClientRect().height,
    viewportHeight:window.innerHeight
  };
});
if(many.rowCount!==25)throw new Error(`ожидалось 25 client-side отрендеренных сцен (без пагинации), найдено: ${many.rowCount}`);
if(!many.scrollable)throw new Error("Scenes here с 25 сценами должен быть bounded (внутренняя прокрутка), а не растягивать окно");
if(many.modalHeight>many.viewportHeight+2)throw new Error(`Profile modal превысил высоту viewport при 25 сценах: ${many.modalHeight} > ${many.viewportHeight}`);

/* ---------- Scene opens from Profile; stacking must place it visually on top ---------- */

const stackDomOrder=await page.evaluate(()=>{
  const scene=document.getElementById("sceneModal"),gallery=document.getElementById("locationsModal");
  return !!(scene.compareDocumentPosition(gallery)&Node.DOCUMENT_POSITION_PRECEDING);
});
if(!stackDomOrder)throw new Error("sceneModal должен идти после Gallery/Profile модалей в DOM (flat z-index + source-order stacking, см. modal-manager.js) для корректного visual stacking");
await page.click("#locationProfileScenes .location-profile-scene-row >> nth=0");
const openedScene=await page.evaluate(()=>({sceneDisplay:document.getElementById("sceneModal").style.display,editingSceneId:typeof editingSceneId!=="undefined"?editingSceneId:null}));
if(openedScene.sceneDisplay!=="flex")throw new Error("клик по строке в Scenes here должен открыть Scene editor поверх Profile");
if(openedScene.editingSceneId!=="scene-many-1")throw new Error(`открылась не та сцена: ${openedScene.editingSceneId}`);
await page.keyboard.press("Escape");
await page.waitForSelector("#sceneModal",{state:"hidden"});
if(await page.evaluate(()=>document.activeElement?.tagName)==="BODY")throw new Error("Escape из Scene editor должен вернуть фокус, а не потерять его на body");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- Gallery: card layout, delete affordance, search states ---------- */

await page.evaluate(()=>openLocationGallery());
const cardLayout=await page.evaluate(()=>{
  const card=document.querySelector('.location-card[data-location-id="loc-one"]');
  return {
    hasCoverBand:!!card.querySelector(".location-card-cover"),
    monogramHeight:card.querySelector(".location-card-monogram")?.getBoundingClientRect().height||0
  };
});
if(cardLayout.hasCoverBand)throw new Error("Gallery card больше не должна иметь отдельную полноширинную beige cover-полосу под монограмму");
if(cardLayout.monogramHeight<=0||cardLayout.monogramHeight>32)throw new Error(`монограмма должна остаться небольшим identity accent (<=32px), высота: ${cardLayout.monogramHeight}`);

const deleteOpacity=await page.evaluate(()=>{
  const btn=document.querySelector('.location-card[data-location-id="loc-one"] button.danger-quiet');
  return parseFloat(getComputedStyle(btn).opacity);
});
if(!(deleteOpacity>=0.75))throw new Error(`delete icon на Gallery card слишком бледная и может читаться как disabled, opacity: ${deleteOpacity}`);

const manyResultsCount=await page.locator(".location-card").count();
if(manyResultsCount!==4)throw new Error(`ожидалось 4 карточки без поискового запроса, найдено: ${manyResultsCount}`);

await page.fill("#locationGallerySearch","Вокзал");
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===1);
const oneResultName=(await page.locator(".location-card-name").first().textContent())?.trim();
if(oneResultName!=="Вокзал")throw new Error(`поиск с одним результатом показал не ту карточку: ${oneResultName}`);

await page.fill("#locationGallerySearch","совершенно нет такой локации");
await page.waitForFunction(()=>!document.querySelector(".location-card"));
const zeroText=await page.locator("#locationsGalleryGrid").textContent();
if(!zeroText.includes("Совпадений не найдено"))throw new Error("zero-result поиск должен ясно сообщать об отсутствии совпадений, а не выглядеть как сломанная пустая Gallery");

await page.fill("#locationGallerySearch","");
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===4);
await page.click("#closeLocations");

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("location gallery/profile corrective pass browser tests: OK");
await browser.close();
