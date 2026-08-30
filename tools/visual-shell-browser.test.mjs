import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

// Functional-losslessness regression for the "modern editorial workspace" visual-foundation
// redesign (design/workspace-visual-foundation). This does NOT check pixel-perfect CSS — it
// checks that every function the old two-toolbar shell exposed is still reachable in the new
// merged-header/restyled shell, and that the old+new shell never coexist as duplicate controls.
const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
const project={version:11,
  characters:[{id:"char-a",name:"Анна"},{id:"char-b",name:"Борис"}],
  profiles:{},
  chapters:[
    {id:"chapter-unassigned",title:"Без главы",collapsed:false},
    {id:"chapter-one",title:"Глава 1",collapsed:false}
  ],
  locations:[{id:"loc-1",name:"Дом"}],
  tags:[{id:"tag-1",name:"тайна"}],
  scenes:[
    {id:"scene-1",title:"Сцена один",date:"2026-01-01",time:"10:00",dateReview:false,chapterId:"chapter-one",locationId:"loc-1",tags:["tag-1"],writingStatus:"draft",sceneText:"Текст",included:true,status:"fixed",people:{"char-a":{action:"делает что-то",legacyState:"",relationChanges:{},visibleRelations:[]}}},
    {id:"scene-2",title:"Сцена два",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{"char-b":emptyPerson()}}
  ]};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("visual-shell-seeded"))return;sessionStorage.setItem("visual-shell-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // 1) Project/app identity is visible. Local mode's identity is the header wordmark; the
  //    cloud-only project-title element is checked structurally further below.
  const brand=await page.evaluate(()=>{const h1=document.querySelector("header h1");return {text:h1?.textContent.trim(),visible:h1?.offsetParent!==null}});
  if(!brand.text||!brand.visible)throw new Error(`App identity not visible: ${JSON.stringify(brand)}`);

  // 2) No duplicate/leftover controls from the old two-toolbar shell: every functional id is
  //    unique, and there is exactly one global search field, living in the workspace filter row
  //    (not a second one added to the header).
  const idAudit=await page.evaluate(()=>{
    const ids=[...document.querySelectorAll("[id]")].map(n=>n.id);
    const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
    const searchInputs=[...document.querySelectorAll('input[id="projectSearch"]')].length;
    const headerHasSearch=!!document.querySelector('header input:not([type="file"]):not([type="hidden"])');
    return {duplicates,searchInputs,headerHasSearch};
  });
  if(idAudit.duplicates.length)throw new Error(`Duplicate ids from old+new shell coexisting: ${idAudit.duplicates.join(", ")}`);
  if(idAudit.searchInputs!==1)throw new Error(`Expected exactly one #projectSearch field, found ${idAudit.searchInputs}`);
  if(idAudit.headerHasSearch)throw new Error("A second global search field leaked into the header");

  // 3) "My projects" (now in the account menu, not a standalone header button),
  //    new-scene action and account/project-menu triggers are present, enabled and
  //    keyboard-reachable (not hover-only, not removed). ?local=1 keeps the account
  //    menu hidden (no cloud dashboard concept in local mode), same as backToProjects
  //    was always inert there under the old shell — this only checks DOM presence.
  const reachable=await page.evaluate(()=>{
    const check=id=>{const el=document.getElementById(id);return el?{present:true,enabled:!el.disabled,tabbable:el.tabIndex>=0}:{present:false}};
    return {workspaceProjects:check("workspaceProjects"),noBackToProjects:!document.getElementById("backToProjects"),addFirst:check("addFirst"),projectMenuSummary:!!document.querySelector("#projectMenu summary"),toggleNavigation:check("toggleNavigation")};
  });
  if(!reachable.addFirst.present||!reachable.addFirst.enabled||!reachable.addFirst.tabbable)throw new Error(`+Новая сцена action not reachable: ${JSON.stringify(reachable.addFirst)}`);
  if(!reachable.workspaceProjects.present)throw new Error("workspaceProjects (Мои проекты) control missing from DOM");
  if(!reachable.noBackToProjects)throw new Error("Legacy standalone backToProjects header control should be removed");
  if(!reachable.projectMenuSummary)throw new Error("Project menu trigger missing");
  if(!reachable.toggleNavigation.present||!reachable.toggleNavigation.enabled)throw new Error("Sidebar toggle not reachable");

  // 4) Project menu still exposes every original function.
  await page.click("#projectMenu summary");
  const menuButtons=await page.evaluate(()=>[...document.querySelectorAll("#projectMenu .top-menu-panel button, #projectMenu .top-menu-panel label")].filter(el=>el.offsetParent!==null||el.tagName==="LABEL").map(el=>el.id||el.textContent.trim()));
  for(const expected of ["manageChapters","manageChars","manageLocations","manageTags","openInspector","openSortScenes","clearBtn"])
    if(!menuButtons.includes(expected))throw new Error(`Project menu lost function: ${expected} (menu had: ${menuButtons.join(", ")})`);
  await page.evaluate(()=>{document.getElementById("projectMenu").open=false});

  // 5) Export / full-text functions are present and enabled.
  const exportControls=await page.evaluate(()=>["allScenesBtn","exportTextBtn","exportBtn"].map(id=>{const el=document.getElementById(id);return {id,present:!!el,visible:el?.offsetParent!==null,enabled:el&&!el.disabled}}));
  for(const c of exportControls)if(!c.present||!c.visible||!c.enabled)throw new Error(`Export control regressed: ${JSON.stringify(c)}`);

  // 6) Sidebar sections remain reachable and collapsible (does not regress the accepted
  //    sidebar-collapse behaviour; see sidebar-collapse-browser.test.mjs for the full contract).
  const beforeCollapse=await page.evaluate(()=>document.querySelector('[data-sidebar-toggle="characters"]').getAttribute("aria-expanded"));
  await page.click('[data-sidebar-toggle="characters"]');
  const afterCollapse=await page.evaluate(()=>document.querySelector('[data-sidebar-toggle="characters"]').getAttribute("aria-expanded"));
  if(beforeCollapse!=="true"||afterCollapse!=="false")throw new Error(`Sidebar section did not collapse: ${beforeCollapse} -> ${afterCollapse}`);
  await page.click('[data-sidebar-toggle="characters"]');

  // 7) Filters still work, and clearing an active filter through the new chip UI actually clears it.
  await page.selectOption("#filterCharacter","char-a");
  await page.waitForTimeout(150);
  const filteredCount=await page.evaluate(()=>getVisibleSceneEntries().length);
  if(filteredCount!==1)throw new Error(`Character filter regressed, expected 1 visible scene, got ${filteredCount}`);
  const chipVisible=await page.evaluate(()=>!!document.querySelector(".active-filter-chip"));
  if(!chipVisible)throw new Error("Active filter chip did not render for an active filter");
  await page.click(".active-filter-chip button");
  await page.waitForTimeout(150);
  const clearedFilter=await page.evaluate(()=>filters.character);
  const clearedCount=await page.evaluate(()=>getVisibleSceneEntries().length);
  if(clearedFilter!==""||clearedCount!==2)throw new Error(`Filter chip removal did not clear the filter: filter=${clearedFilter}, visible=${clearedCount}`);

  // 8) View switcher still switches views.
  await page.click('[data-view="cards"]');
  let boardClass=await page.evaluate(()=>document.getElementById("board").className);
  if(!boardClass.includes("view-cards"))throw new Error(`View switch to cards failed: ${boardClass}`);
  await page.click('[data-view="list"]');
  boardClass=await page.evaluate(()=>document.getElementById("board").className);
  if(!boardClass.includes("view-list"))throw new Error(`View switch to list failed: ${boardClass}`);
  await page.click('[data-view="table"]');
  boardClass=await page.evaluate(()=>document.getElementById("board").className);
  if(!boardClass.includes("view-table"))throw new Error(`View switch back to table failed: ${boardClass}`);

  // 9) Save-status and error-banner surfaces still exist and still update on a real save.
  await page.evaluate(()=>{document.getElementById("saveStatus").textContent="";saveData()});
  const saveStatusText=await page.evaluate(()=>document.getElementById("saveStatus").textContent);
  if(!saveStatusText.includes("Сохранено"))throw new Error(`Save status did not update after saveData(): "${saveStatusText}"`);
  const storageBannerPresent=await page.evaluate(()=>!!document.getElementById("storageBanner"));
  if(!storageBannerPresent)throw new Error("storageBanner surface missing");

  // 10) The cloud-only project identity group (#workspaceCloudBar) still exists structurally —
  //     now nested inside the single merged <header> row (design/core-workspace-recomposition
  //     collapsed the old separate two-row shell into one application bar) — still carries the
  //     project-title element, and the account menu is still present and toggled in lockstep with
  //     it, even though none of this can be exercised through a real Supabase login in this
  //     local-mode test.
  const cloudBarStructure=await page.evaluate(()=>{
    const bar=document.getElementById("workspaceCloudBar");
    const account=document.getElementById("workspaceAccountMenu");
    return {present:!!bar,nestedInHeader:bar?.closest("header")!==null,hasTitle:!!document.getElementById("workspaceProjectTitle"),hasAccountMenu:!!account,accountNestedInHeader:account?.closest("header")!==null,accountHiddenMatchesBar:account?.hidden===bar?.hidden};
  });
  if(!cloudBarStructure.present||!cloudBarStructure.nestedInHeader)throw new Error(`workspaceCloudBar structure regressed: ${JSON.stringify(cloudBarStructure)}`);
  if(!cloudBarStructure.hasTitle||!cloudBarStructure.hasAccountMenu||!cloudBarStructure.accountNestedInHeader)throw new Error(`workspaceCloudBar lost a function: ${JSON.stringify(cloudBarStructure)}`);
  if(!cloudBarStructure.accountHiddenMatchesBar)throw new Error(`Account menu visibility no longer matches workspaceCloudBar: ${JSON.stringify(cloudBarStructure)}`);

  // 11) Background becomes inert behind a modal exactly as before (header AND app-shell), which
  //     depends on both staying direct children of <body> after the shell restructuring.
  await page.click("#addFirst");
  await page.waitForSelector("#sceneModal[style*='flex']");
  const inertState=await page.evaluate(()=>({header:document.querySelector("header")?.inert===true,appShell:document.querySelector(".app-shell")?.inert===true}));
  if(!inertState.header||!inertState.appShell)throw new Error(`Background did not become inert behind modal: ${JSON.stringify(inertState)}`);
  await page.click("#cancelScene");

  console.log("Visual-shell functional-losslessness browser tests passed");
}finally{await browser.close();server.kill()}
