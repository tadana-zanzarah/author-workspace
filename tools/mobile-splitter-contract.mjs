// Stage E3.2.8: the real-phone splitter / clipping / horizontal-containment
// contract, shared by tools/mobile-scene-editor-browser.test.mjs (#sceneModal)
// and tools/mobile-text-scene-browser.test.mjs (#textModal) so both surfaces
// are held to the SAME scenarios instead of two drifting copies. Every check
// here is a REAL failure observed on a phone (or measured to be its cause) --
// not an internal numeric invariant:
//
//  A. dragging the splitter with the manuscript FOCUSED must not move the
//     outer modal (Chrome scroll anchoring prefers the focused element as
//     its anchor; the measured baseline moved the modal by exactly the drag
//     distance and fired a scroll event on it);
//  B. the manuscript's bottom border + bottom radii must never be clipped,
//     including on short viewports and after a `dvh` shrink (browser chrome
//     reappearing) -- the measured baseline overflowed the bounded region by
//     6-41px and `overflow:hidden` cut the border off;
//  C. project results must never create horizontal scrolling on the page,
//     backdrop, modal, region or editor -- only the ONE results scrollport;
//  D. a SHORT active result row must span the whole shared scroll canvas
//     (also once the list is scrolled sideways), not end after its text.
//
// Genuine touch input (CDP Input.dispatchTouchEvent) is used for every drag
// and pan -- the same rationale as the E3.2.2 splitter test.

const UA="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const KEY="ХМАРКЕР";
const longManuscript=Array.from({length:60},(_,i)=>`Абзац номер ${i+1}. `+"Текст сцены для проверки длинной прокрутки в редакторе сцены. ".repeat(4)).join("\n\n");
// One SHORT result (the paragraph is just the keyword) and one LONG result
// (keyword in the middle of a paragraph far wider than a phone), both in a
// second scene so project search finds them while scene-a stays open.
const longPara="Начало очень длинного абзаца с большим количеством слов до нужного слова "+KEY+" а также после этого слова идёт ещё очень много дополнительного текста для проверки горизонтальной прокрутки";
export const contractProject={version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false},{id:"chapter-one",title:"Глава 1",collapsed:false}],locations:[],tags:[],future:{},scenes:[
  {id:"scene-a",title:"Основная сцена",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:longManuscript,included:true,status:"floating",people:{}},
  {id:"scene-h",title:"Горизонталь",date:"",time:"",dateReview:false,chapterId:"chapter-one",locationId:"",tags:[],writingStatus:"draft",sceneText:`${KEY}\n\n${longPara}\n\nещё ${KEY} тут`,included:true,status:"floating",people:{}}
]};

const sel=surface=>surface==="scene"
  ?{modal:"#sceneModal",scroller:"#sceneModal .modal",editor:"#sceneTextEditor",toolbar:"#sceneTextToolbar",find:"#sceneTextFindReplace",above:"#sceneTextFindReplace",below:".scene-participant-selector",open:"editScene"}
  :{modal:"#textModal",scroller:"#textModal .modal",editor:"#fullSceneTextEditor",toolbar:"#fullSceneTextToolbar",find:"#fullSceneTextFindReplace",above:"#fullSceneTextFindReplace",below:"#textModal .modal-actions",open:"openSceneText"};

// `stage`: how far to drive the UI -- "editor" (Find/Replace closed), "find"
// (current-scene Find/Replace open), or "project" (default: project scope with
// results visible).
export async function newContractPage(browser,base,surface,viewport={width:375,height:812},stage="project"){
  const s=sel(surface);
  const page=await browser.newPage({viewport,isMobile:true,hasTouch:true,userAgent:UA});
  page.setDefaultTimeout(5000);
  page.__errors=[];
  page.on("pageerror",e=>page.__errors.push(e.message));
  await page.addInitScript(v=>{localStorage.setItem("novelTimelineV11",JSON.stringify(v))},contractProject);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.evaluate(([fn])=>window[fn]("scene-a"),[s.open]);
  await page.waitForFunction(m=>document.querySelector(m).style.display==="flex",s.modal);
  await page.waitForSelector(`${s.editor} .ProseMirror`);
  if(stage==="editor")return page;
  await page.tap(`${s.toolbar} .rte-btn-find`);
  if(stage==="find")return page;
  await page.tap(`${s.find} .rte-scope-btn:not(.active)`);
  await page.locator(`${s.find} .rte-find-input`).fill(KEY);
  await page.waitForSelector(`${s.modal} .rte-project-result-row`);
  await page.waitForTimeout(150);
  return page;
}

