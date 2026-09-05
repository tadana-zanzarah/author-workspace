// Location History -- HYBRID IMPLEMENTATION browser regression (local mode): base_profile prose
// (historicalOverview/origin/legends) read/edit lifecycle, structured events (add/edit/reorder/
// delete, one-expanded-at-a-time editor, free-form date_label never parsed), the combined
// "hide History hides prose AND events together" contract, dirty-state/exact-revert, and sibling
// (Media/other thematic modules/hierarchy/scenes) isolation. Runs against local mode only -- cloud
// RPC/revision/RLS behavior is covered by supabase/tests/location_history_events_foundation.sql
// instead (requires production schema that has not been applied yet).
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
  {id:"loc-history-full",name:"Академия Вейлор",description:"",officialName:"",aliases:[],parentId:null,typePreset:"building",customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",
      history:{
        origin:"Основана как монастырь на месте старого маяка.",
        historicalOverview:"Позже превращена в военный госпиталь, сгорела во время восстания и была отстроена заново как академия.",
        legends:"Студенты уверяют, что по ночам в библиотеке горит свет в комнате, которой официально не существует."
      }
    },
    historyEvents:[
      {id:"ev-3",title:"Открытие академии","dateLabel":"20 лет назад","description":"","sortOrder":2},
      {id:"ev-1",title:"Основание монастыря","dateLabel":"около 800 года","description":"Первые монахи поселились рядом со старым маяком.","sortOrder":0},
      {id:"ev-2",title:"Пожар во время восстания","dateLabel":"за три века до войны","description":"Пожар уничтожил северное крыло.","sortOrder":1}
    ]},
  {id:"loc-fresh",name:"Пустой участок",description:"",officialName:"",aliases:[],parentId:null,typePreset:"settlement",customTypeLabel:"",shortSummary:""},
  {id:"loc-events-only",name:"Чёрное озеро",description:"",officialName:"",aliases:[],parentId:null,typePreset:"natural_place",customTypeLabel:"",shortSummary:"",
    historyEvents:[{id:"ev-lake","title":"Исчезновение экспедиции",dateLabel:"","description":"Никто так и не узнал, что случилось.","sortOrder":0}]},
  {id:"loc-isolation",name:"Isolation Fixture",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",
      appearanceAtmosphere:{atmosphere:"Спокойно"},geography:{terrain:"Равнина"},
      governmentSociety:{leadership:"Совет старейшин"},economy:{currency:"Бартер"},
      populationCulture:{populationCharacter:"Небольшая изолированная община."},
      history:{origin:"Основана переселенцами."}
    },
    historyEvents:[{id:"ev-iso",title:"Основание",dateLabel:"",description:"",sortOrder:0}]}
];
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes:[]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});

