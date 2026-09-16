import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const project={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false}],locations:[],tags:[],future:{},scenes:[]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  // Stage E2.2.1 real-phone blocker: the original version of this test used
  // a phone-sized viewport but a DESKTOP-emulated Playwright context (mouse
  // events, no isMobile/hasTouch) — a real Android tap dispatches touch
  // events through a different code path, and Playwright only emulates that
  // when explicitly asked. Genuine touch + a mobile UA is the closest this
  // harness can get to "the real visible control through normal app wiring"
  // without an actual device.
  const page=await browser.newPage({
    viewport:{width:390,height:844},
    isMobile:true,
    hasTouch:true,
    userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
  });
  page.setDefaultTimeout(5000);
  const pageErrors=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")pageErrors.push("console: "+message.text())});
  await page.addInitScript(value=>{if(sessionStorage.getItem("quick-scene-seeded"))return;sessionStorage.setItem("quick-scene-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  // Checks the inline style the app itself sets, not Playwright's isVisible() —
  // see tools/mobile-navigation-browser.test.mjs's identical helper/comment
  // (allow-discrete close-fade transition, css/modals.css).
  const displayIs=(id,value)=>page.$eval(`#${id}`,(node,v)=>node.style.display===v,value);
  const flag=id=>page.$eval(`#${id}`,node=>node.hidden);

  // 1. Distinct action, does not replace "+ Новая сцена".
  if(!await page.isVisible("#addFirst"))throw new Error("+ Новая сцена must still exist");
  if(!await page.isVisible("#quickSceneBtn"))throw new Error("Быстрая сцена action must exist");
  if((await page.textContent("#addFirst")).indexOf("Новая сцена")===-1)throw new Error("+ Новая сцена label changed");

  // Real-phone blocker investigation: the reported failure was tested against
  // an actual CLOUD project. Nothing in openQuickScene/openQuickSceneNow
  // branches on cloud vs local mode, but the header's DOM state genuinely
  // differs (setAppState("workspace") unhides #workspaceCloudBar/
  // #workspaceAccountMenu, which stay `hidden` in local mode) — simulate
  // that exact state plus a large realistic project and confirm tapping
  // still opens Quick Scene correctly. This did not reproduce the reported
  // failure during investigation, but it is a real, previously-untested
  // condition worth locking in either way.
  await page.evaluate(()=>{
    document.getElementById("workspaceCloudBar").hidden=false;
    document.getElementById("workspaceAccountMenu").hidden=false;
    document.getElementById("workspaceProjectTitle").textContent="Проект с достаточно длинным названием для проверки переноса";
    document.getElementById("workspaceAccountName").textContent="Автор Тестович";
    const chars=[];for(let i=0;i<15;i++)chars.push({id:"char-"+i,name:"Персонаж "+i});
    const scenes=[];for(let i=0;i<20;i++)scenes.push({id:"scene-existing-"+i,title:"Существующая сцена "+i,date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:"текст",included:true,status:"fixed",people:{}});
    data.characters=chars;data.scenes=scenes;
    render();
  });
  await page.tap("#quickSceneBtn");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="flex");
  await page.waitForSelector("#quickSceneEditor .ProseMirror");
  const focusedUnderCloudHeader=await page.evaluate(()=>document.activeElement.closest("#quickSceneEditor")!==null);
  if(!focusedUnderCloudHeader)throw new Error("Quick Scene must open and focus the writing surface with the cloud-mode header state present");
  await page.tap("#closeQuickScene");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="none");
  // Reset back to a clean, empty project so the existing numbered checks
  // below (which assert on absolute scene counts) are unaffected by this
  // scenario's seeded data.
  await page.evaluate(()=>{data.characters=[];data.scenes=[];render()});

  // 2/3. Opening Quick Scene creates nothing and shows the writing surface
  // first — no title/chapter/status/character/location/tags/metadata form.
  // A genuine touch tap, not a synthesized mouse click.
  await page.tap("#quickSceneBtn");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="flex");
  if((await page.evaluate(()=>data.scenes.length))!==0)throw new Error("Opening Quick Scene must not create a scene");
  if(await flag("quickSceneWriteStep"))throw new Error("Writing step should be the first thing shown");
  if(!await flag("quickSceneTitleStep"))throw new Error("Title-confirmation step must not show before writing");
  if(!await displayIs("sceneModal","")&&!(await displayIs("sceneModal","none")))throw new Error("Full Scene Editor metadata form must not appear");
  await page.waitForSelector("#quickSceneEditor .ProseMirror");
  const focusedIsEditor=await page.evaluate(()=>document.activeElement.closest("#quickSceneEditor")!==null);
  if(!focusedIsEditor)throw new Error("Focus should enter the writing surface promptly");

  // Stage E2.2 real-phone fullscreen microfix: real-device review found a
  // strip of the underlying workspace exposed below the surface (root
  // cause: an ID-scoped per-modal height rule outranking the shared
  // `.mobile-fullscreen-modal` primitive's override by CSS specificity —
  // see css/editor.css). Check the ACTUAL rendered geometry against the
  // page viewport, not just that some fullscreen class/rule exists, since
  // that is exactly the layer that missed the original defect.
  // Honesty note: this runs in Playwright's emulated mobile viewport, which
  // is a fixed CSS viewport box — it does not reproduce Android Chrome's
  // own dynamic (collapsing/expanding) toolbar behavior on a real device.
  // A pass here proves the surface fills the full viewport Playwright
  // reports; it is not itself proof of physical-device geometry, which is
  // why real-phone review remains the final check.
  const viewportSize=page.viewportSize();
  const modalRect=await page.$eval("#quickSceneModal .modal",el=>el.getBoundingClientRect().toJSON());
  const geometryTolerance=2;
  if(Math.abs(modalRect.top-0)>geometryTolerance)throw new Error(`Quick Scene surface must reach the viewport top on phone: top=${modalRect.top}`);
  if(Math.abs(modalRect.left-0)>geometryTolerance)throw new Error(`Quick Scene surface must reach the viewport left on phone: left=${modalRect.left}`);
  if(Math.abs(viewportSize.width-modalRect.right)>geometryTolerance)throw new Error(`Quick Scene surface must reach the viewport right on phone: right=${modalRect.right}, viewport width=${viewportSize.width}`);
  if(Math.abs(viewportSize.height-modalRect.bottom)>geometryTolerance)throw new Error(`Quick Scene surface must reach the viewport bottom on phone: bottom=${modalRect.bottom}, viewport height=${viewportSize.height} (this is the exact real-phone defect: a bottom strip of the underlying workspace left exposed)`);

  // The underlying workspace must not be interactable while Quick Scene is
  // open — probe a point near the bottom-left of the viewport (where the
  // real-phone screenshot showed the exposed strip and the floating
  // "Навигация" control) and confirm it resolves inside the Quick Scene
  // surface, not the workspace behind it.
  const pointBelongsToQuickScene=await page.evaluate(()=>{
    const el=document.elementFromPoint(20,window.innerHeight-10);
    return el!==null&&el.closest("#quickSceneModal")!==null;
  });
  if(!pointBelongsToQuickScene)throw new Error("Underlying workspace must not be reachable/interactable while Quick Scene is open");

  // 4. Whitespace-only content cannot advance/create a scene.
  await page.locator("#quickSceneEditor .ProseMirror").pressSequentially("   ");
  await page.tap("#quickSceneSaveNext");
  await page.waitForTimeout(150);
  if(!await flag("quickSceneTitleStep"))throw new Error("Whitespace-only content must not advance to title confirmation");
  if((await page.textContent("#quickSceneWriteStatus")).trim()==="")throw new Error("Whitespace-only Save should show guidance, not silently no-op");

  // 5/6/7. Real text reaches the title step intact; the suggested title is
  // the first meaningful line, prefilled AND selected (so typing replaces
  // it without a manual clear-first). Clears the whitespace-only content
  // from the previous check first (select-all + type replaces it) rather
  // than appending to it.
  await page.locator("#quickSceneEditor .ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.locator("#quickSceneEditor .ProseMirror").pressSequentially("Она открыла дверь и замерла.\n\nЗа окном шёл снег.");
  await page.tap("#quickSceneSaveNext");
  await page.waitForFunction(()=>!document.getElementById("quickSceneTitleStep").hidden);
  if(!await flag("quickSceneWriteStep"))throw new Error("Writing step should hide once advanced to title confirmation");
  const titleValue=await page.inputValue("#quickSceneTitleInput");
  if(titleValue!=="Она открыла дверь и замерла.")throw new Error(`Unexpected suggested title: ${JSON.stringify(titleValue)}`);
  const selection=await page.$eval("#quickSceneTitleInput",node=>({start:node.selectionStart,end:node.selectionEnd,length:node.value.length}));
  if(selection.start!==0||selection.end!==selection.length)throw new Error(`Suggested title should be fully selected on focus: ${JSON.stringify(selection)}`);
  const activeIsTitleInput=await page.evaluate(()=>document.activeElement.id==="quickSceneTitleInput");
  if(!activeIsTitleInput)throw new Error("Title-confirmation step must focus the title field");

  // 8. Confirming creates exactly one normal Scene, with canonical
  // unassigned/unplaced/default metadata (same defaults as "+ Новая сцена"
  // opened with no explicit position).
  await page.tap("#quickSceneConfirm");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="none");
  const created=await page.evaluate(()=>({
    count:data.scenes.length,scene:data.scenes[0]
  }));
  if(created.count!==1)throw new Error(`Expected exactly one scene, found ${created.count}`);
  if(created.scene.title!=="Она открыла дверь и замерла.")throw new Error("Created scene has the wrong title");
  if(created.scene.chapterId!=="chapter-unassigned")throw new Error(`Quick Scene must use the canonical unassigned chapter, got ${created.scene.chapterId}`);
  if(created.scene.status!=="floating")throw new Error(`Quick Scene must use the canonical unplaced status, got ${created.scene.status}`);
  if(created.scene.writingStatus!=="draft")throw new Error(`Quick Scene must use the canonical default writing status, got ${created.scene.writingStatus}`);
  if(created.scene.sceneText!=="Она открыла дверь и замерла.\n\nЗа окном шёл снег.")throw new Error(`Created scene text does not match what was typed: ${JSON.stringify(created.scene.sceneText)}`);
  if(Object.keys(created.scene.people).length!==0||created.scene.tags.length!==0||created.scene.locationId!=="")throw new Error("Quick Scene must not invent participants/tags/location");

  // 11. The new scene appears through normal rendering (Cards) — not a
  // second/parallel entity type.
  await page.evaluate(()=>{currentView="cards";render()});
  const cardTitle=await page.textContent(".compact-scene-card .compact-card-title");
  if(cardTitle!=="Она открыла дверь и замерла.")throw new Error("New scene did not appear through normal Cards rendering");
  const chapterGroup=await page.textContent(".compact-chapter-title");
  if(!chapterGroup.startsWith("Без главы"))throw new Error("New scene did not render under the unassigned chapter group");

  // 9. Rapid repeated confirmation must not create a duplicate.
  await page.tap("#quickSceneBtn");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="flex");
  await page.locator("#quickSceneEditor .ProseMirror").pressSequentially("Вторая быстрая сцена.");
  await page.tap("#quickSceneSaveNext");
  await page.waitForFunction(()=>!document.getElementById("quickSceneTitleStep").hidden);
  await Promise.all([
    page.evaluate(()=>handleQuickSceneConfirm()),
    page.evaluate(()=>handleQuickSceneConfirm())
  ]);
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="none");
  const afterDouble=await page.evaluate(()=>data.scenes.length);
  if(afterDouble!==2)throw new Error(`Repeated confirmation created a duplicate: expected 2 scenes, found ${afterDouble}`);

  // 12. Cancel before creation (typed content, then discard) creates
  // nothing and preserves nothing (the guard fires, confirms discard).
  const beforeCancel=await page.evaluate(()=>data.scenes.length);
  await page.tap("#quickSceneBtn");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="flex");
  await page.locator("#quickSceneEditor .ProseMirror").pressSequentially("Этот текст должен быть отброшен.");
  await page.tap("#closeQuickScene");
  await page.waitForFunction(()=>document.getElementById("discardChangesModal").style.display==="flex");
  await page.tap("#discardChanges");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="none");
  if((await page.evaluate(()=>data.scenes.length))!==beforeCancel)throw new Error("Cancel before creation must not create a scene");

  // Closing restores normal workspace interaction — the same probe point
  // used above to confirm the workspace was UNreachable while open must now
  // resolve outside Quick Scene.
  const pointRestoredAfterClose=await page.evaluate(()=>{
    const el=document.elementFromPoint(20,window.innerHeight-10);
    return el===null||el.closest("#quickSceneModal")===null;
  });
  if(!pointRestoredAfterClose)throw new Error("Closing Quick Scene must restore normal workspace interaction");

  // Opening and closing with nothing typed must not even prompt — not
  // dirty, closes immediately.
  await page.tap("#quickSceneBtn");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="flex");
  await page.tap("#closeQuickScene");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="none");
  if(await displayIs("discardChangesModal","flex"))throw new Error("Closing untouched Quick Scene should not prompt for discard");

  // 13. A persistence failure preserves the user's typed content/session —
  // the modal stays open, the text is not cleared, no scene is created.
  await page.tap("#quickSceneBtn");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="flex");
  await page.locator("#quickSceneEditor .ProseMirror").pressSequentially("Текст, который нельзя терять при сбое сохранения.");
  await page.tap("#quickSceneSaveNext");
  await page.waitForFunction(()=>!document.getElementById("quickSceneTitleStep").hidden);
  const beforeFailure=await page.evaluate(()=>data.scenes.length);
  await page.evaluate(()=>{
    window.__realCommitDataChange=commitDataChange;
    commitDataChange=()=>({ok:false,userMessage:"Симулированная ошибка сохранения."});
  });
  await page.tap("#quickSceneConfirm");
  await page.waitForFunction(()=>document.getElementById("quickSceneTitleStatus").textContent.trim()!=="");
  const afterFailure=await page.evaluate(()=>({
    count:data.scenes.length,
    stillOpen:document.getElementById("quickSceneModal").style.display==="flex",
    docText:quickSceneEditor.serialize().sceneText,
    titleValue:document.getElementById("quickSceneTitleInput").value
  }));
  await page.evaluate(()=>{commitDataChange=window.__realCommitDataChange});
  if(afterFailure.count!==beforeFailure)throw new Error("A failed save must not create a scene");
  if(!afterFailure.stillOpen)throw new Error("A failed save must keep Quick Scene open");
  if(!afterFailure.docText.includes("нельзя терять"))throw new Error("A failed save must preserve the typed manuscript text");
  if(!afterFailure.titleValue)throw new Error("A failed save must preserve the confirmed title");
  // Recover cleanly: back to writing, discard, close.
  await page.tap("#quickSceneBackToWrite");
  await page.waitForFunction(()=>!document.getElementById("quickSceneWriteStep").hidden);
  await page.tap("#closeQuickScene");
  await page.waitForFunction(()=>document.getElementById("discardChangesModal").style.display==="flex");
  await page.tap("#discardChanges");
  await page.waitForFunction(()=>document.getElementById("quickSceneModal").style.display==="none");

  // 14. "+ Новая сцена" still opens the full Scene Editor, unaffected.
  await page.click("#addFirst");
  await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="flex");
  if((await page.textContent("#sceneModalTitle"))!=="Новая сцена")throw new Error("+ Новая сцена no longer opens the full Scene Editor");
  await page.click("#cancelScene");
  await page.waitForFunction(()=>document.getElementById("sceneModal").style.display==="none");

  // 15. Existing mobile Cards single-tap -> Text Scene (Stage E2.1) remains
  // intact alongside Quick Scene.
  await page.evaluate(()=>{currentView="cards";render()});
  await page.click(".compact-scene-card .compact-card-title >> nth=0");
  await page.waitForFunction(()=>document.getElementById("textModal").style.display==="flex");
  await page.evaluate(()=>document.getElementById("closeText").click());

  if(pageErrors.length)throw new Error(`Unexpected page errors: ${pageErrors.join("; ")}`);

  console.log("Quick Scene browser tests passed");
}finally{await browser.close();server.kill()}
