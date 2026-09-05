// Location History async-resolution races (js/locations.js's loadLocationHistoryEventsForProfile) --
// regression coverage for planLocationHistoryEventsAsyncResolution (js/location-history-events.js),
// the pure decision function the two real, previously-fixed races were extracted into. Simulates the
// lazy list_location_history_events fetch resolving LATE via a manually-resolvable Promise (never a
// real timer/network), then mutates world state exactly as each race scenario describes before
// resolving it -- proving resolution TIMING, not just the final decision, is what's under test.
import assert from "node:assert/strict";
import {planLocationHistoryEventsAsyncResolution} from "../js/location-history-events.js";

// A controllable stand-in for `await cloudProjectSync.api.listLocationHistoryEvents(canonicalId)`:
// resolves only when the test calls `resolve`, never on its own.
function pendingFetch(){
  let resolve;
  const promise=new Promise(r=>{resolve=r});
  return {promise,resolve};
}

// Mirrors loadLocationHistoryEventsForProfile's own shape closely enough to genuinely race against
// world-state mutations the test makes while `fetchPromise` is still pending, without any DOM: reads
// `world.isDirty`/`world.mode` only AFTER the fetch resolves, exactly like the real function reads
// `tracker.isDirty()`/`locationProfileMode` only after `await`ing the RPC call.
async function resolveHistoryEventsLoad(fetchPromise,world){
  const result=await fetchPromise;
  return planLocationHistoryEventsAsyncResolution({
    isStale:false,resultOk:result.ok,resultData:result.data,
    isDirty:world.isDirty(),mode:world.mode()
  });
}

const seededRows=[{id:"e1",title:"Основание",date_label:"около 800 года",description:"",sort_order:0,revision:0,metadata:{}}];

// RACE A: the fetch is still in flight when the author starts an in-progress edit (Profile modal
// tracker becomes dirty) -- e.g. adds a brand-new draft event -- before the fetch finally resolves.
// The resolution must NOT reset the draft (that would silently discard the unsaved addition) and
// must NOT re-capture the tracker's "clean" baseline (that would make a genuinely dirty Profile look
// clean, defeating unsaved-changes protection). This must fail if the dirty guard is removed (i.e.
// if resetDraft/captureInitialState were unconditional).
{
  const {promise,resolve}=pendingFetch();
  let dirty=false;
  const world={isDirty:()=>dirty,mode:()=>"edit"};
  const pending=resolveHistoryEventsLoad(promise,world);
  dirty=true; // user added an unsaved draft event while the fetch was still in flight
  resolve({ok:true,data:seededRows});
  const plan=await pending;
  assert.equal(plan.stale,false);
  assert.equal(plan.resetDraft,false,"an in-progress dirty draft must not be clobbered by a late-resolving fetch");
  assert.equal(plan.captureInitialState,false,"a genuinely dirty Profile must not be marked clean by a late-resolving fetch");
  assert.deepEqual(plan.events.map(e=>e.id),["e1"],"the fetched events are still recorded as the new persisted baseline");
}

// RACE A control: same race, but the author never touched anything before the fetch resolved (still
// clean) -- the draft SHOULD reset to the freshly-fetched events and the tracker SHOULD capture a
// clean baseline, exactly as before this fix existed. Confirms the guard is conditional, not just
// "never reset".
{
  const {promise,resolve}=pendingFetch();
  const world={isDirty:()=>false,mode:()=>"read"};
  const pending=resolveHistoryEventsLoad(promise,world);
  resolve({ok:true,data:seededRows});
  const plan=await pending;
  assert.equal(plan.resetDraft,true,"a clean, untouched draft is safe to reset to the fetched events");
  assert.equal(plan.captureInitialState,true,"a clean Profile's baseline should be (re)captured once real data lands");
}

// RACE B: the author opens edit mode (Profile modal's action-row/disclosure state is computed once,
// at edit-mode entry -- see syncLocationProfileThematicFields) BEFORE the fetch resolves, so that
// entry-time computation only ever saw an empty/stale event list. History's module has no prose in
// this scenario -- events are its only content -- so the action row and disclosure must both refresh
// once the fetch reveals real events, not stay stuck showing "no data" state. Must fail if the
// mode==="edit" refresh guard is removed (i.e. if refreshModules/expandHistoryDisclosure were always
// false, matching the pre-fix behavior where this only ever ran at edit-mode entry).
{
  const {promise,resolve}=pendingFetch();
  let mode="read";
  const world={isDirty:()=>false,mode:()=>mode};
  const pending=resolveHistoryEventsLoad(promise,world);
  mode="edit"; // user entered edit mode while the fetch was still in flight
  resolve({ok:true,data:seededRows});
  const plan=await pending;
  assert.equal(plan.refreshModules,true,"History's action-row visibility must be recomputed once events land after edit mode was already entered");
  assert.equal(plan.expandHistoryDisclosure,true,"an events-only History module must auto-expand once its only content is known, even if that's after edit-mode entry");
}

// RACE B control: fetch resolves while still in read mode (edit never entered) -- no module
// re-render/disclosure change should be requested; nothing to refresh yet.
{
  const {promise,resolve}=pendingFetch();
  const world={isDirty:()=>false,mode:()=>"read"};
  const pending=resolveHistoryEventsLoad(promise,world);
  resolve({ok:true,data:seededRows});
  const plan=await pending;
  assert.equal(plan.refreshModules,false);
  assert.equal(plan.expandHistoryDisclosure,false);
}

// An empty event result in edit mode must never force the disclosure open (no content to reveal) --
// only refreshModules (the action-row recompute) fires; expandHistoryDisclosure stays false because
// prose (not modeled here) might still be what determines the module's own hasData.
{
  const {promise,resolve}=pendingFetch();
  const world={isDirty:()=>false,mode:()=>"edit"};
  const pending=resolveHistoryEventsLoad(promise,world);
  resolve({ok:true,data:[]});
  const plan=await pending;
  assert.equal(plan.refreshModules,true);
  assert.equal(plan.expandHistoryDisclosure,false,"no events fetched -- nothing to auto-expand for");
}

// A stale resolution (superseded load token, or the Profile switched to a different Location while
// this fetch was still in flight) must be a complete no-op regardless of dirty/mode state at
// resolution time -- staleness is checked first and short-circuits everything else.
{
  const plan=planLocationHistoryEventsAsyncResolution({isStale:true,resultOk:true,resultData:seededRows,isDirty:true,mode:"edit"});
  assert.deepEqual(plan,{stale:true});
}

console.log("location history async-race regression tests: OK");