// Everything geometric, in one evaluate so a sample is a consistent snapshot.
const sample=(page,surface)=>{
  const s=sel(surface);
  return page.evaluate(s=>{
    const q=x=>document.querySelector(x);
    const editor=q(s.editor),region=editor.closest(".rte-manuscript-region"),results=q(`${s.modal} .rte-project-results`),scroller=q(s.scroller);
    const r=e=>e.getBoundingClientRect();
    const below=q(s.below);
    return {
      outerScrollTop:scroller.scrollTop,winY:window.scrollY,winX:window.scrollX,
      aboveTop:r(q(s.above)).top,belowTop:below?r(below).top:null,
      regionH:r(region).height,editorH:r(editor).height,resultsH:r(results).height,
      editorBottomPastRegion:r(editor).bottom-r(region).bottom
    };
  },s);
};

// Bottom border/radius: the editor's whole border box must sit inside EVERY
// ancestor that could clip it. `overflow-y` of the shared region is asserted
// `visible` (nothing clips it there by construction) and the bounded region
// must have no vertical overflow of its own.
export async function assertBottomBorderIntact(page,surface,label){
  const s=sel(surface);
  const m=await page.evaluate(s=>{
    const editor=document.querySelector(s.editor),region=editor.closest(".rte-manuscript-region"),modal=document.querySelector(s.scroller);
    const r=e=>e.getBoundingClientRect(),eb=r(editor).bottom,cs=getComputedStyle(editor);
    const clippers=[];
    for(let a=editor.parentElement;a&&a!==modal;a=a.parentElement){
      const o=getComputedStyle(a);
      if(o.overflowY!=="visible")clippers.push({n:a.className||a.tagName,clipBottom:r(a).top+a.clientHeight,oy:o.overflowY});
    }
    const footer=document.querySelector(s.modal+" .modal-actions");
    return {
      editorBottom:eb,regionOverflowY:getComputedStyle(region).overflowY,
      regionScrollOver:region.scrollHeight-region.clientHeight,
      clippers,
      radiusBL:parseFloat(cs.borderBottomLeftRadius),radiusBR:parseFloat(cs.borderBottomRightRadius),borderBottom:parseFloat(cs.borderBottomWidth),
      modalClipBottom:r(modal).top+modal.clientHeight,footerTop:footer?r(footer).top:null,
      textClipsAtModal:getComputedStyle(modal).overflowY==="hidden"
    };
  },s);
  const tol=0.75;
  if(m.regionOverflowY!=="visible")throw new Error(`[${label}] the bounded region must not vertically clip its contents (overflow-y=${m.regionOverflowY}) -- a clip line coinciding with the manuscript's bottom edge is what cuts its border/radii`);
  if(m.regionScrollOver>1)throw new Error(`[${label}] the bounded region overflows vertically by ${m.regionScrollOver}px`);
  for(const c of m.clippers)if(m.editorBottom>c.clipBottom+tol)throw new Error(`[${label}] ancestor ${c.n} clips the manuscript's bottom border: editor bottom=${m.editorBottom}, clip line=${c.clipBottom}`);
  if(m.textClipsAtModal&&m.editorBottom>m.modalClipBottom+tol)throw new Error(`[${label}] the modal clips the manuscript's bottom border: ${m.editorBottom} > ${m.modalClipBottom}`);
  if(m.footerTop!=null&&surface==="text"&&m.editorBottom>m.footerTop+tol)throw new Error(`[${label}] the manuscript's bottom edge runs under the footer: ${m.editorBottom} > ${m.footerTop}`);
  if(!(m.radiusBL>0&&m.radiusBR>0&&m.borderBottom>=1))throw new Error(`[${label}] the manuscript lost its bottom border/radii styling: ${JSON.stringify({bl:m.radiusBL,br:m.radiusBR,b:m.borderBottom})}`);
}

