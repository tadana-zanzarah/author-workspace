import assert from "node:assert/strict";
import {createDirtyTracker,normalizedEqual} from "../js/dirty-state.js";

// Find/Replace Stage D2.1: rebaseExtra() -- an out-of-band programmatic text
// commit (project-wide Replace) must stop reporting as dirty WITHOUT
// silently accepting any OTHER currently-pending, unrelated dirty state
// already sitting in the same tracker (a real form field, or a sibling key
// of `extra` itself). See js/dirty-state.js's own doc comment on rebaseExtra
// and docs/find-replace-architecture.md.

// 1. Single-doc tracker shape (sceneModal/textModal): rebasing `doc` alone
// must not silently accept an unrelated pending `title` edit.
{
  let controls=[{key:"title",value:"Original title"}];
  let extra={doc:{v:1}};
  const tracker=createDirtyTracker("sceneModalLike",()=>({controls,extra}));
  tracker.captureInitialState();
  assert.equal(tracker.isDirty(),false,"clean right after capture");

  // Simulate: an out-of-band project-wide Replace commits new text for this
  // exact (currently open) scene, while an UNRELATED title edit is also
  // pending in the same form.
  controls=[{key:"title",value:"Changed title"}];
  extra={...extra,doc:{v:2}};
  assert.equal(tracker.isDirty(),true,"both the title edit and the (not yet rebased) doc change are dirty");

  tracker.rebaseExtra(e=>({...e,doc:{v:2}}));
  assert.equal(tracker.isDirty(),true,"the UNRELATED pending title edit must still report dirty after a text-only rebase");

  controls=[{key:"title",value:"Original title"}];
  assert.equal(tracker.isDirty(),false,"reverting the title too makes it fully clean again -- proving the rebase did not silently accept it earlier, and did not full-reset the baseline");
}

// 2. docs-map tracker shape (allScenesModal): rebasing ONE scene's own entry
// must leave a sibling scene's still-pending doc change dirty.
{
  let extra={docs:{"scene-a":{v:1},"scene-b":{v:1}}};
  const tracker=createDirtyTracker("allScenesModalLike",()=>({controls:[],extra}));
  tracker.captureInitialState();

  extra={docs:{"scene-a":{v:2},"scene-b":{v:2}}};
  assert.equal(tracker.isDirty(),true,"both scenes' pending edits are dirty");

  tracker.rebaseExtra(e=>({...e,docs:{...e.docs,"scene-a":{v:2}}}));
  assert.equal(tracker.isDirty(),true,"scene-b's own still-pending change must remain dirty after scene-a's rebase");

  extra={docs:{...extra.docs,"scene-b":{v:1}}};
  assert.equal(tracker.isDirty(),false,"reverting scene-b too makes it fully clean, confirming scene-a's rebase alone was correctly scoped");
}

// 3. rebaseExtra on a tracker that was never activated (captureInitialState
// never called, or deactivated since) is a safe no-op -- nothing to rebase
// against, never a crash.
{
  let extra={doc:{v:1}};
  const tracker=createDirtyTracker("neverOpened",()=>({controls:[],extra}));
  tracker.rebaseExtra(e=>({...e,doc:{v:2}}));
  assert.equal(tracker.isDirty(),false);
}

assert.equal(normalizedEqual({b:2,a:1},{a:1,b:2}),true,"порядок ключей не создаёт ложный dirty-state");
assert.equal(normalizedEqual(["a","b"],["b","a"]),false,"значимый порядок массивов сохраняется");
assert.equal(normalizedEqual("data:image/png;base64,AAAA","data:image/png;base64,AAAA"),true,"data URL сравнивается безопасно");

let draft={title:"Сцена",tags:["tag-a"],photo:"data:image/png;base64,AAAA"};
const tracker=createDirtyTracker("sceneEditor",()=>draft);
tracker.captureInitialState();
assert.equal(tracker.isDirty(),false,"исходная форма чистая");
draft={...draft,title:"Изменено"};
assert.equal(tracker.isDirty(),true,"реальное изменение обнаружено");
draft={...draft,title:"Сцена"};
assert.equal(tracker.isDirty(),false,"возврат к baseline снова делает форму чистой");
draft={...draft,photo:"data:image/png;base64,BBBB"};
assert.equal(tracker.isDirty(),true,"изменение фотографии обнаружено");
tracker.captureInitialState();
assert.equal(tracker.isDirty(),false,"успешное сохранение обновляет baseline");
draft={...draft,tags:["tag-a","tag-b"]};
assert.equal(tracker.isDirty(),true,"изменение тегов обнаружено");
tracker.resetDirty();
assert.equal(tracker.isDirty(),false,"подтверждённый discard сбрасывает tracker");

console.log("dirty-state unit tests: OK");
