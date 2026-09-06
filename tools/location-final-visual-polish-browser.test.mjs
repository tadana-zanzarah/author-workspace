// Location Manual UX final visual polish -- browser regression suite (local mode unless a section
// explicitly mocks cloud state, no real Supabase credentials). Covers the five user-observed
// findings from the manual review pass, each verified through real DOM/bounding-rect assertions,
// not screenshots:
//
//   #1 FOCUS STYLE -- the shared global :focus-visible rule (css/base.css) used to ring every
//      input/textarea/select/button with a 3px outline + 2px offset (5px of visual ring per side).
//      On compact two-column Location fields (Звуки/Запахи/Освещение) and the identical
//      .profile-editor-grid Character shares, this read as an oversized "double border". Now 2px/
//      1px. Focus must never change a control's own geometry either way (outline never
//      participates in layout) -- verified for both Location and Character.
//
//   #2 ADD-MODULE CATALOG REVEAL -- "+ Добавить раздел" always opened the catalog correctly; it
//      just gave no scroll feedback when the catalog landed below the visible portion of
//      .location-profile-scroll. revealLocationModuleAddPanel (js/locations.js) now brings the
//      catalog's own start into view -- only from the explicit toggle-to-open action, only inside
//      the inner scroll region, never the page/body.
//
//   #3 CHILD STATS -- type and scene-count used to be joined into one "·"-separated string, so
//      rows with/without scenes read as different lengths (a "comb"). They're now two separate
//      slots with a zero rendered as "—" instead of omitted.
//
//   #4 BACKDROP -- .modal-backdrop's display:none<->flex toggle (js/modal-manager.js) now
//      participates in an opacity transition via transition-behavior:allow-discrete +
//      @starting-style (css/modals.css), purely a rendering-layer effect -- the underlying
//      `.style.display` toggle other tests assert on is unaffected.
//
//   #5 MEDIA LAYOUT STABILITY -- .location-profile-modal had `max-height` with no `height`, so it
//      shrink-wrapped to whatever synchronous content it had, then visibly grew once async Media
//      resolved. It now has an explicit height too (matching #charsModal's own convention), and a
//      genuine LOADING state (distinct from LOADED EMPTY) occupies the Media position meanwhile.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

const longText=Array.from({length:6},(_,i)=>`Абзац номер ${i+1} длинного описательного текста для переполнения формы редактирования локации по вертикали.`).join(" ");

// #2 fixture: only appearanceAtmosphere is shown -- geography/governmentSociety/economy/
// populationCulture/history all remain candidates in the add-panel catalog. Long text in the one
// shown module is enough to overflow a modest viewport once its disclosure is expanded.
const addPanelLoc={
  id:"loc-addpanel",name:"Локация с каталогом разделов",description:"",officialName:"",aliases:[],parentId:null,
  typePreset:"building",customTypeLabel:"",shortSummary:"",
  baseProfile:{appearanceAtmosphere:{visualDescription:longText,atmosphere:longText,sounds:longText}},
  moduleSelection:{shown:["appearanceAtmosphere"]}
};
// #2 Case A fixture: minimal content, catalog always fully visible without scrolling.
const addPanelShortLoc={
  id:"loc-addpanel-short",name:"Короткая локация",description:"",officialName:"",aliases:[],parentId:null,
  typePreset:"room",customTypeLabel:"",shortSummary:"",baseProfile:{},moduleSelection:{shown:[]}
};

