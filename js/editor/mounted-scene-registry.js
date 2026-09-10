// Find/Replace Stage D1: the mounted-scene registry. A small, headless,
// DOM/app-independent module tracking which live ProseMirror EditorViews are
// currently mounted for which scene, across however many surfaces happen to
// have one open at once. This is the primitive both live project search
// (find-replace-project-search.js) and the navigation adapter
// (find-replace-navigation.js) build on -- neither of those files reaches
// into scene-editor-controller.js's internals directly.
//
// IMPORTANT (see docs/find-replace-architecture.md): one scene can
// legitimately have MORE THAN ONE mounted live EditorView at once -- e.g. the
// standalone "Текст сцены" modal and an instance inside "Весь текст" open
// simultaneously (the app's modal stack allows nesting). This is therefore
// never `Map<sceneId, singleEntry>` -- it is `sceneId -> Map<registrationId,
// registration>`, and multiple simultaneous registrations for one scene are
// expected, supported, and tested, not an edge case to special-case away.
//
// A registration is `{registrationId, sceneId, view, surfaceId, activate}`:
//   - view: the live ProseMirror EditorView.
//   - surfaceId: which surface this came from ("textModal"/"sceneModal"/
//     "allScenesModal") -- informational, never branched on inside this file.
//   - activate(): a caller-supplied closure that brings THIS registration's
//     surface/scene to the front and focuses its editor (e.g. re-raise the
//     modal, retarget the shared "Весь текст" toolbar to this scene, scroll
//     the right block into view). This module never calls it itself -- it is
//     only ever invoked by find-replace-navigation.js, and this module has no
//     idea what it does.
//
// Registration lifecycle is the caller's responsibility: register on mount,
// unregister on destroy, one call each, matched by the returned
// registrationId. No stale registrations can survive a destroy this module
// wasn't told about -- callers that skip unregister are a caller bug, not
// something this module can detect or work around.
let nextRegistrationId=1;
const registrationsByScene=new Map(); // sceneId -> Map<registrationId, registration>
const activationOrder=new Map(); // registrationId -> monotonic counter, see markMountedSceneActive
let activationCounter=0;

function isViewUsable(view){
  return !!view&&!view.isDestroyed;
}

export function registerMountedScene(sceneId,{view,surfaceId,activate}){
  if(!sceneId)throw new Error("mounted-scene-registry: registerMountedScene requires a sceneId");
  const registrationId=`reg-${nextRegistrationId++}`;
  let bucket=registrationsByScene.get(sceneId);
  if(!bucket){bucket=new Map();registrationsByScene.set(sceneId,bucket)}
  bucket.set(registrationId,{registrationId,sceneId,view,surfaceId,activate});
  markMountedSceneActive(sceneId,registrationId); // a fresh mount is, by definition, the most recently active one
  return registrationId;
}

// Unregisters exactly the one registration named -- never "all registrations
// for this scene". Safe to call with an id that's already gone (double
// destroy, or a scene that was never registered because it had no id yet).
export function unregisterMountedScene(sceneId,registrationId){
  const bucket=registrationsByScene.get(sceneId);
  if(!bucket)return;
  bucket.delete(registrationId);
  activationOrder.delete(registrationId);
  if(!bucket.size)registrationsByScene.delete(sceneId);
}

// Called whenever a registration's surface/view genuinely becomes the
// active editing context (mount time, and real focus events) -- see
// getPreferredLiveSceneView below for what this feeds.
export function markMountedSceneActive(sceneId,registrationId){
  const bucket=registrationsByScene.get(sceneId);
  if(!bucket||!bucket.has(registrationId))return;
  activationCounter++;
  activationOrder.set(registrationId,activationCounter);
}

export function getMountedSceneRegistrations(sceneId){
  const bucket=registrationsByScene.get(sceneId);
  return bucket?[...bucket.values()]:[];
}

export function hasMountedScene(sceneId){
  const bucket=registrationsByScene.get(sceneId);
  return !!bucket&&bucket.size>0;
}

// Result shapes:
//   null                                 -- no live registration at all
//   {status:"ok",registration}           -- exactly one usable view, or
//                                            several agreeing on the same doc,
//                                            or several disagreeing but one is
//                                            unambiguously the most recently
//                                            active
//   {status:"conflict",registrations}    -- several usable, DIVERGENT docs,
//                                            and no recorded activation to
//                                            break the tie deterministically
//
// Deterministic preference policy (documented here, not left to Map
// iteration order):
//   1. Registrations whose view is destroyed are never candidates.
//   2. If exactly one usable registration remains, use it.
//   3. If every usable registration's document is structurally identical
//      (ProseMirror Node#eq -- content equality, not reference equality),
//      any of them is an equally valid source; the first is used.
//   4. Otherwise the docs genuinely disagree. Break the tie by the most
//      recently `markMountedSceneActive`-marked registration among the
//      usable ones -- "whichever the author was just actually working in"
//      is the only safe implicit choice.
//   5. If no usable registration has ever been marked active (should not
//      happen in practice -- registerMountedScene marks its own
//      registration active immediately -- but defended anyway), this
//      returns an explicit conflict rather than guessing from iteration
//      order.
export function getPreferredLiveSceneView(sceneId){
  const all=getMountedSceneRegistrations(sceneId);
  const usable=all.filter(registration=>isViewUsable(registration.view));
  if(!usable.length)return null;
  if(usable.length===1)return {status:"ok",registration:usable[0]};
  const firstDoc=usable[0].view.state.doc;
  const allSame=usable.every(registration=>registration.view.state.doc.eq(firstDoc));
  if(allSame)return {status:"ok",registration:usable[0]};
  const ranked=[...usable].sort((a,b)=>(activationOrder.get(b.registrationId)??-1)-(activationOrder.get(a.registrationId)??-1));
  const best=ranked[0];
  if((activationOrder.get(best.registrationId)??-1)>=0)return {status:"ok",registration:best};
  return {status:"conflict",registrations:usable};
}

// Test-only: fully resets module state between independent test cases.
export function _resetMountedSceneRegistryForTests(){
  registrationsByScene.clear();
  activationOrder.clear();
  activationCounter=0;
  nextRegistrationId=1;
}
