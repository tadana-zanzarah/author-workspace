// Location Adaptive Modules B3C browser regression (local mode): Population & Culture thematic
// module -- read-mode rendering (fixed field order, prose paragraphs, chip groups), the full
// add/fill/Save/reload/Hide/Show/Delete lifecycle reusing the exact Phase 1 generic shell,
// sibling-module isolation across all five modules, and the B3C type-recommendation hint (guidance
// only -- text-carried, never color-alone; never blocks adding a non-recommended module).
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
  {id:"loc-pop-culture",name:"Портовый город Вейлор",description:"",officialName:"",aliases:[],parentId:null,typePreset:"settlement",customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",
      populationCulture:{
        populationCharacter:"Космополитичный порт: моряки, торговцы и сезонные рабочие со всего побережья — редко кто-то живёт здесь больше одного поколения, не смешавшись с приезжими.",
        peoplesAndGroups:["Докерская гильдия","Северная диаспора"],
        languages:["Общий","Старосеверный"],
        customsAndTraditions:"Новичок в порту обязан поставить первую кружку в таверне у пристани — отказ считается дурным знаком для всего экипажа.",
        holidays:["Праздник прилива"],
        beliefs:["Вера моряков"],
        socialNorms:"Не свистеть на пришвартованном корабле — считается, что этим подзывают шторм."
      }
    }},
  {id:"loc-fresh",name:"Пустой участок",description:"",officialName:"",aliases:[],parentId:null,typePreset:"country",customTypeLabel:"",shortSummary:""},
  {id:"loc-room",name:"Кладовая",description:"",officialName:"",aliases:[],parentId:null,typePreset:"room",customTypeLabel:"",shortSummary:""},
  {id:"loc-isolation",name:"Isolation Fixture",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",
      appearanceAtmosphere:{atmosphere:"Спокойно"},geography:{terrain:"Равнина"},
      governmentSociety:{leadership:"Совет старейшин"},economy:{currency:"Бартер"},
      populationCulture:{populationCharacter:"Небольшая изолированная община."}
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

// 1. The new module renders after Economy (populationCulture is last in catalog order), with the
// B3C read-mode field order: populationCharacter/customsAndTraditions/socialNorms as prose,
// peoplesAndGroups/languages/beliefs/holidays as chip groups in that order.
await page.evaluate(()=>openLocationProfile("loc-pop-culture"));
{
  const state=await page.evaluate(()=>{
    const view=document.getElementById("locationProfileReadView");
    const econ=document.getElementById("locationProfileEconomy");
    const pop=document.getElementById("locationProfilePopulationCulture");
    const scenesSection=[...view.querySelectorAll(".profile-section")].find(s=>s.querySelector("#locationProfileScenes"));
    return {
      popHidden:pop.hidden,
      popAfterEcon:Array.prototype.indexOf.call(view.children,pop)>Array.prototype.indexOf.call(view.children,econ),
      popBeforeScenes:Array.prototype.indexOf.call(view.children,pop)<Array.prototype.indexOf.call(view.children,scenesSection),
      title:pop.querySelector(".location-profile-thematic-title")?.textContent.trim(),
      prose:[...pop.querySelectorAll(".location-profile-thematic-prose")].map(el=>el.textContent.trim()),
      chipGroups:[...pop.querySelectorAll(".location-profile-thematic-chips-label")].map(el=>el.textContent.trim())
    };
  });
  if(state.popHidden)throw new Error("1: populated Population & Culture must be visible in Read");
  if(!state.popAfterEcon)throw new Error("1: Population & Culture must render after Economy");
  if(!state.popBeforeScenes)throw new Error("1: Population & Culture must render before 'Сцены здесь'");
  if(state.title!=="Население и культура")throw new Error(`1: unexpected heading: ${state.title}`);
  if(state.prose.length!==3)throw new Error(`1: expected exactly 3 prose paragraphs (populationCharacter, customsAndTraditions, socialNorms), got ${state.prose.length}`);
  if(!state.prose[0].includes("Космополитичный порт"))throw new Error("1: populationCharacter must render first, as prose");
  if(!state.prose[1].includes("первую кружку"))throw new Error("1: customsAndTraditions must render second, as prose");
  if(!state.prose[2].includes("Не свистеть"))throw new Error("1: socialNorms must render third, as prose");
  if(JSON.stringify(state.chipGroups)!==JSON.stringify(["Народы и сообщества","Языки","Религии и верования","Праздники и важные даты"]))throw new Error(`1: unexpected chip group order: ${JSON.stringify(state.chipGroups)}`);
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- EDIT LIFECYCLE: add, fill, save, reload, read ---------- */

// 2. Add the module via the picker, fill all seven fields, Save.
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
await page.click(addChip("Население и культура"));
await page.fill("#locProfilePopulationCharacter","В основном студенты и преподаватели университета.");
{
  const host=await page.$("#locProfilePeoplesAndGroups input");
  await host.fill("Студенческое братство");await host.press("Enter");
}
{
  const host=await page.$("#locProfileLanguages input");
  await host.fill("Латынь (церемониальный)");await host.press("Enter");
}
await page.fill("#locProfileCustomsAndTraditions","Выпускной устраивают на главной площади при свечах.");
{
  const host=await page.$("#locProfileHolidays input");
  await host.fill("День основания университета");await host.press("Enter");
}
{
  const host=await page.$("#locProfileBeliefs input");
  await host.fill("Культ знания");await host.press("Enter");
}
await page.fill("#locProfileSocialNorms","Не шуметь во дворе библиотеки после десяти вечера.");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const readHidden=await page.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden);
  if(readHidden)throw new Error("2: freshly filled Population & Culture must appear in Read immediately after Save");
  const stored=await page.evaluate(()=>locationById("loc-fresh").baseProfile.populationCulture);
  if(stored.populationCharacter!=="В основном студенты и преподаватели университета.")throw new Error("2: populationCharacter did not persist");
  if(JSON.stringify(stored.peoplesAndGroups)!==JSON.stringify(["Студенческое братство"]))throw new Error("2: peoplesAndGroups chip did not persist");
  if(JSON.stringify(stored.languages)!==JSON.stringify(["Латынь (церемониальный)"]))throw new Error("2: languages chip did not persist");
  if(stored.customsAndTraditions!=="Выпускной устраивают на главной площади при свечах.")throw new Error("2: customsAndTraditions did not persist");
  if(JSON.stringify(stored.holidays)!==JSON.stringify(["День основания университета"]))throw new Error("2: holidays chip did not persist");
  if(JSON.stringify(stored.beliefs)!==JSON.stringify(["Культ знания"]))throw new Error("2: beliefs chip did not persist");
  if(stored.socialNorms!=="Не шуметь во дворе библиотеки после десяти вечера.")throw new Error("2: socialNorms did not persist");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// 3. Survives a fresh page load (real persistence, not just in-session state); Reopen shows exact
// same data (Reopen = re-running populateLocationProfileCore, already exercised by every prior
// openLocationProfile call in this file, so this also covers "reopen" from the task's lifecycle
// list).
{
  const reloaded=await freshPage();
  await reloaded.evaluate(()=>openLocationProfile("loc-fresh"));
  const stored=await reloaded.evaluate(()=>locationById("loc-fresh").baseProfile.populationCulture);
  if(stored.populationCharacter!=="В основном студенты и преподаватели университета.")throw new Error("3: populationCulture did not survive reload");
  if(JSON.stringify(stored.holidays)!==JSON.stringify(["День основания университета"]))throw new Error("3: holidays chip did not survive reload");
  const readHidden=await reloaded.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden);
  if(readHidden)throw new Error("3: reopened Location must show Population & Culture in Read");
  await reloaded.evaluate(()=>document.getElementById("locationProfileClose").click());
  await reloaded.close();
}

