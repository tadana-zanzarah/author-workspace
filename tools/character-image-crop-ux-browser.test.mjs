import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");

const port=3041,server=spawn(process.execPath,["tools/server.mjs"],{env:{...process.env,PORT:String(port)},stdio:"ignore"});

// Tall portrait (240x480): green band in the top 40px, blue band in the bottom 40px,
// red everywhere else — lets geometry checks target the true top/bottom edges.
const tallDataUrl="data:image/svg+xml;base64,"+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="480"><rect width="240" height="480" fill="tomato"/><rect width="240" height="40" fill="green"/><rect y="440" width="240" height="40" fill="blue"/></svg>').toString("base64");
const project={version:11,characters:[{id:"character-a",name:"Анна"},{id:"character-b",name:"Борис"}],profiles:{
  "character-a":{id:"character-a",characterId:"character-a",name:"Анна",photos:[tallDataUrl],hidden:{},initialRelations:{}},
  "character-b":{id:"character-b",characterId:"character-b",name:"Борис",photos:[],hidden:{},initialRelations:{}}
},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]};

try{
  await new Promise(resolve=>setTimeout(resolve,500));
  const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}),page=await browser.newPage({viewport:{width:900,height:800}});
  page.setDefaultTimeout(7000);
  const networkCalls=[];page.on("request",req=>{if(req.url().includes("supabase")||req.method()!=="GET")networkCalls.push(req.url())});
  await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}

  await page.evaluate(()=>editProfile("character-a"));
  await page.waitForSelector("#profileEditorModal",{state:"visible"});
  await page.click('[data-action="crop-photo"]');
  await page.waitForSelector("#photoCropModal",{state:"visible"});
  await page.waitForFunction(()=>document.getElementById("photoCropImage").complete);

  // Drag the viewport by (dxPx,dyPx) via real pointer events, mirroring the app's own handler.
  async function drag(dxPx,dyPx){
    await page.evaluate(([dx,dy])=>{
      const vp=document.getElementById("photoCropViewport"),rect=vp.getBoundingClientRect();
      const sx=rect.left+rect.width/2,sy=rect.top+rect.height/2;
      const fire=(type,x,y)=>vp.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:7,bubbles:true,cancelable:true}));
      fire("pointerdown",sx,sy);fire("pointermove",sx+dx,sy+dy);fire("pointerup",sx+dx,sy+dy);
    },[dxPx,dyPx]);
  }
  async function setCrop(x,y,zoom){await page.evaluate(([x,y,zoom])=>{photoCropState.draft={x,y,zoom};syncCropPreview()},[x,y,zoom])}
  async function crop(){return page.evaluate(()=>({...photoCropState.draft}))}
  // Reads live DOM geometry and reproduces the CSS object-position + transform-origin/scale
  // formula generically (using the ACTUALLY applied transform-origin, not an assumption), so
  // it fails the same way a real browser would if transform-origin stopped tracking the pan.
  async function edgeContent(axis){
    return page.evaluate(axis=>{
      const img=document.getElementById("photoCropImage"),vp=document.getElementById("photoCropViewport");
      const rect=vp.getBoundingClientRect();
      const natSize=axis==="x"?img.naturalWidth:img.naturalHeight;
      const containerSize=axis==="x"?rect.width:rect.height;
      const coverScale=Math.max(rect.width/img.naturalWidth,rect.height/img.naturalHeight);
      const imageSize=natSize*coverScale;
      const style=getComputedStyle(img);
      const originParts=style.transformOrigin.split(" ").map(parseFloat);
      const origin=axis==="x"?originParts[0]:originParts[1];
      const cropFraction=axis==="x"?photoCropState.draft.x:photoCropState.draft.y;
      const zoom=photoCropState.draft.zoom;
      const imageOffset=(containerSize-imageSize)*cropFraction;
      const preTransformAtLeftEdge=origin-origin/zoom;
      const preTransformAtRightEdge=origin+(containerSize-origin)/zoom;
      return {
        left:preTransformAtLeftEdge-imageOffset,
        right:preTransformAtRightEdge-imageOffset,
        imageSize
      };
    },axis);
  }

  // 1) Dragging right must move the x fraction the direction that visually follows the
  //    pointer (down toward 0, which pans the *view* toward the image's left content).
  await setCrop(.5,.5,1);
  const beforeRight=await crop();await drag(60,0);const afterRight=await crop();
  if(!(afterRight.x<beforeRight.x))throw new Error(`Drag right should decrease x (direct manipulation), got ${beforeRight.x}->${afterRight.x}`);

  // 2) Dragging left is the mirror image.
  await setCrop(.5,.5,1);
  const beforeLeft=await crop();await drag(-60,0);const afterLeft=await crop();
  if(!(afterLeft.x>beforeLeft.x))throw new Error(`Drag left should increase x, got ${beforeLeft.x}->${afterLeft.x}`);

  // 3) Vertical drag follows the same direct-manipulation rule.
  await setCrop(.5,.5,1);
  const beforeDown=await crop();await drag(0,60);const afterDown=await crop();
  if(!(afterDown.y<beforeDown.y))throw new Error(`Drag down should decrease y, got ${beforeDown.y}->${afterDown.y}`);
  await setCrop(.5,.5,1);
  const beforeUp=await crop();await drag(0,-60);const afterUp=await crop();
  if(!(afterUp.y>beforeUp.y))throw new Error(`Drag up should increase y, got ${beforeUp.y}->${afterUp.y}`);

  // 4) At high zoom, panning to y=0/y=1 must reach the image's TRUE top/bottom edge —
  //    not a permanently unreachable dead zone (the reported "can't reach the top" bug).
  for(const zoom of [1.5,2.5,4]){
    await setCrop(.5,0,zoom);
    const top=await edgeContent("y");
    if(Math.abs(top.left)>3)throw new Error(`zoom=${zoom}: top pan should reach true top edge (content=0), got ${top.left}`);
    await setCrop(.5,1,zoom);
    const bottom=await edgeContent("y");
    if(Math.abs(bottom.right-bottom.imageSize)>3)throw new Error(`zoom=${zoom}: bottom pan should reach true bottom edge, got ${bottom.right} vs ${bottom.imageSize}`);
  }
  for(const zoom of [1.5,3]){
    await setCrop(0,.5,zoom);
    const left=await edgeContent("x");
    if(Math.abs(left.left)>3)throw new Error(`zoom=${zoom}: left pan should reach true left edge, got ${left.left}`);
    await setCrop(1,.5,zoom);
    const right=await edgeContent("x");
    if(Math.abs(right.right-right.imageSize)>3)throw new Error(`zoom=${zoom}: right pan should reach true right edge, got ${right.right} vs ${right.imageSize}`);
  }

  // 5) Pan clamp: dragging far past the edge must clamp to [0,1], never show empty space.
  await setCrop(.5,.5,2);
  await drag(5000,5000);
  const clampedLow=await crop();
  if(clampedLow.x!==0||clampedLow.y!==0)throw new Error(`Large rightward/downward drag should clamp to 0, got ${JSON.stringify(clampedLow)}`);
  await drag(-5000,-5000);
  const clampedHigh=await crop();
  if(clampedHigh.x!==1||clampedHigh.y!==1)throw new Error(`Large leftward/upward drag should clamp to 1, got ${JSON.stringify(clampedHigh)}`);

  // 6) Changing zoom after panning keeps the pan fraction valid (still full range, no reclamp needed).
  await setCrop(.1,.9,1);
  await page.fill("#photoCropZoom","3.2");await page.dispatchEvent("#photoCropZoom","input");
  const afterZoom=await crop();
  if(afterZoom.x!==.1||afterZoom.y!==.9)throw new Error(`Zoom change should not move existing pan fraction, got ${JSON.stringify(afterZoom)}`);
  const zoomTop=await edgeContent("y");
  if(zoomTop.left<-1||zoomTop.right>zoomTop.imageSize+1)throw new Error("Post-zoom pan escaped image bounds");

  // 7)+8) Confirming a crop updates the in-editor thumbnail immediately, before any Save,
  //    and without touching the underlying (pre-save) profile data or firing network calls.
  await setCrop(.15,.85,2.2);
  networkCalls.length=0;
  await page.click("#savePhotoCrop");
  await page.waitForSelector("#photoCropModal",{state:"hidden"});
  const thumb=await page.evaluate(()=>document.querySelector("#profilePhotosGrid img").getAttribute("style"));
  if(!thumb.includes("15%")||!thumb.includes("85%")||!thumb.includes("scale(2.2)"))throw new Error(`Thumbnail did not reflect confirmed crop immediately: ${thumb}`);
  const draftPhoto=await page.evaluate(()=>({...profileDraftPhotos[0].crop}));
  if(draftPhoto.x!==.15||draftPhoto.y!==.85)throw new Error("Draft photo crop was not updated on confirm");
  const savedPhotoStillOld=await page.evaluate(()=>data.profiles["character-a"].photos[0].crop.x);
  if(savedPhotoStillOld!==.5)throw new Error("Confirming crop must not touch saved data before Save");
  if(networkCalls.length)throw new Error(`Confirming crop should not cause network calls, saw: ${networkCalls.join(",")}`);

  // 9) Clicking the real Save button persists the confirmed crop.
  await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  const savedCrop=await page.evaluate(()=>data.profiles["character-a"].photos[0].crop);
  if(savedCrop.x!==.15||savedCrop.y!==.85||savedCrop.zoom!==2.2)throw new Error(`Save did not persist confirmed crop: ${JSON.stringify(savedCrop)}`);

  // 10) A failed Save (duplicate name) must not drop the crop draft — the user can retry
  //     without re-cropping.
  page.on("dialog",dialog=>dialog.accept());
  await page.evaluate(()=>editProfile("character-b"));
  await page.waitForSelector("#profileEditorModal",{state:"visible"});
  await page.setInputFiles("#profilePhotosInput",[{name:"p.svg",mimeType:"image/svg+xml",buffer:Buffer.from(tallDataUrl.split(",")[1],"base64")}]);
  await page.waitForSelector('[data-photo-id]');
  await page.click('[data-action="crop-photo"]');
  await page.waitForSelector("#photoCropModal",{state:"visible"});
  await setCrop(.2,.3,1.7);
  await page.click("#savePhotoCrop");
  await page.fill("#pf_name","Анна");
  await page.click("#saveProfile");
  await page.waitForTimeout(200);
  if(!await page.locator("#profileEditorModal").isVisible())throw new Error("Failed save should keep the editor open");
  const survivedCrop=await page.evaluate(()=>({...profileDraftPhotos[0].crop}));
  if(survivedCrop.x!==.2||survivedCrop.y!==.3||survivedCrop.zoom!==1.7)throw new Error(`Crop draft was lost after failed save: ${JSON.stringify(survivedCrop)}`);

  // 11) Reopening the cropper on the same photo shows the latest confirmed state, not the original.
  await page.click('[data-action="crop-photo"]');
  await page.waitForSelector("#photoCropModal",{state:"visible"});
  const reopened=await crop();
  if(reopened.x!==.2||reopened.y!==.3||reopened.zoom!==1.7)throw new Error(`Reopening crop did not show latest confirmed state: ${JSON.stringify(reopened)}`);

  console.log("character image crop UX browser tests passed");await browser.close();
} finally {server.kill()}
