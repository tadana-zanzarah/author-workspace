import assert from "node:assert/strict";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {plainTextToDoc} from "../js/editor/scene-doc-convert.js";
import {
  registerMountedScene,unregisterMountedScene,markMountedSceneActive,
  getMountedSceneRegistrations,getPreferredLiveSceneView,hasMountedScene,
  _resetMountedSceneRegistryForTests
} from "../js/editor/mounted-scene-registry.js";

// Find/Replace Stage D1: the mounted-scene registry, exercised headlessly
// with fake EditorView stand-ins (only `.isDestroyed` and `.state.doc` are
// ever read by this module) carrying REAL ProseMirror docs (so Node#eq
// comparisons -- the actual mechanism getPreferredLiveSceneView relies on --
// are exercised for real, not mocked).
function fakeView(doc){
  return {isDestroyed:false,state:{doc}};
}

_resetMountedSceneRegistryForTests();

// 1. No registration at all -> null, never a thrown error or a fabricated
// registration.
{
  assert.equal(getPreferredLiveSceneView("scene-x"),null);
  assert.equal(hasMountedScene("scene-x"),false);
  assert.deepEqual(getMountedSceneRegistrations("scene-x"),[]);
}

// 2. Exactly one registration -> that one, unconditionally.
{
  const view=fakeView(plainTextToDoc(schema,"Кот сидел на окне."));
  const id=registerMountedScene("scene-a",{view,surfaceId:"textModal",activate(){}});
  const preferred=getPreferredLiveSceneView("scene-a");
  assert.equal(preferred.status,"ok");
  assert.equal(preferred.registration.registrationId,id);
  assert.equal(preferred.registration.surfaceId,"textModal");
  unregisterMountedScene("scene-a",id);
}

// 3. Multiple registrations for the SAME scene must coexist (never
// Map<sceneId,singleEntry> collapsing to one) -- this is the documented
// accepted invariant from docs/find-replace-architecture.md.
{
  const docText="Кот сидел на окне.";
  const viewA=fakeView(plainTextToDoc(schema,docText));
  const viewB=fakeView(plainTextToDoc(schema,docText));
  const idA=registerMountedScene("scene-b",{view:viewA,surfaceId:"textModal",activate(){}});
  const idB=registerMountedScene("scene-b",{view:viewB,surfaceId:"allScenesModal",activate(){}});
  assert.equal(getMountedSceneRegistrations("scene-b").length,2,"both registrations must coexist");
  assert.equal(hasMountedScene("scene-b"),true);

  // 3a. Identical docs -> either is a valid source; must not throw/conflict.
  const preferredIdentical=getPreferredLiveSceneView("scene-b");
  assert.equal(preferredIdentical.status,"ok");

  // 3b. Unregistering ONE registration must never remove the other (never
  // "unregister all for this scene").
  unregisterMountedScene("scene-b",idA);
  assert.equal(getMountedSceneRegistrations("scene-b").length,1);
  assert.equal(getMountedSceneRegistrations("scene-b")[0].registrationId,idB);
  unregisterMountedScene("scene-b",idB);
  assert.equal(hasMountedScene("scene-b"),false,"no stale registrations after both are unregistered");
}

// 4. Divergent docs, deterministic preference via most-recently-active --
// never arbitrary Map iteration order.
{
  const viewOld=fakeView(plainTextToDoc(schema,"Старый текст."));
  const viewNew=fakeView(plainTextToDoc(schema,"Новый текст."));
  const idOld=registerMountedScene("scene-c",{view:viewOld,surfaceId:"textModal",activate(){}});
  // registerMountedScene marks its OWN registration active immediately, so
  // idOld is "most recently active" right after registering it...
  const idNew=registerMountedScene("scene-c",{view:viewNew,surfaceId:"allScenesModal",activate(){}});
  // ...until idNew's own registration marks IT active instead.
  {
    const preferred=getPreferredLiveSceneView("scene-c");
    assert.equal(preferred.status,"ok");
    assert.equal(preferred.registration.registrationId,idNew,"the most recently registered/activated view wins when docs diverge");
  }
  // Explicitly re-activating the OLDER registration must flip the preference.
  markMountedSceneActive("scene-c",idOld);
  {
    const preferred=getPreferredLiveSceneView("scene-c");
    assert.equal(preferred.registration.registrationId,idOld);
  }
  unregisterMountedScene("scene-c",idOld);
  unregisterMountedScene("scene-c",idNew);
}

// 5. A destroyed view is never a candidate, even if it's the only
// registration on record -- destroy always implies unregister in real
// callers, but this module must not crash if a stale destroyed view somehow
// lingers.
{
  const view=fakeView(plainTextToDoc(schema,"Текст."));
  const id=registerMountedScene("scene-d",{view,surfaceId:"textModal",activate(){}});
  view.isDestroyed=true;
  assert.equal(getPreferredLiveSceneView("scene-d"),null,"a destroyed view must never be returned as preferred");
  unregisterMountedScene("scene-d",id);
}

// 6. Unregistering an id that was never registered (or already removed) is a
// safe no-op, never a throw.
{
  assert.doesNotThrow(()=>unregisterMountedScene("scene-does-not-exist","reg-999"));
  const view=fakeView(plainTextToDoc(schema,"Текст."));
  const id=registerMountedScene("scene-e",{view,surfaceId:"textModal",activate(){}});
  unregisterMountedScene("scene-e",id);
  assert.doesNotThrow(()=>unregisterMountedScene("scene-e",id));
}

console.log("mounted-scene-registry.test.mjs: all assertions passed");
