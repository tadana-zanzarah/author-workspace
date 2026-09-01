import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/"),{chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"}),context=await browser.newContext({viewport:{width:390,height:760},isMobile:true,hasTouch:true}),page=await context.newPage();
page.setDefaultTimeout(10000);const errors=[];page.on("pageerror",e=>errors.push(e.message));
const project={version:11,characters:[{id:"character-mobile",name:"Мобильный персонаж"}],profiles:{"character-mobile":{id:"character-mobile",characterId:"character-mobile",name:"Мобильный персонаж",photos:[],hidden:{},initialRelations:{}}},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{},scenes:[]};
await page.addInitScript(value=>localStorage.setItem("novelTimelineV11",JSON.stringify(value)),project);await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
await page.evaluate(()=>editProfile("character-mobile"));await page.waitForSelector("#profileEditorModal",{state:"visible"});
const portrait=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="480"><rect width="240" height="480" fill="tomato"/></svg>');
const files=[{name:"portrait-one.svg",mimeType:"image/svg+xml",buffer:portrait},{name:"portrait-two.svg",mimeType:"image/svg+xml",buffer:portrait}];
await page.setInputFiles("#profilePhotosInput",files);
// Resume photo model: one active/primary portrait tile plus a vertical
// thumbnail rail beside it (thumbnails only render once >1 photo exists) —
// not a 1:1 grid of per-photo cards, so wait on the rail rather than a
// generic [data-photo-id].
await page.waitForSelector(".photo-rail .photo-thumb:nth-child(2)");
// The native <input type=file> is intentionally clipped off-screen now (an
// app-styled "＋ Добавить фото" label triggers it instead) — it stays
// keyboard-reachable (a real tab stop) but is not expected to be visible.
// What must not overflow the mobile viewport is the visible trigger, the
// primary portrait, and the thumbnail rail.
const triggerBox=await page.locator(".photo-upload-button").boundingBox(),grid=page.locator("#profilePhotosGrid"),gridBox=await grid.boundingBox();
if(!triggerBox||triggerBox.x<0||triggerBox.x+triggerBox.width>390||!gridBox||gridBox.x<0||gridBox.x+gridBox.width>390)throw new Error(`Mobile upload/preview layout overflow: ${JSON.stringify({triggerBox,gridBox,viewport:await page.evaluate(()=>{const modal=document.getElementById("profilePhotosInput").closest(".modal"),style=getComputedStyle(modal);return {client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,modal:{box:modal.getBoundingClientRect().width,width:style.width,min:style.minWidth,max:style.maxWidth}}})})}`);
// No horizontal scrollbar anywhere in the photo column — the thumbnail rail
// is a vertical column now, so any overflow there scrolls vertically only.
const overflowState=await page.evaluate(()=>{
  const grid=document.getElementById("profilePhotosGrid"),rail=document.querySelector(".photo-rail");
  return {gridScrollsY:grid.scrollHeight>grid.clientHeight+1,gridScrollsX:grid.scrollWidth>grid.clientWidth+1,railScrollsX:rail.scrollWidth>rail.clientWidth+1};
});
if(overflowState.gridScrollsY)throw new Error("Photo column has a vertical internal scrollbar");
if(overflowState.railScrollsX)throw new Error("Thumbnail rail has a horizontal scrollbar");
if(overflowState.gridScrollsX)throw new Error("Photo column (outside the thumbnail rail) has a horizontal scrollbar");

// Cropping the active (first/primary) photo still works from the shared action row.
await page.locator('[data-action="crop-photo"]').click();await page.waitForSelector("#photoCropModal",{state:"visible"});
await page.fill("#photoCropZoom","1.9");await page.dispatchEvent("#photoCropZoom","input");await page.evaluate(()=>nudgePhotoCrop(.1,-.1));
const cropBox=await page.locator("#photoCropModal .modal").boundingBox();if(!cropBox||cropBox.x<0||cropBox.x+cropBox.width>390||cropBox.y<0)throw new Error("Crop modal exceeds mobile viewport");
if(!await page.evaluate(()=>document.getElementById("photoCropModal").contains(document.activeElement)))throw new Error("Crop modal lost focus");await page.locator("#savePhotoCrop").focus();await page.keyboard.press("Enter");if(!await page.evaluate(()=>document.getElementById("profileEditorModal").contains(document.activeElement)))throw new Error("Crop close did not restore focus to profile editor");

// Selecting the second thumbnail makes it the active photo, then the shared
// action row's "Сделать главным" promotes it.
const secondThumb=page.locator(".photo-rail .photo-thumb").nth(1);
await secondThumb.click();
if(await secondThumb.getAttribute("aria-selected")!=="true")throw new Error("Clicking a thumbnail did not make it the active photo");
await grid.getByRole("button",{name:"Сделать главным"}).click();
if(!await page.locator(".photo-item-primary .photo-primary").isVisible())throw new Error("Primary image did not move");
if(!await secondThumb.locator(".photo-thumb-primary-mark").isVisible())throw new Error("Thumbnail primary indicator did not move");

// Preview (lightbox) still works for the active photo.
await page.locator('[data-action="view-photo"]').click();await page.waitForSelector("#photoLightboxModal",{state:"visible"});const lightboxBox=await page.locator("#photoLightboxModal .modal").boundingBox();if(!lightboxBox||lightboxBox.x<0||lightboxBox.x+lightboxBox.width>390)throw new Error("Lightbox exceeds mobile viewport");await page.locator("#closePhotoLightbox").focus();await page.keyboard.press("Enter");if(!await page.evaluate(()=>document.getElementById("profileEditorModal").contains(document.activeElement)))throw new Error("Lightbox close did not restore focus");

// Deleting the active photo removes it and falls back to a single primary
// portrait with no leftover (now pointless) thumbnails in the rail.
await grid.getByRole("button",{name:"Удалить"}).click();
if(await page.locator(".photo-thumb").count()!==0)throw new Error("Mobile delete removed wrong image, or a stale thumbnail remains in the rail for a single photo");
if(await page.locator(".photo-item-primary").count()!==1)throw new Error("Single remaining photo is not shown as the primary portrait");

await page.locator("#saveProfile").focus();await page.keyboard.press("Enter");await page.waitForSelector("#profileEditorModal",{state:"hidden"});const saved=await page.evaluate(()=>data.profiles["character-mobile"]);if(saved.photos.length!==1||saved.primaryPhotoId!==saved.photos[0].id)throw new Error("Mobile image state did not persist");
if(errors.length)throw new Error(errors.join(" | "));
console.log(JSON.stringify({ok:true,viewport:"390x760",upload:true,multiple:true,crop:true,zoom:true,primary:true,lightbox:true,delete:true,focus:true,overflow:false}));await browser.close();
