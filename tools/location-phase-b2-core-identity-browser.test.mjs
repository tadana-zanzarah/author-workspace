// Location Phase B2 core-identity + hierarchy UI regression (local mode): type badge/custom
// label precedence, breadcrumb (ancestors-only rendering + non-participating-ancestor rule is
// covered structurally by locationAncestors()/exclusion logic — this file drives the actual
// local-mode DOM, where every Location necessarily "participates"), aliases (read chips +
// gallery/search), parent picker (self+descendant exclusion, disambiguating context, dirty
// tracking), short-summary/description distinction with fallback, gallery type filter, and the
// create-with-parent-in-one-step flow (create_location_canonical's structurally-cycle-free
// inline parent).
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
  {id:"loc-world",name:"Эферия",description:"",officialName:"",aliases:[],parentId:null,typePreset:"world",customTypeLabel:"",shortSummary:"Мир, где разворачивается история."},
  {id:"loc-country",name:"Вальдория",description:"",officialName:"Королевство Вальдория",aliases:["Старое королевство"],parentId:"loc-world",typePreset:"country",customTypeLabel:"",shortSummary:""},
  {id:"loc-city",name:"Рен",description:"Столица королевства, полная шпилей.",officialName:"",aliases:["Город шпилей"],parentId:"loc-country",typePreset:"settlement",customTypeLabel:"Столица",shortSummary:"Столица, полная шпилей и тайн."},
  {id:"loc-room",name:"Кабинет Рене",description:"Тихий рабочий кабинет.",officialName:"",aliases:[],parentId:"loc-city",typePreset:"room",customTypeLabel:"",shortSummary:""},
  {id:"loc-orphan",name:"Заброшенная шахта",description:"",officialName:"",aliases:[],parentId:null,typePreset:"natural_place",customTypeLabel:"",shortSummary:""},
  {id:"loc-untyped",name:"Безымянное место",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""},
  // Corrective-pass regression fixture: a long name paired with the longest type label
  // ("Транспорт / транспортный объект") reproduced the Gallery-card name-collapses-to-0px bug.
  {id:"loc-longname",name:"Богом забытая пристань на краю света, куда не заходят даже контрабандисты",description:"",officialName:"",aliases:[],parentId:null,typePreset:"transport",customTypeLabel:"",shortSummary:""}
];
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes:[]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});

/* ---------- Profile read mode: type badge, custom label precedence, breadcrumb, aliases, short summary ---------- */

await page.evaluate(()=>openLocationProfile("loc-city"));
const cityIntro=await page.evaluate(()=>({
  typeBadge:document.querySelector("#locationProfileIntro .location-type-badge")?.textContent.trim(),
  breadcrumb:[...document.querySelectorAll("#locationProfileIntro .location-breadcrumb-link,#locationProfileIntro .location-breadcrumb-current")].map(el=>el.textContent.trim()),
  aliases:[...document.querySelectorAll("#locationProfileIntro .location-alias-chip")].map(el=>el.textContent.trim()),
  summary:document.querySelector("#locationProfileIntro .location-profile-short-summary")?.textContent.trim()
}));
if(cityIntro.typeBadge!=="Столица")throw new Error(`custom_type_label должен побеждать в отображении над preset-меткой типа, получено: ${cityIntro.typeBadge}`);
if(JSON.stringify(cityIntro.breadcrumb)!==JSON.stringify(["Эферия","Вальдория","Рен"]))throw new Error(`breadcrumb в неверном порядке/составе: ${JSON.stringify(cityIntro.breadcrumb)}`);
if(JSON.stringify(cityIntro.aliases)!==JSON.stringify(["Город шпилей"]))throw new Error(`aliases не отрендерились как read-only чипы: ${JSON.stringify(cityIntro.aliases)}`);
if(cityIntro.summary!=="Столица, полная шпилей и тайн.")throw new Error("shortSummary не отобразился в read mode intro");

