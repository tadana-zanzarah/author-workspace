import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-full",title:"Глава с сценами",collapsed:false},{id:"chapter-empty",title:"Пустая глава",collapsed:false}],locations:[],tags:[],future:{},scenes:[
  {id:"scene-a",title:"A",date:"",time:"",dateReview:false,chapterId:"chapter-full",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
  {id:"scene-b",title:"B",date:"",time:"",dateReview:false,chapterId:"chapter-full",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}}
]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("compact-empty-state-seeded"))return;sessionStorage.setItem("compact-empty-state-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.click('[data-view="list"]');
  await page.waitForSelector(".compact-chapter-group");

  const tailRow=async(chapterId)=>page.evaluate(chapterId=>{
    const group=document.querySelector(`.compact-chapter-group[data-chapter-id="${chapterId}"]`);
    const rows=[...group.querySelectorAll("tr.compact-drop-position")];
    const tail=rows.at(-1);
    return {isEmptyStyled:tail.classList.contains("compact-empty-drop"),height:tail.getBoundingClientRect().height,text:tail.textContent.trim()};
  },chapterId);

  // A genuinely empty chapter keeps the large, labelled empty-state insertion target.
  const empty=await tailRow("chapter-empty");
  if(!empty.isEmptyStyled||empty.height<30||!empty.text.includes("Сцен пока нет"))throw new Error(`Empty chapter lost its empty-state insertion target: ${JSON.stringify(empty)}`);

  // A populated chapter's tail insertion row must stay a thin, non-intrusive affordance —
  // not a permanent phantom "empty scene" panel — while filters are inactive.
  const full=await tailRow("chapter-full");
  if(full.isEmptyStyled||full.height>15)throw new Error(`Populated chapter shows a phantom empty-state panel after its last scene: ${JSON.stringify(full)}`);

  // Dropping at the end of a populated chapter (tail position, beforeSceneId=null) still works.
  const result=await page.evaluate(()=>compactMoveScene("scene-a",{chapterId:"chapter-full",beforeSceneId:null}));
  if(!result.ok)throw new Error(`End-of-populated-chapter move failed: ${JSON.stringify(result)}`);
  const order=await page.evaluate(()=>data.scenes.map(s=>s.id));
  if(order.join(",")!=="scene-b,scene-a")throw new Error(`Scene was not moved to the end of the chapter: ${order.join(",")}`);

  // Cross-chapter drop into the previously-empty chapter's own insertion target still works.
  const cross=await page.evaluate(()=>compactMoveScene("scene-b",{chapterId:"chapter-empty",beforeSceneId:null}));
  if(!cross.ok)throw new Error(`Cross-chapter move into an empty chapter failed: ${JSON.stringify(cross)}`);

  console.log("Compact list empty-state browser tests passed");
}finally{await browser.close();server.kill()}
