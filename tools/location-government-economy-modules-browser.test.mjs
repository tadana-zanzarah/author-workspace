// Location Adaptive Modules B3B browser regression (local mode): Government & Society / Economy
// thematic modules -- read-mode rendering (prose-vs-fact threshold, chips, section order after
// Geography), the full add/fill/Save/reload/Hide/Show/Delete lifecycle reusing the exact Phase 1
// generic shell, sibling-module isolation across all four modules, and the B3B type-recommendation
// hint (guidance only -- text-carried, never color-alone; never blocks adding a non-recommended
// module).
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
  {id:"loc-gov-econ",name:"Портовый город Вейлор",description:"",officialName:"",aliases:[],parentId:null,typePreset:"settlement",customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",
      governmentSociety:{governmentForm:"Республика",leadership:"Мэр Альварес",politicalSituation:"После недавних выборов город расколот между сторонниками порта и защитниками старого центра — обе стороны готовы на многое, чтобы отстоять своё видение будущего Вейлора.",lawsAndRules:"Комендантский час в порту после полуночи.",securityForces:["Городская стража","Портовая охрана"],notableInstitutions:["Городской совет"]},
      economy:{currency:"Кроны",economicCharacter:"Экономика держится на порту: рыбная ловля кормит окраины, а склады и биржа приносят деньги в центр — но зависимость от одного грузового пути делает город уязвимым к любому сбою торговли.",industries:["Рыболовство","Портовая торговля"],costOfLiving:"Дёшево у воды, дорого в центре.",scarcity:["Пресная вода"],tradeConnections:["Морской путь на юг"]}
    }},
  {id:"loc-fresh",name:"Пустой участок",description:"",officialName:"",aliases:[],parentId:null,typePreset:"country",customTypeLabel:"",shortSummary:""},
  {id:"loc-room",name:"Кладовая",description:"",officialName:"",aliases:[],parentId:null,typePreset:"room",customTypeLabel:"",shortSummary:""},
  {id:"loc-isolation",name:"Isolation Fixture",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",
      appearanceAtmosphere:{atmosphere:"Спокойно"},geography:{terrain:"Равнина"},
      governmentSociety:{leadership:"Совет старейшин"},economy:{currency:"Бартер"}
    }}
];
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes:[]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});