/* ---------- HIDE / SHOW ---------- */

// 4. Hide Population & Culture: canonical data preserved, module absent from Read, survives
// reload, Show restores it with data intact (no phantom shown/hidden state left behind).
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
// Already has data, so its disclosure auto-expands on entry -- no toggle click needed (clicking
// the toggle here would COLLAPSE it instead, since it starts expanded).
await page.click("#locProfilePopulationCultureHide");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
if(!await page.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden))throw new Error("4: hidden Population & Culture must not appear in Read");
{
  const stored=await page.evaluate(()=>locationById("loc-fresh").baseProfile.populationCulture);
  if(stored.populationCharacter!=="В основном студенты и преподаватели университета.")throw new Error("4: hiding must not delete canonical data");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());
{
  const reloaded=await freshPage();
  await reloaded.evaluate(()=>openLocationProfile("loc-fresh"));
  if(!await reloaded.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden))throw new Error("4: hidden state must survive reload");
  await reloaded.click("#locationProfileEdit");
  await reloaded.click("#locProfileAddSectionToggle");
  await reloaded.click(addChip("Население и культура"));
  if(await reloaded.evaluate(()=>document.getElementById("locProfilePopulationCharacter").value)!=="В основном студенты и преподаватели университета.")throw new Error("4: Show must restore the module with its data intact");
  await reloaded.click("#locationProfileSave");
  await reloaded.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
  if(await reloaded.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden))throw new Error("4: shown-again Population & Culture must appear in Read");
  // No phantom shown/hidden state: since it now has data, it must not be spuriously tracked as
  // still "shown" in the persisted selection metadata (dropRedundantShownEntries).
  const selection=await reloaded.evaluate(()=>locationById("loc-fresh").moduleSelection);
  if(selection&&(selection.shown||[]).includes("populationCulture"))throw new Error("4: a module with real data must not linger in 'shown' after save (phantom selection state)");
  if(selection&&(selection.hidden||[]).includes("populationCulture"))throw new Error("4: a restored module must not linger in 'hidden' after save (phantom selection state)");
  await reloaded.close();
}

