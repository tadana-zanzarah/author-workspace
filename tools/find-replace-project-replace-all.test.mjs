import assert from "node:assert/strict";
import {EditorState} from "prosemirror-state";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {plainTextToDoc,loadSceneDocument} from "../js/editor/scene-doc-convert.js";
import {registerMountedScene,unregisterMountedScene,_resetMountedSceneRegistryForTests} from "../js/editor/mounted-scene-registry.js";
import {planProjectReplaceAll,resolveSceneReplacementSource,syncMountedScenesAfterReplaceAll} from "../js/editor/find-replace-project-replace-all.js";
import {createFindReplaceController} from "../js/editor/find-replace-controller.js";

// Find/Replace Stage D2.2.1: project-wide Replace ALL -- headless coverage
// for the fresh-plan/live-doc/conflict/atomicity/no-op/rich-text contract
// (see docs/find-replace-architecture.md's "Stage D2.2.1" section). Same
// technique as tools/find-replace-project-replace.test.mjs: real ProseMirror
// schema/EditorState (no DOM dependency at all -- only EditorView needs a
// real DOM), fake "view" stand-ins registered in the REAL mounted-scene
// registry.
function scene(id,title,chapterId,sceneText,{included=true}={}){
  return {id,title,chapterId,sceneText,included,sceneTextDoc:null};
}
function makeProject(scenes){
  return {chapters:[{id:"chapter-1",title:"Глава 1"}],scenes};
}
function fakeView(doc){
  const view={isDestroyed:false,dispatchCount:0,dispatchedTrs:[],focus(){}};
  view.state=EditorState.create({schema,doc});
  view.dispatch=tr=>{view.dispatchCount++;view.dispatchedTrs.push(tr);view.state=view.state.apply(tr)};
  return view;
}
// Real EditorView instances call the controller's own handleTransaction from
// their `onUpdate` hook on EVERY dispatch (see js/editor/scene-editor-
// view.js). A bare fake view has no such wiring, so an INTEGRATION test that
// needs the controller's own project result to stay live across a dispatch
// must reproduce it explicitly, exactly like the Single Replace test suite
// already does.
function attachToController(view,controller,sceneId){
  const baseDispatch=view.dispatch;
  view.dispatch=tr=>{
    baseDispatch(tr);
    controller.handleTransaction(view.state,tr);
  };
  controller.attachView(view,sceneId);
}

// ================================================================
// 1. resolveSceneReplacementSource -- the per-scene doc-authority/conflict
//    policy in isolation.
// ================================================================

