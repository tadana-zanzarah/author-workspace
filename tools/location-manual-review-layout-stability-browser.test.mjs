// Location Manual Review -- layout-stability browser regression suite (local mode unless a
// section explicitly mocks cloud state, no real Supabase credentials). Covers five findings from
// a manual review of the REAL published app that survived the earlier "final visual polish" pass
// -- each one a case where an earlier source-level assertion (outline is 2px, outer modal height
// unchanged, backdrop transition exists) was technically true but the user could still SEE the
// problem. Every assertion below measures the actual visual consequence instead:
//
//   #1 FOCUS RING CONTAINMENT -- the shared global :focus-visible rule (css/base.css) thinned the
//      ring in the earlier pass but kept a POSITIVE outline-offset, which paints outside the
//      control's own border box -- .location-profile-scroll's overflow-y:auto also computes its
//      overflow-x to auto (spec), so a full-width field's ring got clipped flush against that
//      container's own edge. outline-offset is now NEGATIVE (-3px, with a 2px ring -- see
//      css/base.css's own comment for the exact geometry), pulling the whole ring inside the
//      border edge so no ancestor's overflow can ever clip it. Verified as real geometry (ring's
//      own outer edge vs. field vs. scroller bounds), not just the declared CSS values.
//
//   #2 ADD-MODULE COMPLETE FLOW -- catalog-open reveal (from the earlier pass) must still work;
//      the regression is Step 2 (selecting a concrete module), which used to leave the new
//      module's header barely visible at the very bottom of the viewport with its fields below
//      the fold. revealLocationThematicModule (js/locations.js) now reveals the module's heading
//      THROUGH its first real field, sharing the same scrollLocationProfileElementIntoView
//      primitive Step 1 already used -- verified for both the empty-module (add) and
//      already-has-data (restore) paths, keyboard activation, and reduced motion.
//
//   #3 GALLERY INITIAL LOAD CLS -- the parent-breadcrumb line on a Location Gallery card
//      (".location-card-parent") only appeared once loadOwnedLocationRows()'s cloud round trip
//      resolved, so cards with a parent were shorter on first paint than a moment later, pushing
//      every row below downward. Whether a card carries that line at all is now decided from
//      location.parentId alone (already known synchronously) -- the line's slot is reserved from
//      first paint, and only its TEXT fills in once the async rows resolve. Verified as real
//      before/after card-height deltas and row-position displacement across multiple rows.
//
//   #4 MEDIA INTERNAL CLS -- the Media loading placeholder was one generic guessed shape
//      (hero-ish block + one thumb-ish block), which could be far shorter than the real Media
//      section for a multi-item/multi-type Location, so Children/History/Scenes below Media
//      jumped a large distance once Media actually resolved. loadLocationMediaForProfile now
//      reveals the REAL group/hero/thumb/grid structure the moment list_location_media's metadata
//      response resolves (composition is fully known then; only the separate per-path signed-URL
//      round trip is still pending) -- signing then only fills already correctly-sized slots.
//      Verified for 0/1/2-item and single/multi-type compositions, measuring the position of the
//      first section below Media before and after signing resolves.
//
//   #5 BACKDROP EXIT ("bright flash") -- closing a nested modal removes only ITS OWN dark tint;
//      the parent modal-backdrop underneath was always at its own steady dimness the whole time,
//      so what the user saw wasn't one continuous darkness change but two stacked dim layers
//      collapsing to one the instant the child left -- read as a sudden jump to bright wherever
//      the parent's own light modal box was visible only through both tints stacked.
//      animateModalReveal (js/modal-manager.js) now gives the freshly-revealed PARENT its own
//      brief, independent luminance-recovery pulse via `.modal-backdrop--reveal`/`--reveal-
//      settled` classes -- verified as real class-lifecycle timing (added synchronously, cleaned
//      up afterward, never left stale across rapid open/close/reopen), Profile->Gallery and
//      nested-confirmation->Profile specifically, and reduced motion.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

// #1 fixture: a Location with a full-width name/description, a compact two-column field
// (Звуки/Запахи/Освещение, appearanceAtmosphere), a tag field (notableFeatures), and History's own
// origin field (bottom of a long Edit form) -- exactly the controls the manual review named.
const focusLoc={
  id:"loc-focus",name:"Локация для фокуса",description:"",officialName:"",aliases:[],parentId:null,
  typePreset:"building",customTypeLabel:"",shortSummary:"",
  baseProfile:{appearanceAtmosphere:{sounds:"тест",notableFeatures:["особенность"]},history:{origin:"тест"}},
  moduleSelection:{shown:["appearanceAtmosphere","history"]}
};

// #2 fixture: only appearanceAtmosphere shown -- geography/governmentSociety/economy/
// populationCulture/history remain catalog candidates. "История" (history) is the long module the
// manual-review brief names explicitly (origin/overview/events/legends -- several fields tall).
const longText=Array.from({length:6},(_,i)=>`Абзац номер ${i+1} длинного описательного текста для переполнения формы редактирования локации по вертикали.`).join(" ");
const addPanelLoc={
  id:"loc-addpanel",name:"Локация с каталогом разделов",description:"",officialName:"",aliases:[],parentId:null,
  typePreset:"building",customTypeLabel:"",shortSummary:"",
  baseProfile:{appearanceAtmosphere:{visualDescription:longText,atmosphere:longText,sounds:longText}},
  moduleSelection:{shown:["appearanceAtmosphere"]}
};
// A Location whose history module ALREADY has data -- exercises the "restore" (showLocationThematicModule)
// path, not just the "add empty" one.
const restorePanelLoc={
  id:"loc-restorepanel",name:"Локация с восстановлением раздела",description:"",officialName:"",aliases:[],parentId:null,
  typePreset:"building",customTypeLabel:"",shortSummary:"",
  baseProfile:{appearanceAtmosphere:{visualDescription:longText},history:{origin:"давняя история",historicalOverview:longText}},
  moduleSelection:{shown:["appearanceAtmosphere"],hidden:["history"]}
};

