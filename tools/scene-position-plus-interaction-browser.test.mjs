// Regression coverage for the design/scene-surfaces-visual-system corrective pass:
// the shared positional "+" insertion control (Matrix/Cards/Compact) used to jump
// away from its own anchor point on press because the global `button:active{
// transform:translateY(1px)}` rule (css/base.css) had higher specificity than the
// control's own centering `transform:translate(-50%,-50%)` and fully replaced it.
// It also relied on `:focus-within` to reveal itself, which stayed matched after
// the modal manager restored focus to the control once a Create Scene modal it
// opened was closed — making the "+" look permanently "stuck open" after any
// mouse-driven open+cancel, until the user clicked elsewhere. See css/base.css
// (.position-insert-btn), css/timeline.css (.scene-position-btn) and
// css/layout.css (.card-insert-edge / .compact-position-insert) for the fix.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8092,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});

const project={
  version:11,characters:[],profiles:{},characterLinks:[],
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава первая",collapsed:false}],
  locations:[],tags:[],future:{},
  scenes:[
    {id:"scene-1",title:"Первая",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}},
    {id:"scene-2",title:"Вторая",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"idea",sceneText:"",included:true,status:"floating",people:{}}
  ]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.setDefaultTimeout(8000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}

  const center=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
  const closeTo=(a,b,tol=1)=>Math.abs(a.x-b.x)<=tol&&Math.abs(a.y-b.y)<=tol;

  async function checkView(label,{switchTo,selector,revealSelector}){
    if(switchTo)await page.click(`[data-view="${switchTo}"]`);
    await page.waitForSelector(selector);
    const handle=page.locator(selector).first();
    await handle.scrollIntoViewIfNeeded();

    // -- before hover --
    const restRect=await handle.boundingBox();
    const restCenter=center(restRect);

    // -- hover --
    await page.mouse.move(restCenter.x,restCenter.y);
    await page.waitForTimeout(60);
    const hoverRect=await handle.boundingBox();
    const hoverCenter=center(hoverRect);
    if(!closeTo(restCenter,hoverCenter))throw new Error(`${label}: center moved on hover, rest=${JSON.stringify(restCenter)} hover=${JSON.stringify(hoverCenter)}`);

    // -- pointer down (pressed) --
    await page.mouse.down();
    await page.waitForTimeout(30);
    const pressRect=await handle.boundingBox();
    const pressCenter=center(pressRect);
    if(!closeTo(restCenter,pressCenter))throw new Error(`${label}: center moved on press, rest=${JSON.stringify(restCenter)} press=${JSON.stringify(pressCenter)}`);
    if(pressRect.width<restRect.width-1||pressRect.height<restRect.height-1)
      throw new Error(`${label}: hit target shrank on press, rest=${JSON.stringify(restRect)} press=${JSON.stringify(pressRect)}`);

    // -- pointer up over the same spot -> click opens Create Scene --
    await page.mouse.up();
    if(!await page.locator("#sceneModal").isVisible())throw new Error(`${label}: click on the positional "+" did not open Create Scene`);

    // -- cancel (mouse-driven) -> modal closes, focus is restored to the opener --
    await page.click("#cancelScene");
    await page.waitForTimeout(80);
    if(await page.locator("#sceneModal").isVisible())throw new Error(`${label}: Scene modal stayed open after Cancel`);

    // -- move the mouse away from the control entirely --
    await page.mouse.move(5,5);
    await page.waitForTimeout(80);

    // The control must NOT still read as "revealed" merely because focus was
    // programmatically restored to it by the modal manager after a mouse-driven
    // close — only real hover or genuine keyboard focus may reveal it.
    const revealed=await page.evaluate(sel=>{
      const el=document.querySelector(sel);
      if(!el)return null;
      const cs=getComputedStyle(el);
      return {opacity:parseFloat(cs.opacity)};
    },revealSelector);
    if(!revealed)throw new Error(`${label}: reveal element not found (${revealSelector})`);
    if(revealed.opacity>0.05)throw new Error(`${label}: "+" stayed visually revealed after mouse-driven cancel + pointer moved away, opacity=${revealed.opacity}`);

    // -- keyboard: real Tab navigation must reach it, and Enter must open it --
    // Deliberately real Tab keypresses rather than a scripted .focus() call:
    // Chromium's :focus-visible heuristic tracks genuine keyboard input, and a
    // scripted .focus() (e.g. the modal manager restoring focus to the opener
    // after a mouse-driven close, tested above) does NOT count — confirmed by
    // hand against this exact page before writing this test. Only a real Tab
    // press proves the "stays keyboard-focusable" requirement.
    await page.evaluate(()=>document.activeElement?.blur?.());
    let tabbedIn=false;
    for(let i=0;i<200;i++){
      await page.keyboard.press("Tab");
      const matched=await page.evaluate(sel=>document.activeElement?.matches?.(sel)||false,selector);
      if(matched){tabbedIn=true;break}
    }
    if(!tabbedIn)throw new Error(`${label}: could not reach the positional "+" via real Tab navigation`);
    const outline=await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle);
    if(outline==="none")throw new Error(`${label}: Tab-focused positional "+" has no visible focus indicator`);
    await page.keyboard.press("Enter");
    if(!await page.locator("#sceneModal").isVisible())throw new Error(`${label}: Enter on a Tab-focused positional "+" did not open Create Scene`);
    // Close via Escape for the next view's clean state.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    if(await page.locator("#discardChangesModal").isVisible()){await page.click("#discardChanges");await page.waitForTimeout(80)}
  }

  await checkView("Matrix",{switchTo:"table",selector:".scene-position-btn",revealSelector:".scene-position-btn .position-plus"});
  await checkView("Cards",{switchTo:"cards",selector:".card-insert-edge",revealSelector:".card-insert-edge .position-plus"});
  await checkView("Compact",{switchTo:"list",selector:".compact-position-insert:not(.compact-position-insert-empty)",revealSelector:".compact-position-insert:not(.compact-position-insert-empty)"});

  if(errors.length)throw new Error(`Console/page errors during test: ${errors.join(" | ")}`);
  console.log("Scene position plus interaction browser tests: OK");
}finally{await browser.close();server.kill()}