/* ---------- DELETE DATA ---------- */

// 5. Cancel canonical delete: data remains. Confirm canonical delete: module data removed.
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
await page.click("#locProfilePopulationCultureDeleteStart");
await page.click("#locProfilePopulationCultureDeleteConfirm .location-thematic-delete-confirm-no");
{
  const stillHasStart=await page.evaluate(()=>!document.getElementById("locProfilePopulationCultureDeleteStart").hidden);
  if(!stillHasStart)throw new Error("5: cancelling delete must restore the normal action row");
}
await cancelEdit(page);
{
  const stored=await page.evaluate(()=>locationById("loc-fresh").baseProfile.populationCulture);
  if(!stored||stored.populationCharacter!=="В основном студенты и преподаватели университета.")throw new Error("5: cancelling delete (then discarding the edit session) must leave canonical data untouched");
}
await page.click("#locationProfileEdit");
await page.click("#locProfilePopulationCultureDeleteStart");
await page.click("#locProfilePopulationCultureDeleteConfirm .location-thematic-delete-confirm-yes");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const readHidden=await page.evaluate(()=>document.getElementById("locationProfilePopulationCulture").hidden);
  if(!readHidden)throw new Error("5: deleted Population & Culture must not appear in Read");
  const stored=await page.evaluate(()=>locationById("loc-fresh").baseProfile);
  if("populationCulture" in stored)throw new Error("5: deleted Population & Culture must be fully removed from base_profile");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- SIBLING ISOLATION (all five modules) ---------- */

// 6. Editing populationCulture must not mutate any sibling module; another populated module
// (economy) must be unaffected by a populationCulture-only edit + delete.
await page.evaluate(()=>openLocationProfile("loc-isolation"));
await page.click("#locationProfileEdit");
// All five modules on this fixture already have data, so every disclosure auto-expands on entry
// -- no toggle clicks needed (clicking a toggle here would COLLAPSE it instead).
await page.fill("#locProfileSocialNorms","Не шуметь после заката.");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const stored=await page.evaluate(()=>locationById("loc-isolation").baseProfile);
  if(stored.populationCulture?.socialNorms!=="Не шуметь после заката.")throw new Error("6: populationCulture edit did not persist");
  if(stored.economy?.currency!=="Бартер")throw new Error("6: editing populationCulture must not mutate sibling economy");
  if(stored.governmentSociety?.leadership!=="Совет старейшин")throw new Error("6: editing populationCulture must not mutate sibling governmentSociety");
  if(stored.geography?.terrain!=="Равнина")throw new Error("6: editing populationCulture must not mutate sibling geography");
  if(stored.appearanceAtmosphere?.atmosphere!=="Спокойно")throw new Error("6: editing populationCulture must not mutate sibling appearanceAtmosphere");
  const econReadHidden=await page.evaluate(()=>document.getElementById("locationProfileEconomy").hidden);
  if(econReadHidden)throw new Error("6: sibling Economy must remain visible in Read");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- TYPE RECOMMENDATIONS (guidance only) ---------- */

// 7. A country-typed Location: Population & Culture gets the restrained "Рекомендуется" text hint
// in the add panel; the hint is carried by visible text, not color alone.
await page.evaluate(()=>openLocationProfile("loc-fresh")); // typePreset:"country"
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
{
  const chipText=await page.evaluate(()=>{
    const chip=[...document.querySelectorAll("#locProfileAddSectionPanel .location-thematic-add-chip")].find(el=>el.textContent.includes("Население и культура"));
    return chip?.textContent||"";
  });
  if(!chipText.includes("Рекомендуется"))throw new Error("7: country-typed Location must show the recommendation hint text for populationCulture");
}
await cancelEdit(page);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// 8. A room-typed Location: no recommendation hint, but the module remains addable (guidance never
// blocks a manual add) -- confirms a nonrecommended type can still add Population & Culture.
await page.evaluate(()=>openLocationProfile("loc-room"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
{
  const chipText=await page.evaluate(()=>{
    const chip=[...document.querySelectorAll("#locProfileAddSectionPanel .location-thematic-add-chip")].find(el=>el.textContent.includes("Население и культура"));
    return chip?.textContent||"";
  });
  if(chipText.includes("Рекомендуется"))throw new Error("8: a room-typed Location must not show the recommendation hint for populationCulture");
  if(!chipText)throw new Error("8: Population & Culture must remain an addable candidate even without a recommendation");
}
await page.click(addChip("Население и культура"));
if(await page.evaluate(()=>document.getElementById("locProfilePopulationCultureModule").hidden))throw new Error("8: a non-recommended module must still be addable on click");
await cancelEdit(page);
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

if(errors.length)throw new Error(`Console/page errors during test run: ${JSON.stringify(errors)}`);
await browser.close();
console.log("location-population-culture-browser.test.mjs OK");