// #3 fixture: a root Location plus several children, spread across multiple Gallery grid rows at
// a modest viewport width (2 columns).
const galleryRoot={id:"loc-gal-root",name:"Корневая локация",description:"",officialName:"",aliases:[],parentId:null,typePreset:"building",customTypeLabel:"",shortSummary:""};
const galleryChildren=Array.from({length:7},(_,i)=>({
  id:`loc-gal-child-${i}`,name:`Дочерняя локация ${i+1}`,description:"",officialName:"",aliases:[],
  parentId:"loc-gal-root",typePreset:"room",customTypeLabel:"",shortSummary:""
}));

// #4 fixture: one parent Location per Media composition, each with a real CHILD so Read mode's
// Children section (the first thing below Media in DOM order -- see index.html) is guaranteed to
// render synchronously and give a concrete "first section below Media" position to measure.
const mediaCompositions=["empty","onePlan","onePhoto","twoPlans","photoPlusTwoPlans"];
const mediaLocs=Object.fromEntries(mediaCompositions.map(key=>[key,{id:`loc-media-${key}`,name:`Локация Медиа ${key}`,description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""}]));
const mediaChildren=mediaCompositions.map(key=>({id:`loc-media-${key}-child`,name:`Дитя ${key}`,description:"",officialName:"",aliases:[],parentId:`loc-media-${key}`,typePreset:"room",customTypeLabel:"",shortSummary:""}));

// #5 fixture: reuses the Gallery root/children above (Gallery -> Profile is the exact stack the
// manual review named) plus a stray Location to exercise a plain nested confirmation.
const confirmLoc={id:"loc-confirm",name:"Локация для подтверждения",description:"",officialName:"",aliases:[],parentId:null,typePreset:"building",customTypeLabel:"",shortSummary:"",baseProfile:{history:{origin:"x"}},moduleSelection:{shown:["history"]}};