// Corrective-pass regression: the intro's column-flex default align-items:stretch was
// stretching the type badge to the full container width (a wide beige bar instead of a
// compact pill). Real geometry assertion, not just a screenshot: the badge must stay close to
// its own content width and far short of the intro container's width.
const badgeGeometry=await page.evaluate(()=>{
  const intro=document.getElementById("locationProfileIntro");
  const badge=intro.querySelector(".location-type-badge");
  const probe=document.createElement("span");
  probe.textContent=badge.textContent;
  probe.style.cssText=`position:absolute;visibility:hidden;white-space:nowrap;font-size:${getComputedStyle(badge).fontSize};font-weight:${getComputedStyle(badge).fontWeight}`;
  document.body.appendChild(probe);
  const contentWidth=probe.getBoundingClientRect().width;
  probe.remove();
  return {badgeWidth:badge.getBoundingClientRect().width,introWidth:intro.getBoundingClientRect().width,contentWidth};
});
// Badge box = text content + fixed horizontal padding (2*8px, see .location-type-badge) + border
// (2*1px) — allow generous slack (24px) above the bare text width for that chrome.
if(!(badgeGeometry.badgeWidth<badgeGeometry.contentWidth+24))throw new Error(`type badge шире своего содержимого больше, чем на паддинг/бордер — похоже на регресс full-width растягивания (badge=${badgeGeometry.badgeWidth}px, content=${badgeGeometry.contentWidth}px)`);
if(!(badgeGeometry.badgeWidth<badgeGeometry.introWidth*0.5))throw new Error(`type badge остаётся близко к полной ширине intro-контейнера — регресс align-items:stretch (badge=${badgeGeometry.badgeWidth}px, intro=${badgeGeometry.introWidth}px)`);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// A Location with no parent must not render a meaningless breadcrumb at all.
await page.evaluate(()=>openLocationProfile("loc-world"));
const worldIntro=await page.evaluate(()=>({
  hasBreadcrumb:!!document.querySelector("#locationProfileIntro .location-breadcrumb"),
  typeBadge:document.querySelector("#locationProfileIntro .location-type-badge")?.textContent.trim()
}));
if(worldIntro.hasBreadcrumb)throw new Error("Location без родителя не должна показывать breadcrumb");
if(worldIntro.typeBadge!=="Мир")throw new Error(`preset-метка не показалась при отсутствии custom_type_label: ${worldIntro.typeBadge}`);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// A Location with neither typePreset nor customTypeLabel must render no badge at all (NULL must
// never be silently coerced to a fallback label).
await page.evaluate(()=>openLocationProfile("loc-untyped"));
if(await page.evaluate(()=>!!document.querySelector("#locationProfileIntro .location-type-badge")))throw new Error("type_preset=NULL не должен показывать никакой type badge");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- Edit mode: field prefill, parent picker exclusion, dirty tracking, save round-trip ---------- */

await page.evaluate(()=>openLocationProfile("loc-country"));
await page.click("#locationProfileEdit");
const prefill=await page.evaluate(()=>({
  official:document.getElementById("locProfileOfficialName").value,
  type:document.getElementById("locProfileTypePreset").value,
  parent:document.getElementById("locProfileParent").value,
  aliasChips:[...document.querySelectorAll("#locProfileAliases .multi-value-chip span:first-child")].map(el=>el.textContent)
}));
if(prefill.official!=="Королевство Вальдория")throw new Error("officialName не подставился в edit mode");
if(prefill.type!=="country")throw new Error(`typePreset select не подставился: ${prefill.type}`);
if(prefill.parent!=="Эферия")throw new Error(`родитель не подставился в picker: ${prefill.parent}`);
if(JSON.stringify(prefill.aliasChips)!==JSON.stringify(["Старое королевство"]))throw new Error("aliases не подставились в multi-value виджет edit mode");

// Parent picker must exclude self and all descendants (Рен, Кабинет Рене) — only
// "Без родительской локации", "Эферия" (current parent) and the two unrelated roots are legal.
await page.click("#locProfileParent");
const parentOptions=await page.evaluate(()=>[...document.querySelectorAll("#locProfileParentListbox [role=option]")].map(el=>el.textContent.trim()));
if(parentOptions.some(text=>text.startsWith("Вальдория")))throw new Error("parent picker должен исключать саму локацию");
if(parentOptions.some(text=>text.startsWith("Рен")))throw new Error("parent picker должен исключать потомков (Рен — прямой потомок Вальдории)");
if(parentOptions.some(text=>text.startsWith("Кабинет Рене")))throw new Error("parent picker должен исключать потомков любой глубины (Кабинет Рене — потомок второго уровня)");
if(!parentOptions.some(text=>text.startsWith("Заброшенная шахта")))throw new Error("parent picker должен предлагать несвязанные локации");

