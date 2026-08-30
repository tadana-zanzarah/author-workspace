import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const characters=Array.from({length:40},(_,i)=>({id:`char-${i}`,name:`Персонаж ${i}`}));
const project={version:11,characters,profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{},scenes:[
  {id:"scene-1",title:"Тест",date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",
   people:{"char-5":{action:"бежит",relationChanges:{"char-9":"друзья"},visibleRelations:["char-9"],legacyState:""}}}
]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  await page.addInitScript(value=>{if(sessionStorage.getItem("scene-participants-seeded"))return;sessionStorage.setItem("scene-participants-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  await page.evaluate(()=>editScene("scene-1"));
  await page.waitForSelector("#sceneModal .modal");

  // A/B. With 40 project characters and one real participant, only that one editor block renders,
  // but the selector still lists all 40 in canonical project order.
  let state=await page.evaluate(()=>({
    blocks:[...document.querySelectorAll(".person-block")].map(b=>b.dataset.participantId),
    options:[...document.querySelectorAll("#sceneParticipantSelect option")].map(o=>o.value)
  }));
  if(state.blocks.length!==1||state.blocks[0]!=="char-5")throw new Error(`Expected exactly one participant block, got: ${JSON.stringify(state.blocks)}`);
  if(state.options.length!==40||state.options[0]!=="char-0"||state.options[39]!=="char-39")throw new Error("Selector must list all 40 project characters in canonical order");

  // D. The existing participant stays visible in the selector, in place, but disabled.
  const existingOption=await page.evaluate(()=>{const o=document.querySelector('#sceneParticipantSelect option[value="char-5"]');return {disabled:o.disabled,text:o.textContent}});
  if(!existingOption.disabled||!existingOption.text.includes("уже в сцене"))throw new Error(`Existing participant option should be visible+disabled: ${JSON.stringify(existingOption)}`);

  // C/E. Add a second participant -> exactly two editor blocks, in canonical project order.
  await page.selectOption("#sceneParticipantSelect","char-2");
  await page.click("#addSceneParticipant");
  state=await page.evaluate(()=>[...document.querySelectorAll(".person-block")].map(b=>b.dataset.participantId));
  if(state.join(",")!=="char-2,char-5")throw new Error(`Two participants should render in canonical (char-2 before char-5) order: ${state.join(",")}`);

  // F. Duplicate add is impossible: the already-added option stays disabled after re-render.
  const dupOption=await page.evaluate(()=>document.querySelector('#sceneParticipantSelect option[value="char-2"]').disabled);
  if(!dupOption)throw new Error("Just-added participant must be disabled in the selector");

  // K. "Что делает персонаж" text set on the pre-existing participant survives the add/re-render.
  const preservedAction=await page.evaluate(()=>document.querySelector('.p-action[data-char-id="char-5"]').value);
  if(preservedAction!=="бежит")throw new Error(`Existing action text was lost on re-render: "${preservedAction}"`);

  // L. Existing explicit relation change / visibility survive too.
  const relation=await page.evaluate(()=>{
    const input=document.querySelector('.rel-value[data-char-id="char-5"][data-target-id="char-9"]');
    const checkbox=document.querySelector('.rel-visible[data-char-id="char-5"][data-target-id="char-9"]');
    return {value:input?.value,explicit:input?.dataset.explicit,checked:checkbox?.checked};
  });
  if(relation.value!=="друзья"||relation.explicit!=="true"||!relation.checked)throw new Error(`Relation change/visibility regressed: ${JSON.stringify(relation)}`);

  // G. Remove a participant from the draft (no prior content -> no confirmation needed).
  await page.click('[data-participant-id="char-2"] .danger');
  state=await page.evaluate(()=>[...document.querySelectorAll(".person-block")].map(b=>b.dataset.participantId));
  if(state.join(",")!=="char-5")throw new Error(`Remove did not take effect: ${state.join(",")}`);

  // Removing a participant WITH content requires an app-native confirmation, not window.confirm().
  await page.evaluate(()=>{window.confirm=()=>{throw new Error("window.confirm() must never be used for this")}});
  await page.click('[data-participant-id="char-5"] .danger');
  const confirmVisible=await page.isVisible("#confirmActionModal");
  if(!confirmVisible)throw new Error("Removing a participant with content must show the app-native confirmation modal");
  await page.click("#confirmActionCancel");
  state=await page.evaluate(()=>[...document.querySelectorAll(".person-block")].map(b=>b.dataset.participantId));
  if(state.join(",")!=="char-5")throw new Error("Cancelling the confirmation must keep the participant");
  await page.click('[data-participant-id="char-5"] .danger');
  await page.click("#confirmActionConfirm");
  state=await page.evaluate(()=>[...document.querySelectorAll(".person-block")].map(b=>b.dataset.participantId));
  if(state.length!==0)throw new Error("Confirmed removal should clear the participant block");

  // H/I. Save/reload preserves the resulting participation and it is zero-write to storage until Save.
  await page.selectOption("#sceneParticipantSelect","char-30");
  await page.click("#addSceneParticipant");
  await page.fill('.p-action[data-char-id="char-30"]',"молчит у окна");
  await page.click("#saveScene");
  await page.waitForTimeout(50);
  let people=await page.evaluate(()=>data.scenes[0].people);
  if(!people["char-30"]||people["char-30"].action!=="молчит у окна"||people["char-5"])throw new Error(`Save did not persist the expected draft state: ${JSON.stringify(people)}`);
  await page.reload({waitUntil:"networkidle"});
  people=await page.evaluate(()=>data.scenes[0].people);
  if(!people["char-30"]||people["char-30"].action!=="молчит у окна")throw new Error(`Reload lost saved participant: ${JSON.stringify(people)}`);

  // J. Changing project character order changes presentation order without changing scene membership.
  await page.evaluate(()=>{
    commitDataChange(next=>{const c=next.characters.find(x=>x.id==="char-30");next.characters=[c,...next.characters.filter(x=>x.id!=="char-30")]});
  });
  await page.evaluate(()=>{
    commitDataChange(next=>{next.scenes[0].people["char-3"]={action:"стоит рядом",relationChanges:{},visibleRelations:[],legacyState:""}});
  });
  await page.evaluate(()=>editScene("scene-1"));
  await page.waitForSelector("#sceneModal .modal");
  state=await page.evaluate(()=>[...document.querySelectorAll(".person-block")].map(b=>b.dataset.participantId));
  if(state.join(",")!=="char-30,char-3")throw new Error(`Participant blocks did not follow the new project order: ${state.join(",")}`);
  const membership=await page.evaluate(()=>Object.keys(data.scenes[0].people).sort().join(","));
  if(membership!=="char-3,char-30")throw new Error(`Reordering the project changed scene membership: ${membership}`);

  console.log("Scene participant selector browser tests passed");
}finally{await browser.close();server.kill()}