_resetMountedSceneRegistryForTests();
{
  // No live registration at all -> the persisted doc.
  const s=scene("none","Нет","chapter-1","Кот сидел.");
  const result=resolveSceneReplacementSource(s);
  assert.equal(result.status,"none");
  assert.equal(result.doc.textContent,"Кот сидел.");
}
_resetMountedSceneRegistryForTests();
{
  // One live registration, with UNSAVED text different from persisted -> the
  // live doc is authoritative, not the stale persisted one.
  const s=scene("live","Живая","chapter-1","Кот сидел.");
  const view=fakeView(plainTextToDoc(schema,"Кот сидел и играл."));
  const regId=registerMountedScene("live",{view,surfaceId:"textModal",activate(){}});
  const result=resolveSceneReplacementSource(s);
  assert.equal(result.status,"agree");
  assert.equal(result.doc.textContent,"Кот сидел и играл.");
  unregisterMountedScene("live",regId);
}
_resetMountedSceneRegistryForTests();
{
  // Two registrations that AGREE (byte-for-byte identical live docs) ->
  // still "agree", using that shared content.
  const s=scene("agree","Согласны","chapter-1","Кот сидел.");
  const doc=plainTextToDoc(schema,"Кот сидел тихо.");
  const viewA=fakeView(doc),viewB=fakeView(doc);
  const regA=registerMountedScene("agree",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("agree",{view:viewB,surfaceId:"sceneModal",activate(){}});
  const result=resolveSceneReplacementSource(s);
  assert.equal(result.status,"agree");
  assert.equal(result.doc.textContent,"Кот сидел тихо.");
  unregisterMountedScene("agree",regA);unregisterMountedScene("agree",regB);
}
_resetMountedSceneRegistryForTests();
{
  // Two registrations that DISAGREE -> conflict, no doc reported.
  const s=scene("conflict","Конфликт","chapter-1","Кот сидел.");
  const viewA=fakeView(plainTextToDoc(schema,"Кот сидел тихо."));
  const viewB=fakeView(plainTextToDoc(schema,"Кот бежал быстро."));
  const regA=registerMountedScene("conflict",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("conflict",{view:viewB,surfaceId:"sceneModal",activate(){}});
  const result=resolveSceneReplacementSource(s);
  assert.equal(result.status,"conflict");
  assert.equal(result.doc,undefined);
  unregisterMountedScene("conflict",regA);unregisterMountedScene("conflict",regB);
}

// D2.2.1 corrective pass (manual acceptance): a stale-but-still-registered
// registration whose own surface is NOT currently open/visible (this app's
// existing, accepted "closing just hides the modal, the mount is destroyed
// only on that surface's own NEXT open" pattern -- see mounted-scene-
// registry.js's own doc comment) must never, on its own, produce a false
// conflict against a genuinely visible, freshly-mounted registration for the
// same scene -- even though their document content genuinely differs.
// `view.dom={offsetParent:null}` simulates a closed modal's editor,
// `{offsetParent:{}}` a currently-open one -- same technique tools/mounted-
// scene-registry.test.mjs already established for isViewVisible.
_resetMountedSceneRegistryForTests();
{
  const s=scene("orphan","Осиротевшая","chapter-1","Кот сидел.");
  const staleHidden=fakeView(plainTextToDoc(schema,"Кот сидел и играл всё утро."));
  staleHidden.dom={offsetParent:null}; // e.g. "Текст сцены", closed via discard/Escape/backdrop -- never destroyed
  const freshVisible=fakeView(plainTextToDoc(schema,"Кот сидел."));
  freshVisible.dom={offsetParent:{}}; // e.g. the Scene modal, just opened
  const regStale=registerMountedScene("orphan",{view:staleHidden,surfaceId:"textModal",activate(){}});
  const regFresh=registerMountedScene("orphan",{view:freshVisible,surfaceId:"sceneModal",activate(){}});
  const result=resolveSceneReplacementSource(s);
  assert.equal(result.status,"agree","an invisible orphan must never block the plan on its own");
  assert.equal(result.doc.textContent,"Кот сидел.","the visible, currently-open registration is authoritative, never the hidden orphan");
  unregisterMountedScene("orphan",regStale);unregisterMountedScene("orphan",regFresh);
}

// D2.2.1 corrective pass: TWO simultaneously VISIBLE registrations that
// genuinely disagree must still conflict -- the visibility narrowing above
// must never weaken this. Both here are visible (e.g. "Текст сцены" and
// "Весь текст" both genuinely open at once, per this app's own supported
// architecture -- see mounted-scene-registry.js's module doc comment).
_resetMountedSceneRegistryForTests();
{
  const s=scene("real-conflict","РеальныйКонфликт","chapter-1","Кот сидел.");
  const viewA=fakeView(plainTextToDoc(schema,"Кот сидел тихо."));
  viewA.dom={offsetParent:{}};
  const viewB=fakeView(plainTextToDoc(schema,"Кот бежал быстро."));
  viewB.dom={offsetParent:{}};
  const regA=registerMountedScene("real-conflict",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("real-conflict",{view:viewB,surfaceId:"allScenesModal",activate(){}});
  const result=resolveSceneReplacementSource(s);
  assert.equal(result.status,"conflict","two SIMULTANEOUSLY VISIBLE, genuinely disagreeing registrations must still abort");
  unregisterMountedScene("real-conflict",regA);unregisterMountedScene("real-conflict",regB);
}

// D2.2.1 corrective pass: when EVERY registration for a scene is invisible
// (e.g. two abandoned, never-destroyed hidden mounts, no surface for this
// scene currently open at all) and they genuinely disagree, this must still
// conflict -- the fallback-to-full-set branch must never silently pick one.
_resetMountedSceneRegistryForTests();
{
  const s=scene("all-hidden-conflict","ВсеСкрыты","chapter-1","Кот сидел.");
  const viewA=fakeView(plainTextToDoc(schema,"Кот сидел тихо."));
  viewA.dom={offsetParent:null};
  const viewB=fakeView(plainTextToDoc(schema,"Кот бежал быстро."));
  viewB.dom={offsetParent:null};
  const regA=registerMountedScene("all-hidden-conflict",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("all-hidden-conflict",{view:viewB,surfaceId:"sceneModal",activate(){}});
  const result=resolveSceneReplacementSource(s);
  assert.equal(result.status,"conflict","when NO registration is visible, disagreement among the full set must still abort -- never an arbitrary pick");
  unregisterMountedScene("all-hidden-conflict",regA);unregisterMountedScene("all-hidden-conflict",regB);
}

// ================================================================
// 2. planProjectReplaceAll -- pure planning, no I/O.
// ================================================================

// 2a. Basic multi-scene plan: every affected scene, canonical order,
// correct total match count, every unrelated scene absent.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([
    scene("p1","П1","chapter-1","Кот один. Кот два."),
    scene("p2","П2","chapter-1","И кот здесь."),
    scene("p3","П3","chapter-1","Собака лает.")
  ]);
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  assert.equal(plan.ok,true);assert.equal(plan.changed,true);
  assert.equal(plan.affectedSceneCount,2);
  assert.equal(plan.totalMatchCount,3);
  assert.deepEqual(plan.scenes.map(s=>s.sceneId),["p1","p2"],"canonical project order, p3 absent (no match)");
  assert.equal(plan.scenes[0].sceneText,"пёс один. пёс два.");
  assert.equal(plan.scenes[1].sceneText,"И пёс здесь.");
}

// 2b. included:false scenes participate exactly like included ones.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("hidden","Скрытая","chapter-1","Кот сидел.",{included:false})]);
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  assert.equal(plan.ok,true);assert.equal(plan.changed,true);
  assert.equal(plan.affectedSceneCount,1);
  assert.equal(plan.scenes[0].sceneId,"hidden");
  assert.equal(plan.scenes[0].sceneText,"пёс сидел.");
}

