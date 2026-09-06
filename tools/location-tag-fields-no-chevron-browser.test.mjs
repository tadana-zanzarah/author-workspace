// Location Manual UX Batch B, B8: the shared multi-value combobox (js/multi-value-input.js) must
// not render a dropdown chevron/toggle, nor a fake empty suggestion menu, for a field created with
// an EMPTY initial suggestions array (every Location free-tag field today: aliases,
// notableFeatures, naturalFeatures, securityForces, notableInstitutions, industries, scarcity,
// tradeConnections, peoplesAndGroups, languages, holidays, beliefs). A field created with a
// NON-EMPTY suggestions array (Character favorites/hobbies) must keep its real chevron/dropdown
// exactly as before -- see tools/multi-value-profile-browser.test.mjs for that regression's own
// dedicated, more thorough coverage; this file only re-confirms the chevron/dropdown itself stays
// present there, not the full Character interaction suite.
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

const locations=[{id:"loc-a",name:"Локация А",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""}];
const characters=[{id:"char-a",name:"Персонаж А"}];
const profiles={"char-a":{id:"char-a",characterId:"char-a",name:"Персонаж А"}};
const project={version:11,characters,profiles,chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes:[]};
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await page.evaluate(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.reload({waitUntil:"networkidle"});

// 1. Empty-suggestions Location tag input (aliases) -> no chevron, no fake empty menu on focus,
// free custom value still works via typing + Enter, chips remain editable/removable.
await page.evaluate(()=>openLocationProfile("loc-a"));
await page.click("#locationProfileEdit");
{
  const hasToggle=await page.evaluate(()=>!!document.querySelector("#locProfileAliases .multi-value-toggle"));
  if(hasToggle)throw new Error("1: an empty-suggestions Location tag field must not render a dropdown chevron");
  await page.click("#locProfileAliases input");
  const emptyMenuVisible=await page.evaluate(()=>!document.querySelector("#locProfileAliases .multi-value-list").hidden);
  if(emptyMenuVisible)throw new Error("1: focusing an empty-suggestions field with nothing typed must not open a fake empty suggestion menu");
  const input=page.locator("#locProfileAliases input");
  await input.fill("Старое имя");
  const typingMenuVisible=await page.evaluate(()=>!document.querySelector("#locProfileAliases .multi-value-list").hidden);
  if(!typingMenuVisible)throw new Error("1: typing into an empty-suggestions field must still surface the 'Добавить «...»' custom-add option");
  await input.press("Enter");
  const values=await page.evaluate(()=>multiValueInputs.locationAliases.getValues());
  if(JSON.stringify(values)!==JSON.stringify(["Старое имя"]))throw new Error(`1: free custom value did not get added: ${JSON.stringify(values)}`);
  // Chip remains editable/removable.
  await page.click('#locProfileAliases .multi-value-chip button[aria-label*="Старое имя"]');
  const afterRemove=await page.evaluate(()=>multiValueInputs.locationAliases.getValues());
  if(afterRemove.length)throw new Error("1: chip must remain removable");
}
await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
if(await page.evaluate(()=>document.getElementById("discardChangesModal").style.display)==="flex")await page.click("#discardChanges");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

// 2. Non-empty-suggestions Character field (favorites) -> chevron/dropdown still present, Character
// behavior fully preserved (real regression coverage in tools/multi-value-profile-browser.test.mjs).
await page.evaluate(()=>editProfile("char-a"));
{
  const hasToggle=await page.evaluate(()=>!!document.querySelector("#pf_favorites .multi-value-toggle"));
  if(!hasToggle)throw new Error("2: a Character field with real suggestions must keep its chevron/dropdown toggle");
  await page.click("#pf_favorites input");
  const expanded=await page.evaluate(()=>document.querySelector("#pf_favorites input").getAttribute("aria-expanded"));
  if(expanded!=="true")throw new Error("2: Character suggestion dropdown must still open on focus");
}
await page.evaluate(()=>document.getElementById("cancelProfile").click());

if(errors.length)throw new Error(`Console/page errors during test run: ${JSON.stringify(errors)}`);
await browser.close();
console.log("location-tag-fields-no-chevron-browser.test.mjs OK");
