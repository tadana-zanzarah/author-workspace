// Location Phase B3A.1 browser regression (local mode): the "Внутри" child-locations section
// in the Location Profile -- absent for a leaf, visible with direct project-participating
// children only (grandchildren excluded), name/type/scene-count/summary row content, child-click
// navigation (replacing the Profile content, same modal instance), parent breadcrumb navigation
// staying functional afterwards, progressive "Показать ещё"/"Свернуть" for large child counts,
// long-name rows not overflowing, unchanged direct Scene counts, and B3A Appearance/Geography
// plus correct section order (Description -> Внутри -> thematic modules -> Сцены здесь).
import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});

const loc=(id,name,parentId,extra={})=>({id,name,description:"",officialName:"",aliases:[],parentId,typePreset:null,customTypeLabel:"",shortSummary:"",...extra});

const locations=[
  // B/F/G/I: one-child parent, used for click-navigation + breadcrumb-back + leaf-child checks.
  loc("loc-airport","Аэропорт",null,{typePreset:"transport"}),
  loc("loc-terminal","Терминал 1","loc-airport"),

  // C/D/H: three-children parent, one of which has its own child (grandchild exclusion, and the
  // grandchild becoming a direct child once its OWN parent's Profile is opened).
  loc("loc-country","Вальдория",null,{typePreset:"country"}),
  loc("loc-city-a","Рен","loc-country",{typePreset:"settlement",shortSummary:"Столица, полная шпилей."}),
  loc("loc-city-b","Морхейвен","loc-country",{typePreset:"settlement"}),
  loc("loc-city-c","Тихая гавань","loc-country"),
  loc("loc-district","Старый квартал","loc-city-a"),

  // K/L/M/N: building with 8 direct children (progressive show-more, mixed types, long name,
  // scene counts, thematic modules coexisting with Внутри).
  loc("loc-sher","Шер",null,{typePreset:"building",
    baseProfile:{appearanceAtmosphere:{visualDescription:"Тяжёлые каменные стены."},geography:{terrain:"Городской квартал"}}}),
  loc("loc-dvor","Двор Шера","loc-sher"),
  loc("loc-kabinet-arman","Кабинет Армана","loc-sher",{typePreset:"room"}),
  loc("loc-kabinet-rene","Кабинет Рене","loc-sher",{typePreset:"room"}),
  loc("loc-korridor","Коридор Шера","loc-sher"),
  loc("loc-kuhnya","Кухня","loc-sher",{shortSummary:"Всегда пахнет свежим хлебом."}),
  loc("loc-spalnya-zeina","Спальня Зейна","loc-sher",{typePreset:"room"}),
  loc("loc-stolovaya","Столовая","loc-sher"),
  loc("loc-longname","Потайной ход за старым книжным шкафом в восточном крыле, о котором помнят только слуги","loc-sher",{typePreset:"natural_place"}),
  // A grandchild of Двор Шера -- must never appear in Шер's own direct list.
  loc("loc-dvor-corner","Клумба во дворе","loc-dvor"),

  // M: 22-children parent for the 20+ scenario.
  loc("loc-palace","Огромный дворец",null),
  ...Array.from({length:22},(_,i)=>loc(`loc-palace-room-${String(i+1).padStart(2,"0")}`,`Комната ${i+1}`,"loc-palace"))
];

const scenes=[
  {id:"scene-kuhnya-1",title:"Завтрак",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-kuhnya",tags:[],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{}},
  {id:"scene-kuhnya-2",title:"Ссора",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-kuhnya",tags:[],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{}},
  // Assigned to the GRANDCHILD only -- must never bleed into loc-dvor's own row scene count.
  {id:"scene-corner-1",title:"Тайный разговор",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-dvor-corner",tags:[],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{}}
];

const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations,tags:[],future:{},scenes};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});

const childrenEl=()=>page.locator("#locationProfileChildren");
const childRows=()=>page.evaluate(()=>[...document.querySelectorAll("#locationProfileChildren .location-profile-child-row .location-profile-child-title")].map(el=>el.textContent.trim()));