// 2c. Mounted unsaved doc: live text (never the stale persisted text) is
// what gets planned, and the replacement is applied ON TOP of it -- the
// author's own pending edit survives INTO the committed result.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("mounted","Смонтир","chapter-1","Кот сидел.")]);
  const view=fakeView(plainTextToDoc(schema,"Кот сидел и играл с мячом."));
  const regId=registerMountedScene("mounted",{view,surfaceId:"textModal",activate(){}});
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  assert.equal(plan.ok,true);assert.equal(plan.changed,true);
  assert.equal(plan.scenes[0].sceneText,"пёс сидел и играл с мячом.","live unsaved edit preserved, replacement applied on top of it, never on stale canonical text");
  unregisterMountedScene("mounted",regId);
}

// 2d. Conflicting live registrations abort the WHOLE plan, zero scenes
// returned -- even a scene that had nothing to do with the conflict.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([
    scene("ok","Норм","chapter-1","Кот сидел."),
    scene("bad","Плохо","chapter-1","Кот бежал.")
  ]);
  const viewA=fakeView(plainTextToDoc(schema,"Кот бежал быстро."));
  const viewB=fakeView(plainTextToDoc(schema,"Кот бежал медленно."));
  const regA=registerMountedScene("bad",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("bad",{view:viewB,surfaceId:"sceneModal",activate(){}});
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  assert.equal(plan.ok,false);assert.equal(plan.reason,"conflict");
  assert.deepEqual(plan.conflictedSceneIds,["bad"]);
  assert.equal(plan.scenes,undefined,"a conflict plan must never carry a usable scenes[] to commit");
  unregisterMountedScene("bad",regA);unregisterMountedScene("bad",regB);
}

