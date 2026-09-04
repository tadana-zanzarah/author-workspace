// Location Adaptive Module Selection (Phase 1) browser regression -- local mode. Covers the
// add/show/hide/remove/delete lifecycle end to end: legacy data with no selection metadata,
// add-empty + persistence across Save/reload, remove of a PERSISTED empty selection (not just an
// unsaved draft one), hide/restore of populated modules with read-mode visibility, the delete
// confirm/cancel/confirm cycle including sibling-module preservation, and the local-mode
// participation_count=1 delete wording (see the Final Contract Addendum §5/§6).
import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});

// loc-legacy-both: real B3A-shaped data, no moduleSelection field at all (every production row
// today). loc-legacy-appearance / loc-legacy-geography: single-module legacy fixtures. loc-fresh:
// no thematic data at all, the add/remove/persistence target.
const locations=[
  {id:"loc-legacy-both",name:"Архивное крыло",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:"",
    baseProfile:{description:"",appearanceAtmosphere:{visualDescription:"Пыльные полки до потолка."},geography:{terrain:"Подземный уровень"}}},
  {id:"loc-fresh",name:"Новая комната",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""}
];
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes:[]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});

const addChip=label=>`.location-thematic-add-chip:has-text("${label}")`;

// 1/2. Legacy data with no moduleSelection metadata at all -- both modules must be visible
// automatically in both Read and Edit, purely from hasData (no migration/backfill required).
await page.evaluate(()=>openLocationProfile("loc-legacy-both"));
{
  const readState=await page.evaluate(()=>({
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
    geographyHidden:document.getElementById("locationProfileGeography").hidden
  }));
  if(readState.appearanceHidden||readState.geographyHidden)throw new Error("1/2: legacy populated modules with no selection metadata must be visible in Read automatically");
}
await page.click("#locationProfileEdit");
{
  const editState=await page.evaluate(()=>({
    appearanceModuleHidden:document.getElementById("locProfileAppearanceModule").hidden,
    geographyModuleHidden:document.getElementById("locProfileGeographyModule").hidden,
    addWrapperHidden:document.getElementById("locationProfileThematicAdd").hidden
  }));
  if(editState.appearanceModuleHidden||editState.geographyModuleHidden)throw new Error("1/2: legacy populated modules must be visible in Edit automatically");
  // B3B (governmentSociety/economy) extended the catalog to four modules -- this fixture only has
  // appearanceAtmosphere/geography data, so governmentSociety/economy remain valid add-panel
  // candidates and "+ Добавить раздел" must stay VISIBLE. (Before B3B, with a two-module catalog,
  // both modules being populated meant zero candidates remained, hence hidden -- that assumption is
  // now stale, not a product regression.)
  if(editState.addWrapperHidden)throw new Error("+ Добавить раздел must remain visible while governmentSociety/economy are still valid unadded candidates");
}
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// 3/4. Add an empty module, Save, and confirm it survives a fresh page (persisted `shown`, not
// just a same-session draft).
await page.evaluate(()=>openLocationProfile("loc-fresh"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
await page.click(addChip("Внешний вид и атмосфера"));
if(await page.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden))throw new Error("3: adding an empty module must render it immediately");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  // Read mode must NOT show an added-but-still-empty module (Read visibility: hasData AND NOT
  // hidden -- shown alone is never enough).
  const readHidden=await page.evaluate(()=>document.getElementById("locationProfileAppearance").hidden);
  if(!readHidden)throw new Error("an added-but-empty module must never appear in Read mode");
  const stored=await page.evaluate(()=>locationById("loc-fresh").moduleSelection);
  if(JSON.stringify(stored)!==JSON.stringify({shown:["appearanceAtmosphere"],hidden:[]}))throw new Error(`4: empty selection did not persist correctly: ${JSON.stringify(stored)}`);
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

const freshPage=async()=>{
  // A genuine reload re-runs this test's own addInitScript seed and clobbers the just-saved
  // localStorage -- open a fresh page in the SAME context instead (same technique as the B3A
  // browser suite), which reads the real persisted localStorage without re-seeding it.
  const p=await context.newPage();p.setDefaultTimeout(5000);p.on("pageerror",error=>errors.push(error.message));
  await p.goto(`${base}?local=1`,{waitUntil:"networkidle"});
  return p;
};

{
  const reloaded=await freshPage();
  const stored=await reloaded.evaluate(()=>locationById("loc-fresh").moduleSelection);
  if(JSON.stringify(stored)!==JSON.stringify({shown:["appearanceAtmosphere"],hidden:[]}))throw new Error(`4: empty selection did not survive a fresh page: ${JSON.stringify(stored)}`);
  await reloaded.evaluate(()=>openLocationProfile("loc-fresh"));
  await reloaded.click("#locationProfileEdit");
  if(await reloaded.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden))throw new Error("4: a persisted empty `shown` module must still render as an accordion after reload");

  // 5. Remove a PERSISTED empty module (not merely an unsaved-draft one) -- must reach
  // persistence, not just clear the in-session draft. A persisted-but-still-empty module starts
  // COLLAPSED on re-entry (same disclosure rule as any other empty module -- see js/locations.js
  // syncLocationProfileThematicFields), so expand it first, same as a real user would.
  if(await reloaded.evaluate(()=>document.getElementById("locProfileAppearanceRemove").hidden))throw new Error("5: an empty module must offer Убрать раздел, not Скрыть/Удалить");
  await reloaded.click("#locProfileAppearanceToggle");
  await reloaded.click("#locProfileAppearanceRemove");
  if(!await reloaded.evaluate(()=>document.getElementById("locProfileAppearanceModule").hidden))throw new Error("5: Убрать раздел must remove the accordion from the draft immediately");
  await reloaded.click("#locationProfileSave");
  await reloaded.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
  const afterRemove=await reloaded.evaluate(()=>locationById("loc-fresh").moduleSelection);
  if(afterRemove&&afterRemove.shown&&afterRemove.shown.length)throw new Error(`5: removing a PERSISTED shown module must clear it from storage on Save: ${JSON.stringify(afterRemove)}`);
  await reloaded.close();
}

