// Location Phase B3A browser regression (local mode): Appearance & Atmosphere / Geography
// thematic modules -- read-mode visibility rules (hidden entirely when empty, correct section
// order, no empty labels, compact chips), edit-mode progressive disclosure (collapsed-when-empty/
// expanded-when-populated, keyboard/ARIA, non-destructive collapse), multi-value add/remove,
// clear-section (draft-only), Cancel/discard, and the real save round-trip (patch shape: field
// clearing produces a full replacement without the old field, full-module clearing produces null).
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
  {id:"loc-core-only",name:"Пустой чердак",description:"Пыльное место.",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""},
  {id:"loc-appearance-only",name:"Туманный лес",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",appearanceAtmosphere:{visualDescription:"Стволы деревьев теряются в тумане.",atmosphere:"Тихо и сыро.",notableFeatures:["Мшистый камень","Старый указатель"]}}},
  {id:"loc-geography-only",name:"Северный хребет",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",geography:{terrain:"Горы",climate:"Холодный",naturalFeatures:["Ледник"]}}},
  {id:"loc-both",name:"Прибрежная деревня",description:"Рыбацкая деревня.",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"Рыбацкая деревня.",
      appearanceAtmosphere:{visualDescription:"Деревянные дома вдоль воды.",sounds:"Крики чаек",smells:"Солёный воздух"},
      geography:{terrain:"Побережье",water:"Море",coordinates:"41N 12E"}}},
  {id:"loc-edit-target",name:"Сторожевая башня",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",geography:{terrain:"Горы",climate:"Холодный"}}}
];
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes:[]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});

/* ---------- READ MODE ---------- */