// 2e. Equivalent (agreeing) multiple registrations do NOT block the plan.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("twin","Твин","chapter-1","Кот сидел.")]);
  const doc=plainTextToDoc(schema,"Кот сидел тихо.");
  const viewA=fakeView(doc),viewB=fakeView(doc);
  const regA=registerMountedScene("twin",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("twin",{view:viewB,surfaceId:"sceneModal",activate(){}});
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  assert.equal(plan.ok,true);assert.equal(plan.changed,true);
  assert.equal(plan.scenes[0].sceneText,"пёс сидел тихо.");
  unregisterMountedScene("twin",regA);unregisterMountedScene("twin",regB);
}

// 2f. No-op: empty query, no matches anywhere, and "replacement identical to
// every match" all report changed:false with an empty scenes[].
{
  const project=makeProject([scene("s","С","chapter-1","Кот сидел.")]);
  assert.deepEqual(planProjectReplaceAll(project,"",{replaceText:"пёс"}),{ok:true,changed:false,affectedSceneCount:0,totalMatchCount:0,scenes:[]});
  assert.deepEqual(planProjectReplaceAll(project,"жираф",{replaceText:"пёс"}),{ok:true,changed:false,affectedSceneCount:0,totalMatchCount:0,scenes:[]});
  assert.deepEqual(planProjectReplaceAll(project,"Кот",{replaceText:"Кот"}),{ok:true,changed:false,affectedSceneCount:0,totalMatchCount:0,scenes:[]});
}

// 2g. Rich text / metadata: sceneTextDoc round-trips as valid ProseMirror
// JSON; `included` (an unrelated field) is never touched by planning.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("rt","РичТекст","chapter-1","Кот сидел.",{included:false})]);
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  const row=plan.scenes[0];
  assert.equal(row.sceneTextDoc.type,"doc");
  assert.equal(loadSceneDocument(schema,{sceneTextDoc:row.sceneTextDoc}).textContent,"пёс сидел.");
  assert.equal(project.scenes[0].included,false,"planning must never mutate canonical project data itself");
}

// 2h. Fresh-plan protection: planning against project data mutated AFTER an
// earlier search reflects the NEW content, never a stale snapshot -- proven
// by calling the planner twice against the same project object, with a
// canonical-data edit (simulating "the author's own Save landed elsewhere")
// in between.
{
  const project=makeProject([scene("fresh","Свежесть","chapter-1","Кот сидел.")]);
  const before=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  assert.equal(before.scenes[0].sceneText,"пёс сидел.");
  project.scenes[0].sceneText="Кот сидел тихо и спокойно.";
  const after=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  assert.equal(after.scenes[0].sceneText,"пёс сидел тихо и спокойно.","a second plan call must reflect the just-edited canonical text, never the first call's own result");
}

// ================================================================
// 3. syncMountedScenesAfterReplaceAll -- pushing the committed result into
//    every live registration, addToHistory:false, never a second commit
//    trigger of its own.
// ================================================================