// #3 fixture: a parent with children mixing zero/non-zero scene counts and two different types.
const childLocs=[
  {id:"loc-child-zero",name:"Библиотека",description:"",officialName:"",aliases:[],parentId:"loc-parent",typePreset:"room",customTypeLabel:"",shortSummary:""},
  {id:"loc-child-few",name:"Двор",description:"",officialName:"",aliases:[],parentId:"loc-parent",typePreset:"room",customTypeLabel:"",shortSummary:""},
  {id:"loc-child-many",name:"Кабинет Рене",description:"",officialName:"",aliases:[],parentId:"loc-parent",typePreset:"room",customTypeLabel:"",shortSummary:""},
  {id:"loc-child-building",name:"Кинозал",description:"",officialName:"",aliases:[],parentId:"loc-parent",typePreset:"building",customTypeLabel:"",shortSummary:""}
];
const parentLoc={id:"loc-parent",name:"Шер",description:"",officialName:"",aliases:[],parentId:null,typePreset:"building",customTypeLabel:"",shortSummary:""};
const childScenes=[
  ...["a","b"].map(n=>({id:`scene-few-${n}`,title:n,date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-child-few",tags:[],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{}})),
  ...Array.from({length:7},(_,i)=>({id:`scene-many-${i}`,title:`s${i}`,date:"",time:"",dateReview:false,chapterId:"chapter-unassigned",locationId:"loc-child-many",tags:[],writingStatus:"draft",sceneText:"",included:true,status:"floating",people:{}}))
];

// #5 fixture: a plain cloud-ready Location, no special baseProfile content needed (Media is
// entirely lazy-loaded, independent of baseProfile).
const mediaLocA={id:"loc-media-a",name:"Локация Медиа А",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""};
const mediaLocB={id:"loc-media-b",name:"Локация Медиа Б",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""};
const mediaLocC={id:"loc-media-c",name:"Локация Медиа В",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""};

const project={
  version:11,
  characters:[{id:"char-focus",name:"Рене",sortOrder:1000}],
  profiles:{},
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[addPanelLoc,addPanelShortLoc,parentLoc,...childLocs,mediaLocA,mediaLocB,mediaLocC],
  tags:[],future:{},scenes:childScenes
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error"&&!/favicon/.test(message.text())&&!/404/.test(message.text()))errors.push(message.text())});
  await page.setViewportSize({width:900,height:700});
  await page.addInitScript(value=>{if(sessionStorage.getItem("final-polish-seeded"))return;sessionStorage.setItem("final-polish-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.waitForFunction(()=>typeof openLocationProfile==="function");

  /* ================= #1 FOCUS STYLE ================= */
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelLoc.id);
    const before=await page.evaluate(()=>document.getElementById("locProfileSounds").getBoundingClientRect().toJSON());
    await page.click("#locProfileSounds");
    const focusVisible=await page.evaluate(()=>document.activeElement.id==="locProfileSounds"&&document.activeElement.matches(":focus-visible"));
    assert(focusVisible,"clicking a text field must land keyboard-visible focus on it");
    const outline=await page.evaluate(()=>{const s=getComputedStyle(document.getElementById("locProfileSounds"));return {width:s.outlineWidth,offset:s.outlineOffset,style:s.outlineStyle}});
    assert(outline.style==="solid","Location compact field must still show a solid focus outline");
    assert(outline.width==="2px","Location compact field outline must be thinned to 2px (was 3px)");
    assert(outline.offset==="1px","Location compact field outline-offset must be thinned to 1px (was 2px)");
    const after=await page.evaluate(()=>document.getElementById("locProfileSounds").getBoundingClientRect().toJSON());
    assert(before.width===after.width&&before.height===after.height,"focusing a Location field must not change its own box geometry");

    // Tag input (multi-value combobox) regression.
    await page.click("#locProfileNotableFeatures input");
    const tagOutline=await page.evaluate(()=>getComputedStyle(document.querySelector("#locProfileNotableFeatures input")).outlineWidth);
    assert(tagOutline==="2px","Location tag-field input must use the same thinned focus outline");

    // Large textarea regression (must also be thin, not just compact fields).
    await page.click("#locProfileVisualDescription");
    const textareaOutline=await page.evaluate(()=>getComputedStyle(document.getElementById("locProfileVisualDescription")).outlineWidth);
    assert(textareaOutline==="2px","Location textarea must use the same thinned focus outline");
    await page.evaluate(()=>cancelLocationProfileEdit());
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }

  // Character regression -- same shared base.css rule, different modal entirely.
  {
    await page.evaluate(id=>editProfile(id),"char-focus");
    await page.waitForSelector("#profileEditorModal:not([style*='display: none'])");
    const before=await page.evaluate(()=>document.getElementById("pf_height").getBoundingClientRect().toJSON());
    await page.click("#pf_height");
    const outline=await page.evaluate(()=>{const s=getComputedStyle(document.getElementById("pf_height"));return {width:s.outlineWidth,offset:s.outlineOffset}});
    assert(outline.width==="2px"&&outline.offset==="1px","Character field must pick up the same shared, thinned focus rule as Location");
    const after=await page.evaluate(()=>document.getElementById("pf_height").getBoundingClientRect().toJSON());
    assert(before.width===after.width&&before.height===after.height,"focusing a Character field must not change its own box geometry");
    await page.evaluate(()=>forceCloseModal("profileEditorModal"));
  }
  console.log("#1 focus style: OK");

  /* ================= #2 ADD-MODULE CATALOG REVEAL ================= */

  const scrollerState=()=>page.evaluate(()=>{
    const scroller=document.querySelector("#locationProfileEditView .location-profile-scroll");
    const toggle=document.getElementById("locProfileAddSectionToggle");
    const panel=document.getElementById("locProfileAddSectionPanel");
    const scrollerRect=scroller.getBoundingClientRect();
    const panelRect=panel.getBoundingClientRect();
    return {
      scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,
      panelTopOffset:panelRect.top-scrollerRect.top,panelBottomOffset:panelRect.bottom-scrollerRect.top,
      panelHidden:panel.hidden,toggleExpanded:toggle.getAttribute("aria-expanded"),
      bodyScrollTop:document.scrollingElement.scrollTop,activeId:document.activeElement?.id||null
    };
  });

  // Case A: minimal Location on a tall viewport -- catalog already fully visible, no pointless
  // scroll. A short Location's Edit form still has plenty of static chrome (identity fields, Media
  // section, thematic header) before the catalog itself, so this needs real headroom, not just
  // sparse content -- 700px (this file's usual viewport) is not enough on its own.
  {
    await page.setViewportSize({width:900,height:1400});
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelShortLoc.id);
    const beforeTop=await page.evaluate(()=>document.querySelector("#locationProfileEditView .location-profile-scroll").scrollTop);
    await page.click("#locProfileAddSectionToggle");
    const state=await scrollerState();
    assert(state.panelHidden===false,"catalog must actually open on click");
    assert(state.panelTopOffset>=0&&state.panelBottomOffset<=state.clientHeight,"test setup: catalog should be fully visible without scrolling for this tall-viewport fixture");
    assert(state.scrollTop===beforeTop,"an already-fully-visible catalog must cause no scroll movement (Case A)");
    await page.evaluate(()=>cancelLocationProfileEdit());
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.setViewportSize({width:900,height:700});
  }
  console.log("#2 Case A (already visible, no movement): OK");

  // Case B/C: long Location, scrolled to the bottom before clicking -- catalog lands below the
  // fold and must be actively revealed, without moving the page/body.
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit();toggleLocationThematicDisclosure("appearanceAtmosphere")},addPanelLoc.id);
    const scroller=await page.$("#locationProfileEditView .location-profile-scroll");
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileEditView .location-profile-scroll");s.scrollTop=s.scrollHeight});
    const beforeClick=await scrollerState();
    assert(beforeClick.scrollHeight>beforeClick.clientHeight,"test setup failed: Edit Profile content must actually overflow for this fixture");
    await page.click("#locProfileAddSectionToggle");
    await page.waitForTimeout(400); // allow the smooth scroll to settle
    const afterClick=await scrollerState();
    assert(afterClick.panelHidden===false,"catalog must open");
    assert(afterClick.scrollTop>beforeClick.scrollTop,"a below-the-fold catalog must trigger an actual scroll (Case B)");
    // The catalog sits as the very last content before the fixed footer, so scrolling to the
    // container's actual max here both reveals its start AND (in this fixture) brings its bottom
    // flush with the viewport edge -- the strongest form of "revealed", not just its top edge.
    assert(afterClick.panelTopOffset>=-2&&afterClick.panelTopOffset<afterClick.clientHeight,`the catalog's own START must end up on-screen, got offset ${afterClick.panelTopOffset} of ${afterClick.clientHeight}`);
    assert(afterClick.panelBottomOffset<=afterClick.clientHeight+2,"the catalog must be fully visible once scrolled as far as this fixture's content allows");
    assert(afterClick.bodyScrollTop===0,"revealing the catalog must never scroll the page/body");
    assert(afterClick.activeId==="locProfileAddSectionToggle","clicking the toggle must leave focus on the toggle itself, not steal it");
    await page.evaluate(()=>cancelLocationProfileEdit());
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#2 Case B (below-the-fold catalog revealed): OK");

  // Keyboard activation must behave identically.
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit();toggleLocationThematicDisclosure("appearanceAtmosphere")},addPanelLoc.id);
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileEditView .location-profile-scroll");s.scrollTop=s.scrollHeight});
    await page.focus("#locProfileAddSectionToggle");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const state=await scrollerState();
    assert(state.panelHidden===false,"keyboard activation (Enter) must open the catalog");
    assert(state.panelTopOffset>=-2&&state.panelTopOffset<state.clientHeight,"keyboard activation must reveal the catalog's start the same way a click does");
    assert(state.activeId==="locProfileAddSectionToggle","focus must remain logical (on the toggle) after keyboard activation");
    await page.evaluate(()=>cancelLocationProfileEdit());
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#2 Case D (keyboard activation): OK");

  // Reduced motion: reveal must happen immediately (no animation to wait out).
  {
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit();toggleLocationThematicDisclosure("appearanceAtmosphere")},addPanelLoc.id);
    await page.evaluate(()=>{const s=document.querySelector("#locationProfileEditView .location-profile-scroll");s.scrollTop=s.scrollHeight});
    const beforeClick=await scrollerState();
    await page.click("#locProfileAddSectionToggle");
    // No wait -- with reduced motion the scroll must already be applied synchronously (behavior:"auto").
    const immediately=await scrollerState();
    assert(immediately.scrollTop>beforeClick.scrollTop,"reduced-motion reveal must apply immediately, without waiting for an animation");
    assert(immediately.panelTopOffset>=-2&&immediately.panelTopOffset<immediately.clientHeight,"reduced-motion reveal must still land the catalog's start on-screen");
    await page.evaluate(()=>cancelLocationProfileEdit());
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
    await page.emulateMedia({reducedMotion:"no-preference"});
  }
  console.log("#2 reduced-motion path: OK");

  // Selecting a concrete module afterward must preserve existing behavior (no new double scroll).
  {
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelLoc.id);
    await page.click("#locProfileAddSectionToggle");
    await page.click(".location-thematic-add-chip[onclick*=\"'history'\"]");
    const historyState=await page.evaluate(()=>({
      bodyHidden:document.getElementById("locProfileHistoryBody").hidden,
      panelHidden:document.getElementById("locProfileAddSectionPanel").hidden,
      focusedId:document.activeElement?.id||null
    }));
    assert(historyState.bodyHidden===false,"choosing a candidate module must still expand it (existing behavior preserved)");
    assert(historyState.panelHidden===true,"choosing a candidate module must close the add-panel (existing behavior preserved)");
    assert(historyState.focusedId==="locProfileOrigin","choosing an empty candidate must still focus its first field (existing behavior preserved)");
    // Adding a module is a genuine draft change (unlike the earlier cases' disclosure-only
    // toggling), so cancelLocationProfileEdit() would correctly open a discard confirmation here
    // -- forceCloseModal bypasses that, same as this file's other intentionally-dirtied cleanups.
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#2 Case E (selected-module behavior preserved): OK");

  /* ================= #3 CHILD STATS ================= */
  {
    await page.evaluate(id=>openLocationProfile(id),parentLoc.id);
    const rows=await page.evaluate(()=>[...document.querySelectorAll(".location-profile-child-row")].map(row=>({
      name:row.querySelector(".location-profile-child-title").textContent,
      type:row.querySelector(".location-profile-child-type").textContent,
      scenes:row.querySelector(".location-profile-child-scenes").textContent,
      minWidth:getComputedStyle(row.querySelector(".location-profile-child-scenes")).minWidth,
      height:row.getBoundingClientRect().height
    })));
    const byName=Object.fromEntries(rows.map(r=>[r.name,r]));
    assert(byName["Библиотека"].scenes==="—","a child with zero scenes must render a restrained dash, not disappear or read '0'");
    assert(byName["Двор"].scenes==="Сцен 2","a child with 2 direct scenes must read 'Сцен 2'");
    assert(byName["Кабинет Рене"].scenes==="Сцен 7","a child with 7 direct scenes must read 'Сцен 7' (direct count only)");
    assert(byName["Библиотека"].type==="Помещение"&&byName["Двор"].type==="Помещение","room-type children must show the Помещение type label");
    assert(byName["Кинозал"].type==="Здание","building-type child must show the Здание type label");
    const minWidths=new Set(rows.map(r=>r.minWidth));
    assert(minWidths.size===1,"every row's scene-count slot must share the same stable min-width, zero or not");
    const heights=new Set(rows.map(r=>Math.round(r.height)));
    assert(heights.size===1,"rows with and without a scene count must remain the same height");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#3 child stats: OK");

  /* ================= #4 BACKDROP ================= */
  {
    const backdropTransition=await page.evaluate(()=>{
      const s=getComputedStyle(document.getElementById("locationsModal"));
      return {property:s.transitionProperty,duration:s.transitionDuration};
    });
    assert(backdropTransition.property.includes("opacity"),".modal-backdrop must declare an opacity transition");

    // Open/close must still work and never get visually stuck: display flips synchronously and
    // opacity settles at a sane resting value shortly after.
    await page.evaluate(()=>openLocationGallery());
    assert((await page.evaluate(()=>document.getElementById("locationsModal").style.display))==="flex","Gallery must open (display flips synchronously, unaffected by the new transition)");
    await page.waitForTimeout(220);
    const openedOpacity=await page.evaluate(()=>getComputedStyle(document.getElementById("locationsModal")).opacity);
    assert(Number(openedOpacity)>0.9,"backdrop must have faded up to fully opaque shortly after opening");
    await page.evaluate(()=>forceCloseModal("locationsModal"));
    assert((await page.evaluate(()=>document.getElementById("locationsModal").style.display))==="none","closing must still flip display synchronously (existing tests rely on this)");

    // Rapid reopen must not leave a stuck invisible backdrop.
    await page.evaluate(()=>openLocationGallery());
    await page.evaluate(()=>forceCloseModal("locationsModal"));
    await page.evaluate(()=>openLocationGallery());
    await page.waitForTimeout(220);
    const rapidOpacity=await page.evaluate(()=>getComputedStyle(document.getElementById("locationsModal")).opacity);
    assert(Number(rapidOpacity)>0.9,"a rapid close-then-reopen must still end up fully visible, never stuck faded");
    await page.evaluate(()=>forceCloseModal("locationsModal"));

    // Reduced motion: the app-wide transition-duration override must apply to this transition too.
    await page.emulateMedia({reducedMotion:"reduce"});
    const reducedDuration=await page.evaluate(()=>getComputedStyle(document.getElementById("locationsModal")).transitionDuration);
    assert(/^0\.001s/.test(reducedDuration)||reducedDuration.split(",").every(d=>parseFloat(d)<=0.002),`reduced-motion must collapse the backdrop transition duration near-instant, got ${reducedDuration}`);
    await page.emulateMedia({reducedMotion:"no-preference"});

    // Nested-modal regression: discard confirmation over the Profile shell.
    await page.evaluate(id=>{openLocationProfile(id);enterLocationProfileEdit()},addPanelShortLoc.id);
    await page.evaluate(()=>{document.getElementById("locProfileShortSummary").value="changed";document.getElementById("locProfileShortSummary").dispatchEvent(new Event("input",{bubbles:true}))});
    const closeAttempt=page.evaluate(()=>requestCloseModal("locationProfileModal","test"));
    await page.waitForTimeout(80);
    assert((await page.evaluate(()=>document.getElementById("discardChangesModal").style.display))==="flex","discard confirmation must still appear over the Profile shell with the new backdrop transition in place");
    await page.evaluate(()=>resolveDiscardConfirmation(true));
    assert(await closeAttempt,"confirming discard must still close the Profile");
    assert((await page.evaluate(()=>document.getElementById("locationProfileModal").style.display))==="none","the Profile modal must actually be closed");
  }
  console.log("#4 backdrop: OK");

  /* ================= #5 MEDIA LAYOUT STABILITY ================= */
  {
    await page.evaluate(()=>{
      globalThis.cloudProjectSync={projectId:"fake-project",api:{listOwnedLocations:async()=>({ok:true,data:[]}),listLocationHistoryEvents:async()=>({ok:true,data:[]})}};
      cloudState.locationMediaApi={
        listMedia:()=>window.__mediaFetch||Promise.resolve({ok:true,data:[]}),
        signedUrl:async()=>({ok:true,url:"https://example.test/fake.jpg"})
      };
    });

    const outerModalRect=()=>page.evaluate(()=>document.querySelector("#locationProfileModal .modal").getBoundingClientRect().toJSON());
    const mediaState=()=>page.evaluate(()=>{
      const el=document.getElementById("locationProfileMedia");
      return {hidden:el.hidden,hasLoading:!!el.querySelector(".location-media-loading"),hasError:!!el.querySelector(".location-media-error-state"),html:el.innerHTML};
    });

    // Media resolves LATE with real content -- outer modal geometry must already be at its final
    // size the instant the Profile opens, before Media has arrived at all.
    await page.evaluate(()=>{window.__mediaFetch=new Promise(resolve=>{window.__resolveMediaA=resolve})});
    await page.evaluate(id=>openLocationProfile(id),mediaLocA.id);
    const rectBeforeMedia=await outerModalRect();
    const stateWhileLoading=await mediaState();
    assert(stateWhileLoading.hidden===false&&stateWhileLoading.hasLoading===true,"while Media is pending, a distinct LOADING placeholder must occupy the Media position (not hidden, not empty)");
    assert(!stateWhileLoading.html.includes("<img"),"the loading placeholder must never render a fake thumbnail");

    await page.evaluate(()=>window.__resolveMediaA({ok:true,data:[{id:"ma",media_kind:"photo",storage_path:"p/ma.jpg",mime_type:"image/jpeg",crop:{x:.5,y:.5,zoom:1},alt:"MEDIA-A",caption:"",sort_order:0,is_primary:true,revision:0,metadata:{}}]}));
    await page.waitForFunction(()=>document.getElementById("locationProfileMedia").innerHTML.includes("MEDIA-A")||document.getElementById("locationProfileMedia").querySelector("img"));
    const rectAfterMedia=await outerModalRect();
    assert(Math.abs(rectAfterMedia.height-rectBeforeMedia.height)<1,`the outer Profile modal must not resize when Media resolves, got ${rectBeforeMedia.height} -> ${rectAfterMedia.height}`);
    const stateWithMedia=await mediaState();
    assert(stateWithMedia.hasLoading===false&&stateWithMedia.html.includes("<img"),"real Media must fully replace the loading placeholder once resolved");

    // Switching to a different Location must show ITS OWN loading state, never A's stale Media,
    // and the outer modal must again stay the same size.
    await page.evaluate(()=>{window.__mediaFetch=new Promise(()=>{})}); // never resolves for B in this step
    await page.evaluate(id=>openLocationProfile(id),mediaLocB.id);
    const rectSwitch=await outerModalRect();
    const stateSwitch=await mediaState();
    assert(!stateSwitch.html.includes("MEDIA-A"),"switching Locations must never show the previous Location's Media, not even while the new one is still loading");
    assert(stateSwitch.hasLoading===true,"a genuine Location switch must show the LOADING state for the new Location, not a stale/empty one");
    assert(Math.abs(rectSwitch.height-rectBeforeMedia.height)<1,"switching Locations must not change the outer modal's height either");

    // Empty resolution: LOADING must cleanly resolve to LOADED-EMPTY (hidden), never stay a skeleton.
    await page.evaluate(()=>{window.__mediaFetch=Promise.resolve({ok:true,data:[]})});
    await page.evaluate(id=>openLocationProfile(id),mediaLocC.id);
    await page.waitForFunction(()=>{const el=document.getElementById("locationProfileMedia");return el.hidden===true||el.querySelector(".location-media-error-state")});
    const stateEmpty=await mediaState();
    assert(stateEmpty.hidden===true&&stateEmpty.hasLoading===false,"an empty Media result must resolve to the clean hidden LOADED-EMPTY state, not a stuck skeleton");
    const rectEmpty=await outerModalRect();
    assert(Math.abs(rectEmpty.height-rectBeforeMedia.height)<1,"a no-media Location must claim the exact same stable outer modal height");

    // Error resolution: must show a restrained failure state, never an eternal skeleton.
    await page.evaluate(()=>{window.__mediaFetch=Promise.resolve({ok:false})});
    await page.evaluate(id=>openLocationProfile(id),mediaLocA.id); // re-load A to exercise a fresh fetch
    await page.waitForFunction(()=>document.getElementById("locationProfileMedia").querySelector(".location-media-error-state"));
    const stateError=await mediaState();
    assert(stateError.hasLoading===false&&stateError.hasError===true,"a failed Media fetch must show a restrained error state, not stay loading forever");

    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#5 media layout stability: OK");

  if(errors.length)throw new Error(`Browser console errors: ${errors.join("; ")}`);
  console.log("location manual ux final visual polish browser tests passed");
}finally{await browser.close();server.kill()}