// A. Core-only Location: no thematic headings, Profile stays compact.
await page.evaluate(()=>openLocationProfile("loc-core-only"));
{
  const state=await page.evaluate(()=>({
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
    geographyHidden:document.getElementById("locationProfileGeography").hidden,
    appearanceHtml:document.getElementById("locationProfileAppearance").innerHTML.trim(),
    geographyHtml:document.getElementById("locationProfileGeography").innerHTML.trim()
  }));
  if(!state.appearanceHidden||!state.geographyHidden)throw new Error("Core-only Location must not show either thematic section");
  if(state.appearanceHtml||state.geographyHtml)throw new Error("Core-only Location must not render placeholder markup for empty modules (no giant empty card, no 'Нет данных')");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// B. Appearance only: Appearance visible, Geography absent.
await page.evaluate(()=>openLocationProfile("loc-appearance-only"));
{
  const state=await page.evaluate(()=>({
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
    geographyHidden:document.getElementById("locationProfileGeography").hidden,
    title:document.querySelector("#locationProfileAppearance .location-profile-thematic-title")?.textContent.trim(),
    prose:[...document.querySelectorAll("#locationProfileAppearance .location-profile-thematic-prose")].map(el=>el.textContent.trim()),
    chips:[...document.querySelectorAll("#locationProfileAppearance .location-alias-chip")].map(el=>el.textContent.trim())
  }));
  if(state.appearanceHidden)throw new Error("Appearance module with data must be visible");
  if(!state.geographyHidden)throw new Error("Geography must stay absent when the Location has no geography data");
  if(state.title!=="Внешний вид и атмосфера")throw new Error(`unexpected Appearance heading: ${state.title}`);
  if(state.prose[0]!=="Стволы деревьев теряются в тумане.")throw new Error("visualDescription did not render as primary prose");
  if(state.prose[1]!=="Тихо и сыро.")throw new Error("atmosphere did not render as secondary prose");
  if(JSON.stringify(state.chips)!==JSON.stringify(["Мшистый камень","Старый указатель"]))throw new Error(`notableFeatures did not render as compact chips: ${JSON.stringify(state.chips)}`);
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// C. Geography only: Geography visible, Appearance absent.
await page.evaluate(()=>openLocationProfile("loc-geography-only"));
{
  const state=await page.evaluate(()=>({
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
    geographyHidden:document.getElementById("locationProfileGeography").hidden,
    title:document.querySelector("#locationProfileGeography .location-profile-thematic-title")?.textContent.trim(),
    facts:[...document.querySelectorAll("#locationProfileGeography .location-profile-fact")].map(el=>el.textContent.trim()),
    chips:[...document.querySelectorAll("#locationProfileGeography .location-alias-chip")].map(el=>el.textContent.trim())
  }));
  if(!state.appearanceHidden)throw new Error("Appearance must stay absent when the Location has no appearance data");
  if(state.geographyHidden)throw new Error("Geography module with data must be visible");
  if(state.title!=="География")throw new Error(`unexpected Geography heading: ${state.title}`);
  if(!state.facts.some(text=>text.includes("Горы"))||!state.facts.some(text=>text.includes("Холодный")))throw new Error(`short geography fields did not render as compact facts: ${JSON.stringify(state.facts)}`);
  if(JSON.stringify(state.chips)!==JSON.stringify(["Ледник"]))throw new Error("naturalFeatures did not render as compact chips");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// D. Both modules: both visible, correct vertical order (intro/description -> Appearance ->
// Geography -> Scenes here), partial module (only some fields set) renders no empty labels.
await page.evaluate(()=>openLocationProfile("loc-both"));
{
  const state=await page.evaluate(()=>{
    const view=document.getElementById("locationProfileReadView");
    const ids=["locationProfileSummary","locationProfileAppearance","locationProfileGeography"].map(id=>document.getElementById(id));
    const order=ids.map(el=>Array.prototype.indexOf.call(view.children,el)).every((pos,i,arr)=>i===0||pos>arr[i-1]);
    const scenesSection=[...view.querySelectorAll(".profile-section")].find(s=>s.querySelector("#locationProfileScenes"));
    const scenesAfterGeography=Array.prototype.indexOf.call(view.children,scenesSection)>Array.prototype.indexOf.call(view.children,document.getElementById("locationProfileGeography"));
    return {
      appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
      geographyHidden:document.getElementById("locationProfileGeography").hidden,
      domOrderCorrect:order,scenesAfterGeography,
      appearanceLabels:[...document.querySelectorAll("#locationProfileAppearance .location-profile-fact dt")].map(el=>el.textContent.trim()),
      geographyLabels:[...document.querySelectorAll("#locationProfileGeography .location-profile-fact dt")].map(el=>el.textContent.trim())
    };
  });
  if(state.appearanceHidden||state.geographyHidden)throw new Error("both modules with data must be visible together");
  if(!state.domOrderCorrect)throw new Error("thematic sections must sit in DOM after the description and before Сцены здесь");
  if(!state.scenesAfterGeography)throw new Error("Сцены здесь must remain reachable after the thematic modules, not moved into a tab");
  // loc-both sets sounds/smells but not lighting/climateFeel -- no label for an unset field.
  if(state.appearanceLabels.includes("Освещение")||state.appearanceLabels.includes("Ощущение климата"))throw new Error("empty Appearance fields must not render empty labels");
  if(!state.appearanceLabels.includes("Звуки")||!state.appearanceLabels.includes("Запахи"))throw new Error("populated Appearance facts missing");
  // loc-both sets terrain/water/coordinates but not climate/vegetation/access/area/elevation.
  if(state.geographyLabels.includes("Климат")||state.geographyLabels.includes("Растительность"))throw new Error("empty Geography fields must not render empty labels");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- EDIT MODE ---------- */

// G/H/I/J. Disclosure: empty module collapsed, populated module expanded, toggle works, aria-expanded correct.
await page.evaluate(()=>openLocationProfile("loc-appearance-only"));
await page.click("#locationProfileEdit");
{
  const initial=await page.evaluate(()=>({
    appExpanded:document.getElementById("locProfileAppearanceToggle").getAttribute("aria-expanded"),
    appBodyHidden:document.getElementById("locProfileAppearanceBody").hidden,
    geoExpanded:document.getElementById("locProfileGeographyToggle").getAttribute("aria-expanded"),
    geoBodyHidden:document.getElementById("locProfileGeographyBody").hidden
  }));
  if(initial.appExpanded!=="true"||initial.appBodyHidden)throw new Error("populated Appearance must start expanded on entering edit mode");
  if(initial.geoExpanded!=="false"||!initial.geoBodyHidden)throw new Error("empty Geography must start collapsed on entering edit mode");
}
await page.click("#locProfileGeographyToggle");
{
  const afterToggle=await page.evaluate(()=>({
    geoExpanded:document.getElementById("locProfileGeographyToggle").getAttribute("aria-expanded"),
    geoBodyHidden:document.getElementById("locProfileGeographyBody").hidden
  }));
  if(afterToggle.geoExpanded!=="true"||afterToggle.geoBodyHidden)throw new Error("clicking the disclosure toggle must expand a collapsed module");
}
await page.click("#locProfileAppearanceToggle");
{
  const afterCollapse=await page.evaluate(()=>({
    appExpanded:document.getElementById("locProfileAppearanceToggle").getAttribute("aria-expanded"),
    appBodyHidden:document.getElementById("locProfileAppearanceBody").hidden,
    visualDescription:document.getElementById("locProfileVisualDescription").value
  }));
  if(afterCollapse.appExpanded!=="false"||!afterCollapse.appBodyHidden)throw new Error("clicking an expanded disclosure toggle must collapse it");
  // K. Collapsing must not clear the draft.
  if(afterCollapse.visualDescription!=="Стволы деревьев теряются в тумане.")throw new Error("collapsing the Appearance module must not clear its draft values");
}
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());

// L/M/N. Text-field and multi-value edits mark dirty; multi-value add/remove works.
await page.evaluate(()=>openLocationProfile("loc-edit-target"));
await page.click("#locationProfileEdit");
if(await page.evaluate(()=>document.getElementById("locProfileGeographyToggle").getAttribute("aria-expanded"))!=="true")throw new Error("Geography with data (loc-edit-target) must start expanded");
if(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()))throw new Error("opening edit mode alone must not mark the form dirty");
await page.click("#locProfileAppearanceToggle"); // expand the empty Appearance module to edit it
await page.fill("#locProfileAtmosphere","Напряжённая тишина.");
if(!await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()))throw new Error("editing an Appearance textarea must mark the form dirty");
const notableFeatures=page.locator("#locProfileNotableFeatures");
await notableFeatures.locator("input").click();
await notableFeatures.locator("input").fill("Сломанные ворота");
await notableFeatures.locator("input").press("Enter");
if((await notableFeatures.locator(".multi-value-chip").count())!==1)throw new Error("adding a notableFeatures chip failed");
await notableFeatures.getByRole("button",{name:/Удалить значение/}).click();
if((await notableFeatures.locator(".multi-value-chip").count())!==0)throw new Error("removing a notableFeatures chip failed");
await notableFeatures.locator("input").click();
await notableFeatures.locator("input").fill("Сломанные ворота");
await notableFeatures.locator("input").press("Enter");

// P. Cancel restores original read state (discard-dirty guard, same contract as B2).
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
if(!await page.evaluate(()=>document.getElementById("discardChangesModal").style.display==="flex"))throw new Error("dirty-state protection must fire when leaving edit mode with unsaved B3A changes");
await page.click("#discardChanges");
{
  const afterDiscard=await page.evaluate(()=>({
    baseProfile:locationById("loc-edit-target").baseProfile,
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden
  }));
  if(afterDiscard.baseProfile?.appearanceAtmosphere)throw new Error("discard must not have persisted any Appearance draft data");
  if(!afterDiscard.appearanceHidden)throw new Error("read mode after discard must still show no Appearance section");
}

// O/R. Clear-section clears the draft only (no immediate save); T. no-op edit -> no thematic patch.
await page.click("#locationProfileEdit");
await page.click("#locProfileGeographyClear");
{
  const cleared=await page.evaluate(()=>({
    terrain:document.getElementById("locProfileTerrain").value,
    climate:document.getElementById("locProfileClimate").value,
    dirty:trackerFor("locationProfileModal").isDirty(),
    stillStoredTerrain:locationById("loc-edit-target").baseProfile?.geography?.terrain
  }));
  if(cleared.terrain||cleared.climate)throw new Error("Очистить раздел must blank every field in the module's draft");
  if(!cleared.dirty)throw new Error("Очистить раздел must mark the form dirty");
  if(cleared.stillStoredTerrain!=="Горы")throw new Error("Очистить раздел must not touch the stored Location until Save");
}
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
await page.click("#discardChanges");

// T. Re-entering edit with zero real changes must not mark the form dirty (Save stays disabled --
// the no-op-produces-no-patch contract itself is covered exhaustively at the unit level in
// tools/location-base-profile.test.mjs case 13; this asserts the UI-level consequence: opening
// Edit and touching nothing never enables Save).
await page.click("#locationProfileEdit");
if(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()))throw new Error("re-entering edit mode with unchanged data must not mark the form dirty");
if(!await page.evaluate(()=>document.getElementById("locationProfileSave").disabled))throw new Error("Save must stay disabled when nothing changed");
if(JSON.stringify(await page.evaluate(()=>locationById("loc-edit-target").baseProfile.geography))!==JSON.stringify({terrain:"Горы",climate:"Холодный"}))throw new Error("a no-op edit must not alter the stored thematic modules");
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());

