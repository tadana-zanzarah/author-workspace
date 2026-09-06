// Location Manual UX Batch B, B2: generic adaptive-module-selection Hide/Show lifecycle
// regression, exercised through a REAL page reload (not a same-tab in-memory check) after every
// Save, for two independent modules that both go through the exact same generic mechanism
// (locationModuleHasData / hideLocationModule / showLocationModule / dropRedundantShownEntries /
// saveNeedsModuleSelectionWrite in js/location-module-selection.js, wired up in js/locations.js).
//
// Investigation note (see completion report): the originally-reported symptom
// (`locProfilePopulationCultureModule.hidden === true` despite real canonical data after a Show
// cycle) was re-derived here from first principles across many isolated repros and traced to a
// STALE BROWSER-TAB REFERENCE in tools/location-population-culture-browser.test.mjs's own test 5
// (continuing on the original `page` after a second, `context.newPage()`-derived tab had performed
// the actual Show+Save) -- not a defect in the generic module-selection mechanism itself. That test
// file's stale-reference bug is fixed alongside this one. This file independently re-proves the
// full cycle end-to-end, through a genuine `page.reload()` (not a second tab), for two modules, so
// any REAL future regression in the generic mechanism is caught even if nobody touches the other
// file again.
import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on("pageerror",error=>errors.push(error.message));
page.on("console",message=>{if(message.type()==="error"&&!/favicon/.test(message.text())&&!/404/.test(message.text()))errors.push(message.text())});

// Seeded via evaluate AFTER goto (not page.addInitScript), so plain page.reload() below always
// reflects the CURRENT localStorage instead of re-seeding the pristine fixture on every navigation.
const locations=[
  {id:"loc-pop",name:"Приморский Вейлор",description:"",officialName:"",aliases:[],parentId:null,typePreset:"settlement",customTypeLabel:"",shortSummary:"",
    baseProfile:{populationCulture:{populationCharacter:"Портовая община."}}},
  {id:"loc-geo",name:"Хребет Иглана",description:"",officialName:"",aliases:[],parentId:null,typePreset:"natural_place",customTypeLabel:"",shortSummary:"",
    baseProfile:{geography:{terrain:"Скалистые пики."}}}
];
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes:[]};
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await page.evaluate(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.reload({waitUntil:"networkidle"});

const MODULE_FIXTURES={
  populationCulture:{locationId:"loc-pop",readViewId:"locationProfilePopulationCulture",hideId:"locProfilePopulationCultureHide",
    firstFieldId:"locProfilePopulationCharacter",label:"Население и культура",originalValue:"Портовая община."},
  geography:{locationId:"loc-geo",readViewId:"locationProfileGeography",hideId:"locProfileGeographyHide",
    firstFieldId:"locProfileTerrain",label:"География и природа",originalValue:"Скалистые пики."}
};

async function runHideShowLifecycle(moduleKey){
  const f=MODULE_FIXTURES[moduleKey];

  // Hide -> Save
  await page.evaluate(id=>openLocationProfile(id),f.locationId);
  await page.click("#locationProfileEdit");
  await page.click(`#${f.hideId}`);
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
  await page.evaluate(()=>document.getElementById("locationProfileClose").click());

  // Reopen via a REAL full page reload -- proves persistence, not just in-session state.
  await page.reload({waitUntil:"networkidle"});
  await page.evaluate(id=>openLocationProfile(id),f.locationId);
  {
    const hidden=await page.evaluate(id=>document.getElementById(id).hidden,f.readViewId);
    if(!hidden)throw new Error(`${moduleKey}: must be hidden in Read after Hide+Save+reload`);
    const stored=await page.evaluate(({locId,key})=>locationById(locId).baseProfile?.[key],{locId:f.locationId,key:moduleKey});
    if(!stored)throw new Error(`${moduleKey}: hiding must not delete canonical data`);
  }

  // Show (via the add-panel's "restore" chip, since it's hidden+populated) -> Save
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAddSectionToggle");
  await page.click(`.location-thematic-add-chip:has-text("${f.label}")`);
  {
    const restoredValue=await page.evaluate(id=>document.getElementById(id).value,f.firstFieldId);
    if(restoredValue!==f.originalValue)throw new Error(`${moduleKey}: Show must restore the module with its data intact, got "${restoredValue}"`);
  }
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
  await page.evaluate(()=>document.getElementById("locationProfileClose").click());

  // Reopen again via a REAL full page reload -- the actual reported symptom's exact repro shape.
  await page.reload({waitUntil:"networkidle"});
  await page.evaluate(id=>openLocationProfile(id),f.locationId);
  {
    const hidden=await page.evaluate(id=>document.getElementById(id).hidden,f.readViewId);
    if(hidden)throw new Error(`${moduleKey}: must be VISIBLE in Read after Hide+Save+reload+Show+Save+reload (this is the reported bug's exact shape)`);
    const stored=await page.evaluate(({locId,key})=>locationById(locId).baseProfile?.[key],{locId:f.locationId,key:moduleKey});
    if(!stored)throw new Error(`${moduleKey}: Show+Save must not have lost canonical data`);
    // No phantom shown/hidden entries left in the persisted selection metadata once the module has
    // real data again (dropRedundantShownEntries).
    const selection=await page.evaluate(id=>locationById(id).moduleSelection,f.locationId);
    if(selection&&(selection.shown||[]).includes(moduleKey))throw new Error(`${moduleKey}: must not linger in 'shown' once it has real data again`);
    if(selection&&(selection.hidden||[]).includes(moduleKey))throw new Error(`${moduleKey}: must not linger in 'hidden' after being shown again`);
  }
  // Edit mode must also show it (not just Read) -- the module's action row (Hide/Delete) must be
  // reachable again, since that's the concrete discoverability complaint (B3) this bug would break.
  await page.click("#locationProfileEdit");
  {
    const hideButtonReachable=await page.evaluate(id=>{
      const el=document.getElementById(id);
      return !!el&&el.offsetParent!==null;
    },f.hideId);
    if(!hideButtonReachable)throw new Error(`${moduleKey}: Hide action must be reachable in Edit after the full Hide/Show cycle`);
  }
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex"){await page.click("#discardChanges")}
  await page.evaluate(()=>document.getElementById("locationProfileClose").click());
}

await runHideShowLifecycle("populationCulture");
await runHideShowLifecycle("geography");

if(errors.length)throw new Error(`Console/page errors during test run: ${JSON.stringify(errors)}`);
await browser.close();
console.log("location-module-visibility-lifecycle-browser.test.mjs OK");