/* A. Leaf Location (loc-terminal has no children of its own) -> no "Внутри" section at all. */
await page.evaluate(()=>openLocationProfile("loc-terminal"));
if(!await page.evaluate(()=>document.getElementById("locationProfileChildren").hidden))throw new Error("a leaf Location must not render the «Внутри» section");
if((await page.evaluate(()=>document.getElementById("locationProfileChildren").innerHTML.trim())))throw new Error("a leaf Location must not leave placeholder markup in the hidden «Внутри» container");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* B/F/G/I. One child -> section visible; click navigates; breadcrumb back works; child itself is a leaf. */
await page.evaluate(()=>openLocationProfile("loc-airport"));
if(await childrenEl().isHidden())throw new Error("a parent with one child must show the «Внутри» section");
if(JSON.stringify(await childRows())!==JSON.stringify(["Терминал 1"]))throw new Error("one-child parent did not render the expected single row");
await page.click("#locationProfileChildren .location-profile-child-row");
if((await page.evaluate(()=>document.getElementById("locationProfileTitle").textContent))!=="Терминал 1")throw new Error("clicking a child row must navigate the Profile to that child");
if(!await childrenEl().isHidden())throw new Error("the child (a leaf) must not show its own «Внутри» section");
// Parent navigation: existing breadcrumb link must still open the parent.
await page.click("#locationProfileIntro .location-breadcrumb-link");
if((await page.evaluate(()=>document.getElementById("locationProfileTitle").textContent))!=="Аэропорт")throw new Error("breadcrumb parent link must still navigate back to the parent after the «Внутри» addition");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* C/D/H. Three children shown; grandchild excluded; grandchild becomes a direct child of ITS OWN parent. */
await page.evaluate(()=>openLocationProfile("loc-country"));
if(JSON.stringify((await childRows()).sort())!==JSON.stringify(["Морхейвен","Рен","Тихая гавань"].sort()))throw new Error(`country's direct children incorrect: ${JSON.stringify(await childRows())}`);
if((await childRows()).includes("Старый квартал"))throw new Error("a grandchild (city's own child) must not appear in the country's direct child list");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());
await page.evaluate(()=>openLocationProfile("loc-city-a"));
if(JSON.stringify(await childRows())!==JSON.stringify(["Старый квартал"]))throw new Error("opening the city's own Profile must show its own direct child");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* E. Name/type/summary render correctly on a populated row. */
await page.evaluate(()=>openLocationProfile("loc-country"));
{
  const renCity=await page.evaluate(()=>{
    const row=[...document.querySelectorAll("#locationProfileChildren .location-profile-child-row")].find(r=>r.querySelector(".location-profile-child-title").textContent.trim()==="Рен");
    return {
      meta:row.querySelector(".location-profile-child-meta")?.textContent.trim(),
      excerpt:row.querySelector(".location-profile-child-excerpt")?.textContent.trim()
    };
  });
  if(!renCity.meta||!renCity.meta.includes("Населённый пункт"))throw new Error(`type label secondary text missing/wrong for Рен: ${JSON.stringify(renCity)}`);
  if(renCity.excerpt!=="Столица, полная шпилей.")throw new Error("shortSummary excerpt did not render on the child row");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* J. Scene counts stay DIRECT: Кухня shows its own 2 scenes; Двор Шера shows 0 (its
   grandchild's scene must not bleed upward). */
await page.evaluate(()=>openLocationProfile("loc-sher"));
{
  const rows=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll("#locationProfileChildren .location-profile-child-row")].map(r=>[
    r.querySelector(".location-profile-child-title").textContent.trim(),
    r.querySelector(".location-profile-child-meta")?.textContent.trim()||""
  ])));
  if(!rows["Кухня"]?.includes("Сцен 2"))throw new Error(`Кухня row must show its own direct scene count (2): ${JSON.stringify(rows["Кухня"])}`);
  if(rows["Двор Шера"]?.includes("Сцен"))throw new Error(`Двор Шера has zero direct scenes -- its grandchild's scene must not be aggregated upward: ${JSON.stringify(rows["Двор Шера"])}`);
}