// Select a different parent (clear it), aliases widget change, type change — all must mark dirty.
const clearOption=await page.locator("#locProfileParentListbox [role=option]").first();
await clearOption.click(); // "Без родительской локации"
if(!await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()))throw new Error("смена родителя (custom picker) должна помечать форму dirty");
if(await page.evaluate(()=>document.getElementById("locProfileParent").value)!=="")throw new Error("очистка родителя должна очистить отображаемое значение picker");

await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
if(!await page.evaluate(()=>document.getElementById("discardChangesModal").style.display==="flex"))throw new Error("dirty-state protection должен сработать при попытке выйти из edit mode с несохранённой сменой родителя");
await page.click("#discardChanges");
if(await page.evaluate(()=>locationById("loc-country").parentId)!=="loc-world")throw new Error("discard не должен был изменить сохранённого родителя");

// Real save round-trip: change parent to the orphan and save; breadcrumb must reflect the new
// chain, and the location's own parentId must persist (local-mode single-transaction save).
await page.click("#locationProfileEdit");
await page.click("#locProfileParent");
await page.locator("#locProfileParentListbox [role=option]",{hasText:"Заброшенная шахта"}).click();
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
const afterSave=await page.evaluate(()=>({
  parentId:locationById("loc-country").parentId,
  breadcrumb:[...document.querySelectorAll("#locationProfileIntro .location-breadcrumb-link,#locationProfileIntro .location-breadcrumb-current")].map(el=>el.textContent.trim())
}));
if(afterSave.parentId!=="loc-orphan")throw new Error(`сохранённый parentId не совпадает с выбором: ${afterSave.parentId}`);
if(JSON.stringify(afterSave.breadcrumb)!==JSON.stringify(["Заброшенная шахта","Вальдория"]))throw new Error(`breadcrumb после сохранения не обновился: ${JSON.stringify(afterSave.breadcrumb)}`);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- Gallery: type badge, parent context, search by alias/official name, type filter ---------- */

await page.evaluate(()=>openLocationGallery());
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===7);
const cityCard=await page.evaluate(()=>{
  const card=document.querySelector('.location-card[data-location-id="loc-city"]');
  return {
    typeBadge:card.querySelector(".location-type-badge")?.textContent.trim(),
    excerpt:card.querySelector(".location-card-excerpt")?.textContent.trim()
  };
});
if(cityCard.typeBadge!=="Столица")throw new Error("Gallery card должна показывать custom_type_label вместо preset-метки, когда он задан");
if(cityCard.excerpt!=="Столица, полная шпилей и тайн.")throw new Error("Gallery card должна показывать shortSummary (не description), когда shortSummary задан");

const roomCardExcerpt=await page.evaluate(()=>document.querySelector('.location-card[data-location-id="loc-room"] .location-card-excerpt')?.textContent.trim());
if(roomCardExcerpt!=="Тихий рабочий кабинет.")throw new Error("Gallery card с пустым shortSummary должна показывать description как запасной вариант");