const cancelEdit=async targetPage=>{
  await targetPage.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if(await targetPage.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex"){await targetPage.click("#discardChanges")}
};
const freshPage=async()=>{
  const p=await context.newPage();p.setDefaultTimeout(5000);p.on("pageerror",error=>errors.push(error.message));
  await p.goto(`${base}?local=1`,{waitUntil:"networkidle"});
  return p;
};
const addChip=label=>`.location-thematic-add-chip:has-text("${label}")`;

/* ---------- A. History absent -> no Read section ---------- */
await page.evaluate(()=>openLocationProfile("loc-fresh"));
if(!await page.evaluate(()=>document.getElementById("locationProfileHistory").hidden))throw new Error("A: History must be hidden in Read when neither prose nor events exist");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- F/G/H/I. Read mode: full prose + event list, order, fantasy/undated labels ---------- */
await page.evaluate(()=>openLocationProfile("loc-history-full"));
{
  const state=await page.evaluate(()=>{
    const view=document.getElementById("locationProfileReadView");
    const pop=document.getElementById("locationProfilePopulationCulture");
    const hist=document.getElementById("locationProfileHistory");
    const scenesSection=[...view.querySelectorAll(".profile-section")].find(s=>s.querySelector("#locationProfileScenes"));
    return {
      hidden:hist.hidden,
      afterPop:Array.prototype.indexOf.call(view.children,hist)>Array.prototype.indexOf.call(view.children,pop),
      beforeScenes:Array.prototype.indexOf.call(view.children,hist)<Array.prototype.indexOf.call(view.children,scenesSection),
      html:hist.innerHTML,
      events:[...hist.querySelectorAll(".location-profile-history-event")].map(el=>({
        date:el.querySelector(".location-profile-history-event-date")?.textContent.trim()||"",
        title:el.querySelector(".location-profile-history-event-title")?.textContent.trim(),
        description:el.querySelector(".location-profile-history-event-description")?.textContent.trim()||""
      }))
    };
  });
  if(state.hidden)throw new Error("F: populated History must be visible in Read");
  if(!state.afterPop)throw new Error("F: History must render after Population & Culture");
  if(!state.beforeScenes)throw new Error("F: History must render before 'Сцены здесь'");
  if(!state.html.includes("Основана как монастырь"))throw new Error("F: origin prose must render");
  if(!state.html.includes("военный госпиталь"))throw new Error("F: historicalOverview prose must render");
  if(!state.html.includes("не существует"))throw new Error("F: legends prose must render");
  if(state.events.length!==3)throw new Error(`F: expected 3 events, got ${state.events.length}`);
  if(state.events[0].title!=="Основание монастыря"||state.events[0].date!=="около 800 года")throw new Error("G: events must render oldest-first by sort_order, not insertion order");
  if(state.events[1].title!=="Пожар во время восстания"||state.events[1].date!=="за три века до войны")throw new Error("I: fantasy date label must render verbatim");
  if(state.events[2].title!=="Открытие академии"||state.events[2].date!=="20 лет назад")throw new Error("F: third event out of order");
  if(!state.events[1].description.includes("северное крыло"))throw new Error("F: event description must render");
  // Legends must render AFTER the event list (task brief read order: origin -> overview -> events -> legends).
  const legendsIdx=state.html.indexOf("не существует");
  const eventsIdx=state.html.indexOf("Основание монастыря");
  if(!(eventsIdx<legendsIdx))throw new Error("F: events must render before legends");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- Read mode: events-only Location (no prose at all) still shows the section ---------- */
await page.evaluate(()=>openLocationProfile("loc-events-only"));
{
  const hidden=await page.evaluate(()=>document.getElementById("locationProfileHistory").hidden);
  if(hidden)throw new Error("events-only: History must be visible in Read from events alone, with zero prose");
  const undatedRendersBlank=await page.evaluate(()=>{
    const el=document.getElementById("locationProfileHistory");
    const row=[...el.querySelectorAll(".location-profile-history-event")][0];
    return !row.querySelector(".location-profile-history-event-date");
  });
  if(!undatedRendersBlank)throw new Error("H: an undated event must render with no date element, not a placeholder");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- B-E. Edit lifecycle: add module, fill prose, add events, reorder, edit, Save, reload ---------- */
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
await page.click(addChip("История"));
await page.fill("#locProfileOrigin","Основан беженцами после падения старой столицы.");
await page.fill("#locProfileHistoricalOverview","Быстро вырос благодаря удобной гавани.");
await page.fill("#locProfileLegends","Говорят, под городом спит дракон.");

// G. Add first undated event.
await page.click(".location-history-add-event");
{
  const editingVisible=await page.evaluate(()=>!!document.querySelector("#locProfileHistoryEventsList .location-history-event-card-editing"));
  if(!editingVisible)throw new Error("G: adding an event must auto-expand it for editing");
}
await page.fill("#locProfileHistoryEventsList .location-history-event-card-editing label:nth-of-type(1) input","Событие без даты");
await page.click("#locProfileHistoryEventsList .location-history-event-card-editing button.primary");

// H/K/L/M. Add a second, dated event with an odd fantasy label; edit its title/date/description.
await page.click(".location-history-add-event");
await page.fill("#locProfileHistoryEventsList .location-history-event-card-editing label:nth-of-type(1) input","Пожар уничтожил северное крыло");
await page.fill("#locProfileHistoryEventsList .location-history-event-card-editing label:nth-of-type(2) input","за три века до войны");
await page.fill("#locProfileHistoryEventsList .location-history-event-card-editing textarea","Пожар начался ночью.");
await page.click("#locProfileHistoryEventsList .location-history-event-card-editing button.primary");

// N. Delete an unsaved (draft-only) event, then re-add so the remaining state is deterministic.
await page.click(".location-thematic-add-toggle.location-history-add-event");
await page.click("#locProfileHistoryEventsList .location-history-event-card-editing .location-media-card-delete");
{
  const count=await page.evaluate(()=>document.querySelectorAll("#locProfileHistoryEventsList .location-history-event-card").length);
  if(count!==2)throw new Error(`N: deleting an unsaved draft event must leave exactly the prior 2, got ${count}`);
}

// Q. Dirty state must be set by every History mutation above.
{
  const dirty=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
  if(!dirty)throw new Error("Q: History prose/event edits must mark the Profile dirty");
}

// J. Reorder: move the second (fire) card up, ahead of the undated one.
await page.click("#locProfileHistoryEventsList .location-history-event-card:nth-child(2) button:nth-of-type(1)");
{
  const order=await page.evaluate(()=>[...document.querySelectorAll("#locProfileHistoryEventsList .location-history-event-title")].map(el=>el.textContent.trim()));
  if(order[0]!=="Пожар уничтожил северное крыло")throw new Error(`J: reorder-up must move the fire event first, got ${JSON.stringify(order)}`);
}
// Move it back down so persisted order matches what we assert below.
await page.click("#locProfileHistoryEventsList .location-history-event-card:nth-child(1) button:nth-of-type(2)");

await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const location=await page.evaluate(()=>locationById("loc-fresh"));
  if(location.baseProfile.history.origin!=="Основан беженцами после падения старой столицы.")throw new Error("B: origin did not persist");
  if(location.baseProfile.history.legends!=="Говорят, под городом спит дракон.")throw new Error("B: legends did not persist");
  if(!Array.isArray(location.historyEvents)||location.historyEvents.length!==2)throw new Error("local mode: historyEvents must persist as a plain array on the location record");
  const localShapeOk=location.historyEvents.every(ev=>Object.keys(ev).sort().join(",")==="dateLabel,description,id,sortOrder,title");
  if(!localShapeOk)throw new Error(`local mode: historyEvents must carry ONLY id/title/dateLabel/description/sortOrder, got keys ${JSON.stringify(location.historyEvents.map(ev=>Object.keys(ev)))}`);
  const byTitle=Object.fromEntries(location.historyEvents.map(ev=>[ev.title,ev]));
  if(byTitle["Событие без даты"].sortOrder>=byTitle["Пожар уничтожил северное крыло"].sortOrder)throw new Error("J: the undated event must remain first after the reorder-up-then-down round trip");
  if(byTitle["Пожар уничтожил северное крыло"].dateLabel!=="за три века до войны")throw new Error("L: edited date label did not persist");
  if(byTitle["Пожар уничтожил северное крыло"].description!=="Пожар начался ночью.")throw new Error("M: edited description did not persist");
  const readHidden=await page.evaluate(()=>document.getElementById("locationProfileHistory").hidden);
  if(readHidden)throw new Error("B: freshly filled History must appear in Read immediately after Save");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// Y/Z. Local mode persistence survives a fresh page load (real localStorage, not just in-memory).
{
  const reloaded=await freshPage();
  await reloaded.evaluate(()=>openLocationProfile("loc-fresh"));
  const location=await reloaded.evaluate(()=>locationById("loc-fresh"));
  if(location.historyEvents.length!==2)throw new Error("Y/Z: local mode History events did not survive reload");
  if(location.baseProfile.history.origin!=="Основан беженцами после падения старой столицы.")throw new Error("Y/Z: local mode History prose did not survive reload");
  await reloaded.evaluate(()=>document.getElementById("locationProfileClose").click());
  await reloaded.close();
}

/* ---------- P/R. Cancel with draft-only changes -> exact revert ---------- */
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
const beforeCancel=await page.evaluate(()=>JSON.stringify(locationById("loc-fresh")));
await page.fill("#locProfileOrigin","ИЗМЕНЕНО — должно быть отменено");
await page.click(".location-history-add-event");
await page.fill("#locProfileHistoryEventsList .location-history-event-card-editing label:nth-of-type(1) input","Черновик, который должен исчезнуть");
{
  const dirty=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
  if(!dirty)throw new Error("P: draft prose+event edits must mark dirty before Cancel");
}
await cancelEdit(page);
{
  const afterCancel=await page.evaluate(()=>JSON.stringify(locationById("loc-fresh")));
  if(afterCancel!==beforeCancel)throw new Error("R: Cancel must exactly revert every History mutation (prose + event add), zero DB/storage writes");
  const clean=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
  if(clean)throw new Error("R: after Cancel + revert, the tracker must report clean");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- O. Delete a persisted event ---------- */
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
await page.click("#locProfileHistoryEventsList .location-history-event-card:nth-child(1) .location-media-card-delete");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const location=await page.evaluate(()=>locationById("loc-fresh"));
  if(location.historyEvents.length!==1)throw new Error("O: deleting a persisted event must remove exactly one, leaving the other intact");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* ---------- S/T/U. Hide History -> prose AND events both hidden; data preserved; Show restores both ---------- */
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
await page.click("#locProfileHistoryHide");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const readHidden=await page.evaluate(()=>document.getElementById("locationProfileHistory").hidden);
  if(!readHidden)throw new Error("S: hiding History must hide the whole section (prose AND events) in Read");
  const location=await page.evaluate(()=>locationById("loc-fresh"));
  if(location.historyEvents.length!==1)throw new Error("U: hiding History must NOT delete the event data");
  if(!location.baseProfile.history?.origin)throw new Error("U: hiding History must NOT delete the prose data");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());
{
  const reloaded=await freshPage();
  await reloaded.evaluate(()=>openLocationProfile("loc-fresh"));
  if(!await reloaded.evaluate(()=>document.getElementById("locationProfileHistory").hidden))throw new Error("S: hidden state must survive reload");
  await reloaded.click("#locationProfileEdit");
  await reloaded.click("#locProfileAddSectionToggle");
  await reloaded.click(addChip("История"));
  const eventsRestored=await reloaded.evaluate(()=>document.querySelectorAll("#locProfileHistoryEventsList .location-history-event-card").length);
  if(eventsRestored!==1)throw new Error("T: Show must restore the event list, not just the prose fields");
  await reloaded.click("#locationProfileSave");
  await reloaded.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
  if(await reloaded.evaluate(()=>document.getElementById("locationProfileHistory").hidden))throw new Error("T: unhidden History (prose+events) must reappear in Read");
  await reloaded.close();
}

/* ---------- W/X. Sibling isolation: editing History must not touch other modules, hierarchy, or scenes ---------- */
await page.evaluate(()=>openLocationProfile("loc-isolation"));
await page.click("#locationProfileEdit");
await page.fill("#locProfileLegends","Новая легенда.");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const stored=await page.evaluate(()=>locationById("loc-isolation"));
  if(stored.baseProfile.history.legends!=="Новая легенда.")throw new Error("W: History edit did not persist");
  if(stored.baseProfile.economy?.currency!=="Бартер")throw new Error("W: editing History must not mutate sibling economy");
  if(stored.baseProfile.populationCulture?.populationCharacter!=="Небольшая изолированная община.")throw new Error("W: editing History must not mutate sibling populationCulture");
  if(stored.baseProfile.governmentSociety?.leadership!=="Совет старейшин")throw new Error("W: editing History must not mutate sibling governmentSociety");
  if(stored.baseProfile.geography?.terrain!=="Равнина")throw new Error("W: editing History must not mutate sibling geography");
  if(stored.baseProfile.appearanceAtmosphere?.atmosphere!=="Спокойно")throw new Error("W: editing History must not mutate sibling appearanceAtmosphere");
  if(stored.historyEvents.length!==1||stored.historyEvents[0].title!=="Основание")throw new Error("W: editing prose must not disturb the untouched event list");
  const econReadHidden=await page.evaluate(()=>document.getElementById("locationProfileEconomy").hidden);
  if(econReadHidden)throw new Error("W: sibling Economy must remain visible in Read");
}
// X. Hierarchy/children/scenes regression: the Scenes section and its container must still exist
// and render independently, unaffected by History occupying the section immediately before it.
{
  const scenesOk=await page.evaluate(()=>{
    const container=document.getElementById("locationProfileScenes");
    return !!container&&container.className==="location-profile-scenes";
  });
  if(!scenesOk)throw new Error("X: Scenes section must remain intact and visually distinct from History");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

if(errors.length)throw new Error(`Console/page errors during test run: ${JSON.stringify(errors)}`);
await browser.close();
console.log("location-history-browser.test.mjs OK");