const addChip=label=>`.location-thematic-add-chip:has-text("${label}")`;
const cancelEdit=async targetPage=>{
  await targetPage.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if(await targetPage.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex"){await targetPage.click("#discardChanges")}
};
const freshPage=async()=>{
  const p=await context.newPage();p.setDefaultTimeout(5000);p.on("pageerror",error=>errors.push(error.message));
  await p.goto(`${base}?local=1`,{waitUntil:"networkidle"});
  return p;
};

/* ---------- READ MODE ---------- */

// 1. Both new modules render, in the correct order (Appearance/Geography absent here -> Government
// -> Economy -> Сцены здесь), long prose fields render as prose, short fields as compact facts,
// arrays as chips, with the B3B Russian headings.
await page.evaluate(()=>openLocationProfile("loc-gov-econ"));
{
  const state=await page.evaluate(()=>{
    const view=document.getElementById("locationProfileReadView");
    const gov=document.getElementById("locationProfileGovernmentSociety");
    const econ=document.getElementById("locationProfileEconomy");
    const order=Array.prototype.indexOf.call(view.children,gov)<Array.prototype.indexOf.call(view.children,econ);
    const scenesSection=[...view.querySelectorAll(".profile-section")].find(s=>s.querySelector("#locationProfileScenes"));
    return {
      govHidden:gov.hidden,econHidden:econ.hidden,order,
      econBeforeScenes:Array.prototype.indexOf.call(view.children,econ)<Array.prototype.indexOf.call(view.children,scenesSection),
      govTitle:gov.querySelector(".location-profile-thematic-title")?.textContent.trim(),
      econTitle:econ.querySelector(".location-profile-thematic-title")?.textContent.trim(),
      govProse:[...gov.querySelectorAll(".location-profile-thematic-prose")].map(el=>el.textContent.trim()),
      govFacts:[...gov.querySelectorAll(".location-profile-fact")].map(el=>el.textContent.trim()),
      govChipsGroups:[...gov.querySelectorAll(".location-profile-thematic-chips-label")].map(el=>el.textContent.trim()),
      econProse:[...econ.querySelectorAll(".location-profile-thematic-prose")].map(el=>el.textContent.trim()),
      econFacts:[...econ.querySelectorAll(".location-profile-fact")].map(el=>el.textContent.trim())
    };
  });
  if(state.govHidden||state.econHidden)throw new Error("1: both populated B3B modules must be visible in Read");
  if(!state.order)throw new Error("1: Government & Society must render before Economy");
  if(!state.econBeforeScenes)throw new Error("1: Economy must render before 'Сцены здесь'");
  if(state.govTitle!=="Государство и общество")throw new Error(`1: unexpected Government heading: ${state.govTitle}`);
  if(state.econTitle!=="Экономика")throw new Error(`1: unexpected Economy heading: ${state.econTitle}`);
  if(!state.govProse.some(t=>t.includes("Политическая обстановка")))throw new Error("1: long politicalSituation must render as prose with its label");
  if(!state.govFacts.some(t=>t.includes("Законы и порядки")))throw new Error("1: short lawsAndRules must render as a compact fact");
  if(!state.govFacts.some(t=>t.includes("Республика")))throw new Error("1: governmentForm must render as a compact fact");
  if(!state.govFacts.some(t=>t.includes("Мэр Альварес")))throw new Error("1: leadership must render as a compact fact");
  if(JSON.stringify(state.govChipsGroups)!==JSON.stringify(["Силы порядка","Учреждения и организации"]))throw new Error(`1: unexpected Government chip groups: ${JSON.stringify(state.govChipsGroups)}`);
  if(!state.econProse.length)throw new Error("1: long economicCharacter must render as prose");
  if(!state.econFacts.some(t=>t.includes("Кроны")))throw new Error("1: currency must render as a compact fact");
  if(!state.econFacts.some(t=>t.includes("Дёшево")))throw new Error("1: costOfLiving must render as a compact fact");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- EDIT LIFECYCLE: add, fill, save, reload, read ---------- */

// 2. Add both modules via the picker, fill primary + secondary fields, Save.
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
await page.click(addChip("Государство и общество"));
await page.fill("#locProfileGovernmentForm","Монархия");
await page.fill("#locProfileLeadership","Королева Ирина");
await page.fill("#locProfilePoliticalSituation","Двор расколот на два лагеря.");
await page.fill("#locProfileLawsAndRules","Ношение оружия в столице запрещено без разрешения.");
{
  const host=await page.$("#locProfileSecurityForces input");
  await host.fill("Королевская гвардия");await host.press("Enter");
}
await page.click("#locProfileAddSectionToggle");
await page.click(addChip("Экономика"));
await page.fill("#locProfileCurrency","Талеры");
await page.fill("#locProfileEconomicCharacter","Экономика растёт за счёт торговли специями.");
{
  const host=await page.$("#locProfileIndustries input");
  await host.fill("Пряности");await host.press("Enter");
}
await page.fill("#locProfileCostOfLiving","Очень дорого в порту.");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const readState=await page.evaluate(()=>({
    govHidden:document.getElementById("locationProfileGovernmentSociety").hidden,
    econHidden:document.getElementById("locationProfileEconomy").hidden
  }));
  if(readState.govHidden||readState.econHidden)throw new Error("2: freshly filled B3B modules must appear in Read immediately after Save");
  const stored=await page.evaluate(()=>locationById("loc-fresh").baseProfile);
  if(stored.governmentSociety.leadership!=="Королева Ирина")throw new Error("2: governmentSociety.leadership did not persist");
  if(JSON.stringify(stored.governmentSociety.securityForces)!==JSON.stringify(["Королевская гвардия"]))throw new Error("2: securityForces chip did not persist");
  if(stored.economy.currency!=="Талеры")throw new Error("2: economy.currency did not persist");
  if(JSON.stringify(stored.economy.industries)!==JSON.stringify(["Пряности"]))throw new Error("2: industries chip did not persist");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// 3. Survives a fresh page load (real persistence, not just in-session state).
{
  const reloaded=await freshPage();
  const stored=await reloaded.evaluate(()=>locationById("loc-fresh").baseProfile);
  if(stored.governmentSociety.governmentForm!=="Монархия")throw new Error("3: governmentSociety did not survive reload");
  if(stored.economy.economicCharacter!=="Экономика растёт за счёт торговли специями.")throw new Error("3: economy did not survive reload");
  await reloaded.close();
}

/* ---------- HIDE / SHOW ---------- */

// 4. Hide Government & Society: canonical data preserved, module absent from Read, survives
// reload, Show restores it with data intact.
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
// Government already has data, so its disclosure auto-expands on entry -- no toggle click needed
// (clicking the toggle here would COLLAPSE it instead, since it starts expanded).
await page.click("#locProfileGovernmentSocietyHide");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
if(!await page.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden))throw new Error("4: hidden Government must not appear in Read");
{
  const stored=await page.evaluate(()=>locationById("loc-fresh").baseProfile.governmentSociety);
  if(stored.governmentForm!=="Монархия")throw new Error("4: hiding must not delete canonical data");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());
{
  const reloaded=await freshPage();
  await reloaded.evaluate(()=>openLocationProfile("loc-fresh"));
  if(!await reloaded.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden))throw new Error("4: hidden state must survive reload");
  await reloaded.click("#locationProfileEdit");
  await reloaded.click("#locProfileAddSectionToggle");
  await reloaded.click(addChip("Государство и общество"));
  if(await reloaded.evaluate(()=>document.getElementById("locProfileGovernmentForm").value)!=="Монархия")throw new Error("4: Show must restore the module with its data intact");
  await reloaded.click("#locationProfileSave");
  await reloaded.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
  if(await reloaded.evaluate(()=>document.getElementById("locationProfileGovernmentSociety").hidden))throw new Error("4: shown-again Government must appear in Read");
  await reloaded.close();
}

