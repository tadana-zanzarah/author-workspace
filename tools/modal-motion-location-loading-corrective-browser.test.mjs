// Modal / Motion / Location Loading corrective pass -- focused browser regression suite for a
// fresh real-user manual review of the published app (local mode unless a section explicitly
// mocks cloud state, no real Supabase credentials). Covers the seven areas from the corrective
// brief that are NOT already exercised by the existing accepted suites (or that needed their own
// root-cause-driven coverage once the actual bug was found):
//
//   1. MODAL SHELL VIEWPORT INVARIANT -- the real bug (not caught by any earlier suite, which only
//      ever drove the inner .location-profile-scroll via a direct `scrollTop=` write): a single
//      `.modal-backdrop{overflow-x:hidden}` declaration, with no matching overflow-y, made the CSS
//      spec's overflow-x/y interdependency rule silently compute overflow-y:auto on the backdrop
//      itself -- turning the "fixed, never scrolls" outer shell into an actual scrollable flex
//      container on any viewport short enough that the centered .modal didn't fit its own padded
//      box (common -- real browser chrome subtracted from a perfectly ordinary window height).
//      A real wheel scroll landing anywhere over the modal OTHER than its own inner scroll region
//      (the header, the footer, the thin padding margin) scrolled the BACKDROP, and flexbox's
//      align-items:center + overflow:auto hides the leading edge of the overflowing centered item
//      at scrollTop:0 with no way to recover it -- exactly the reported symptom. Fixed with
//      `overflow:hidden` (both axes explicit) on css/modals.css's `.modal-backdrop`. These tests
//      drive a REAL wheel event (page.mouse.wheel), not a scrollTop write, at a viewport short
//      enough to reproduce the original bug (700px and 600px -- see the file's own math: the
//      Profile modal's 94dvh + the backdrop's 20px*2 padding stops fitting below ~667px).
//
//   2. PERSISTENT "РЕДАКТИРОВАТЬ" -- moved from inside .location-profile-scroll (READ view's own
//      scrolling content, where it scrolled away on a long Profile) into .location-profile-header
//      (the modal shell's own non-scrolling region, shared by Read/Edit) -- see index.html/
//      css/locations.css/js/locations.js.
//
//   3/4. MEDIA VISUAL LOADING STATES -- two separate fixes: (a) the UNKNOWN-composition placeholder
//      no longer fakes a two-image hero+thumb shape (a distinct, misleading visible state) -- one
//      quiet generic shimmer bar instead; (b) once composition is known but an individual image is
//      still resolving, the shimmer and the eventual <img> coexist in the same slot
//      (.location-media-slot) and only opacity-crossfade once the <img> actually fires `load` --
//      eliminating the beige-shimmer -> plain-white-frame -> image flash the old code produced by
//      swapping the shimmer for a bare <img src> the instant a signed URL string was merely KNOWN,
//      well before the browser had actually fetched/decoded it.
//
//   5. MONOTONIC MODAL CLOSE -- the old `.modal-backdrop--reveal`/`--reveal-settled` "luminance-
//      recovery pulse" (slapped onto the freshly-revealed PARENT the instant a nested child closed)
//      failed real manual review ("very bad flash... blinking... hurts the eyes") and is deleted
//      entirely. The actual root cause: forceCloseModal wrote `.style.display="none"` with no
//      accompanying opacity change, so the base rule's `transition:opacity 160ms ease,display
//      160ms allow-discrete` pair had nothing to interpolate -- allow-discrete's own spec behavior
//      (hold the OLD display value, fully rendered, until the transition's other properties finish)
//      meant the closing modal sat frozen on-screen for the full 160ms then vanished in one instant
//      frame. `.modal-backdrop--closing` (opacity:0), added in the same synchronous turn as the
//      display write, gives that transition an actual value to animate -- a real fade, and (for a
//      nested close) the entire fix for the revealed parent too: it is never touched at all.
//
//   6. MODULE REVEAL SMOOTH-SCROLL -- already-accepted behavior (scrollLocationProfileElementIntoView,
//      js/locations.js) re-verified unchanged after the modal-shell/motion rewrite: one deliberate
//      inner-scroll movement, body scroll never touched, reduced motion instant.
//
//   7. REDUCED MOTION -- every new/changed motion path (backdrop close fade, Media image reveal)
//      collapses to effectively instant under prefers-reduced-motion, via the existing app-wide
//      `transition-duration:.001ms!important` rule (css/base.css) -- no new bypass needed.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

