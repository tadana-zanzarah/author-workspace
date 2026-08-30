import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});

const emptyPerson=()=>({action:"",legacyState:"",relationChanges:{},visibleRelations:[]});
function baseProject(scenes){
  return {version:11,characters:[],profiles:{},
    chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-two",title:"Глава два",collapsed:false}],
    locations:[],tags:[],future:{},scenes};
}
function scene(id,chapterId,date,dateReview=false,extra={}){
  return {id,title:id,date,time:"",dateReview,chapterId,locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{},...extra};
}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  const seed=async project=>{
    await page.evaluate(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
    await page.reload({waitUntil:"networkidle"});
  };
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // The row's date input was replaced by a compact read-only chronology chip
  // (design/core-workspace-recomposition — raw date/time inputs no longer sit
  // permanently in the matrix row, see .scene-chronology-chip); the chip carries the
  // same review/conflict signal the old input's className used to, so this reads
  // that instead and keeps comparing against the same "", "date-review", "date-conflict" values.
  const classes=async()=>page.evaluate(()=>[...document.querySelectorAll(".scene-row")].map(row=>{
    const chip=row.querySelector(".scene-chronology-chip");
    const dateClass=chip.classList.contains("conflict")?"date-conflict":chip.classList.contains("review")?"date-review":"";
    return {
      id:row.dataset.sceneId,
      dateClass,
      reviewNote:!!row.querySelector(".date-status-note.review"),
      conflictNote:!!row.querySelector(".date-status-note.conflict")
    };
  }));
  const editSceneDate=async(sceneId,newDate)=>{
    await page.evaluate(id=>editScene(id),sceneId);
    await page.waitForSelector("#sceneModal",{state:"visible"});
    await page.fill("#sceneDate",newDate);
    await page.click("#saveScene");
    await page.waitForSelector("#sceneModal",{state:"hidden"});
  };
  const byId=(rows,id)=>rows.find(r=>r.id===id);
  const sceneState=async id=>page.evaluate(id=>{const s=data.scenes.find(x=>x.id===id);return {date:s.date,dateReview:s.dateReview,chapterId:s.chapterId}},id);

  const createScene=async({title,date,insertBeforeSceneId=null,chapterId="chapter-unassigned"})=>{
    await page.evaluate(({insertBeforeSceneId,chapterId})=>openNewSceneAt(insertBeforeSceneId,chapterId),{insertBeforeSceneId,chapterId});
    await page.waitForSelector("#sceneModal",{state:"visible"});
    await page.fill("#sceneTitle",title);
    if(date)await page.fill("#sceneDate",date);
    await page.click("#saveScene");
    await page.waitForSelector("#sceneModal",{state:"hidden"});
  };

  // ---- 1) Add a scene AFTER a reviewed scene with NO date: the reviewed scene must stay clean. ----
  await seed(baseProject([scene("A","chapter-unassigned","2024-01-10"),scene("C","chapter-two","2024-02-01")]));
  await createScene({title:"N-nodate",date:"",insertBeforeSceneId:null,chapterId:"chapter-unassigned"});
  let rows=await classes();
  if(byId(rows,"A").dateClass!=="")throw new Error(`(1) reviewed scene must not react to an undated scene added after it: ${JSON.stringify(rows)}`);
  let n=rows.find(r=>r.id!=="A"&&r.id!=="C");
  if(n.dateClass!=="")throw new Error(`(1) a brand-new undated scene must not show review/conflict styling: ${JSON.stringify(n)}`);
  let cState=await sceneState("C");
  if(cState.dateReview!==false)throw new Error("(1) unrelated chapter's reviewed scene must not be touched");

  // ---- 2) Add a scene AFTER with a LATER, compatible date: no conflict on either. ----
  await seed(baseProject([scene("A","chapter-unassigned","2024-01-10"),scene("C","chapter-two","2024-02-01")]));
  await createScene({title:"N-later",date:"2024-01-15",insertBeforeSceneId:null,chapterId:"chapter-unassigned"});
  rows=await classes();
  if(byId(rows,"A").dateClass!=="")throw new Error(`(2) compatible later date must not conflict A: ${JSON.stringify(rows)}`);
  n=rows.find(r=>r.id!=="A"&&r.id!=="C");
  if(n.dateClass!=="date-review")throw new Error(`(2) the new dated scene should show the not-yet-reviewed state, no conflict: ${JSON.stringify(n)}`);

  // ---- 3) Add a scene AFTER with an EARLIER date: a real, localized conflict. ----
  await seed(baseProject([scene("A","chapter-unassigned","2024-01-10"),scene("C","chapter-two","2024-02-01")]));
  await createScene({title:"N-earlier",date:"2024-01-05",insertBeforeSceneId:null,chapterId:"chapter-unassigned"});
  rows=await classes();
  if(byId(rows,"A").dateClass!=="date-conflict")throw new Error(`(3) an out-of-order next scene must flag A red: ${JSON.stringify(rows)}`);
  n=rows.find(r=>r.id!=="A"&&r.id!=="C");
  if(n.dateClass!=="date-conflict")throw new Error(`(3) the out-of-order scene itself must be flagged: ${JSON.stringify(n)}`);
  cState=await sceneState("C");
  if(cState.dateReview!==false)throw new Error("(3) an unrelated chapter's reviewed scene must stay untouched by a conflict elsewhere");

  // ---- 4) Insert a scene BEFORE a reviewed scene with a compatible (earlier) date: no false warning. ----
  await seed(baseProject([scene("A","chapter-unassigned","2024-01-10"),scene("C","chapter-two","2024-02-01")]));
  await createScene({title:"N-before-ok",date:"2024-01-05",insertBeforeSceneId:"A",chapterId:"chapter-unassigned"});
  rows=await classes();
  if(byId(rows,"A").dateClass!=="")throw new Error(`(4) compatible insert-before must not conflict A: ${JSON.stringify(rows)}`);
  n=rows.find(r=>r.id!=="A"&&r.id!=="C");
  if(n.dateClass!=="date-review")throw new Error(`(4) inserted scene should just need review, no conflict: ${JSON.stringify(n)}`);

  // ---- 5) Insert a scene BEFORE with a date that violates order: real conflict. ----
  await seed(baseProject([scene("A","chapter-unassigned","2024-01-10"),scene("C","chapter-two","2024-02-01")]));
  await createScene({title:"N-before-bad",date:"2024-01-15",insertBeforeSceneId:"A",chapterId:"chapter-unassigned"});
  rows=await classes();
  if(byId(rows,"A").dateClass!=="date-conflict")throw new Error(`(5) a later date inserted before A must conflict: ${JSON.stringify(rows)}`);
  n=rows.find(r=>r.id!=="A"&&r.id!=="C");
  if(n.dateClass!=="date-conflict")throw new Error(`(5) the inserted scene itself must show the conflict: ${JSON.stringify(n)}`);

  // ---- 9) Editing an existing scene's date recomputes only its own local chronology context. ----
  await seed(baseProject([
    scene("A","chapter-unassigned","2024-01-01"),
    scene("B","chapter-unassigned","2024-01-10"),
    scene("D","chapter-unassigned","2024-01-20"),
    scene("C","chapter-two","2024-02-01")
  ]));
  rows=await classes();
  if(rows.some(r=>r.dateClass!==""))throw new Error(`(9) baseline must be clean before edit: ${JSON.stringify(rows)}`);
  await editSceneDate("B","2024-01-25");
  await page.waitForTimeout(50);
  rows=await classes();
  if(byId(rows,"A").dateClass!=="")throw new Error(`(9) A must stay clean after a distant edit: ${JSON.stringify(rows)}`);
  if(byId(rows,"B").dateClass!=="date-conflict"||byId(rows,"D").dateClass!=="date-conflict")throw new Error(`(9) edited date must recompute B/D as conflicting: ${JSON.stringify(rows)}`);
  cState=await sceneState("C");
  if(cState.dateReview!==false)throw new Error("(9) unrelated chapter's reviewed scene must stay untouched by a same-chapter edit");
  // Fix the date back: conflict must clear again, localized.
  await editSceneDate("B","2024-01-15");
  await page.waitForTimeout(50);
  rows=await classes();
  if(rows.some(r=>r.id!=="C"&&r.dateClass==="date-conflict"))throw new Error(`(9) conflict must clear once the date is back in range: ${JSON.stringify(rows)}`);

  // ---- 6 & 7) Drag-and-drop reorder in the table view (correct vs. chronologically-incorrect position). ----
  const dragTo=async(sceneId,targetSceneId,after)=>page.evaluate(({sceneId,targetSceneId,after})=>{
    const handle=document.querySelector(`[data-scene-id="${sceneId}"] .drag-handle`);
    const targetRow=document.querySelector(`[data-scene-id="${targetSceneId}"]`);
    const rect=targetRow.getBoundingClientRect();
    const clientY=after?rect.bottom-1:rect.top+1;
    const transfer=new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    targetRow.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY}));
    targetRow.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer,clientY}));
    handle.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:transfer}));
  },{sceneId,targetSceneId,after});

  // Move within the SAME chapter to a chronologically CORRECT slot: U (undated) moves between A and B, no conflict.
  await seed(baseProject([
    scene("A","chapter-unassigned","2024-01-01"),
    scene("U","chapter-unassigned",""),
    scene("B","chapter-unassigned","2024-01-10"),
    scene("C","chapter-two","2024-02-01")
  ]));
  await dragTo("U","A",true); // drop U right after A (a no-op reorder, still between A and B)
  await page.waitForTimeout(50);
  rows=await classes();
  if(rows.some(r=>r.dateClass==="date-conflict"))throw new Error(`(6) valid DnD reorder must not create a conflict: ${JSON.stringify(rows)}`);
  cState=await sceneState("C");
  if(cState.dateReview!==false)throw new Error("(6) DnD in one chapter must not touch an unrelated chapter's reviewed scene");

  // Move a scene via DnD to a chronologically INCORRECT slot: dragging D (2024-01-20) before A (2024-01-01).
  await seed(baseProject([
    scene("A","chapter-unassigned","2024-01-01"),
    scene("B","chapter-unassigned","2024-01-10"),
    scene("D","chapter-unassigned","2024-01-20"),
    scene("C","chapter-two","2024-02-01")
  ]));
  await dragTo("D","A",false); // drop D BEFORE A
  await page.waitForTimeout(50);
  rows=await classes();
  const order=await page.evaluate(()=>data.scenes.map(s=>s.id));
  if(order[0]!=="D"||order[1]!=="A")throw new Error(`(7) DnD did not reorder as expected: ${order}`);
  if(byId(rows,"D").dateClass!=="date-conflict"||byId(rows,"A").dateClass!=="date-conflict")throw new Error(`(7) an out-of-order DnD move must flag a real conflict: ${JSON.stringify(rows)}`);
  if(byId(rows,"B").dateClass==="date-conflict")throw new Error(`(7) B must not be dragged into the conflict it is not part of: ${JSON.stringify(rows)}`);
  cState=await sceneState("C");
  if(cState.dateReview!==false)throw new Error("(7) an unrelated chapter's reviewed scene must not be invalidated by a cross-scene conflict elsewhere");
  const dState=await sceneState("D");
  if(dState.dateReview!==true)throw new Error("(7) the MOVED scene itself is expected to need re-review after DnD");

  // Cross-chapter DnD: move C (chapter-two) in front of A (chapter-unassigned) with an incompatible date.
  await seed(baseProject([
    scene("A","chapter-unassigned","2024-01-01"),
    scene("B","chapter-unassigned","2024-01-10"),
    scene("C","chapter-two","2024-02-01")
  ]));
  const moveResult=await page.evaluate(()=>compactMoveScene("C",{chapterId:"chapter-unassigned",beforeSceneId:"A"}));
  if(!moveResult.ok)throw new Error(`Cross-chapter move failed: ${JSON.stringify(moveResult)}`);
  await page.evaluate(()=>render());
  rows=await classes();
  const finalOrder=await page.evaluate(()=>data.scenes.map(s=>s.id));
  if(finalOrder[0]!=="C")throw new Error(`Cross-chapter move did not reorder: ${finalOrder}`);
  // C (2024-02-01) now sits right before A (2024-01-01) in the SAME chapter: a real conflict.
  if(byId(rows,"C").dateClass!=="date-conflict"||byId(rows,"A").dateClass!=="date-conflict")throw new Error(`Cross-chapter move into an incompatible slot must flag a real conflict: ${JSON.stringify(rows)}`);

  console.log("Scene chronology (local mode) browser tests passed");
}finally{await browser.close();server.kill()}