// Corrective-pass regression: a long name + the longest type label must never squeeze the
// Location's own name to 0px (the confirmed blocking bug) — real geometry assertions, not just
// a screenshot. Checked at both ~1280px (grid at its widest, most columns) and ~1080px (fewer,
// narrower columns, where the bug reproduced worse) per the corrective-pass instructions.
async function assertLongNameCardGeometry(label){
  const geometry=await page.evaluate(()=>{
    const card=document.querySelector('.location-card[data-location-id="loc-longname"]');
    const identity=card.querySelector(".location-card-identity");
    const name=card.querySelector(".location-card-name");
    const badge=card.querySelector(".location-type-badge");
    const cardRect=card.getBoundingClientRect(),identityRect=identity.getBoundingClientRect();
    return {
      nameWidth:name.getBoundingClientRect().width,
      nameText:name.textContent.trim(),
      badgeWidth:badge.getBoundingClientRect().width,
      identityWidth:identityRect.width,
      cardHeight:cardRect.height,
      // horizontal overflow: any child's right edge past the card's own right edge
      overflowsCard:[...card.querySelectorAll("*")].some(el=>el.getBoundingClientRect().right>cardRect.right+1)
    };
  });
  if(!(geometry.nameWidth>0))throw new Error(`[${label}] .location-card-name сжалось до 0px — имя локации полностью скрыто (regression от исходного бага)`);
  if(!geometry.nameText)throw new Error(`[${label}] .location-card-name не содержит видимого текста`);
  if(geometry.overflowsCard)throw new Error(`[${label}] карточка создаёт horizontal overflow за пределы своих границ`);
  // Badge stays secondary: must not consume the whole identity row (monogram+gap left it none).
  if(!(geometry.badgeWidth<geometry.identityWidth*0.6))throw new Error(`[${label}] type badge занимает слишком большую долю identity-строки (badge=${geometry.badgeWidth}px, identity=${geometry.identityWidth}px) — должен оставаться вторичным`);
  if(!(geometry.cardHeight<180))throw new Error(`[${label}] карточка стала слишком высокой при исправлении (${geometry.cardHeight}px) — фикс не должен решать проблему увеличением высоты карточек`);
}
await assertLongNameCardGeometry("Gallery @1280px");
await page.setViewportSize({width:1080,height:760});
await assertLongNameCardGeometry("Gallery @1080px");
await page.setViewportSize({width:1280,height:900});

await page.fill("#locationGallerySearch","Город шпилей");
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===1);
if((await page.locator(".location-card-name").first().textContent()).trim()!=="Рен")throw new Error("поиск по alias не нашёл ожидаемую локацию");
await page.fill("#locationGallerySearch","Королевство Вальдория");
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===1);
if((await page.locator(".location-card-name").first().textContent()).trim()!=="Вальдория")throw new Error("поиск по official_name не нашёл ожидаемую локацию");
await page.fill("#locationGallerySearch","");
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===7);

const filterVisible=await page.evaluate(()=>!document.querySelector("#locationGalleryTypeFilter").closest(".location-gallery-type-filter").hidden);
if(!filterVisible)throw new Error("type filter должен быть виден, когда среди локаций есть заданные типы");
await page.selectOption("#locationGalleryTypeFilter","room");
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===1);
if((await page.locator(".location-card-name").first().textContent()).trim()!=="Кабинет Рене")throw new Error("type filter не сузил список ожидаемым образом");
await page.selectOption("#locationGalleryTypeFilter","");
await page.waitForFunction(()=>document.querySelectorAll(".location-card").length===7);
await page.click("#closeLocations");

/* ---------- Create: type + custom label + parent + aliases + short summary in one step ---------- */

await page.evaluate(()=>openLocationGallery());
await page.evaluate(()=>openCreateLocationModal());
await page.fill("#createLocationName","Таверна «Ржавый якорь»");
await page.evaluate(()=>{
  const select=document.getElementById("createLocationTypePreset");
  select.value="building";select.dispatchEvent(new Event("change",{bubbles:true}));
});
await page.click("#createLocationParent");
await page.locator("#createLocationParentListbox .location-parent-option-name",{hasText:/^Рен$/}).click();
await page.click("#createLocationSubmit");
await page.waitForSelector("#locationProfileModal",{state:"visible"});
const created=await page.evaluate(()=>({
  title:document.getElementById("locationProfileTitle").textContent,
  breadcrumb:[...document.querySelectorAll("#locationProfileIntro .location-breadcrumb-link,#locationProfileIntro .location-breadcrumb-current")].map(el=>el.textContent.trim()),
  typeBadge:document.querySelector("#locationProfileIntro .location-type-badge")?.textContent.trim()
}));
if(created.title!=="Таверна «Ржавый якорь»")throw new Error("созданная локация не открылась в Profile");
if(created.typeBadge!=="Здание")throw new Error(`тип не сохранился при создании: ${created.typeBadge}`);
if(JSON.stringify(created.breadcrumb)!==JSON.stringify(["Заброшенная шахта","Вальдория","Рен","Таверна «Ржавый якорь»"]))throw new Error(`родитель, заданный при создании, не отразился в breadcrumb: ${JSON.stringify(created.breadcrumb)}`);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("location Phase B2 core-identity/hierarchy browser tests: OK");
await browser.close();