// Long-form fixture for the viewport-invariant test: every thematic module populated so Edit mode
// is genuinely many viewport-heights tall, well past what any real screen fits.
const longText=Array.from({length:8},(_,i)=>`Абзац номер ${i+1} длинного описательного текста для переполнения формы редактирования локации по вертикали.`).join(" ");
const longLoc={
  id:"loc-corrective-long",name:"Очень длинная локация",description:longText,officialName:"Официальное",aliases:["Альт1"],parentId:null,
  typePreset:"building",customTypeLabel:"Тип",shortSummary:"Кратко",
  baseProfile:{
    appearanceAtmosphere:{visualDescription:longText,atmosphere:longText,sounds:longText,smells:longText},
    geography:{climate:longText,terrain:longText},
    governmentSociety:{governmentType:longText},
    economy:{mainIndustries:["пром1"]},
    populationCulture:{beliefs:longText},
    history:{origin:longText,historicalOverview:longText,legends:longText}
  },
  moduleSelection:{shown:["appearanceAtmosphere","geography","governmentSociety","economy","populationCulture","history"]}
};

// Rich Read fixture for the persistent-Edit-button test -- enough content that Read mode's own
// .location-profile-scroll genuinely overflows a normal viewport.
const richReadLoc={
  id:"loc-corrective-rich-read",name:"Локация для чтения",description:longText,officialName:"",aliases:[],parentId:null,
  typePreset:"building",customTypeLabel:"",shortSummary:"",
  baseProfile:{history:{origin:longText,historicalOverview:longText}},
  moduleSelection:{shown:["history"]}
};

// Module-reveal fixture (only appearanceAtmosphere shown -- others remain catalog candidates).
const addPanelLoc={
  id:"loc-corrective-addpanel",name:"Локация с каталогом",description:"",officialName:"",aliases:[],parentId:null,
  typePreset:"building",customTypeLabel:"",shortSummary:"",
  baseProfile:{appearanceAtmosphere:{visualDescription:longText,atmosphere:longText}},
  moduleSelection:{shown:["appearanceAtmosphere"]}
};

// Media fixture -- opened fresh per Media section so each phase can be driven independently.
const mediaLoc={id:"loc-corrective-media",name:"Локация Медиа",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""};