// 6/7/8/9. Hide a populated module -> absent from Read -> picker offers "Показать раздел" tagged
// "есть данные" -> restoring it brings it back without touching data. 13: sibling untouched.
await page.evaluate(()=>openLocationProfile("loc-legacy-both"));
await page.click("#locationProfileEdit");
await page.click("#locProfileGeographyHide");
if(await page.evaluate(()=>document.getElementById("locProfileGeographyModule").hidden)!==true)throw new Error("6: Скрыть раздел must remove the accordion immediately");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const readState=await page.evaluate(()=>({
    geographyHidden:document.getElementById("locationProfileGeography").hidden,
    appearanceHidden:document.getElementById("locationProfileAppearance").hidden // 13: sibling module
  }));
  if(!readState.geographyHidden)throw new Error("7: a hidden populated module must not appear in Read mode after Save");
  if(readState.appearanceHidden)throw new Error("13: hiding Geography must not affect the sibling Appearance module");
  const stored=await page.evaluate(()=>locationById("loc-legacy-both").baseProfile.geography);
  if(!stored||stored.terrain!=="Подземный уровень")throw new Error("6: hiding a module must NEVER touch its canonical base_profile data");
}
await page.click("#locationProfileEdit");
await page.click("#locProfileAddSectionToggle");
{
  const panel=await page.evaluate(()=>document.getElementById("locProfileAddSectionPanel").innerHTML);
  if(!panel.includes("Показать раздел")&&!/showLocationThematicModule\('geography'\)/.test(panel))throw new Error(`8: picker must offer "show" (Показать раздел semantics) for a hidden populated module: ${panel}`);
  if(!panel.includes("есть данные"))throw new Error("8: a hidden populated module must be visibly tagged as already having data in the picker");
}
await page.click(addChip("География и природа"));
if(await page.evaluate(()=>document.getElementById("locProfileGeographyModule").hidden))throw new Error("9: Показать раздел must restore the accordion immediately");
if(await page.evaluate(()=>document.getElementById("locProfileTerrain").value)!=="Подземный уровень")throw new Error("9: restoring a hidden module must show its ORIGINAL data, not a blank form");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
if(await page.evaluate(()=>document.getElementById("locationProfileGeography").hidden))throw new Error("9: a restored module must be visible in Read again after Save");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// 10/11/12. Удалить данные раздела: draft-only until Save, Cancel fully reverts, confirmed +
// Saved actually deletes the canonical data. Local-mode participation_count=1 wording (§6).
await page.evaluate(()=>openLocationProfile("loc-legacy-both"));
await page.click("#locationProfileEdit");
await page.click("#locProfileAppearanceDeleteStart");
{
  const warning=await page.evaluate(()=>document.getElementById("locProfileAppearanceDeleteWarning").textContent);
  if(!warning.includes("будут удалены из локации"))throw new Error(`local-mode (participation_count=1) delete warning must use the plain single-project wording, got: ${warning}`);
}
// 11: Cancel the whole edit -- the prepared delete must never reach storage.
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex"){await page.click("#discardChanges");}
{
  const stillThere=await page.evaluate(()=>locationById("loc-legacy-both").baseProfile.appearanceAtmosphere);
  if(!stillThere)throw new Error("11: Cancel after starting a delete confirm must fully discard it -- data must survive");
}
// 12: this time confirm the delete and Save -- canonical data must actually be gone.
await page.click("#locationProfileEdit");
await page.click("#locProfileAppearanceDeleteStart");
await page.click("#locProfileAppearanceDeleteConfirm .location-thematic-delete-confirm-yes");
await page.click("#locationProfileSave");
await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:3000});
{
  const afterDelete=await page.evaluate(()=>locationById("loc-legacy-both").baseProfile);
  if("appearanceAtmosphere" in afterDelete)throw new Error("12: confirmed + saved delete must remove the module key from base_profile entirely");
  if(!afterDelete.geography)throw new Error("13: deleting Appearance must not affect the sibling Geography module's data");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("location adaptive module selection browser tests: OK");
await browser.close();