const touch=async(page,cdp,dy,steps=10)=>{
  await page.locator(".rte-project-results-resizer:visible").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(50);
  const box=await page.$eval(".rte-project-results-resizer",el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x,y:box.y,id:1}]});
  for(let i=1;i<=steps;i++){
    await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x,y:box.y+dy*i/steps,id:1}]});
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await page.waitForTimeout(120);
};

// `checks` exists only so each real-failure class can be proven independently
// against an older commit (otherwise the first failing class masks the rest);
// the tests always run everything.
export async function runSplitterContract({browser,base,surface,checks={}}){
  const on=k=>checks[k]!==false;
  const s=sel(surface),tag=`${surface}`;
  const tolH=4,tolA=1;

  // ---------- A + B (+ repeated cycles / scope toggles) on the default viewport
  {
    const page=await newContractPage(browser,base,surface);
    const cdp=await page.context().newCDPSession(page);
    if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: default`);

    // The REAL precondition: the user has the caret in the manuscript. Settle
    // the outer scroll first (a user scroll, not part of the drag), then
    // focus without letting focus itself scroll.
    await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
    await page.evaluate(s=>document.querySelector(`${s.editor} .ProseMirror`).focus({preventScroll:true}),s);
    await page.waitForTimeout(150);
    if(!await page.evaluate(s=>document.activeElement.closest(s.editor)!==null,s))throw new Error(`${tag}: test precondition failed -- the manuscript must hold focus during the drag`);

    await page.evaluate(()=>{window.__e328=[];document.addEventListener("scroll",e=>{const t=e.target;window.__e328.push(t===document?"document":(t.id||t.className||t.nodeName)+"")},true)});
    const drag=async dy=>{
      await page.locator(".rte-project-results-resizer").scrollIntoViewIfNeeded();
      await page.evaluate(s=>document.querySelector(`${s.editor} .ProseMirror`).focus({preventScroll:true}),s);
      // Scroll events are delivered a frame late: let the events caused by
      // this settle step (a user scroll, not part of the drag) flush before
      // opening the observation window for the drag itself.
      await page.waitForTimeout(150);
      await page.evaluate(()=>{window.__e328.length=0});
      const before=await sample(page,surface);
      await touch(page,cdp,dy);
      const after=await sample(page,surface);
      const events=await page.evaluate(()=>[...new Set(window.__e328)]);
      return {before,after,events};
    };
    const checkOuterStable=(d,label)=>{
      if(!on("A"))return;
      const {before:b,after:a,events}=d;
      if(Math.abs(a.outerScrollTop-b.outerScrollTop)>0.5)throw new Error(`[${label}] the outer modal scrolled during the splitter drag (scroll anchoring): scrollTop ${b.outerScrollTop} -> ${a.outerScrollTop}`);
      if(events.some(e=>e!=="rte-project-results"&&/modal|document|backdrop/i.test(e)))throw new Error(`[${label}] a scroll event fired on an outer ancestor during the drag: ${JSON.stringify(events)}`);
      if(a.winY!==b.winY||a.winX!==b.winX)throw new Error(`[${label}] the window scrolled during the drag`);
      if(Math.abs(a.aboveTop-b.aboveTop)>tolA)throw new Error(`[${label}] content ABOVE the region moved during the drag: ${b.aboveTop} -> ${a.aboveTop}`);
      if(b.belowTop!=null&&Math.abs(a.belowTop-b.belowTop)>tolA)throw new Error(`[${label}] content BELOW the region moved during the drag: ${b.belowTop} -> ${a.belowTop}`);
      if(Math.abs(a.regionH-b.regionH)>tolH)throw new Error(`[${label}] the bounded region's total height changed: ${b.regionH} -> ${a.regionH}`);
    };

    const grow=await drag(100);
    checkOuterStable(grow,`${tag}: +100 drag, manuscript focused`);
    const dRes=grow.after.resultsH-grow.before.resultsH,dEd=grow.after.editorH-grow.before.editorH;
    if(dRes<50||Math.abs(dEd+dRes)>tolH)throw new Error(`${tag}: results/manuscript must exchange height oppositely: results ${dRes}, manuscript ${dEd}`);
    if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: after +100`);

    const shrink=await drag(-60);
    checkOuterStable(shrink,`${tag}: -60 drag, manuscript focused`);
    const sRes=shrink.before.resultsH-shrink.after.resultsH,sEd=shrink.after.editorH-shrink.before.editorH;
    if(sRes<40||Math.abs(sEd-sRes)>tolH)throw new Error(`${tag}: shrinking results must return the same height to the manuscript: results -${sRes}, manuscript +${sEd}`);

    const max=await drag(2000);
    checkOuterStable(max,`${tag}: MAX drag`);
    if(max.after.editorH<140-tolH)throw new Error(`${tag}: MAX drag crushed the manuscript below its 140px floor: ${max.after.editorH}`);
    if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: MAX results`);
    const min=await drag(-2000);
    checkOuterStable(min,`${tag}: MIN drag`);
    if(min.after.resultsH<90-tolH)throw new Error(`${tag}: MIN drag went below the results floor: ${min.after.resultsH}`);
    if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: MIN results`);

    // Repeated grow/shrink cycles: no drift, ever.
    let prev=await sample(page,surface);
    for(let c=0;c<3;c++){
      const g=await drag(50);checkOuterStable(g,`${tag}: cycle ${c} grow`);
      const h=await drag(-50);checkOuterStable(h,`${tag}: cycle ${c} shrink`);
      const now=await sample(page,surface);
      if(Math.abs(now.resultsH-prev.resultsH)>tolH||Math.abs(now.editorH-prev.editorH)>tolH||Math.abs(now.regionH-prev.regionH)>tolH)throw new Error(`${tag}: repeated grow/shrink cycle ${c} drifted: ${JSON.stringify({prev,now})}`);
      if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: after cycle ${c}`);
      prev=now;
    }

    // project -> current -> project, with the manuscript focused.
    const regionBefore=(await sample(page,surface)).regionH;
    for(let t=0;t<2;t++){
      await page.locator(`${s.find} .rte-scope-btn:not(.active)`).tap();await page.waitForTimeout(80);   // -> current scene
      const cur=await sample(page,surface);
      if(cur.editorH<regionBefore-tolH*3)throw new Error(`${tag}: current-scene scope must give the manuscript back the whole region: editor ${cur.editorH} vs region ${regionBefore}`);
      await page.locator(`${s.find} .rte-scope-btn:not(.active)`).tap();await page.waitForTimeout(80);   // -> project
      const proj=await sample(page,surface);
      if(Math.abs(proj.regionH-regionBefore)>tolH)throw new Error(`${tag}: scope toggle ${t} drifted the region height: ${regionBefore} -> ${proj.regionH}`);
      if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: after scope toggle ${t}`);
    }
    if(page.__errors.length)throw new Error(`${tag}: page errors: ${page.__errors.join("; ")}`);
    await page.close();
  }

  // ---------- B on the states that actually clipped the border on phones:
  if(on("B")){
  // a short viewport, and a `dvh` shrink (browser chrome coming back).
  {
    const [w,h,shrink]=surface==="scene"?[360,640,56]:[375,667,0];
    const page=await newContractPage(browser,base,surface,{width:w,height:h});
    if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: ${w}x${h} default`);
    if(shrink){
      await page.setViewportSize({width:w,height:h-shrink});await page.waitForTimeout(200);
      if(on("B"))await assertBottomBorderIntact(page,surface,`${tag}: ${w}x${h} after dvh shrink of ${shrink}px`);
    }
    // The results pane yields, the manuscript keeps its floor.
    const m=await sample(page,surface);
    if(m.editorH<140-tolH)throw new Error(`${tag}: on a short viewport the manuscript fell below its 140px floor: ${m.editorH}`);
    await page.close();
  }}

  // ---------- C + D + shared horizontal scroll
  {
    const page=await newContractPage(browser,base,surface);
    const cdp=await page.context().newCDPSession(page);
    const own=await page.evaluate(s=>{
      const sp=document.querySelector(`${s.modal} .rte-project-results`);
      const chain=[];for(let a=sp.parentElement;a;a=a.parentElement)chain.push(a);
      const overflowing=chain.filter(a=>a.scrollWidth-a.clientWidth>1&&a.className!=="scene-section").map(a=>a.className||a.tagName);
      const rows=[...sp.querySelectorAll(".rte-project-result-row")].map(r=>r.getBoundingClientRect().width);
      const cv=sp.querySelector(".rte-project-results-canvas");
      return {spClient:sp.clientWidth,spScroll:sp.scrollWidth,rows,hasCanvas:!!cv,overflowing,
        docOver:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        regionOverflowX:getComputedStyle(sp.closest(".rte-manuscript-region")).overflowX,
        editorOver:(e=>e.scrollWidth-e.clientWidth)(document.querySelector(s.editor))};
    },s);
    if(own.spScroll<=own.spClient+1)throw new Error(`${tag}: fixture must produce a LONG result that overflows the results scrollport: ${JSON.stringify(own)}`);
    if(on("C")&&own.overflowing.length)throw new Error(`${tag}: only the results scrollport may overflow horizontally, but these ancestors do: ${JSON.stringify(own.overflowing)}`);
    if(on("C")&&own.docOver>1)throw new Error(`${tag}: the document overflows horizontally by ${own.docOver}px`);
    if(on("C")&&own.editorOver>1)throw new Error(`${tag}: the manuscript overflows horizontally by ${own.editorOver}px`);
    if(on("C")&&own.regionOverflowX!=="clip")throw new Error(`${tag}: the bounded region must clip horizontally WITHOUT being a scroll container (overflow-x:clip), got ${own.regionOverflowX}`);
    // D: every row spans the canvas; the widest row is wider than the phone.
    // The reference is the WIDEST row (the canvas is exactly as wide as it),
    // so this fails on a DOM without the canvas too: hugging rows differ.
    const widestRow=Math.max(...own.rows);
    if(on("D")&&(!own.hasCanvas||own.rows.some(w=>Math.abs(w-widestRow)>1)))throw new Error(`${tag}: every result row must span the shared scroll canvas (widest row ${widestRow}px, canvas present: ${own.hasCanvas}), got ${JSON.stringify(own.rows)}`);
    if(Math.max(...own.rows)<=375)throw new Error(`${tag}: the long row must extend past the phone width: ${JSON.stringify(own.rows)}`);

    // Genuine touch pan on the shared scrollport, beyond its end, several times.
    const pan=async(dx)=>{
      const b=await page.$eval(`${s.modal} .rte-project-results`,e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:b.x-dx/2,y:b.y,id:1}]});
      for(let i=1;i<=10;i++){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:b.x-dx/2+dx*i/10,y:b.y,id:1}]});await page.waitForTimeout(16)}
      await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await page.waitForTimeout(150);
    };
    const scrollLefts=()=>page.evaluate(s=>{
      const sp=document.querySelector(`${s.modal} .rte-project-results`);
      const others=[];for(let a=sp.parentElement;a;a=a.parentElement)if(a.scrollLeft!==0)others.push(a.className||a.tagName);
      return {results:sp.scrollLeft,others,vv:visualViewport.pageLeft};
    },s);
    await pan(-260);await pan(-260);await pan(-260);
    let sl=await scrollLefts();
    if(on("C")){
    if(sl.results<=0)throw new Error(`${tag}: a horizontal touch pan must scroll the results scrollport`);
    if(sl.others.length||sl.vv!==0)throw new Error(`${tag}: panning the results scrolled something else sideways: ${JSON.stringify(sl)}`);
    // Focus / scroll-into-view are the OTHER ways clipped ancestors get shifted.
    await page.evaluate(s=>{const rows=document.querySelectorAll(`${s.modal} .rte-project-result-row`);rows[1].focus();rows[1].scrollIntoView({block:"nearest",inline:"end"})},s);
    await page.waitForTimeout(100);
    sl=await scrollLefts();
    if(sl.others.length)throw new Error(`${tag}: focusing/revealing a long row scrolled an ancestor sideways: ${JSON.stringify(sl)}`);
    // Deterministic stand-in for ANY content that ever escapes the results
    // list (desktop Chromium cannot reproduce the phone's escape directly):
    // wide focusable content inside the region must not be able to scroll the
    // region, modal, backdrop or page.
    const shifted=await page.evaluate(s=>{
      const region=document.querySelector(`${s.modal} .rte-project-results-wrapper`).closest(".rte-manuscript-region");
      const probe=document.createElement("button");probe.type="button";probe.style.cssText="display:block;width:1200px;flex:none";probe.textContent="probe";
      region.appendChild(probe);probe.focus();probe.scrollIntoView({block:"nearest",inline:"end"});
      const r={region:region.scrollLeft,modal:document.querySelector(s.scroller).scrollLeft,backdrop:document.querySelector(s.modal).scrollLeft,doc:document.documentElement.scrollLeft};
      probe.remove();region.scrollLeft=0;return r;
    },s);
    if(shifted.region||shifted.modal||shifted.backdrop||shifted.doc)throw new Error(`${tag}: wide content inside the bounded region shifted a container sideways: ${JSON.stringify(shifted)}`);
    }

    // Shared scroll: rows move together by exactly the same amount.
    await page.evaluate(s=>{document.querySelector(`${s.modal} .rte-project-results`).scrollLeft=0},s);
    const lefts0=await page.$$eval(`${s.modal} .rte-project-result-row`,els=>els.map(e=>e.getBoundingClientRect().left));
    await page.evaluate(s=>{document.querySelector(`${s.modal} .rte-project-results`).scrollLeft=200},s);
    const lefts1=await page.$$eval(`${s.modal} .rte-project-result-row`,els=>els.map(e=>e.getBoundingClientRect().left));
    const deltas=new Set(lefts0.map((l,i)=>Math.round(l-lefts1[i])));
    if(deltas.size!==1||[...deltas][0]<=0)throw new Error(`${tag}: all rows must move together by the same amount when the shared scrollport scrolls: ${JSON.stringify([...deltas])}`);

    // D: activate the SHORT row and prove its border spans the visible width,
    // both at rest and once the list is scrolled to its end (the state in
    // which the previous `min-width:100%` fix visibly stopped after the text).
    if(on("D")){
    const shortRow=page.locator(`${s.modal} .rte-project-result-row`).filter({hasText:new RegExp(`^\\s*${KEY}\\s*$`)}).first();
    await shortRow.tap();
    await page.waitForFunction(s=>{const a=document.querySelector(`${s.modal} .rte-project-result-row.active`);return a&&a.textContent.trim()==="ХМАРКЕР"},s);
    for(const at of ["start","end"]){
      await page.evaluate(([s,at])=>{const sp=document.querySelector(`${s.modal} .rte-project-results`);sp.scrollLeft=at==="end"?99999:0},[s,at]);
      await page.waitForTimeout(80);
      const g=await page.evaluate(s=>{
        const sp=document.querySelector(`${s.modal} .rte-project-results`),R=sp.getBoundingClientRect();
        const row=sp.querySelector(".rte-project-result-row.active"),b=row.getBoundingClientRect();
        const widest=Math.max(...[...sp.querySelectorAll(".rte-project-result-row")].map(x=>x.getBoundingClientRect().right));
        return {rowW:b.width,visibleW:sp.clientWidth,gapLeft:b.left-R.left,gapRight:R.right-b.right,rowRight:b.right,widestRight:widest,borderTop:getComputedStyle(row).borderTopWidth,borderColor:getComputedStyle(row).borderTopColor};
      },s);
      if(at==="start"&&g.rowW<g.visibleW-2*18-2)throw new Error(`${tag}: a short active row's border must span the visible result width (${g.visibleW}px minus gutters), got ${g.rowW}`);
      if(at==="end"&&(g.gapRight>18+2||g.rowW<g.visibleW-2*18-2))throw new Error(`${tag}: scrolled to the end, the short active row's border must still reach the end of the scroll canvas: ${JSON.stringify(g)}`);
      if(Math.abs(g.rowRight-g.widestRight)>1)throw new Error(`${tag}: the short active row must end where the longest row ends (shared canvas): ${JSON.stringify(g)}`);
      if(!(parseFloat(g.borderTop)>=1))throw new Error(`${tag}: the active row lost its border: ${g.borderTop}`);
    }
    }
    // Nothing leaked sideways while doing all of the above.
    sl=await scrollLefts();
    if(on("C")&&sl.others.length)throw new Error(`${tag}: an ancestor scrolled sideways during row activation: ${JSON.stringify(sl)}`);
    if(on("C")&&await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)>1)throw new Error(`${tag}: the document overflows horizontally after the interaction`);
    if(page.__errors.length)throw new Error(`${tag}: page errors: ${page.__errors.join("; ")}`);
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Stage E3.2.9: the Full Scene Editor's sticky footer (Закрыть / Сохранить и
// закрыть / Сохранить текст) must stay pinned to the bottom of the OUTER
// modal's viewport while that modal scrolls -- in EVERY Find/Replace state --
// and must coexist with the splitter (splitter immediately hit-testable, never
// under the footer, footer never moves because of a drag).
//
// Real regression this pins (E3.2.6 -> E3.2.8): a `:has()` rule made the
// footer `position:static` whenever project results were visible, so Save/Close
// scrolled away with the content. Asserting `position:sticky` alone would miss
// that class of bug (and any containing-block/overflow change that breaks
// stickiness while the computed value still says `sticky`), so everything here
// is OBSERVED GEOMETRY: the footer's viewport rect while the outer modal is
// really scrolled. The scroll is proven real (not vacuous) by requiring the
// outer scroller to have a large range and each sampled position to be reached.
// ---------------------------------------------------------------------------
async function assertFooterPinned(page,label){
  const geo=()=>page.evaluate(()=>{
    const m=document.querySelector("#sceneModal .modal"),f=m.querySelector(".modal-actions.sticky-modal-footer");
    const mr=m.getBoundingClientRect(),fr=f.getBoundingClientRect();
    return {scrollTop:m.scrollTop,maxScroll:m.scrollHeight-m.clientHeight,pos:getComputedStyle(f).position,
      gap:mr.top+m.clientHeight-fr.bottom,fits:fr.top>=mr.top-0.5&&fr.bottom<=mr.top+m.clientHeight+0.5,
      hitsFooter:(()=>{const b=f.querySelector("button").getBoundingClientRect();const e=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!e&&f.contains(e)})()};
  });
  const start=await geo();
  if(start.maxScroll<400)throw new Error(`[${label}] vacuous: the outer modal must have a real scroll range to prove stickiness, got ${start.maxScroll}px`);
  const seen=[];
  for(const frac of [0,0.25,0.5,0.75,1]){
    const target=Math.round(start.maxScroll*frac);
    await page.$eval("#sceneModal .modal",(m,t)=>{m.scrollTop=t},target);
    await page.waitForTimeout(70);
    const g=await geo();
    if(Math.abs(g.scrollTop-target)>1.5)throw new Error(`[${label}] the outer modal did not actually scroll to ${target} (at ${g.scrollTop})`);
    seen.push(g.scrollTop);
    if(!g.fits)throw new Error(`[${label}] footer left the modal's visible viewport at scrollTop ${g.scrollTop}/${g.maxScroll} (gap below viewport bottom: ${g.gap.toFixed(1)}px)`);
    // Pinned flush to the viewport bottom everywhere except the last ~40px of
    // scroll, where it rests at its natural end position (measured 24.9px up).
    const inEndZone=g.scrollTop>=g.maxScroll-40;
    if(!inEndZone&&Math.abs(g.gap)>1)throw new Error(`[${label}] footer is not pinned to the viewport bottom at scrollTop ${g.scrollTop}/${g.maxScroll}: gap ${g.gap.toFixed(1)}px`);
    if(inEndZone&&(g.gap<-1||g.gap>26))throw new Error(`[${label}] footer end position out of range: gap ${g.gap.toFixed(1)}px`);
    if(!g.hitsFooter)throw new Error(`[${label}] the footer's own button is not the hit-test target at scrollTop ${g.scrollTop}`);
    // Secondary, and deliberately LAST: observed geometry above is the proof.
    if(g.pos!=="sticky")throw new Error(`[${label}] footer is not position:sticky (computed ${g.pos}) at scrollTop ${g.scrollTop}`);
  }
  if(Math.max(...seen)-Math.min(...seen)<300)throw new Error(`[${label}] vacuous: sampled scroll positions barely differ: ${JSON.stringify(seen)}`);
  await page.$eval("#sceneModal .modal",(m,t)=>{m.scrollTop=t},start.scrollTop);
  await page.waitForTimeout(70);
}

