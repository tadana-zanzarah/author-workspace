// Location Media async-resolution races (js/locations.js's loadLocationMediaForProfile) --
// regression coverage for planLocationMediaAsyncResolution (js/location-media.js), the pure
// decision function Location Manual UX Batch A issue #1 ("false dirty after successful Save")
// was fixed through. Mirrors tools/location-history-async-race.test.mjs's exact philosophy:
// simulates the lazy list_location_media (+ per-path signed-URL) fetch resolving LATE via a
// manually-resolvable Promise (never a real timer/network), then mutates world state exactly as
// each race scenario describes before resolving it -- proving resolution TIMING, not just the
// final decision, is what's under test.
import assert from "node:assert/strict";
import {planLocationMediaAsyncResolution} from "../js/location-media.js";

// A controllable stand-in for the already-hydrated-and-signed media array
// loadLocationMediaForProfile itself produces after awaiting listMedia + signedUrl.
function pendingFetch(){
  let resolve;
  const promise=new Promise(r=>{resolve=r});
  return {promise,resolve};
}

async function resolveMediaLoad(fetchPromise,world){
  const media=await fetchPromise;
  return planLocationMediaAsyncResolution({
    isStale:false,resultOk:media!==null,resultData:media,isDirty:world.isDirty()
  });
}

const seededMedia=[{id:"m1",mediaKind:"photo",source:{kind:"storage",storagePath:"p/m1.jpg",mimeType:"image/jpeg",value:"https://signed/m1.jpg"},crop:{x:.5,y:.5,zoom:1},alt:"",caption:"",sortOrder:0,isPrimary:true,revision:0,metadata:{}}];

// THE BUG THIS REPLACES: the exact trigger from the manual UX audit -- a dirty-tracker baseline is
// captured (synchronously, at Profile-open or post-Save reopen time) BEFORE the media fetch has
// resolved. When it finally resolves with genuinely different data (e.g. the just-saved media),
// checking isDirty() AFTER applying that data compares fresh data against a stale baseline and
// reads as dirty essentially always -- permanently stranding the Profile in a false-dirty state
// with no later recapture trigger. isDirty must be read BEFORE resultData is applied; this test
// fails if that ordering regresses back to a post-mutation check.
{
  const {promise,resolve}=pendingFetch();
  const world={isDirty:()=>false}; // no genuine edit occurred anywhere in the Profile
  const pending=resolveMediaLoad(promise,world);
  resolve(seededMedia); // the fetch resolves with real, different-from-baseline server truth
  const plan=await pending;
  assert.equal(plan.stale,false);
  assert.equal(plan.resetDraft,true,"a clean, untouched draft is safe to reset to the fetched media");
  assert.equal(plan.captureInitialState,true,"a clean Profile's baseline must be recaptured once real media data lands, even though it differs from what was captured before the fetch resolved");
  assert.deepEqual(plan.media.map(m=>m.id),["m1"],"the fetched media is recorded as the new persisted baseline");
}

// RACE A: the fetch is still in flight when the author starts a genuine in-progress edit (Profile
// modal tracker becomes dirty) -- e.g. edits an unrelated field, or adds a not-yet-uploaded media
// item -- before the fetch finally resolves. The resolution must NOT reset the draft (that would
// silently discard the unsaved edit) and must NOT re-capture the tracker's "clean" baseline (that
// would make a genuinely dirty Profile look clean, defeating unsaved-changes protection). This must
// fail if the dirty guard is removed (i.e. if resetDraft/captureInitialState were unconditional).
{
  const {promise,resolve}=pendingFetch();
  let dirty=false;
  const world={isDirty:()=>dirty};
  const pending=resolveMediaLoad(promise,world);
  dirty=true; // user made a genuine edit while the fetch was still in flight
  resolve(seededMedia);
  const plan=await pending;
  assert.equal(plan.stale,false);
  assert.equal(plan.resetDraft,false,"an in-progress dirty draft must not be clobbered by a late-resolving fetch");
  assert.equal(plan.captureInitialState,false,"a genuinely dirty Profile must not be marked clean by a late-resolving fetch");
  assert.deepEqual(plan.media.map(m=>m.id),["m1"],"the diff baseline still advances to the new persisted truth even while the draft itself is left untouched");
}

// A failed fetch (network error / RPC failure) must apply the SAME isDirty-gated discipline as a
// successful one: the baseline collapses to empty either way (nothing persisted, or nothing known),
// but a genuinely dirty draft is still never clobbered by the failure.
{
  const {promise,resolve}=pendingFetch();
  const world={isDirty:()=>true};
  const pending=resolveMediaLoad(promise,world);
  resolve(null); // resultOk:false path
  const plan=await pending;
  assert.equal(plan.media.length,0,"a failed fetch has no server truth to record");
  assert.equal(plan.resetDraft,false,"a dirty draft must not be wiped by a failed fetch either");
  assert.equal(plan.captureInitialState,false);
}

// A stale resolution (superseded load token, or the Profile switched to a different Location while
// this fetch was still in flight -- Batch A issue #2) must be a complete no-op regardless of
// dirty state at resolution time -- staleness is checked first and short-circuits everything else.
{
  const plan=planLocationMediaAsyncResolution({isStale:true,resultOk:true,resultData:seededMedia,isDirty:true});
  assert.deepEqual(plan,{stale:true});
}

console.log("location media async-race regression tests: OK");
