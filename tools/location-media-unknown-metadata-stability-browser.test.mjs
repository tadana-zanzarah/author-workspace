// Location Media unknown->metadata layout-stability follow-up -- browser regression suite (local
// mode unless a section explicitly mocks cloud state, no real Supabase credentials).
//
// The prior Manual Review batch made METADATA-KNOWN -> SIGNED perfectly stable (0px) by revealing
// the real Media group/hero/thumb/grid structure as soon as list_location_media's metadata
// resolves, instead of waiting for the slower per-path signed-URL round trip. But
// populateLocationProfileCore renders Children/thematic-module/Scenes sections SYNCHRONOUSLY,
// before Media's own async load even starts -- so while composition is still genuinely unknown,
// those sections already sit at whatever position the generic guessed loading placeholder leaves
// them, then visibly jump once the real Media structure replaces that guess. Measured on the
// published app: ~190px for the critical 1-Photo+2-Plans case.
//
// Fix: #locationProfileReadDownstream (index.html -- wraps everything in Read order AFTER
// #locationProfileMedia: Children, every thematic module, the Scenes section) stays `hidden` while
// Media's composition is unknown (hideLocationProfileReadDownstream, called from
// resetLocationProfileLazyChildState on a genuine Location switch) and is revealed exactly once,
// already at its final position, the instant Media's status stops being "loading"
// (revealLocationProfileReadDownstream, called from all three resolution points inside
// loadLocationMediaForProfile: local mode, cloud metadata-known, and the final/error path).
// Identity/summary and the Media loading state itself are NEVER hidden -- only what Read order
// places after Media.
import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

// One parent-with-child Location per composition case -- the child guarantees Read mode's Children
// section (first thing after Media in DOM order) actually renders, giving a concrete "first
// downstream section" position to measure without depending on Scenes/thematic content.
const compositionKeys=["empty","onePlan","onePhoto","twoPlans","photoPlusTwoPlans","error"];
const mediaLocs=Object.fromEntries(compositionKeys.map(key=>[key,{id:`loc-um-${key}`,name:`UM ${key}`,description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""}]));
const mediaChildren=compositionKeys.map(key=>({id:`loc-um-${key}-child`,name:`Child ${key}`,description:"",officialName:"",aliases:[],parentId:`loc-um-${key}`,typePreset:"room",customTypeLabel:"",shortSummary:""}));

// A->B fixture.
const locA={id:"loc-um-a",name:"Локация UM А",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""};
const locAChild={id:"loc-um-a-child",name:"Ребёнок А",description:"",officialName:"",aliases:[],parentId:"loc-um-a",typePreset:"room",customTypeLabel:"",shortSummary:""};
const locB={id:"loc-um-b",name:"Локация UM Б",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""};
const locBChild={id:"loc-um-b-child",name:"Ребёнок Б",description:"",officialName:"",aliases:[],parentId:"loc-um-b",typePreset:"room",customTypeLabel:"",shortSummary:""};

// Sparse (no description/children/thematic/scenes -- Media is the ONLY thing that could make it
// non-sparse) vs. rich (real description, a child, and thematic content) fixtures for section 7/10.
const sparseLoc={id:"loc-um-sparse",name:"UM sparse",description:"",officialName:"",aliases:[],parentId:null,typePreset:null,customTypeLabel:"",shortSummary:""};
const richLoc={id:"loc-um-rich",name:"UM rich",description:"Описание есть.",officialName:"",aliases:[],parentId:null,typePreset:"building",customTypeLabel:"",shortSummary:"",
  baseProfile:{history:{origin:"давняя история"}},moduleSelection:{shown:["history"]}};
const richChild={id:"loc-um-rich-child",name:"Ребёнок rich",description:"",officialName:"",aliases:[],parentId:"loc-um-rich",typePreset:"room",customTypeLabel:"",shortSummary:""};