_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("sync","Синхро","chapter-1","Кот сидел.")]);
  const doc=plainTextToDoc(schema,"Кот сидел.");
  const viewA=fakeView(doc),viewB=fakeView(doc);
  const regA=registerMountedScene("sync",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("sync",{view:viewB,surfaceId:"sceneModal",activate(){}});
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  const synced=syncMountedScenesAfterReplaceAll(plan.scenes);
  assert.equal(synced.length,2,"every live registration for the affected scene must be synced");
  assert.equal(viewA.state.doc.textContent,"пёс сидел.");
  assert.equal(viewB.state.doc.textContent,"пёс сидел.");
  // Synchronization-only: never an undo-able entry for Replace All itself
  // (project-level Undo is out of scope -- see docs/find-replace-
  // architecture.md's Stage D2.2.1 "Undo" section).
  assert.equal(viewA.dispatchedTrs[0].getMeta("addToHistory"),false);
  assert.equal(viewB.dispatchedTrs[0].getMeta("addToHistory"),false);
  unregisterMountedScene("sync",regA);unregisterMountedScene("sync",regB);
}
_resetMountedSceneRegistryForTests();
{
  // A scene with no mounted registration at all -> nothing to sync, no crash.
  const project=makeProject([scene("unmounted","Немонтир","chapter-1","Кот сидел.")]);
  const plan=planProjectReplaceAll(project,"кот",{replaceText:"пёс"});
  const synced=syncMountedScenesAfterReplaceAll(plan.scenes);
  assert.deepEqual(synced,[]);
}

// ================================================================
// 4. Controller integration: find-replace-controller.js's replaceProjectAll
//    -- guards, atomicity (one commit call, never a loop), sync + dirty-
//    rebase wiring, fresh search/active-result after success, and failure
//    semantics (conflict / persist-failed / no-op) with zero
//    writes/sync/rebase on any failure path.
// ================================================================

// 4a. Wrong scope / not-configured guards -- never throw, never call the
// injected commit function.
{
  let calls=0;
  const controller=createFindReplaceController({getProjectData:()=>makeProject([]),commitProjectReplaceAll:async()=>{calls++;return {ok:true}}});
  const wrongScope=await controller.replaceProjectAll();
  assert.equal(wrongScope.ok,false);assert.equal(wrongScope.reason,"wrong-scope");
  assert.equal(calls,0);
}
{
  const controller=createFindReplaceController({getProjectData:()=>makeProject([])}); // no commitProjectReplaceAll wired
  controller.open();controller.setScope("project");
  const result=await controller.replaceProjectAll();
  assert.equal(result.ok,false);assert.equal(result.reason,"not-configured");
}

// 4b. Basic success: ONE commit call covering every affected scene (never a
// per-scene loop -- this is the controller-level atomicity contract both
// the local commitDataChange path and the cloud bulkUpdateSceneText path
// are built on top of), mounted views synced, dirty-baseline rebase called
// once per committed scene, and a fresh search afterward shows zero
// remaining matches for the now-replaced query.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([
    scene("b1","Б1","chapter-1","Кот один."),
    scene("b2","Б2","chapter-1","И кот здесь.")
  ]);
  const view1=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const reg1=registerMountedScene("b1",{view:view1,surfaceId:"textModal",activate(){}});
  const commitCalls=[];
  const rebaseCalls=[];
  const commitProjectReplaceAll=async plan=>{
    commitCalls.push(plan);
    // Mirrors js/import-export.js's own local commit: ONE mutation over the
    // whole batch.
    plan.scenes.forEach(({sceneId,sceneText,sceneTextDoc})=>{
      const target=project.scenes.find(s=>s.id===sceneId);
      target.sceneText=sceneText;target.sceneTextDoc=sceneTextDoc;
    });
    return {ok:true};
  };
  const controller=createFindReplaceController({
    getProjectData:()=>project,commitProjectReplaceAll,
    rebaseSceneDirtyBaseline:(sceneId,doc)=>rebaseCalls.push({sceneId,doc})
  });
  attachToController(view1,controller,"b1");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");

  const result=await controller.replaceProjectAll();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(result.affectedSceneCount,2);assert.equal(result.totalMatchCount,2);
  assert.equal(commitCalls.length,1,"exactly ONE commit call for the whole batch -- never a per-scene loop");
  assert.equal(commitCalls[0].scenes.length,2);
  assert.equal(project.scenes[0].sceneText,"пёс один.");
  assert.equal(project.scenes[1].sceneText,"И пёс здесь.");
  assert.equal(view1.state.doc.textContent,"пёс один.","the mounted view for the affected scene must reflect the committed result");
  assert.equal(rebaseCalls.length,2,"rebase called once per committed scene");

  const after=controller.getSnapshot();
  assert.equal(after.projectResult.totalMatches,0,"a fresh search after success finds no remaining matches for the now-replaced query");

  unregisterMountedScene("b1",reg1);
}