/* ---------- DELETE DATA ---------- */

// 5. Delete Economy's data: confirm flow removes it from Read and canonical data, Government
// (sibling) untouched.
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
// Economy already has data, so its disclosure auto-expands on entry -- no toggle click needed.
await page.click("#locProfileEconomyDeleteStart");
await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-yes");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const readHidden=await page.evaluate(()=>document.getElementById("locationProfileEconomy").hidden);
  if(!readHidden)throw new Error("5: deleted Economy must not appear in Read");
  const stored=await page.evaluate(()=>locationById("loc-fresh").baseProfile);
  if("economy" in stored)throw new Error("5: deleted Economy must be fully removed from base_profile");
  if(!stored.governmentSociety||stored.governmentSociety.governmentForm!=="Монархия")throw new Error("5: deleting Economy must not disturb sibling Government data");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- SIBLING ISOLATION (all four modules) ---------- */

// 6. Editing governmentSociety must not mutate economy; deleting economy must not mutate
// geography; hidden governmentSociety must not hide appearanceAtmosphere.
await page.evaluate(()=>openLocationProfile("loc-isolation"));
await page.click("#locationProfileEdit");
// All four modules on this fixture already have data, so every disclosure auto-expands on entry
// -- no toggle clicks needed (clicking a toggle here would COLLAPSE it instead).
await page.fill("#locProfileLeadership","Новый регент");
await page.click("#locProfileEconomyDeleteStart");
await page.click("#locProfileEconomyDeleteConfirm .location-thematic-delete-confirm-yes");
await page.click("#locProfileGovernmentSocietyHide");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const stored=await page.evaluate(()=>locationById("loc-isolation").baseProfile);
  if("economy" in stored)throw new Error("6: economy deletion did not take effect");
  if(stored.geography?.terrain!=="Равнина")throw new Error("6: deleting economy must not mutate geography");
  if(stored.governmentSociety?.leadership!=="Новый регент")throw new Error("6: governmentSociety edit must persist even though the module ends up hidden");
  const appearanceReadHidden=await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden);
  if(appearanceReadHidden)throw new Error("6: hiding Government must not hide sibling Appearance");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- TYPE RECOMMENDATIONS (guidance only) ---------- */

// 7. A country-typed Location: both new modules get the restrained "Рекомендуется" text hint in
// the add panel; the hint is carried by visible text, not color alone.
await page.evaluate(()=>openLocationProfile("loc-fresh")); // typePreset:"country"
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
{
  const panelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
  if(!panelText.includes("Рекомендуется"))throw new Error("7: country-typed Location must show the recommendation hint text for governmentSociety/economy");
  const tagCount=await page.evaluate(()=>document.querySelectorAll("#locProfileAddSectionPanel .location-thematic-add-chip-recommend-tag").length);
  if(tagCount<1)throw new Error("7: recommendation hint must render as a real element with text, not merely a color/class with no content");
}
await cancelEdit(page);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// 8. A room-typed Location: no recommendation hint, but both modules remain addable (guidance
// never blocks a manual add).
await page.evaluate(()=>openLocationProfile("loc-room"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
{
  const panelText=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").textContent);
  if(panelText.includes("Рекомендуется"))throw new Error("8: a room-typed Location must not show the recommendation hint");
  const govChipExists=await page.evaluate(label=>!!document.querySelector(`#locProfileAddSectionPanel .location-thematic-add-chip`),null);
  if(!govChipExists)throw new Error("8: non-recommended modules must remain addable");
}
await page.click(addChip("Государство и общество"));
if(await page.evaluate(()=>document.getElementById("locProfileGovernmentSocietyModule").hidden))throw new Error("8: a non-recommended module must still be addable on click");
await cancelEdit(page);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

if(errors.length)throw new Error(`Console/page errors during test run: ${JSON.stringify(errors)}`);
await browser.close();
console.log("location-government-economy-modules-browser.test.mjs OK");
