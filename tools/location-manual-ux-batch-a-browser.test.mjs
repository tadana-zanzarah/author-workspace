// Location Manual UX Batch A -- Profile browser regression suite (local mode, no cloud
// credentials). Covers the two issues that need a real DOM/module-state integration to prove,
// not just the pure decision function each was fixed through:
//
//   #2 CROSS-LOCATION STALE MEDIA/HISTORY -- opening a different Location must never render the
//      previous Location's Media/History, even for one frame, and a same-Location refresh (e.g.
//      the post-Save reopen) must never wipe already-loaded content while its own reload is still
//      pending. Location Media/History are cloud-only (see js/location-media.js's header) --
//      exercising the real async race without real Supabase credentials means installing a small,
//      fully local, controllable stand-in for cloudState.locationMediaApi/cloudProjectSync.api
//      directly in the page (no real network call, no server round trip, just a Promise this test
//      resolves on its own schedule) -- the exact same "manually-resolvable Promise, never a real
//      timer/network" discipline tools/location-history-async-race.test.mjs already uses in Node,
//      just driven through the real DOM/module state instead of one pure function.
//
//   #11 MODAL SCROLL OWNERSHIP -- a long Edit/Read Profile must keep its header and footer action
//      row pinned within the viewport, with .location-profile-scroll as the one and only scrolling
//      region (see css/locations.css's Batch A rules).
//
// Local mode has no async gap for Media/History at all (both load synchronously there -- see
// AGENTS.md "no local binary Media persistence" and this file's own mock below), which is why the
// underlying race could only ever manifest in cloud mode; this suite reproduces that exact cloud
// timing locally by mocking only the two RPC-shaped entry points the real code awaits
// (listMedia/signedUrl, listLocationHistoryEvents), leaving every other cloud code path untouched
// and never invoked by these scenarios.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