const project={
  version:11,
  characters:[],
  profiles:{},
  chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],
  locations:[...Object.values(mediaLocs),...mediaChildren,locA,locAChild,locB,locBChild,sparseLoc,richLoc,richChild],
  tags:[],future:{},scenes:[]
};

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  // ERR_NAME_NOT_RESOLVED: this suite renders real <img src="https://example.test/..."> against
  // the RFC 2606 reserved, deliberately non-resolvable "example.test" domain (same convention the
  // other Location Media suites use for their own fake signed URLs) -- not a real app error.
  page.on("console",message=>{if(message.type()==="error"&&!/favicon/.test(message.text())&&!/404/.test(message.text())&&!/ERR_NAME_NOT_RESOLVED/.test(message.text()))errors.push(message.text())});
  await page.setViewportSize({width:900,height:700});
  await page.addInitScript(value=>{if(sessionStorage.getItem("um-stability-seeded"))return;sessionStorage.setItem("um-stability-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  await page.waitForFunction(()=>typeof openLocationProfile==="function");

  await page.evaluate(()=>{
    globalThis.cloudProjectSync={projectId:"fake-um-project",api:{listOwnedLocations:async()=>({ok:true,data:[]}),listLocationHistoryEvents:async()=>({ok:true,data:[]})}};
  });

  const setMediaMock=()=>page.evaluate(()=>{
    cloudState.locationMediaApi={
      listMedia:()=>window.__mediaListFetch||Promise.resolve({ok:true,data:[]}),
      signedUrl:async path=>{await window.__mediaSignGate;return {ok:true,url:`https://example.test/${encodeURIComponent(path)}`}}
    };
  });
  await setMediaMock();

  const rows=(kind,count,captioned)=>Array.from({length:count},(_,i)=>({
    id:`um-${kind}-${i}-${Math.random().toString(36).slice(2)}`,media_kind:kind,storage_path:`p/${kind}-${i}-${Math.random().toString(36).slice(2)}.jpg`,mime_type:"image/jpeg",
    crop:{x:.5,y:.5,zoom:1},alt:"",caption:captioned?`Подпись ${i+1}`:"",sort_order:i,is_primary:i===0,revision:0,metadata:{}
  }));
  const compositionRows={
    empty:[],
    onePlan:rows("floorplan",1,false),
    onePhoto:rows("photo",1,false),
    twoPlans:rows("floorplan",2,true),
    photoPlusTwoPlans:[...rows("photo",1,false),...rows("floorplan",2,true)],
    error:null // signals result:{ok:false}
  };

  const downstreamState=()=>page.evaluate(()=>{
    const wrapper=document.getElementById("locationProfileReadDownstream");
    const media=document.getElementById("locationProfileMedia");
    const identity=document.getElementById("locationProfileSummary");
    const modal=document.querySelector("#locationProfileModal .modal");
    return {
      wrapperHidden:wrapper.hidden,
      wrapperInDom:!!wrapper.getClientRects().length,
      mediaHidden:media.hidden,
      mediaAriaBusy:media.getAttribute("aria-busy"),
      hasLoadingSkeleton:!!media.querySelector(".location-media-loading"),
      identityVisible:!!identity.getClientRects().length||!identity.hidden,
      modalHeight:Math.round(modal.getBoundingClientRect().height),
      childrenTop:document.getElementById("locationProfileChildren").hidden?null:Math.round(document.getElementById("locationProfileChildren").getBoundingClientRect().top)
    };
  });

  /* ================= PHASE 1: unknown -> metadata (per composition) ================= */
  const results={};
  for(const key of compositionKeys){
    await page.evaluate(()=>{window.__mediaSignGate=new Promise(resolve=>{window.__resolveMediaSignGate=resolve})});
    await page.evaluate(()=>{window.__mediaListFetch=new Promise(resolve=>{window.__resolveMediaListFetch=resolve})});
    await page.evaluate(id=>openLocationProfile(id),mediaLocs[key].id);

    // PHASE 1: metadata unknown.
    const phase1=await downstreamState();
    assert(phase1.hasLoadingSkeleton,`${key}: while metadata is unknown, the generic Media loading state must be visible`);
    assert(phase1.mediaAriaBusy==="true",`${key}: Media must be marked aria-busy while its composition is unknown`);
    assert(phase1.identityVisible,`${key}: Location identity/summary must be visible immediately -- never withheld`);
    assert(phase1.wrapperHidden===true,`${key}: downstream (Children/thematic/Scenes) must be intentionally withheld while metadata is unknown`);
    const modalHeightPhase1=phase1.modalHeight;

    // PHASE 2: metadata resolves.
    if(key==="error"){
      await page.evaluate(()=>window.__resolveMediaListFetch({ok:false}));
      await page.waitForFunction(()=>document.getElementById("locationProfileMedia").querySelector(".location-media-error-state"));
    } else {
      await page.evaluate(data=>window.__resolveMediaListFetch({ok:true,data}),compositionRows[key]);
      await page.waitForFunction(()=>{
        const media=document.getElementById("locationProfileMedia");
        return media.hidden===true||media.querySelectorAll(".location-media-group").length>0;
      });
    }
    const phase2=await downstreamState();
    assert(phase2.mediaAriaBusy==="false",`${key}: Media must no longer be aria-busy once composition is known`);
    assert(phase2.wrapperHidden===false,`${key}: downstream must be revealed the instant Media's status stops being "loading" (metadata known, error, or empty)`);
    assert(Math.abs(phase2.modalHeight-modalHeightPhase1)<=1,`${key}: outer modal geometry must stay stable across the reveal, got ${modalHeightPhase1} -> ${phase2.modalHeight}`);
    const childrenTopAfterMetadata=phase2.childrenTop;
    assert(childrenTopAfterMetadata!=null,`${key}: Children must actually be visible (and positioned) once downstream is revealed`);

    // PHASE 3: signed images resolve (skip for the error/empty cases -- nothing to sign).
    if(key!=="error"&&compositionRows[key].length){
      await page.evaluate(()=>window.__resolveMediaSignGate());
      await page.waitForFunction(count=>document.querySelectorAll("#locationProfileMedia img").length>=count,compositionRows[key].length);
      await page.waitForTimeout(30);
    }
    const phase3ChildrenTop=await page.evaluate(()=>{
      const el=document.getElementById("locationProfileChildren");
      return el.hidden?null:Math.round(el.getBoundingClientRect().top);
    });
    const metadataToSignedDelta=Math.abs((phase3ChildrenTop??childrenTopAfterMetadata)-childrenTopAfterMetadata);
    assert(metadataToSignedDelta<=2,`${key}: metadata-known -> signed must still be ~0px (that phase was already fixed), got delta ${metadataToSignedDelta}`);

    results[key]={childrenTopAfterMetadata,metadataToSignedDelta};
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("  unknown-phase checks + metadata->signed deltas (px):",JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.metadataToSignedDelta]))));
  console.log("#1-7 composition + error cases (0/1-plan/1-photo/2-plans/photo+2plans/error): OK");

  /* ================= 8. A -> B overlap ================= */
  {
    await page.evaluate(()=>{window.__mediaListFetch=new Promise(()=>{})}); // A never resolves
    await page.evaluate(id=>openLocationProfile(id),locA.id);
    const aState=await downstreamState();
    assert(aState.wrapperHidden===true,"A: downstream must be withheld while A's own metadata is pending");

    await page.evaluate(data=>{window.__mediaListFetch=Promise.resolve({ok:true,data})},rows("photo",1,false));
    await page.evaluate(()=>{window.__mediaSignGate=Promise.resolve()});
    await page.evaluate(id=>openLocationProfile(id),locB.id);
    await page.waitForFunction(()=>document.getElementById("locationProfileReadDownstream").hidden===false);
    const bState=await downstreamState();
    assert(bState.wrapperHidden===false,"B: downstream must reveal from B's OWN (already-known) metadata, not leak A's pending state");
    const html=await page.evaluate(()=>document.getElementById("locationProfileMedia").innerHTML);
    assert(!html.includes("Ребёнок А")&&!html.includes(locA.id),"B: no trace of A's identity/content must appear once B has taken over");
    const childrenText=await page.evaluate(()=>document.getElementById("locationProfileChildren").textContent);
    assert(childrenText.includes("Ребёнок Б"),"B: B's own Children must be showing, not withheld and not A's");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#8 A -> B overlap: OK");

  /* ================= 9. same-Location reopen with metadata already known ================= */
  {
    await page.evaluate(data=>{window.__mediaListFetch=Promise.resolve({ok:true,data});window.__mediaSignGate=Promise.resolve()},rows("photo",1,false));
    await page.evaluate(id=>openLocationProfile(id),locA.id);
    await page.waitForFunction(()=>document.getElementById("locationProfileReadDownstream").hidden===false);
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));

    // Reopen the SAME Location -- metadata is already known in current state (locationMediaOriginal/
    // locationMediaLoadStatus persist across a mere close+reopen, no genuine identity switch
    // happened). The gate must never flash hidden again.
    await page.evaluate(id=>openLocationProfile(id),locA.id);
    const reopenState=await downstreamState();
    assert(reopenState.wrapperHidden===false,"reopening the SAME Location with already-known Media metadata must never re-hide downstream, not even for one synchronous check");
    assert(!reopenState.hasLoadingSkeleton,"reopening the same Location must not flash the generic loading skeleton when metadata is already known");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#9 same-Location reopen (metadata already known): OK");

  /* ================= 10/11. sparse vs. rich Location outer-modal behavior ================= */
  {
    const outerHeight=()=>page.evaluate(()=>document.querySelector("#locationProfileModal .modal").getBoundingClientRect().height);
    const isSparseClassed=()=>page.evaluate(()=>document.querySelector("#locationProfileModal .modal").classList.contains("location-profile-modal--sparse-read"));

    // Sparse: while Media is pending (composition genuinely unknown -- could still turn out
    // non-empty), the modal must NOT compact -- unchanged contract from the earlier Manual Review
    // batch (section 7 of this task: "outer modal geometry unchanged" concerns internal stability,
    // not this pre-existing pending-always-workspace rule).
    await page.evaluate(()=>{window.__mediaListFetch=new Promise(resolve=>{window.__resolveMediaListFetch=resolve});window.__mediaSignGate=Promise.resolve()});
    await page.evaluate(id=>openLocationProfile(id),sparseLoc.id);
    assert(!(await isSparseClassed()),"sparse Location: must NOT compact while Media is still pending, even though everything else is empty");
    const pendingHeight=await outerHeight();

    // Resolve empty -- genuinely sparse, but density must not shrink an already-open workspace
    // modal mid-viewing (pre-existing contract, unaffected by this task).
    await page.evaluate(()=>window.__resolveMediaListFetch({ok:true,data:[]}));
    await page.waitForFunction(()=>document.getElementById("locationProfileMedia").hidden===true);
    await page.waitForTimeout(30);
    const resolvedHeight=await outerHeight();
    assert(Math.abs(resolvedHeight-pendingHeight)<=1,"sparse Location: outer modal must not shrink once Media resolves empty mid-viewing");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));

    // Rich: real content -- must be (and stay) workspace-sized, downstream still gated correctly
    // while pending, revealed once known.
    await page.evaluate(()=>{window.__mediaListFetch=new Promise(resolve=>{window.__resolveMediaListFetch=resolve})});
    await page.evaluate(id=>openLocationProfile(id),richLoc.id);
    const richPending=await downstreamState();
    assert(richPending.wrapperHidden===true,"rich Location: downstream must still be withheld while Media metadata is pending, same as any other Location");
    assert(!(await isSparseClassed()),"rich Location: must be workspace-sized");
    await page.evaluate(data=>window.__resolveMediaListFetch({ok:true,data}),rows("photo",1,false));
    await page.waitForFunction(()=>document.getElementById("locationProfileReadDownstream").hidden===false);
    const richAfter=await downstreamState();
    assert(!(await isSparseClassed()),"rich Location: must remain workspace-sized after Media resolves");
    assert(Math.abs(richAfter.modalHeight-richPending.modalHeight)<=1,"rich Location: outer modal must not resize when downstream reveals");
    const childrenText=await page.evaluate(()=>document.getElementById("locationProfileChildren").textContent);
    assert(childrenText.includes("Ребёнок rich"),"rich Location: Children must be showing its own real content once revealed");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("#10-11 sparse/rich outer-modal + downstream-gate interaction: OK");

  /* ================= Accessibility: focus never moves/stolen by the gate ================= */
  {
    await page.evaluate(()=>{window.__mediaListFetch=new Promise(resolve=>{window.__resolveMediaListFetch=resolve})});
    await page.evaluate(id=>openLocationProfile(id),richLoc.id);
    const focusedBeforeReveal=await page.evaluate(()=>document.activeElement?.id);
    assert(focusedBeforeReveal==="locationProfileEdit","the Profile's normal initial focus (Редактировать) must be unaffected by the downstream gate");
    await page.evaluate(data=>window.__resolveMediaListFetch({ok:true,data}),rows("photo",1,false));
    await page.waitForFunction(()=>document.getElementById("locationProfileReadDownstream").hidden===false);
    const focusedAfterReveal=await page.evaluate(()=>document.activeElement?.id);
    assert(focusedAfterReveal==="locationProfileEdit","revealing downstream content must never move focus away from wherever it already was");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("accessibility (focus stable across reveal): OK");

  /* ================= Local mode: no async gap, no flash of hidden content ================= */
  {
    await page.evaluate(()=>{delete globalThis.cloudProjectSync;delete cloudState.locationMediaApi});
    await page.evaluate(id=>openLocationProfile(id),richLoc.id);
    const state=await downstreamState();
    assert(state.wrapperHidden===false,"local mode has no async gap -- downstream must never be visibly withheld");
    assert(!state.hasLoadingSkeleton,"local mode must never show the Media loading skeleton");
    await page.evaluate(()=>forceCloseModal("locationProfileModal"));
  }
  console.log("local mode (no gate flash): OK");

  if(errors.length)throw new Error(`Browser console errors: ${errors.join("; ")}`);
  console.log("location media unknown-metadata stability browser tests passed");
}finally{await browser.close();server.kill()}