const resizerHit=page=>page.evaluate(()=>{
  const rz=document.querySelector("#sceneModal .rte-project-results-resizer"),r=rz.getBoundingClientRect();
  const f=document.querySelector("#sceneModal .modal-actions.sticky-modal-footer").getBoundingClientRect();
  const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return {ok:hit===rz,hit:hit===rz?"resizer":(hit?.className||hit?.tagName||"nothing (off-screen)"),y:r.y,overlapsFooter:r.bottom>f.top&&r.top<f.bottom,footerTop:f.top};
});

export async function runStickyFooterContract({browser,base}){
  const s=sel("scene");
  // ---- A / B: Find/Replace closed, then current-scene
  {
    const page=await newContractPage(browser,base,"scene",{width:375,height:812},"editor");
    await assertFooterPinned(page,"footer: Find/Replace closed");
    await page.tap(`${s.toolbar} .rte-btn-find`);
    await page.waitForSelector(`${s.find} .rte-find-input`,{state:"visible"});
    await page.waitForTimeout(150);
    await assertFooterPinned(page,"footer: current-scene Find/Replace");
    await page.close();
  }
  // ---- C..H at a normal AND a tight phone
  for(const [w,h] of [[375,812],[360,640]]){
    const tag=`${w}x${h}`;
    const page=await newContractPage(browser,base,"scene",{width:w,height:h});
    const cdp=await page.context().newCDPSession(page);
    // C/D: project scope, default splitter. NOTHING has scrolled the outer
    // modal but the browser's own focus-scroll: the splitter must already be
    // the hit-test target, clear of the footer.
    let hit=await resizerHit(page);
    if(!hit.ok||hit.overlapsFooter)throw new Error(`[${tag} project default] the splitter must be immediately hit-testable and clear of the sticky footer: ${JSON.stringify(hit)}`);
    await assertFooterPinned(page,`${tag} footer: project results, default splitter`);

    await page.evaluate(s=>document.querySelector(`${s.editor} .ProseMirror`).focus({preventScroll:true}),s);
    await page.waitForTimeout(150);
    const footTop=()=>page.evaluate(()=>document.querySelector("#sceneModal .modal-actions.sticky-modal-footer").getBoundingClientRect().top);
    const outerTop=()=>page.$eval("#sceneModal .modal",m=>m.scrollTop);
    const dragFromHere=async(dy,label)=>{
      hit=await resizerHit(page);
      if(!hit.ok||hit.overlapsFooter)throw new Error(`[${tag} ${label}] splitter must be hit-testable before the drag starts: ${JSON.stringify(hit)}`);
      const box=await page.$eval(".rte-project-results-resizer",el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
      const ft0=await footTop(),st0=await outerTop();
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x,y:box.y,id:1}]});
      for(let i=1;i<=10;i++){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x,y:box.y+dy*i/10,id:1}]});await page.waitForTimeout(16)}
      await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await page.waitForTimeout(150);
      const ft1=await footTop(),st1=await outerTop();
      if(Math.abs(ft1-ft0)>1)throw new Error(`[${tag} ${label}] the sticky footer moved because of the splitter drag: ${ft0} -> ${ft1}`);
      if(Math.abs(st1-st0)>0.5)throw new Error(`[${tag} ${label}] the outer modal scrolled because of the splitter drag (E3.2.8 invariant): ${st0} -> ${st1}`);
      // straight after the finger lifts -- no settling scroll -- it must still be usable
      hit=await resizerHit(page);
      if(!hit.ok||hit.overlapsFooter)throw new Error(`[${tag} ${label}] splitter is not hit-testable / is under the footer right after the drag: ${JSON.stringify(hit)}`);
    };
    await dragFromHere(100,"E: after grow");
    await assertFooterPinned(page,`${tag} footer: after splitter grow`);
    await dragFromHere(-60,"F: after shrink");
    await assertFooterPinned(page,`${tag} footer: after splitter shrink`);
    await dragFromHere(-2000,"G: at practical MIN");
    await assertFooterPinned(page,`${tag} footer: splitter at MIN`);
    await dragFromHere(2000,"H: at practical MAX");
    await assertFooterPinned(page,`${tag} footer: splitter at MAX`);
    if(page.__errors.length)throw new Error(`${tag}: page errors: ${page.__errors.join("; ")}`);
    await page.close();
  }
}