const longText=Array.from({length:8},(_,i)=>`Абзац номер ${i+1} с довольно длинным описательным текстом для проверки переполнения формы редактирования локации по вертикали и корректности прокрутки внутри модального окна.`).join(" ");
const scrollLoc={
  id:"loc-scroll",name:"Тестовая локация для скролла",description:longText,officialName:"",aliases:[],parentId:null,
  typePreset:"building",customTypeLabel:"",shortSummary:"Короткое summary",
  baseProfile:{
    appearanceAtmosphere:{visualDescription:longText,atmosphere:longText,notableFeatures:["деталь1","деталь2"]},
    geography:{terrain:longText,climate:longText},
    governmentSociety:{governmentForm:longText,leadership:longText},
    economy:{industries:["торговля"]},
    populationCulture:{peoplesAndGroups:["люди"]},
    history:{origin:longText,historicalOverview:longText}
  },
  moduleSelection:{shown:["appearanceAtmosphere","geography","governmentSociety","economy","populationCulture","history"]}
};
const project={
  version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[
    {id:"loc-a",name:"Локация А",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""},
    {id:"loc-b",name:"Локация Б",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""},
    scrollLoc
  ],
  tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("batch-a-seeded"))return;sessionStorage.setItem("batch-a-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.waitForFunction(()=>typeof openLocationProfile==="function");

  /* ================= #2 CROSS-LOCATION STALE MEDIA/HISTORY ================= */

  // Install a controllable fake cloud environment: no real network, no credentials -- just two
  // RPC-shaped entry points backed by test-controlled Promises, exactly mirroring the shape
  // js/cloud-location-media-api.js / js/cloud-content-api.js's real methods return.
  await page.evaluate(()=>{
    globalThis.cloudProjectSync={
      projectId:"fake-project",
      api:{
        listOwnedLocations:async()=>({ok:true,data:[]}),
        listLocationHistoryEvents:()=>window.__historyFetch||Promise.resolve({ok:true,data:[]})
      }
    };
    cloudState.locationMediaApi={
      listMedia:()=>window.__mediaFetch||Promise.resolve({ok:true,data:[]}),
      signedUrl:async()=>({ok:true,url:"https://example.test/fake.jpg"})
    };
  });

  const mediaHtml=()=>page.evaluate(()=>document.getElementById("locationProfileMedia").innerHTML);
  const historyHtml=()=>page.evaluate(()=>document.getElementById("locationProfileHistory").innerHTML);
  const profileTitle=()=>page.evaluate(()=>document.getElementById("locationProfileTitle").textContent);

  // Open A, resolve its Media/History immediately with distinctive content, let it fully render.
  await page.evaluate(()=>{
    window.__mediaFetch=Promise.resolve({ok:true,data:[{id:"ma",media_kind:"photo",storage_path:"p/ma.jpg",mime_type:"image/jpeg",crop:{x:.5,y:.5,zoom:1},alt:"MEDIA-A-UNIQUE",caption:"",sort_order:0,is_primary:true,revision:0,metadata:{}}]});
    window.__historyFetch=Promise.resolve({ok:true,data:[{id:"ea",title:"EVENT-A-UNIQUE",date_label:"",description:"",sort_order:0,revision:0,metadata:{}}]});
  });
  await page.evaluate(()=>openLocationProfile("loc-a"));
  await page.waitForTimeout(80);
  assert((await mediaHtml()).includes("MEDIA-A-UNIQUE"),"Location A's own Media must render after its fetch resolves");
  assert((await historyHtml()).includes("EVENT-A-UNIQUE"),"Location A's own History must render after its fetch resolves");

  // Switch to B, holding B's fetches pending. Await the switch itself (openLocationProfile's own
  // returned Promise resolves once the synchronous populateLocationProfileCore body has run --
  // the fire-and-forget lazy fetches are still pending after that, which is exactly the window
  // under test) -- never A's content, not even for one frame, while B is still loading.
  await page.evaluate(()=>{
    window.__mediaFetch=new Promise(resolve=>{window.__resolveMediaB=resolve});
    window.__historyFetch=new Promise(resolve=>{window.__resolveHistoryB=resolve});
  });
  await page.evaluate(()=>openLocationProfile("loc-b"));
  assert((await profileTitle())==="Локация Б","opening B must immediately update the Profile title");
  assert(!(await mediaHtml()).includes("MEDIA-A-UNIQUE"),"Location B's Profile must never render Location A's Media, even while B's own fetch is still pending");
  assert(!(await historyHtml()).includes("EVENT-A-UNIQUE"),"Location B's Profile must never render Location A's History, even while B's own fetch is still pending");

  // Resolve B's fetches -- B's own content must appear, and A's must never reappear.
  await page.evaluate(()=>{
    window.__resolveMediaB({ok:true,data:[{id:"mb",media_kind:"photo",storage_path:"p/mb.jpg",mime_type:"image/jpeg",crop:{x:.5,y:.5,zoom:1},alt:"MEDIA-B-UNIQUE",caption:"",sort_order:0,is_primary:true,revision:0,metadata:{}}]});
    window.__resolveHistoryB({ok:true,data:[{id:"eb",title:"EVENT-B-UNIQUE",date_label:"",description:"",sort_order:0,revision:0,metadata:{}}]});
  });
  await page.waitForTimeout(80);
  assert((await mediaHtml()).includes("MEDIA-B-UNIQUE"),"Location B's own Media must render once its fetch resolves");
  assert((await historyHtml()).includes("EVENT-B-UNIQUE"),"Location B's own History must render once its fetch resolves");
  assert(!(await mediaHtml()).includes("MEDIA-A-UNIQUE"),"Location A's Media must never reappear once B's own fetch resolves");
  assert(!(await historyHtml()).includes("EVENT-A-UNIQUE"),"Location A's History must never reappear once B's own fetch resolves");
  assert(await page.evaluate(()=>!trackerFor("locationProfileModal").isDirty()),"closing B after its own load resolves must not require a discard confirmation");

  // Same-Location refresh: reopening the SAME Location (simulating the post-Save reopen) must
  // NOT wipe its already-loaded content while a new reload is pending -- only an actual identity
  // change may clear anything.
  await page.evaluate(()=>{
    window.__mediaFetch=new Promise(()=>{}); // deliberately never resolves
    window.__historyFetch=new Promise(()=>{});
  });
  await page.evaluate(()=>openLocationProfile("loc-b"));
  assert((await mediaHtml()).includes("MEDIA-B-UNIQUE"),"a same-Location refresh must not clear already-loaded Media while its own reload is still pending");
  assert((await historyHtml()).includes("EVENT-B-UNIQUE"),"a same-Location refresh must not clear already-loaded History while its own reload is still pending");

  await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  console.log("cross-Location identity boundary: OK");

  /* ================= #11 MODAL SCROLL OWNERSHIP ================= */

  await page.evaluate(()=>{
    // Back to plain local mode for this section -- no cloud mock needed, Media is hidden entirely
    // in local mode and irrelevant to the scroll-shell structure under test here.
    delete globalThis.cloudProjectSync;
    openLocationProfile("loc-scroll");
    enterLocationProfileEdit();
    for(const key of ["appearanceAtmosphere","geography","governmentSociety","economy","populationCulture","history"]){
      const bodyId={appearanceAtmosphere:"locProfileAppearanceBody",geography:"locProfileGeographyBody",governmentSociety:"locProfileGovernmentSocietyBody",economy:"locProfileEconomyBody",populationCulture:"locProfilePopulationCultureBody",history:"locProfileHistoryBody"}[key];
      const body=document.getElementById(bodyId);
      if(body&&body.hidden)toggleLocationThematicDisclosure(key);
    }
  });

  const scrollShellState=()=>page.evaluate(()=>{
    const modal=document.querySelector("#locationProfileModal .modal");
    const view=document.getElementById("locationProfileEditView");
    const scrollEl=view.querySelector(".location-profile-scroll");
    const header=document.querySelector(".location-profile-header");
    const actions=view.querySelector(".modal-actions");
    return {
      modalOverflow:getComputedStyle(modal).overflow,
      modalIsScrollOwner:modal.scrollHeight>modal.clientHeight,
      scrollElHasOverflow:scrollEl.scrollHeight>scrollEl.clientHeight,
      headerTop:header.getBoundingClientRect().top,
      actionsBottom:actions.getBoundingClientRect().bottom,
      viewportHeight:window.innerHeight
    };
  });

  const before=await scrollShellState();
  assert(before.modalOverflow==="hidden","the outer .modal box must not itself be a scroll container (Batch A #11)");
  assert(!before.modalIsScrollOwner,"the outer .modal box must never need to scroll -- only .location-profile-scroll may");
  assert(before.scrollElHasOverflow,"test setup failed: the long Edit Profile content did not actually overflow .location-profile-scroll");
  assert(before.headerTop>=0&&before.actionsBottom<=before.viewportHeight,"header and footer must both start within the viewport");

  await page.evaluate(()=>{document.querySelector("#locationProfileEditView .location-profile-scroll").scrollTop=1500});
  const after=await scrollShellState();
  assert(after.headerTop===before.headerTop,"scrolling the content region must not move the header");
  assert(after.actionsBottom===before.actionsBottom,"scrolling the content region must not move the footer action row");
  const saveVisible=await page.evaluate(()=>{const r=document.getElementById("locationProfileSave").getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight});
  assert(saveVisible,"Save must remain reachable without scrolling the page/body, even after scrolling deep into a long Edit Profile");

  // Read mode: same shell, Close must stay reachable the same way.
  await page.evaluate(async()=>{await cancelLocationProfileEdit()});
  await page.evaluate(()=>{document.querySelector("#locationProfileReadView .location-profile-scroll").scrollTop=2000});
  const closeVisible=await page.evaluate(()=>{const r=document.getElementById("locationProfileClose").getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight});
  assert(closeVisible,"Close must remain reachable after scrolling a long Read Profile");

  // Nested modal regression: the two-step inline module-delete confirmation must still render
  // correctly inside the new scroll wrapper.
  await page.evaluate(()=>{enterLocationProfileEdit();startDeleteLocationThematicModule("appearanceAtmosphere")});
  const deleteConfirmVisible=await page.evaluate(()=>!document.getElementById("locProfileAppearanceDeleteConfirm").hidden);
  assert(deleteConfirmVisible,"the module canonical-delete confirmation must still appear inside the restructured Edit view");
  await page.evaluate(()=>cancelDeleteLocationThematicModule("appearanceAtmosphere"));

  // Discard-confirmation modal (a SEPARATE modal-backdrop) must still open/resolve correctly on
  // top of the restructured shell.
  await page.evaluate(()=>{
    document.getElementById("locProfileShortSummary").value="changed";
    document.getElementById("locProfileShortSummary").dispatchEvent(new Event("input",{bubbles:true}));
  });
  const closeAttempt=page.evaluate(()=>requestCloseModal("locationProfileModal","test"));
  await page.waitForTimeout(60);
  const discardVisible=await page.evaluate(()=>document.getElementById("discardChangesModal").style.display);
  assert(discardVisible==="flex","the discard-confirmation modal must still appear over the restructured Profile shell");
  await page.evaluate(()=>resolveDiscardConfirmation(true));
  assert(await closeAttempt,"confirming discard must still close the Profile");
  assert((await page.evaluate(()=>document.getElementById("locationProfileModal").style.display))==="none","the Profile modal must actually be closed after confirming discard");

  // Gallery modal (separate CSS, unaffected by this change) must still open normally.
  await page.evaluate(()=>openLocationGallery());
  assert((await page.evaluate(()=>document.getElementById("locationsModal").style.display))==="flex","the Location Gallery modal must be unaffected by the Profile modal's shell restructuring");
  await page.evaluate(()=>forceCloseModal("locationsModal"));

  console.log("modal scroll ownership: OK");
  console.log("location manual ux batch a browser tests passed");
}finally{await browser.close();server.kill()}