const project={
  version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[longLoc,richReadLoc,addPanelLoc,mediaLoc],tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  page.setDefaultTimeout(6000);
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error"&&!/favicon/.test(message.text())&&!/404/.test(message.text())&&!/ERR_NAME_NOT_RESOLVED/.test(message.text()))errors.push(message.text())});
  await page.setViewportSize({width:1000,height:700});
  await page.addInitScript(value=>{localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.waitForFunction(()=>typeof openLocationProfile==="function");

  /* ================= 1. MODAL SHELL VIEWPORT INVARIANT ================= */
  {
    const modalRect=()=>page.evaluate(()=>document.querySelector("#locationProfileModal .modal").getBoundingClientRect().toJSON());
    const scrollerTop=()=>page.evaluate(()=>document.querySelector("#locationProfileEditView .location-profile-scroll").scrollTop);
    const bodyScroll=()=>page.evaluate(()=>({x:document.scrollingElement.scrollLeft,y:document.scrollingElement.scrollTop}));

    // [width,height] triples: two short DESKTOP heights (94dvh + the backdrop's 20px*2 padding
    // stops fitting below ~667px -- see css/modals.css's own math) plus one genuine MOBILE shape
    // (task brief section 18: 375x700 and one short desktop viewport).
    for(const [width,height] of [[1000,700],[1000,600],[375,700]]){
      await page.setViewportSize({width,height});
      await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},longLoc.id);
      await page.waitForTimeout(150);

      const before=await modalRect();
      const scrollBefore=await scrollerTop();
      const hasHorizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
      assert(!hasHorizontalOverflow,`viewport ${width}x${height}: the Edit form must never cause horizontal overflow`);

      // Real wheel scroll over the modal's HEADER area (outside .location-profile-scroll) -- the
      // exact interaction that used to scroll the backdrop itself and push the modal above the
      // viewport. box top ~y=20..70 in this fixture (header sits at the modal's own top).
      await page.mouse.move(width/2,40);
      await page.mouse.wheel(0,600);
      await page.waitForTimeout(80);
      const afterHeaderScroll=await modalRect();
      const bodyAfterHeaderScroll=await bodyScroll();
      assert(afterHeaderScroll.top>=-1,`viewport ${width}x${height}: modal top must never move above the viewport from a wheel scroll over the header, got top=${afterHeaderScroll.top}`);
      assert(afterHeaderScroll.bottom<=height+1,`viewport ${width}x${height}: modal bottom must stay within the viewport, got bottom=${afterHeaderScroll.bottom} of ${height}`);
      // Small tolerance (not 0): once the wheel event fails to find any scrollable target inside
      // the modal (deliberately true now -- .modal-backdrop and .location-profile-modal are both
      // overflow:hidden, see css/modals.css), it chains all the way up to the document, which can
      // absorb a sub-pixel rounding artifact of real scroll room even when scrollHeight and
      // clientHeight are equal when rounded to whole pixels. The ORIGINAL bug was a 50+px modal
      // ESCAPE, not a few px of invisible document scroll -- this tolerance still catches that by
      // two orders of magnitude while not failing on harmless browser rounding noise.
      assert(Math.abs(bodyAfterHeaderScroll.x)<=3&&Math.abs(bodyAfterHeaderScroll.y)<=3,`viewport ${width}x${height}: document/body must never meaningfully scroll as a side effect, got ${JSON.stringify(bodyAfterHeaderScroll)}`);

      // Real wheel scroll over the INNER content -- this one legitimately should move the inner
      // scroller, and must still leave the outer modal exactly where it was.
      await page.mouse.move(width/2,300);
      await page.mouse.wheel(0,900);
      await page.waitForTimeout(80);
      const afterContentScroll=await modalRect();
      const scrollAfter=await scrollerTop();
      assert(afterContentScroll.top>=-1&&afterContentScroll.bottom<=height+1,`viewport ${width}x${height}: modal must still stay within the viewport after scrolling its own content, got ${JSON.stringify(afterContentScroll)}`);
      assert(scrollAfter>scrollBefore,`viewport ${width}x${height}: the inner .location-profile-scroll must actually be the element that scrolled, got scrollTop ${scrollBefore} -> ${scrollAfter}`);
      assert(Math.abs(afterContentScroll.top-before.top)<1&&Math.abs(afterContentScroll.bottom-before.bottom)<1,`viewport ${width}x${height}: the outer modal's own position must be identical before and after inner-content scrolling, got top ${before.top}->${afterContentScroll.top}, bottom ${before.bottom}->${afterContentScroll.bottom}`);

      // Focusing a field near the bottom must not move the outer modal or the document either.
      await page.evaluate(()=>document.getElementById("locProfileOrigin")?.focus());
      await page.waitForTimeout(80);
      const afterFocus=await modalRect();
      const bodyAfterFocus=await bodyScroll();
      assert(afterFocus.top>=-1&&afterFocus.bottom<=height+1,`viewport ${width}x${height}: focusing a bottom field must not push the outer modal out of the viewport, got ${JSON.stringify(afterFocus)}`);
      assert(Math.abs(bodyAfterFocus.x)<=3&&Math.abs(bodyAfterFocus.y)<=3,`viewport ${width}x${height}: focusing a bottom field must not meaningfully scroll the document either, got ${JSON.stringify(bodyAfterFocus)}`);

      await page.evaluate(()=>{cancelLocationProfileEdit();forceCloseModal("locationProfileModal")});
    }
    await page.setViewportSize({width:1000,height:700});
  }
  console.log("1. modal shell viewport invariant: OK");

  /* ================= 2. PERSISTENT "РЕДАКТИРОВАТЬ" ================= */
  {
    await page.evaluate(id=>openLocationProfile(id),richReadLoc.id);
    await page.waitForTimeout(100);
    const editBtn=()=>page.evaluate(()=>{
      const btn=document.getElementById("locationProfileEdit");
      const header=document.getElementById("locationProfileModal").querySelector(".location-profile-header");
      const btnRect=btn.getBoundingClientRect(),headerRect=header.getBoundingClientRect();
      return {hidden:btn.hidden,visible:btnRect.width>0&&btnRect.height>0,
        insideHeader:btnRect.top>=headerRect.top-1&&btnRect.bottom<=headerRect.bottom+1};
    });
    const before=await editBtn();
    assert(!before.hidden&&before.visible&&before.insideHeader,`Edit button must be visible inside the persistent header on open, got ${JSON.stringify(before)}`);

    // Scroll the inner Read content all the way down.
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileReadView .location-profile-scroll");s.scrollTop=s.scrollHeight});
    await page.waitForTimeout(80);
    const afterScroll=await editBtn();
    assert(!afterScroll.hidden&&afterScroll.visible&&afterScroll.insideHeader,`Edit button must remain visible in the header after scrolling a long Read Profile to the bottom, got ${JSON.stringify(afterScroll)}`);

    // Must be clickable from this scrolled-to-bottom state, with no need to scroll back up.
    await page.click("#locationProfileEdit");
    await page.waitForTimeout(80);
    const mode=await page.evaluate(()=>document.getElementById("locationProfileEditView").hidden===false&&document.getElementById("locProfileName")===document.activeElement);
    assert(mode,"clicking the persistent Edit button (without scrolling back to top) must open Edit mode normally");

    // Edit mode must not show a second/duplicate Edit control.
    const editHiddenInEditMode=await page.evaluate(()=>document.getElementById("locationProfileEdit").hidden);
    assert(editHiddenInEditMode,"Edit mode must hide the Read-mode Edit button -- never a duplicated Edit control");

    await page.evaluate(()=>{cancelLocationProfileEdit();forceCloseModal("locationProfileModal")});
  }
  console.log("2. persistent Edit button: OK");

  /* ================= 3/4. MEDIA VISUAL LOADING STATES ================= */
  {
    const loadableImg="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    await page.evaluate(()=>{globalThis.cloudProjectSync={projectId:"fake",api:{listOwnedLocations:async()=>({ok:true,data:[]}),listLocationHistoryEvents:async()=>({ok:true,data:[]})}}});

    // Phase 1: metadata unknown -- one quiet generic loader, never a fake two-image composition.
    await page.evaluate(()=>{
      window.__listGate=new Promise(()=>{}); // never resolves for this phase
      cloudState.locationMediaApi={listMedia:()=>window.__listGate,signedUrl:async()=>({ok:true,url:""})};
    });
    await page.evaluate(id=>openLocationProfile(id),mediaLoc.id);
    await page.waitForTimeout(100);
    const unknownState=await page.evaluate(()=>{
      const el=document.getElementById("locationProfileMedia");
      return {hidden:el.hidden,genericLoaderCount:el.querySelectorAll(".location-media-generic-loading").length,
        fakeTwoBlockCount:el.querySelectorAll(".location-media-skeleton-block").length,
        groupCount:el.querySelectorAll(".location-media-group:not(.location-media-loading)").length,
        downstreamRevealed:document.getElementById("locationProfileReadDownstream").hidden===false};
    });
    assert(!unknownState.hidden,"the unknown-composition state must occupy visible space, not be hidden");
    assert(unknownState.genericLoaderCount===1,`exactly one quiet generic loader must show while composition is unknown, got ${unknownState.genericLoaderCount}`);
    assert(unknownState.fakeTwoBlockCount===0,"the unknown-composition placeholder must never render a fake two-image composition (the old .location-media-skeleton-block pair)");
    assert(unknownState.groupCount===0,"no real Media group structure may render before composition is actually known");
    assert(!unknownState.downstreamRevealed,"downstream Read content must still be withheld while Media composition is unknown");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));

    // Phase 2/2B/3: metadata known, image resolving, then loaded -- one continuous slot, no white gap.
    await page.evaluate(url=>{
      window.__listGate=new Promise(resolve=>{window.__resolveListGate=resolve});
      window.__signGate=new Promise(resolve=>{window.__resolveSignGate=resolve});
      cloudState.locationMediaApi={
        listMedia:()=>window.__listGate,
        signedUrl:async()=>{await window.__signGate;return {ok:true,url}}
      };
    },loadableImg);
    await page.evaluate(id=>openLocationProfile(id),mediaLoc.id);
    await page.evaluate(()=>window.__resolveListGate({ok:true,data:[
      {id:"m1",media_kind:"photo",storage_path:"p/1.jpg",mime_type:"image/jpeg",crop:{x:.5,y:.5,zoom:1},alt:"",caption:"",sort_order:0,is_primary:true,revision:0,metadata:{}}
    ]}));
    await page.waitForFunction(()=>document.querySelectorAll("#locationProfileMedia .location-media-group").length>0);

    const metadataKnownState=await page.evaluate(()=>{
      const el=document.getElementById("locationProfileMedia");
      const slot=el.querySelector(".location-media-slot-loading"); // bare, URL not known yet
      return {groupCount:el.querySelectorAll(".location-media-group").length,imgCount:el.querySelectorAll("img").length,
        hasSlotLoading:!!slot,downstreamRevealed:document.getElementById("locationProfileReadDownstream").hidden===false};
    });
    assert(metadataKnownState.groupCount>0,"the real group/slot structure must render as soon as metadata is known, before signing");
    assert(metadataKnownState.imgCount===0,"no <img> may exist yet -- the URL isn't known");
    assert(metadataKnownState.hasSlotLoading,"the pending slot must show the loading shimmer, not an empty/white frame");
    assert(metadataKnownState.downstreamRevealed,"downstream Read content may reveal once composition is known, even with images still pending");

    // URL resolves, but the image itself is given time to actually load -- the slot must show the
    // SAME loading treatment throughout, never a plain white frame, right up until `load` fires.
    await page.evaluate(()=>window.__resolveSignGate());
    await page.waitForFunction(()=>!!document.querySelector("#locationProfileMedia .location-media-slot"));
    const urlKnownImageNotReadyState=await page.evaluate(()=>{
      const slot=document.querySelector("#locationProfileMedia .location-media-slot");
      const shimmer=slot.querySelector(".location-media-slot-loading");
      const img=slot.querySelector("img");
      return {state:slot.dataset.state,shimmerOpacity:getComputedStyle(shimmer).opacity,imgOpacity:getComputedStyle(img).opacity,
        frameBg:getComputedStyle(slot.closest(".location-media-hero,.location-media-thumb,.location-media-visual-button")).backgroundColor};
    });
    // The shimmer must still be the visible layer (state may already be "loaded" if the tiny data:
    // URI decoded instantly -- assert on whichever is true rather than racing it).
    if(urlKnownImageNotReadyState.state==="loading"){
      assert(Number(urlKnownImageNotReadyState.shimmerOpacity)>0.9,"while the state is still 'loading', the shimmer must be the fully visible layer");
      assert(Number(urlKnownImageNotReadyState.imgOpacity)<0.1,"while the state is still 'loading', the <img> must not yet be visible -- no premature white/blank frame");
    }

    await page.waitForFunction(()=>{
      const slot=document.querySelector("#locationProfileMedia .location-media-slot");
      return slot&&(slot.dataset.state==="loaded"||slot.dataset.state==="error");
    });
    const loadedState=await page.evaluate(()=>{
      const slot=document.querySelector("#locationProfileMedia .location-media-slot");
      const img=slot.querySelector("img");
      return {state:slot.dataset.state,imgOpacity:getComputedStyle(img).opacity,slotLoadingStillInDom:!!slot.querySelector(".location-media-slot-loading")};
    });
    assert(loadedState.state==="loaded",`the slot must reach the 'loaded' state once the image actually loads, got ${loadedState.state}`);
    assert(Number(loadedState.imgOpacity)===1,"the loaded image must be fully visible");
    assert(loadedState.slotLoadingStillInDom,"the shimmer element stays in the DOM even once loaded (opacity-faded, not removed) -- this is deliberate, see css/locations.css");

    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.evaluate(()=>{delete globalThis.cloudProjectSync;delete cloudState.locationMediaApi});
  }
  console.log("3/4. Media visual loading states (no fake composition, no white flash): OK");

  /* ================= 5. MONOTONIC MODAL CLOSE ================= */
  {
    const state=modalId=>page.evaluate(id=>{
      const modal=document.getElementById(id);
      return {closing:modal.classList.contains("modal-backdrop--closing"),display:modal.style.display,opacity:Number(getComputedStyle(modal).opacity)};
    },modalId);

    await page.evaluate(id=>openLocationProfile(id),longLoc.id);
    await page.waitForTimeout(200);
    const before=await state("locationProfileModal");
    assert(before.opacity===1&&!before.closing,"the modal must sit at steady full opacity before closing");

    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    const immediatelyAfter=await state("locationProfileModal");
    assert(immediatelyAfter.display==="none","the synchronous close contract (display flips immediately) must hold");
    assert(immediatelyAfter.closing,"the closing modal must synchronously receive its own fade class");

    const samples=await page.evaluate(()=>new Promise(resolve=>{
      const out=[];const modal=document.getElementById("locationProfileModal");
      const tick=()=>{out.push(Number(getComputedStyle(modal).opacity));if(out.length<6)setTimeout(tick,35);else resolve(out)};
      tick();
    }));
    for(let i=1;i<samples.length;i++)assert(samples[i]<=samples[i-1]+0.01,`the close fade must be monotonically non-increasing, sampled ${JSON.stringify(samples)}`);
    assert(samples.at(-1)<=0.01,`the modal must have fully faded out by the end of the sampling window, got ${JSON.stringify(samples)}`);
  }
  console.log("5. monotonic modal close: OK");

  /* ================= 6. MODULE REVEAL SMOOTH-SCROLL ================= */
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelLoc.id);
    await page.evaluate(()=>{document.querySelector("#locationProfileEditView .location-profile-scroll").scrollTop=0});
    const bodyScrollBefore=await page.evaluate(()=>document.scrollingElement.scrollTop);
    await page.click("#locProfileAddSectionToggle");
    await page.waitForTimeout(400);
    const catalogReveal=await page.evaluate(()=>{
      const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
      const panel=document.getElementById("locProfileAddSectionPanel");
      const scrollerRect=scroller.getBoundingClientRect(),panelRect=panel.getBoundingClientRect();
      return {scrollTop:scroller.scrollTop,panelTopOffset:panelRect.top-scrollerRect.top,scrollerHeight:scrollerRect.height};
    });
    assert(catalogReveal.scrollTop>0,"opening the add-section catalog must move the inner scroller");
    assert(catalogReveal.panelTopOffset>=-2&&catalogReveal.panelTopOffset<catalogReveal.scrollerHeight,"the catalog panel must end up visible after its own reveal");

    await page.click(".location-thematic-add-chip[onclick*=\"'geography'\"]");
    await page.waitForTimeout(400);
    const moduleReveal=await page.evaluate(()=>{
      const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
      const moduleEl=document.getElementById("locProfileGeographyModule");
      const scrollerRect=scroller.getBoundingClientRect(),moduleRect=moduleEl.getBoundingClientRect();
      return {moduleTopOffset:moduleRect.top-scrollerRect.top,scrollerHeight:scrollerRect.height,focusedId:document.activeElement?.id};
    });
    assert(moduleReveal.moduleTopOffset>=-2&&moduleReveal.moduleTopOffset<moduleReveal.scrollerHeight,"selecting a module must reveal its heading on-screen");
    assert(moduleReveal.focusedId,"selecting a module must focus its first field");
    const bodyScrollAfter=await page.evaluate(()=>document.scrollingElement.scrollTop);
    assert(bodyScrollBefore===bodyScrollAfter,"the module-reveal scroll must only ever move the inner scroller, never the document/body");

    await page.evaluate(()=>{cancelLocationProfileEdit();forceCloseModal("locationProfileModal")});
  }
  console.log("6. module reveal smooth-scroll: OK");

  /* ================= 7. REDUCED MOTION ================= */
  {
    await page.emulateMedia({reducedMotion:"reduce"});

    // Modal close must collapse to effectively instant.
    await page.evaluate(id=>openLocationProfile(id),longLoc.id);
    await page.waitForTimeout(50);
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.waitForTimeout(30);
    const closeOpacity=await page.evaluate(()=>Number(getComputedStyle(document.getElementById("locationProfileModal")).opacity));
    assert(closeOpacity<=0.01,"reduced motion must collapse the close fade to effectively instant");

    // Module reveal must land immediately, no animation to wait out.
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelLoc.id);
    await page.evaluate(()=>{document.querySelector("#locationProfileEditView .location-profile-scroll").scrollTop=0});
    await page.click("#locProfileAddSectionToggle");
    await page.click(".location-thematic-add-chip[onclick*=\"'geography'\"]");
    const reduceMotionReveal=await page.evaluate(()=>{
      const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
      return {scrollTop:scroller.scrollTop};
    });
    assert(reduceMotionReveal.scrollTop>0,"reduced motion must still move the scroller immediately (no animation to wait out)");
    await page.evaluate(()=>{cancelLocationProfileEdit();forceCloseModal("locationProfileModal")});

    await page.emulateMedia({reducedMotion:"no-preference"});
  }
  console.log("7. reduced motion: OK");

  if(errors.length)throw new Error(`Browser console errors: ${errors.join("; ")}`);
  console.log("modal/motion/location-loading corrective browser tests passed");
}finally{await browser.close();server.kill()}