// 4c. Conflict: replaceProjectAll refuses, zero writes -- the injected
// commit function is never even called.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("conf","Конф","chapter-1","Кот сидел.")]);
  const viewA=fakeView(plainTextToDoc(schema,"Кот сидел тихо."));
  const viewB=fakeView(plainTextToDoc(schema,"Кот сидел громко."));
  const regA=registerMountedScene("conf",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("conf",{view:viewB,surfaceId:"sceneModal",activate(){}});
  let calls=0;
  const controller=createFindReplaceController({getProjectData:()=>project,commitProjectReplaceAll:async()=>{calls++;return {ok:true}}});
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const result=await controller.replaceProjectAll();
  assert.equal(result.ok,false);assert.equal(result.reason,"conflict");
  assert.deepEqual(result.conflictedSceneIds,["conf"]);
  assert.equal(calls,0,"a planning-time conflict must never reach the commit function");
  assert.equal(project.scenes[0].sceneText,"Кот сидел.","zero canonical writes on a conflict");
  unregisterMountedScene("conf",regA);unregisterMountedScene("conf",regB);
}

// 4d. Commit failure (REVISION_CONFLICT-shaped or any other failure): no
// fake success, no mounted-view sync, no dirty rebase, and the project
// search state is left exactly as it was (recoverable) rather than reset.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("fail","Провал","chapter-1","Кот сидел.")]);
  const view=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const reg=registerMountedScene("fail",{view,surfaceId:"textModal",activate(){}});
  let rebaseCalls=0;
  const controller=createFindReplaceController({
    getProjectData:()=>project,
    commitProjectReplaceAll:async()=>({ok:false,code:"REVISION_CONFLICT",message:"Проект изменён в другом сеансе."}),
    rebaseSceneDirtyBaseline:()=>rebaseCalls++
  });
  attachToController(view,controller,"fail");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  const result=await controller.replaceProjectAll();
  assert.equal(result.ok,false);assert.equal(result.reason,"persist-failed");
  assert.equal(result.error.code,"REVISION_CONFLICT");
  assert.equal(view.state.doc.textContent,"Кот сидел.","a failed commit must never sync any mounted view");
  assert.equal(rebaseCalls,0);
  assert.equal(project.scenes[0].sceneText,"Кот сидел.","zero canonical writes on a commit failure");
  const after=controller.getSnapshot();
  assert.equal(after.projectResult.totalMatches,before.projectResult.totalMatches,"search state is left exactly as it was on failure, not reset");
  unregisterMountedScene("fail",reg);
}

// 4e. No-op: a fresh plan finds zero replacements -> the commit function is
// never called, no sync, no rebase, no revision-like local mutation.
{
  const project=makeProject([scene("noop","НульОп","chapter-1","Собака лает.")]);
  let calls=0,rebaseCalls=0;
  const controller=createFindReplaceController({
    getProjectData:()=>project,
    commitProjectReplaceAll:async()=>{calls++;return {ok:true}},
    rebaseSceneDirtyBaseline:()=>rebaseCalls++
  });
  controller.open();controller.setScope("project");controller.setQuery("жираф");controller.setReplaceText("пёс");
  const result=await controller.replaceProjectAll();
  assert.equal(result.ok,true);assert.equal(result.changed,false);
  assert.equal(calls,0);assert.equal(rebaseCalls,0);
}

console.log("find-replace project-replace-all unit tests: OK");