/* K/L. Both B3A thematic modules coexist with «Внутри», in the required order:
   Summary/Description -> Внутри -> Appearance -> Geography -> Сцены здесь. */
{
  const state=await page.evaluate(()=>{
    const view=document.getElementById("locationProfileReadView");
    const ids=["locationProfileSummary","locationProfileChildren","locationProfileAppearance","locationProfileGeography"].map(id=>document.getElementById(id));
    const order=ids.map(el=>Array.prototype.indexOf.call(view.children,el)).every((pos,i,arr)=>i===0||pos>arr[i-1]);
    const scenesSection=[...view.querySelectorAll(".profile-section")].find(s=>s.querySelector("#locationProfileScenes"));
    const scenesAfterGeography=Array.prototype.indexOf.call(view.children,scenesSection)>Array.prototype.indexOf.call(view.children,document.getElementById("locationProfileGeography"));
    return {
      childrenHidden:document.getElementById("locationProfileChildren").hidden,
      appearanceHidden:document.getElementById("locationProfileAppearance").hidden,
      geographyHidden:document.getElementById("locationProfileGeography").hidden,
      domOrderCorrect:order,scenesAfterGeography
    };
  });
  if(state.childrenHidden||state.appearanceHidden||state.geographyHidden)throw new Error("Внутри, Appearance and Geography must all be visible together on loc-sher");
  if(!state.domOrderCorrect)throw new Error("section order must be: description -> Внутри -> Appearance -> Geography");
  if(!state.scenesAfterGeography)throw new Error("Сцены здесь must remain reachable after all read-mode sections");
}

/* M. Progressive "Показать ещё": 8 children on loc-sher -> 6 visible + control, expand shows all 8, collapse returns to 6. */
{
  const initialCount=(await childRows()).length;
  if(initialCount!==6)throw new Error(`expected 6 initially-visible children before show-more, got ${initialCount}`);
  const more=await page.locator("#locationProfileChildren .location-profile-children-more").textContent();
  if(!more.includes("2"))throw new Error(`show-more control must report the 2 remaining children, got "${more}"`);
}
await page.click("#locationProfileChildren .location-profile-children-more");
if((await childRows()).length!==8)throw new Error("clicking «Показать ещё» must reveal all 8 children");
if(!(await page.locator("#locationProfileChildren .location-profile-children-more").textContent()).includes("Свернуть"))throw new Error("expanded state must offer a collapse control");
await page.click("#locationProfileChildren .location-profile-children-more");
if((await childRows()).length!==6)throw new Error("«Свернуть» must collapse back to the initial visible count");

/* N. Long child name does not overflow its row/container. */
await page.click("#locationProfileChildren .location-profile-children-more"); // expand again to reach loc-longname
{
  const geometry=await page.evaluate(()=>{
    const row=[...document.querySelectorAll("#locationProfileChildren .location-profile-child-row")].find(r=>r.querySelector(".location-profile-child-title").title.startsWith("Потайной ход"));
    const container=document.getElementById("locationProfileChildren");
    const containerRect=container.getBoundingClientRect();
    return {
      found:!!row,
      overflowsContainer:row?[...row.querySelectorAll("*"),row].some(el=>el.getBoundingClientRect().right>containerRect.right+1):null
    };
  });
  if(!geometry.found)throw new Error("long-name child row not found after expanding");
  if(geometry.overflowsContainer)throw new Error("a long child name must not cause horizontal overflow past the «Внутри» container");
}
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

/* Show-more resets per-Location: opening a different Profile must not carry over expanded state,
   and re-opening a large parent starts collapsed again. */
await page.evaluate(()=>openLocationProfile("loc-palace"));
if((await childRows()).length!==6)throw new Error("opening a different large-child-count Location must start collapsed (expanded state must not leak across Location navigation)");
if(!(await page.locator("#locationProfileChildren .location-profile-children-more").textContent()).includes("16"))throw new Error("22-child parent must report 16 remaining after the initial 6");
await page.click("#locationProfileChildren .location-profile-children-more");
if((await childRows()).length!==22)throw new Error("expanding the 22-child parent must reveal all of them");
await page.evaluate(()=>document.getElementById("locationProfileClose").click());

if(errors.length)throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
console.log("location Phase B3A.1 child-locations browser tests: OK");
await browser.close();