/* ---------- SAVE: real round-trip -- individual field clearing (R) and full-module clearing (S) ---------- */

await page.evaluate(()=>openLocationProfile("loc-edit-target"));
await page.click("#locationProfileEdit");
// R: clear just "climate" (leave terrain) -> stored Geography must drop the key entirely.
await page.fill("#locProfileClimate","");
// Also populate Appearance (currently empty) so this save exercises both directions at once.
await page.click("#locProfileAppearanceToggle");
await page.fill("#locProfileVisualDescription","Каменная кладка, поросшая мхом.");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const afterSave=await page.evaluate(()=>locationById("loc-edit-target").baseProfile);
  if(!("terrain" in afterSave.geography)||afterSave.geography.terrain!=="Горы")throw new Error("unrelated Geography field (terrain) must survive clearing climate");
  if("climate" in afterSave.geography)throw new Error("individual field clearing must remove the old key entirely, not store an empty string");
  if(afterSave.appearanceAtmosphere?.visualDescription!=="Каменная кладка, поросшая мхом.")throw new Error("Appearance change in the same save did not persist");
}
// Q: read mode must reflect the saved patch immediately.
{
  const readState=await page.evaluate(()=>({
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
    geographyFacts:[...document.querySelectorAll("#locationProfileGeography .location-profile-fact")].map(el=>el.textContent.trim())
  }));
  if(readState.appearanceHidden)throw new Error("Appearance must be visible in read mode immediately after saving it");
  if(readState.geographyFacts.some(text=>text.includes("Климат")))throw new Error("cleared Climate must not still render in read mode after save");
}

