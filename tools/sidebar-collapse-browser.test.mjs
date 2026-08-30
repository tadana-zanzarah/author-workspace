import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const project={version:11,characters:[{id:"char-a",name:"Анна"}],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false}],locations:[{id:"loc-1",name:"Дом"}],tags:[{id:"tag-1",name:"тайна"}],future:{},scenes:[]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("sidebar-collapse-seeded"))return;sessionStorage.setItem("sidebar-collapse-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // Tags has no sidebar section any more (workspace-density-navigation: tags are
  // classification/search metadata already covered by the filter bar + Tags manager,
  // not a navigation entity) — only chapters/characters/locations remain here.
  const readState=()=>page.evaluate(()=>Object.fromEntries(["chapters","characters","locations"].map(key=>{
    const toggle=document.querySelector(`[data-sidebar-toggle="${key}"]`),list=document.getElementById({chapters:"sideChapters",characters:"sideCharacters",locations:"sideLocations"}[key]);
    return [key,{expanded:toggle.getAttribute("aria-expanded"),listVisible:getComputedStyle(list).display!=="none"}];
  })));

  let state=await readState();
  if(Object.values(state).some(x=>x.expanded!=="true"||!x.listVisible))throw new Error(`Sections should default to expanded: ${JSON.stringify(state)}`);
  const sideTagsAbsent=await page.evaluate(()=>!document.getElementById("sideTags")&&!document.querySelector('[data-sidebar-toggle="tags"]'));
  if(!sideTagsAbsent)throw new Error("Tags sidebar section should be removed entirely, not just collapsible");

  // Each section collapses independently; manage buttons stay reachable.
  await page.click('[data-sidebar-toggle="characters"]');
  state=await readState();
  if(state.characters.expanded!=="false"||state.characters.listVisible)throw new Error("Characters section did not collapse");
  if(state.chapters.expanded!=="true"||!state.chapters.listVisible||state.locations.expanded!=="true")throw new Error(`Collapsing one section affected another: ${JSON.stringify(state)}`);
  if(!await page.isVisible("#sidebarManageChars"))throw new Error("Manage button became unreachable while section is collapsed");

  await page.click('[data-sidebar-toggle="chapters"]');
  state=await readState();
  if(state.chapters.expanded!=="false"||state.characters.expanded!=="false")throw new Error(`Second collapse should not re-expand the first: ${JSON.stringify(state)}`);

  // Persists across reload as a local UI preference (not project content).
  await page.reload({waitUntil:"networkidle"});
  state=await readState();
  if(state.chapters.expanded!=="false"||state.characters.expanded!=="false"||state.locations.expanded!=="true")throw new Error(`Collapse state did not persist across reload: ${JSON.stringify(state)}`);
  const projectRaw=await page.evaluate(()=>localStorage.getItem("novelTimelineV11"));
  if(projectRaw.includes("sidebarSections"))throw new Error("Sidebar UI preference leaked into project content storage");

  // Re-expand and confirm data underneath is untouched by collapsing.
  await page.click('[data-sidebar-toggle="chapters"]');
  await page.click('[data-sidebar-toggle="characters"]');
  const counts=await page.evaluate(()=>({chapters:data.chapters.length,characters:data.characters.length,locations:data.locations.length,tags:data.tags.length}));
  if(counts.chapters!==2||counts.characters!==1||counts.locations!==1||counts.tags!==1)throw new Error(`Collapsing/expanding mutated project data: ${JSON.stringify(counts)}`);

  console.log("Sidebar collapse browser tests passed");
}finally{await browser.close();server.kill()}