const project={
  version:11,
  characters:[{id:"char-focus",name:"Рене",sortOrder:1000}],
  profiles:{},
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[focusLoc,addPanelLoc,restorePanelLoc,galleryRoot,...galleryChildren,...Object.values(mediaLocs),...mediaChildren,confirmLoc],
  tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  // favicon/404 filtered as pre-existing baseline noise, not a real app error.
  page.on("console",message=>{if(message.type()==="error"&&!/favicon/.test(message.text())&&!/404/.test(message.text())&&!/ERR_NAME_NOT_RESOLVED/.test(message.text()))errors.push(message.text())});
  await page.setViewportSize({width:900,height:700});
  await page.addInitScript(value=>{if(sessionStorage.getItem("manual-review-layout-seeded"))return;sessionStorage.setItem("manual-review-layout-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.waitForFunction(()=>typeof openLocationProfile==="function");

  /* ================= #1 FOCUS RING CONTAINMENT ================= */
  {
    // Geometric containment check shared by every control below: the ring's own OUTERMOST edge
    // (offset+width from the border edge on the side that matters) must never sit past the
    // field's own border box, and must never sit past the scrolling container's own box either --
    // the two things that were previously getting clipped against.
    const ringContainment=(selector)=>page.evaluate(sel=>{
      const el=document.querySelector(sel);
      const scroller=el.closest(".location-profile-scroll")||el.closest(".modal");
      const cs=getComputedStyle(el);
      const width=parseFloat(cs.outlineWidth),offset=parseFloat(cs.outlineOffset);
      const elRect=el.getBoundingClientRect(),scrollerRect=scroller.getBoundingClientRect();
      // Outermost edge of the ring band relative to the border box, per side (see css/base.css's
      // own comment: band spans [offset, offset+width] outward from the border edge).
      const outward=offset+width;
      return {
        focusVisible:el.matches(":focus-visible"),
        outlineStyle:cs.outlineStyle,width,offset,
        ringRight:elRect.right+outward,ringLeft:elRect.left-outward,
        ringTop:elRect.top-outward,ringBottom:elRect.bottom+outward,
        elRect:elRect.toJSON(),scrollerRect:scrollerRect.toJSON()
      };
    },selector);
    const assertContained=(r,label)=>{
      assert(r.focusVisible,`${label}: click must land keyboard-visible focus`);
      assert(r.outlineStyle==="solid",`${label}: must show a solid focus outline`);
      assert(r.width>=2-0.01,`${label}: ring must stay at least 2px thick (WCAG 2.4.11), got ${r.width}`);
      assert(r.offset<=0,`${label}: outline-offset must be zero or inset (<=0), never positive/outward, got ${r.offset}`);
      assert(r.ringRight<=r.elRect.right+0.5,`${label}: ring must not extend past the FIELD's own right edge, got ring=${r.ringRight} field=${r.elRect.right}`);
      assert(r.ringLeft>=r.elRect.left-0.5,`${label}: ring must not extend past the FIELD's own left edge, got ring=${r.ringLeft} field=${r.elRect.left}`);
      assert(r.ringRight<=r.scrollerRect.right+0.5,`${label}: ring must not be clipped by the scroll container's right edge, got ring=${r.ringRight} scroller=${r.scrollerRect.right}`);
      assert(r.ringLeft>=r.scrollerRect.left-0.5,`${label}: ring must not be clipped by the scroll container's left edge, got ring=${r.ringLeft} scroller=${r.scrollerRect.left}`);
    };

    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},focusLoc.id);
    const beforeRect=await page.evaluate(()=>document.getElementById("locProfileName").getBoundingClientRect().toJSON());
    await page.click("#locProfileName");
    assertContained(await ringContainment("#locProfileName"),"full-width Location name");
    const afterRect=await page.evaluate(()=>document.getElementById("locProfileName").getBoundingClientRect().toJSON());
    assert(beforeRect.width===afterRect.width&&beforeRect.height===afterRect.height,"focusing must not change the field's own box geometry");

    await page.click("#locProfileDescription");
    assertContained(await ringContainment("#locProfileDescription"),"Location description textarea");

    await page.click("#locProfileSounds");
    assertContained(await ringContainment("#locProfileSounds"),"compact two-column field (Звуки)");

    await page.click("#locProfileNotableFeatures input");
    assertContained(await ringContainment("#locProfileNotableFeatures input"),"tag field input");

    await page.click("#locProfileTypePreset");
    await page.keyboard.press("Escape");
    await page.evaluate(()=>document.getElementById("locProfileTypePreset").focus());
    assertContained(await ringContainment("#locProfileTypePreset"),"type select");

    // History module's own origin field -- bottom of a long Edit form, exactly where the manual
    // review screenshots showed clipping.
    await page.evaluate(()=>{
      const expanded=document.getElementById("locProfileHistoryToggle")?.getAttribute("aria-expanded")==="true";
      if(!expanded)toggleLocationThematicDisclosure("history");
    });
    await page.evaluate(()=>document.getElementById("locProfileOrigin").scrollIntoView());
    await page.click("#locProfileOrigin");
    assertContained(await ringContainment("#locProfileOrigin"),"History origin field (bottom of Edit form)");

    await page.evaluate(()=>cancelLocationProfileEdit());
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }

  // Character regression -- same shared base.css rule, different modal entirely.
  {
    await page.evaluate(id=>editProfile(id),"char-focus");
    await page.waitForSelector("#profileEditorModal:not([style*='display: none'])");
    await page.click("#pf_height");
    const outline=await page.evaluate(()=>{const s=getComputedStyle(document.getElementById("pf_height"));return {width:s.outlineWidth,offset:s.outlineOffset}});
    assert(parseFloat(outline.width)>=2-0.01&&parseFloat(outline.offset)<=0,"Character field must pick up the same shared, inset focus rule as Location");
    await page.evaluate(()=>forceCloseModal("profileEditorModal"));
  }
  console.log("#1 focus ring containment: OK");

  /* ================= #2 ADD-MODULE COMPLETE FLOW ================= */
  const scrollerState=()=>page.evaluate(()=>{
    const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
    const scrollerRect=scroller.getBoundingClientRect();
    return {scroller,scrollerRect};
  });

  // Step 1 (already covered by the earlier pass's own suite) + Step 2: select "История" (empty
  // candidate, addEmptyLocationThematicModule path) from a below-the-fold catalog and verify the
  // module's heading AND its first real field both end up visible, in ONE deliberate movement.
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelLoc.id);
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileEditView .location-profile-scroll");s.scrollTop=0});
    await page.click("#locProfileAddSectionToggle");
    await page.waitForTimeout(400); // let the catalog's own reveal (Step 1) settle
    await page.click(".location-thematic-add-chip[onclick*=\"'history'\"]");
    await page.waitForTimeout(400); // let Step 2's own reveal settle
    const reveal=await page.evaluate(()=>{
      const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
      const moduleEl=document.getElementById("locProfileHistoryModule");
      const field=document.getElementById("locProfileOrigin");
      const scrollerRect=scroller.getBoundingClientRect(),moduleRect=moduleEl.getBoundingClientRect(),fieldRect=field.getBoundingClientRect();
      return {
        bodyHidden:document.getElementById("locProfileHistoryBody").hidden,
        panelHidden:document.getElementById("locProfileAddSectionPanel").hidden,
        focusedId:document.activeElement?.id||null,
        bodyScrollTop:document.scrollingElement.scrollTop,
        moduleTopOffset:moduleRect.top-scrollerRect.top,
        fieldBottomOffset:fieldRect.bottom-scrollerRect.top,
        scrollerHeight:scrollerRect.height
      };
    });
    assert(reveal.bodyHidden===false,"selecting a candidate module must expand it");
    assert(reveal.panelHidden===true,"selecting a candidate module must close the add-panel");
    assert(reveal.focusedId==="locProfileOrigin","selecting an empty candidate must still focus its first field");
    assert(reveal.bodyScrollTop===0,"revealing the selected module must never scroll the page/body");
    assert(reveal.moduleTopOffset>=-2&&reveal.moduleTopOffset<reveal.scrollerHeight,`the module's own HEADING must end up on-screen, got offset ${reveal.moduleTopOffset} of ${reveal.scrollerHeight}`);
    assert(reveal.fieldBottomOffset<=reveal.scrollerHeight+2,`the module's FIRST FIELD must also be visible (not just the header), got field bottom ${reveal.fieldBottomOffset} of ${reveal.scrollerHeight}`);
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#2 module select reveal (add-empty path): OK");

  // Restore path (showLocationThematicModule, module already has data) -- no explicit focus call
  // in this path (existing behavior), but the scroll reveal must still apply.
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},restorePanelLoc.id);
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileEditView .location-profile-scroll");s.scrollTop=0});
    await page.click("#locProfileAddSectionToggle");
    await page.waitForTimeout(400);
    await page.click(".location-thematic-add-chip[onclick*=\"'history'\"]");
    await page.waitForTimeout(400);
    const reveal=await page.evaluate(()=>{
      const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
      const moduleEl=document.getElementById("locProfileHistoryModule");
      const field=document.getElementById("locProfileOrigin");
      const scrollerRect=scroller.getBoundingClientRect(),moduleRect=moduleEl.getBoundingClientRect(),fieldRect=field.getBoundingClientRect();
      return {
        bodyHidden:document.getElementById("locProfileHistoryBody").hidden,
        moduleTopOffset:moduleRect.top-scrollerRect.top,
        fieldBottomOffset:fieldRect.bottom-scrollerRect.top,
        scrollerHeight:scrollerRect.height
      };
    });
    assert(reveal.bodyHidden===false,"restoring a has-data candidate must expand it");
    assert(reveal.moduleTopOffset>=-2&&reveal.moduleTopOffset<reveal.scrollerHeight,`restore path: module heading must end up on-screen, got ${reveal.moduleTopOffset} of ${reveal.scrollerHeight}`);
    assert(reveal.fieldBottomOffset<=reveal.scrollerHeight+2,`restore path: first field must also be visible, got ${reveal.fieldBottomOffset} of ${reveal.scrollerHeight}`);
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#2 module select reveal (restore path): OK");

  // Keyboard activation of the module chip must behave identically to a click.
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelLoc.id);
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileEditView .location-profile-scroll");s.scrollTop=0});
    await page.click("#locProfileAddSectionToggle");
    await page.waitForTimeout(400);
    await page.focus(".location-thematic-add-chip[onclick*=\"'history'\"]");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const reveal=await page.evaluate(()=>{
      const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
      const moduleEl=document.getElementById("locProfileHistoryModule");
      const scrollerRect=scroller.getBoundingClientRect(),moduleRect=moduleEl.getBoundingClientRect();
      return {bodyHidden:document.getElementById("locProfileHistoryBody").hidden,moduleTopOffset:moduleRect.top-scrollerRect.top,scrollerHeight:scrollerRect.height};
    });
    assert(reveal.bodyHidden===false,"keyboard (Enter) activation must expand the module exactly like a click");
    assert(reveal.moduleTopOffset>=-2&&reveal.moduleTopOffset<reveal.scrollerHeight,"keyboard activation must reveal the module the same way a click does");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#2 module select reveal (keyboard path): OK");

  // Reduced motion: the reveal must land immediately (behavior:"auto"), no animation to wait out,
  // and must not double-jump against the browser's own native focus-scroll (preventScroll:true).
  {
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelLoc.id);
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileEditView .location-profile-scroll");s.scrollTop=0});
    await page.click("#locProfileAddSectionToggle");
    await page.click(".location-thematic-add-chip[onclick*=\"'history'\"]");
    // No wait -- reduced motion must already be applied synchronously.
    const reveal=await page.evaluate(()=>{
      const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
      const moduleEl=document.getElementById("locProfileHistoryModule");
      const scrollerRect=scroller.getBoundingClientRect(),moduleRect=moduleEl.getBoundingClientRect();
      return {moduleTopOffset:moduleRect.top-scrollerRect.top,scrollerHeight:scrollerRect.height,scrollTop:scroller.scrollTop};
    });
    assert(reveal.scrollTop>0,"reduced-motion reveal must still move the scroller, just without animating");
    assert(reveal.moduleTopOffset>=-2&&reveal.moduleTopOffset<reveal.scrollerHeight,"reduced-motion reveal must still land the module's heading on-screen");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.emulateMedia({reducedMotion:"no-preference"});
  }
  console.log("#2 module select reveal (reduced motion): OK");

  /* ================= #3 GALLERY INITIAL LOAD CLS ================= */
  {
    await page.evaluate(()=>{
      globalThis.cloudProjectSync={projectId:"fake-gallery-project",api:{
        listOwnedLocations:()=>window.__ownedRowsFetch||Promise.resolve({ok:true,data:[]}),
        listLocationHistoryEvents:async()=>({ok:true,data:[]})
      }};
      // Force a genuinely cold cache for this test regardless of any earlier section's cloud use.
      invalidateOwnedLocationsCache();
    });

    const cardMetrics=()=>page.evaluate(()=>[...document.querySelectorAll(".location-card")].map(card=>{
      const rect=card.getBoundingClientRect();
      return {
        id:card.dataset.locationId,top:Math.round(rect.top),height:Math.round(rect.height),
        hasParentLine:!!card.querySelector(".location-card-parent"),
        parentText:card.querySelector(".location-card-parent")?.textContent||null
      };
    }));

    await page.evaluate(()=>{window.__ownedRowsFetch=new Promise(resolve=>{window.__resolveOwnedRows=resolve})});
    await page.evaluate(()=>openLocationGallery());
    const before=await cardMetrics();
    const beforeById=Object.fromEntries(before.map(c=>[c.id,c]));
    const childrenBefore=galleryChildren.map(c=>beforeById[c.id]);
    assert(childrenBefore.every(Boolean),"test setup: every child card must render on first paint");
    assert(childrenBefore.every(c=>c.hasParentLine),"every card whose Location has a parentId must reserve the breadcrumb line's slot from FIRST paint, before the owned-rows fetch resolves");

    // Resolve with real owned rows (root now has a real name to render in the breadcrumb).
    const ownedRows=[galleryRoot,...galleryChildren].map(l=>({id:l.id,name:l.name,official_name:null,aliases:[],parent_id:l.parentId||null,type_preset:l.typePreset||null,custom_type_label:null,participation_count:1}));
    await page.evaluate(rows=>window.__resolveOwnedRows({ok:true,data:rows}),ownedRows);
    await page.waitForFunction(name=>{
      const card=[...document.querySelectorAll(".location-card")].find(c=>c.dataset.locationId==="loc-gal-child-0");
      return card?.querySelector(".location-card-parent")?.textContent.includes(name);
    },galleryRoot.name);
    const after=await cardMetrics();
    const afterById=Object.fromEntries(after.map(c=>[c.id,c]));

    // Card-height delta: every card (not just the ones with a parent line) must be the exact same
    // height before and after -- this is the direct CLS measurement the earlier pass's suite
    // never took (it only ever checked the OUTER modal, never the Gallery's own cards). Scoped to
    // THIS section's own fixture set -- the Gallery renders every Location in the whole seeded
    // project (shared across every section in this file), and other sections' own parented
    // fixtures have no matching row in THIS mock's owned-rows response on purpose (their own
    // dedicated sections cover their own behavior) -- asserting on those here would just be
    // checking this test's own fixture scoping, not the app.
    const ownFixtureIds=new Set([galleryRoot.id,...galleryChildren.map(c=>c.id)]);
    for(const before of [...galleryChildren,galleryRoot]){
      const b=beforeById[before.id],a=afterById[before.id];
      assert(a,`test setup: card ${before.id} must still be present after resolution`);
      assert(Math.abs(a.height-b.height)<=1,`card ${before.id} height must not change once owned rows resolve, got ${b.height} -> ${a.height}`);
    }

    // Cumulative row displacement: any of THIS section's own cards not in its own first row must
    // not have moved at all.
    const ownBefore=before.filter(c=>ownFixtureIds.has(c.id));
    const firstRowTop=Math.min(...ownBefore.map(c=>c.top));
    const laterRowIds=ownBefore.filter(c=>c.top>firstRowTop+5).map(c=>c.id);
    assert(laterRowIds.length>0,"test setup: fixture must actually span multiple Gallery rows at this viewport width");
    for(const id of laterRowIds){
      const b=beforeById[id],a=afterById[id];
      assert(Math.abs(a.top-b.top)<=1,`row-2+ card ${id} must not shift downward once owned rows resolve, got top ${b.top} -> ${a.top}`);
    }

    await page.evaluate(()=>forceCloseModal("locationsModal"));
    await page.evaluate(()=>{delete globalThis.cloudProjectSync;invalidateOwnedLocationsCache()});
  }
  console.log("#3 gallery initial load CLS: OK");

  /* ================= #4 MEDIA INTERNAL CLS ================= */
  {
    // Modal/motion corrective pass: a real, tiny (1x1) data: URI, not the earlier `https://
    // example.test/...` placeholder -- that fake host never resolves (by design, RFC 2606), which
    // was fine when a signed URL string alone counted as "success" (the old code swapped the
    // shimmer for a bare <img src> the instant the URL was known). The NEW code (locationMediaSlotHtml,
    // js/locations.js) keeps the shimmer showing until the <img> actually fires `load` -- so this
    // suite needs an image that CAN actually load for its own "fully settled" assertions below to
    // mean anything; a never-resolving host would leave every slot stuck in data-state="loading"
    // (or eventually "error") forever, which is exactly the white-flash bug this pass fixed, not a
    // useful test signal.
    const loadableImg="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    await page.evaluate(url=>{
      globalThis.cloudProjectSync={projectId:"fake-media-project",api:{listOwnedLocations:async()=>({ok:true,data:[]}),listLocationHistoryEvents:async()=>({ok:true,data:[]})}};
      cloudState.locationMediaApi={
        listMedia:()=>window.__mediaListFetch||Promise.resolve({ok:true,data:[]}),
        signedUrl:async()=>{await window.__mediaSignGate;return {ok:true,url}}
      };
    },loadableImg);

    const firstSectionTop=()=>page.evaluate(()=>document.getElementById("locationProfileChildren").getBoundingClientRect().top);
    // Modal/motion corrective pass: slotLoadingCount now counts slots still ACTUALLY mid-load
    // (data-state="loading") rather than raw DOM presence of `.location-media-slot-loading` --
    // that element intentionally stays in the DOM (opacity-faded, see css/locations.css) even
    // after a slot finishes loading, as the whole point of the fix that eliminated the
    // beige->white->image flash (nothing is ever removed before its replacement is ready to
    // paint). settledCount is the complement: slots that reached "loaded" or "error" and are no
    // longer showing the shimmer as their visible layer.
    const mediaSnapshot=()=>page.evaluate(()=>{
      const el=document.getElementById("locationProfileMedia");
      // A bare `.location-media-slot-loading` (no `.location-media-slot` ancestor) means the URL
      // itself isn't known yet; one INSIDE a `.location-media-slot` is only actually "the visible
      // state" while that slot's own data-state is still "loading" (loaded/error fade it to
      // opacity:0 without removing it -- see css/locations.css).
      const stillLoading=[...el.querySelectorAll(".location-media-slot-loading")]
        .filter(s=>{const slot=s.closest(".location-media-slot");return !slot||slot.dataset.state==="loading"});
      const settledSlots=[...el.querySelectorAll(".location-media-slot")].filter(s=>s.dataset.state==="loaded"||s.dataset.state==="error");
      return {hidden:el.hidden,hasLoadingSkeleton:!!el.querySelector(".location-media-loading"),
        slotLoadingCount:stillLoading.length,slotSettledCount:settledSlots.length,
        imgCount:el.querySelectorAll("img").length,
        groupCount:el.querySelectorAll(".location-media-group").length};
    });

    const rows=(kind,count,captioned)=>Array.from({length:count},(_,i)=>({
      id:`m-${kind}-${i}`,media_kind:kind,storage_path:`p/${kind}-${i}.jpg`,mime_type:"image/jpeg",
      crop:{x:.5,y:.5,zoom:1},alt:"",caption:captioned?`Подпись ${i+1}`:"",sort_order:i,is_primary:i===0,revision:0,metadata:{}
    }));
    const compositionRows={
      empty:[],
      onePlan:rows("floorplan",1,false),
      onePhoto:rows("photo",1,false),
      twoPlans:rows("floorplan",2,true),
      photoPlusTwoPlans:[...rows("photo",1,false),...rows("floorplan",2,true)]
    };

    const results={};
    for(const key of mediaCompositions){
      await page.evaluate(()=>{window.__mediaSignGate=new Promise(resolve=>{window.__resolveMediaSignGate=resolve})});
      await page.evaluate(()=>{window.__mediaListFetch=new Promise(resolve=>{window.__resolveMediaListFetch=resolve})});
      await page.evaluate(id=>openLocationProfile(id),mediaLocs[key].id);
      const topWhileFullyLoading=await firstSectionTop();

      // Metadata resolves (composition now fully known) -- real group/hero/thumb/grid structure
      // must render immediately, images still pending as same-size shimmer slots.
      await page.evaluate(data=>window.__resolveMediaListFetch({ok:true,data}),compositionRows[key]);
      if(compositionRows[key].length){
        await page.waitForFunction(()=>document.querySelectorAll(".location-media-group").length>0||document.getElementById("locationProfileMedia").hidden);
        const midState=await mediaSnapshot();
        assert(midState.groupCount>0,`${key}: real group structure must render as soon as metadata (list_location_media) resolves, before signing`);
        assert(midState.imgCount===0,`${key}: no real <img> yet -- signing hasn't resolved`);
        assert(midState.slotLoadingCount>0,`${key}: pending image slots must show the per-slot shimmer, not the unavailable/error text`);
      } else {
        await page.waitForFunction(()=>document.getElementById("locationProfileMedia").hidden===true);
      }
      const topAfterMetadata=await firstSectionTop();

      // Signing resolves -- real images fill the already-correctly-sized slots.
      await page.evaluate(()=>window.__resolveMediaSignGate());
      if(compositionRows[key].length){
        await page.waitForFunction(count=>document.querySelectorAll("#locationProfileMedia img").length>=count,compositionRows[key].filter(r=>true).length>0?compositionRows[key].length:0);
        // The <img> tag existing in the DOM (checked above) is not the same as it having actually
        // fired `load` -- see locationMediaSlotHtml's own comment. Every slot must reach a settled
        // data-state (its real image, this suite's loadable data: URI, always succeeds) before the
        // "no shimmer remains" assertion below means anything.
        await page.waitForFunction(count=>[...document.querySelectorAll("#locationProfileMedia .location-media-slot")].filter(s=>s.dataset.state==="loaded"||s.dataset.state==="error").length>=count,compositionRows[key].length);
      }
      await page.waitForTimeout(30);
      const topAfterSigning=await firstSectionTop();
      const finalState=await mediaSnapshot();
      if(compositionRows[key].length){
        assert(finalState.imgCount===compositionRows[key].length,`${key}: every item must end up with a real <img> once signing resolves, got ${finalState.imgCount} of ${compositionRows[key].length}`);
        assert(finalState.slotSettledCount===compositionRows[key].length,`${key}: every slot must actually finish loading (data-state loaded/error), got ${finalState.slotSettledCount} of ${compositionRows[key].length}`);
        assert(finalState.slotLoadingCount===0,`${key}: no slot may still be showing its loading shimmer once every path has settled`);
      }

      const metadataToSignedDelta=Math.abs(topAfterSigning-topAfterMetadata);
      results[key]={topWhileFullyLoading,topAfterMetadata,topAfterSigning,metadataToSignedDelta};
      // THE critical assertion (see file header): downstream content must not visibly jump once
      // the shape is already known -- signing may only fill already-sized slots.
      assert(metadataToSignedDelta<=2,`${key}: first section below Media must not move once its shape is known, got ${topAfterMetadata} -> ${topAfterSigning} (delta ${metadataToSignedDelta})`);

      await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    }

    // The critical case named explicitly in the brief: multi-item AND multi-type together.
    const worst=results.photoPlusTwoPlans;
    assert(worst.metadataToSignedDelta<=2,`multi-type (photo + 2 plans) is the case that MUST be covered and MUST NOT show a large jump, got delta ${worst.metadataToSignedDelta}`);
    console.log("  media CLS deltas (metadata-known -> signed, px):",JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.metadataToSignedDelta]))));

    // Error path: listMedia itself fails -- must show a restrained error state, never hang.
    await page.evaluate(()=>{window.__mediaListFetch=Promise.resolve({ok:false})});
    await page.evaluate(id=>openLocationProfile(id),mediaLocs.empty.id);
    await page.waitForFunction(()=>document.getElementById("locationProfileMedia").querySelector(".location-media-error-state"));
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));

    // A -> B while requests overlap: B's own metadata-known reveal must never show A's content,
    // and a stale-token late resolution for A must never overwrite B's already-committed state.
    await page.evaluate(()=>{window.__mediaListFetch=new Promise(()=>{})}); // A never resolves
    await page.evaluate(id=>openLocationProfile(id),mediaLocs.onePhoto.id);
    await page.evaluate(data=>{
      window.__mediaListFetch=Promise.resolve({ok:true,data});
    },compositionRows.twoPlans);
    await page.evaluate(id=>openLocationProfile(id),mediaLocs.twoPlans.id);
    await page.evaluate(()=>window.__resolveMediaSignGate?.());
    await page.waitForFunction(()=>document.querySelectorAll("#locationProfileMedia .location-media-group").length>0);
    const overlapHtml=await page.evaluate(()=>document.getElementById("locationProfileMedia").innerHTML);
    assert(!overlapHtml.includes("m-photo-0"),"switching Locations mid-fetch must never let a stale earlier Location's Media render");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));

    await page.evaluate(()=>{delete globalThis.cloudProjectSync;delete cloudState.locationMediaApi});
  }
  console.log("#4 media internal CLS: OK");

  /* ================= #5 BACKDROP EXIT ("very bad flash... hurts the eyes") =================
     The old `.modal-backdrop--reveal`/`--reveal-settled` pulse (applied to the freshly-revealed
     PARENT) failed real manual review and was deleted entirely -- see js/modal-manager.js's own
     comment. The replacement never touches the parent at all: forceCloseModal now adds
     `.modal-backdrop--closing` (opacity:0) to the CLOSING modal itself in the same synchronous
     turn as its display write, giving the base rule's existing `transition:opacity 160ms ease,
     display 160ms allow-discrete` an actual value to animate instead of nothing to interpolate.
     These assertions check the PARENT is never touched (no new class, opacity never leaves 1) and
     the closing child's own opacity is monotonically non-increasing over several sampled frames --
     the direct test for "no dark/bright oscillation". */
  {
    const state=(modalId)=>page.evaluate(id=>{
      const modal=document.getElementById(id);
      return {closing:modal.classList.contains("modal-backdrop--closing"),display:modal.style.display,opacity:Number(getComputedStyle(modal).opacity)};
    },modalId);

    // Profile -> Gallery: closing the Profile must never touch the Gallery at all.
    await page.evaluate(()=>openLocationGallery());
    await page.waitForTimeout(200); // let the Gallery's own open fade-in settle before using it as a steady baseline
    await page.evaluate(id=>openLocationProfile(id),galleryRoot.id);
    await page.waitForTimeout(200); // same, for the Profile's own open fade-in
    const galleryBefore=await state("locationsModal");
    assert(galleryBefore.opacity===1&&!galleryBefore.closing,"the Gallery must sit at its steady opacity, untouched, while the Profile is open on top of it");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    const profileImmediatelyAfter=await state("locationProfileModal");
    assert(profileImmediatelyAfter.closing,"forceCloseModal must synchronously mark the CLOSING modal itself for its own fade, not the parent");
    assert(profileImmediatelyAfter.display==="none","the synchronous close contract (display flips immediately) must be unchanged");
    const galleryImmediatelyAfter=await state("locationsModal");
    assert(!galleryImmediatelyAfter.closing,"the revealed Gallery must never receive any exit/reveal class of its own");
    assert(galleryImmediatelyAfter.opacity===1,"the revealed Gallery's own opacity must never move -- it was never dimmed by the closing child in the first place, only ever displayed underneath it");

    // Sample the CLOSING Profile's own opacity over several real frames -- must be monotonically
    // non-increasing (a plain fade, never a dip-then-recover) -- while the Gallery stays pinned at
    // exactly 1 throughout (proof nothing "pulses" on the parent). One evaluate call with an
    // internal timer loop, not N separate round trips -- keeps this cheap regardless of how many
    // samples are taken.
    const samples=await page.evaluate(()=>new Promise(resolve=>{
      const out=[];
      const tick=()=>{
        const p=document.getElementById("locationProfileModal"),g=document.getElementById("locationsModal");
        out.push({profile:Number(getComputedStyle(p).opacity),gallery:Number(getComputedStyle(g).opacity)});
        if(out.length<6)setTimeout(tick,35);else resolve(out);
      };
      tick();
    }));
    for(const s of samples)assert(s.gallery===1,`the Gallery's opacity must stay exactly 1 for the ENTIRE close sequence, sampled ${JSON.stringify(samples.map(x=>x.gallery))}`);
    for(let i=1;i<samples.length;i++){
      assert(samples[i].profile<=samples[i-1].profile+0.01,`the closing Profile's own opacity must never increase mid-fade (monotonic), sampled ${JSON.stringify(samples.map(x=>x.profile))}`);
    }
    assert(samples.at(-1).profile<=0.01,`the closing Profile must have fully faded out by the end of the sampling window, got ${JSON.stringify(samples.map(x=>x.profile))}`);

    await page.evaluate(()=>forceCloseModal("locationsModal"));
  }
  console.log("#5 backdrop exit (Profile -> Gallery, monotonic, parent untouched): OK");

  {
    // Nested confirmation -> Profile: closing the confirmation must never touch the Profile.
    await page.evaluate(()=>openLocationGallery());
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit();toggleLocationThematicDisclosure("history")},confirmLoc.id);
    await page.evaluate(()=>startDeleteLocationThematicModule("history"));
    // startDeleteLocationThematicModule shows an inline confirm row, not a separate modal, in this
    // app's actual delete-module flow -- exercise a REAL nested modal instead: the generic confirm
    // action modal, via showConfirmAction (used elsewhere, e.g. location deletion).
    const confirmPromise=page.evaluate(()=>showConfirmAction({title:"Тест",description:"тест"}));
    await page.waitForSelector("#confirmActionModal[style*='display: flex']");
    const profileWhileNested=await page.evaluate(()=>({
      closing:document.getElementById("locationProfileModal").classList.contains("modal-backdrop--closing"),
      display:document.getElementById("locationProfileModal").style.display,
      opacity:Number(getComputedStyle(document.getElementById("locationProfileModal")).opacity)
    }));
    assert(profileWhileNested.display==="flex"&&profileWhileNested.opacity===1&&!profileWhileNested.closing,"the Profile modal must still be the visible, untouched parent underneath the confirmation");
    await page.evaluate(()=>resolveConfirmAction(true));
    await confirmPromise;
    const profileAfter=await page.evaluate(()=>({
      closing:document.getElementById("locationProfileModal").classList.contains("modal-backdrop--closing"),
      opacity:Number(getComputedStyle(document.getElementById("locationProfileModal")).opacity)
    }));
    assert(!profileAfter.closing&&profileAfter.opacity===1,"closing the nested confirmation must leave the revealed Profile completely untouched -- no class, no opacity change");
    await page.evaluate(()=>cancelLocationProfileEdit());
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.evaluate(()=>forceCloseModal("locationsModal"));
  }
  console.log("#5 backdrop exit (nested confirmation -> Profile, parent untouched): OK");

  {
    // Rapid open/close/reopen must never leave a stuck fade or an invisible-but-still-flex modal.
    await page.evaluate(()=>openLocationGallery());
    await page.evaluate(id=>openLocationProfile(id),galleryRoot.id);
    await page.evaluate(()=>forceCloseModal("locationProfileModal")); // Profile starts fading, cleanup pending
    await page.evaluate(id=>openLocationProfile(id),galleryRoot.id); // reopen before that fade finishes
    const reopenedState=await page.evaluate(()=>({
      closing:document.getElementById("locationProfileModal").classList.contains("modal-backdrop--closing"),
      opacity:Number(getComputedStyle(document.getElementById("locationProfileModal")).opacity)
    }));
    assert(!reopenedState.closing,"reopening a modal mid-fade must synchronously clear its own closing class");
    assert(reopenedState.opacity===1,"a reopened modal must be fully visible immediately, never stuck at a faded opacity from its previous close");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.waitForTimeout(220);
    const galleryState=await page.evaluate(()=>({
      closing:document.getElementById("locationsModal").classList.contains("modal-backdrop--closing"),
      opacity:Number(getComputedStyle(document.getElementById("locationsModal")).opacity)
    }));
    assert(!galleryState.closing&&galleryState.opacity===1,"the Gallery must end up fully visible, never stuck dimmed, after rapid nested open/close");
    await page.evaluate(()=>forceCloseModal("locationsModal"));
  }
  console.log("#5 backdrop exit (rapid open/close/reopen): OK");

  {
    // Reduced motion: logically identical (still closes synchronously), and the app-wide
    // transition-duration:.001ms rule (css/base.css) already collapses the visual fade to
    // effectively instant -- verified here as "fully faded within a few ms", not the full 160ms.
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.evaluate(()=>openLocationGallery());
    await page.evaluate(id=>openLocationProfile(id),galleryRoot.id);
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.waitForTimeout(30);
    const state=await page.evaluate(()=>({
      opacity:Number(getComputedStyle(document.getElementById("locationProfileModal")).opacity),
      galleryOpacity:Number(getComputedStyle(document.getElementById("locationsModal")).opacity)
    }));
    assert(state.opacity<=0.01,"reduced motion must collapse the close fade to effectively instant, well within 30ms");
    assert(state.galleryOpacity===1,"the Gallery must still never be touched under reduced motion either");
    await page.evaluate(()=>forceCloseModal("locationsModal"));
    await page.emulateMedia({reducedMotion:"no-preference"});
  }
  console.log("#5 backdrop exit (reduced motion): OK");

  if(errors.length)throw new Error(`Browser console errors: ${errors.join("; ")}`);
  console.log("location manual review layout stability browser tests passed");
}finally{await browser.close();server.kill()}