// S: full-module clearing -> saved module must be entirely absent (server-side JSON null).
await page.click("#locationProfileEdit");
await page.click("#locProfileGeographyClear");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const afterFullClear=await page.evaluate(()=>locationById("loc-edit-target").baseProfile);
  if("geography" in afterFullClear)throw new Error("fully clearing a module must remove its key from base_profile entirely, not leave {}");
  if(!afterFullClear.appearanceAtmosphere?.visualDescription)throw new Error("clearing Geography must not affect the untouched Appearance module");
}
if(await page.evaluate(()=>document.getElementById("locationProfileGeography").hidden)!==true)throw new Error("read mode must hide Geography again after it was fully cleared and saved");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- LOCAL MODE: save/reload persistence ---------- */

await page.evaluate(()=>openLocationProfile("loc-core-only"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAppearanceToggle");
await page.fill("#locProfileVisualDescription","Толстый слой пыли на всём.");
await page.click("#locProfileGeographyToggle");
await page.fill("#locProfileTerrain","Чердачное перекрытие");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// A genuine page.reload() would re-run this test's own page.addInitScript seed (Playwright
// re-executes addInitScript on every navigation, including reload) and clobber the just-saved
// localStorage with the original fixture -- that is a test-harness artifact, not the app under
// test. A fresh page in the SAME browser context reads the real persisted localStorage without
// re-seeding it, which is what "survives a reload" actually means here.
const reloadPage=await context.newPage();
reloadPage.setDefaultTimeout(5000);
reloadPage.on("pageerror",error=>errors.push(error.message));
await reloadPage.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await reloadPage.evaluate(()=>openLocationProfile("loc-core-only"));
{
  const reloaded=await reloadPage.evaluate(()=>({
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
    geographyHidden:document.getElementById("locationProfileGeography").hidden,
    stored:locationById("loc-core-only").baseProfile
  }));
  if(reloaded.appearanceHidden||reloaded.geographyHidden)throw new Error("local-mode save must survive a full page reload");
  if(reloaded.stored.appearanceAtmosphere.visualDescription!=="Толстый слой пыли на всём.")throw new Error("reloaded Appearance value mismatch");
  if(reloaded.stored.geography.terrain!=="Чердачное перекрытие")throw new Error("reloaded Geography value mismatch");
}
await reloadPage.close();

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("location Phase B3A profile-modules browser tests: OK");
await browser.close();
