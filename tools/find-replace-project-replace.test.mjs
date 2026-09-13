import assert from "node:assert/strict";
import {EditorState} from "prosemirror-state";
import {history,undo,redo} from "prosemirror-history";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {plainTextToDoc,loadSceneDocument} from "../js/editor/scene-doc-convert.js";
import {findMatches} from "../js/editor/find-replace-model.js";
import {flattenProjectMatches,pickPostReplaceActiveIndex} from "../js/editor/find-replace-project-search.js";
import {registerMountedScene,unregisterMountedScene,_resetMountedSceneRegistryForTests} from "../js/editor/mounted-scene-registry.js";
import {buildProjectReplacement} from "../js/editor/find-replace-project-replace.js";
import {createFindReplaceController} from "../js/editor/find-replace-controller.js";

// Find/Replace Stage D2.1.2: project-wide SINGLE Replace is now an ordinary,
// UNSAVED local edit of the active target EditorView -- NEVER an immediate
// persist (D2.1/D2.1.1's own contract, rejected by manual acceptance). This
// file exercises the new, drastically simplified architecture headlessly --
// real ProseMirror schema/EditorState (with the REAL prosemirror-history
// plugin, needed for genuine undo/redo assertions, not just meta-flag
// inspection), fake "view" stand-ins only where a registry registration is
// needed.
function scene(id,title,chapterId,sceneText,{included=true}={}){
  return {id,title,chapterId,sceneText,included,sceneTextDoc:null};
}
function withOccurrenceIndex(rawMatches){
  return rawMatches.map((match,occurrenceIndex)=>({...match,occurrenceIndex}));
}
function firstMatch(sceneObj,query,options={}){
  return withOccurrenceIndex(findMatches(loadSceneDocument(schema,sceneObj),query,options))[0];
}
// A real EditorState WITH prosemirror-history installed (EditorState has no
// DOM dependency at all -- only EditorView needs a real DOM) -- needed for
// genuine undo()/redo() behavior, not just addToHistory meta inspection.
function fakeView(doc){
  const view={isDestroyed:false,dispatchCount:0,dispatchedTrs:[],focus(){}};
  view.state=EditorState.create({schema,doc,plugins:[history()]});
  view.dispatch=tr=>{view.dispatchCount++;view.dispatchedTrs.push(tr);view.state=view.state.apply(tr)};
  return view;
}
function makeProject(scenes){
  return {chapters:[{id:"chapter-1",title:"Глава 1"}],scenes};
}
// Real EditorView instances call the controller's own handleTransaction from
// their `onUpdate` hook on EVERY dispatch (see js/editor/scene-editor-
// view.js) -- this is what makes replaceProjectCurrent's own dispatch
// synchronously trigger a fresh recompute (the mechanism
// pendingPostReplaceLocality relies on). A bare fake view has no such
// wiring, so attaching one to a controller for an INTEGRATION test must
// reproduce it explicitly, or the controller's own project result would
// silently go stale after a dispatch, exactly the way a real mount never
// would.
function attachToController(view,controller,sceneId){
  const baseDispatch=view.dispatch;
  view.dispatch=tr=>{
    baseDispatch(tr);
    controller.handleTransaction(view.state,tr);
  };
  controller.attachView(view,sceneId);
}

// ================================================================
// 1. buildProjectReplacement -- pure planning, no view/dispatch/persistence
//    involved at all.
// ================================================================

// 1a. Stored old offset still valid -> builds the replacement.
{
  const doc=plainTextToDoc(schema,"Кот сидел на окне.");
  const match=withOccurrenceIndex(findMatches(doc,"кот"))[0];
  const outcome=buildProjectReplacement(doc,match,{query:"кот",replacementText:"Пёс"});
  assert.equal(outcome.ok,true);assert.equal(outcome.changed,true);
  assert.equal(outcome.transform.doc.textContent,"Пёс сидел на окне.");
}

// 1b. Text shifted before Replace -- the stale from/to no longer point at
// the right place, but the occurrenceIndex fallback still resolves the
// correct, only occurrence.
{
  const staleDoc=plainTextToDoc(schema,"Кот сидел.");
  const staleMatch=withOccurrenceIndex(findMatches(staleDoc,"кот"))[0];
  const currentDoc=plainTextToDoc(schema,"Однажды кот сидел.");
  const outcome=buildProjectReplacement(currentDoc,staleMatch,{query:"кот",replacementText:"пёс"});
  assert.equal(outcome.ok,true);assert.equal(outcome.changed,true);
  assert.equal(outcome.transform.doc.textContent,"Однажды пёс сидел.");
}

// 1c. Intended occurrence no longer resolvable -> stale, zero mutation.
{
  const staleDoc=plainTextToDoc(schema,"Кот сидел.");
  const staleMatch=withOccurrenceIndex(findMatches(staleDoc,"кот"))[0];
  const currentDoc=plainTextToDoc(schema,"Пёс сидел.");
  const outcome=buildProjectReplacement(currentDoc,staleMatch,{query:"кот",replacementText:"пёс"});
  assert.equal(outcome.ok,false);assert.equal(outcome.reason,"stale");
}

// 1d/1e/1f. Longer / shorter / empty replacement.
{
  const doc=plainTextToDoc(schema,"Кот сидел.");
  const match=withOccurrenceIndex(findMatches(doc,"кот"))[0];
  assert.equal(buildProjectReplacement(doc,match,{query:"кот",replacementText:"котёнок"}).transform.doc.textContent,"котёнок сидел.");
}
{
  const doc=plainTextToDoc(schema,"Котёнок сидел.");
  const match=withOccurrenceIndex(findMatches(doc,"котёнок"))[0];
  assert.equal(buildProjectReplacement(doc,match,{query:"котёнок",replacementText:"кот"}).transform.doc.textContent,"кот сидел.");
}
{
  const doc=plainTextToDoc(schema,"Кот сидел тихо.");
  const match=withOccurrenceIndex(findMatches(doc,"Кот "))[0];
  const outcome=buildProjectReplacement(doc,match,{query:"Кот ",replacementText:""});
  assert.equal(outcome.changed,true);
  assert.equal(outcome.transform.doc.textContent,"сидел тихо.");
}

// 1g. Replacement identical to the matched text -> no-op.
{
  const doc=plainTextToDoc(schema,"Кот сидел.");
  const match=withOccurrenceIndex(findMatches(doc,"Кот"))[0];
  const outcome=buildProjectReplacement(doc,match,{query:"Кот",replacementText:"Кот"});
  assert.equal(outcome.ok,true);assert.equal(outcome.changed,false);
}

// ================================================================
// 2. Controller-level replaceProjectCurrent: active-editor identification,
//    zero persistence, undo/redo isolation, active-result locality.
// ================================================================

// 2a. No active editor attached to the target scene -> safe refusal, zero
// mutation -- never persist-first, never rebuild the editor, never
// synchronize the active view from anything.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("solo","Сцена","chapter-1","Кот сидел.")]);
  const controller=createFindReplaceController({getProjectData:()=>project});
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);
  // No attachView() call at all -- no editor is attached to ANY scene.
  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,false);assert.equal(result.reason,"no-active-editor");
  assert.equal(project.scenes[0].sceneText,"Кот сидел.","zero mutation when there is no active target editor");
}

// 2b. The active target editor gets the replacement as an ordinary,
// undo-able local edit -- ZERO persistence: canonical `project.scenes` data
// is never touched by replaceProjectCurrent itself.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("s1","Сцена","chapter-1","Кот сидел.")]);
  const view=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const regId=registerMountedScene("s1",{view,surfaceId:"textModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(view,controller,"s1");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);

  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(view.state.doc.textContent,"пёс сидел.","the active editor's own live doc changed");
  assert.equal(project.scenes[0].sceneText,"Кот сидел.","canonical/persisted data must be COMPLETELY untouched -- zero persistence before Save");

  unregisterMountedScene("s1",regId);
}

// 2c. Undo/redo isolation: a manual edit, then a project Single Replace --
// one undo() undoes exactly the Replace (never skipping past it), redo
// restores it.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("s2","Сцена","chapter-1","Кот сидел.")]);
  const view=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const regId=registerMountedScene("s2",{view,surfaceId:"textModal",activate(){}});
  // A real, earlier, unrelated edit.
  view.dispatch(view.state.tr.insertText(" Привет.",view.state.doc.content.size-1));
  assert.equal(view.state.doc.textContent,"Кот сидел. Привет.");

  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(view,controller,"s2");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);

  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(view.state.doc.textContent,"пёс сидел. Привет.");

  undo(view.state,view.dispatch);
  assert.equal(view.state.doc.textContent,"Кот сидел. Привет.","one undo must undo exactly the Replace, leaving the earlier manual edit in place");
  undo(view.state,view.dispatch);
  assert.equal(view.state.doc.textContent,"Кот сидел.","a second undo reaches the original pre-edit text");
  redo(view.state,view.dispatch);
  redo(view.state,view.dispatch);
  assert.equal(view.state.doc.textContent,"пёс сидел. Привет.","redo restores the Replace");

  unregisterMountedScene("s2",regId);
}

// 2d. Secondary mounted registrations of the SAME scene are left COMPLETELY
// alone -- Single Replace is unsaved local editing of the active view only,
// never a synchronization/collaboration mechanism.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("s3","Сцена","chapter-1","Кот сидел.")]);
  const activeView=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const secondaryView=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const activeRegId=registerMountedScene("s3",{view:activeView,surfaceId:"textModal",activate(){}});
  const secondaryRegId=registerMountedScene("s3",{view:secondaryView,surfaceId:"sceneModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(activeView,controller,"s3");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);

  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(activeView.state.doc.textContent,"пёс сидел.");
  // A secondary registration's own CONTENT must be left completely
  // untouched -- no synchronization/collaboration mechanism. It may still
  // receive ordinary decoration-only dispatches (the ambient project-search
  // highlighting every mounted registration already gets, unrelated to this
  // Replace), so the real invariant is "never a doc-changing transaction",
  // not "never dispatched into at all".
  assert.equal(secondaryView.state.doc.textContent,"Кот сидел.","a secondary registration must be left completely untouched -- no synchronization/collaboration mechanism");
  for(const tr of secondaryView.dispatchedTrs){
    assert.equal(tr.docChanged,false,"a secondary registration must never receive a doc-changing transaction from someone else's Replace");
  }

  unregisterMountedScene("s3",activeRegId);
  unregisterMountedScene("s3",secondaryRegId);
}

// 2e. Identity: two scenes with byte-for-byte identical text remain
// distinguished by sceneId -- only the active target scene changes.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("twin-a","Твин А","chapter-1","Кот сидел."),scene("twin-b","Твин Б","chapter-1","Кот сидел.")]);
  const viewA=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const viewB=fakeView(loadSceneDocument(schema,project.scenes[1]));
  const regA=registerMountedScene("twin-a",{view:viewA,surfaceId:"textModal",activate(){}});
  const regB=registerMountedScene("twin-b",{view:viewB,surfaceId:"sceneModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(viewA,controller,"twin-a");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  const flatBefore=flattenProjectMatches(before.projectResult);
  const targetInA=flatBefore.find(m=>m.sceneId==="twin-a");
  controller.activateProjectMatch(targetInA.matchId);

  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.sceneId,"twin-a");
  assert.equal(viewA.state.doc.textContent,"пёс сидел.");
  assert.equal(viewB.state.doc.textContent,"Кот сидел.","the identical sibling scene's own mounted view must remain untouched");

  unregisterMountedScene("twin-a",regA);
  unregisterMountedScene("twin-b",regB);
}

// 2f. included:false -- Replace must work in an excluded scene and must
// never touch `included`.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("excluded-1","Скрытая","chapter-1","Кот сидел.",{included:false})]);
  const view=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const regId=registerMountedScene("excluded-1",{view,surfaceId:"textModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(view,controller,"excluded-1");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);
  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(view.state.doc.textContent,"пёс сидел.");
  assert.equal(project.scenes[0].included,false,"Replace must never modify `included`");
  unregisterMountedScene("excluded-1",regId);
}

// 2g. Guards: wrong scope, no active match -- never throws, never mutates.
{
  const controller=createFindReplaceController({});
  const wrongScope=controller.replaceProjectCurrent();
  assert.equal(wrongScope.ok,false);assert.equal(wrongScope.reason,"wrong-scope");
  controller.open();controller.setScope("project");
  const noMatch=controller.replaceProjectCurrent();
  assert.equal(noMatch.ok,false);assert.equal(noMatch.reason,"no-active-match");
}

// Scene-scope replaceCurrent/replaceAll must still refuse to run under
// project scope, and vice versa.
{
  const controller=createFindReplaceController({});
  controller.open();controller.setScope("project");
  assert.equal(controller.replaceCurrent(),false);
  assert.deepEqual(controller.replaceAll(),{count:0});
}

// ================================================================
// 3. Goal J -- active-result locality after Replace (pickPostReplaceActiveIndex).
// ================================================================

// 3a. Pure unit coverage of the policy itself.
{
  // The match at position 5 in scene B was just replaced and is GONE from
  // this fresh list -- only its sibling (position 20) and scene C's own
  // match remain.
  const flatAfterRemovingFirst=[
    {sceneId:"B",from:19,to:22,sceneOrder:2}, // was at 20, shifted left by 1 (replacement 1 char shorter)
    {sceneId:"C",from:3,to:6,sceneOrder:3}
  ];
  // Replaced the match at position 5 in scene B -> prefer the NEXT one in B (index 0, now at 19).
  assert.equal(pickPostReplaceActiveIndex(flatAfterRemovingFirst,{sceneId:"B",position:5,sceneOrder:2}),0);
  // Replaced the match at position 20 (the LAST one in B) -> no match in B
  // after it -> nearest one BEFORE it (index 0, position 5).
  const flatAfterRemovingLast=[
    {sceneId:"B",from:5,to:8,sceneOrder:2},
    {sceneId:"C",from:3,to:6,sceneOrder:3}
  ];
  assert.equal(pickPostReplaceActiveIndex(flatAfterRemovingLast,{sceneId:"B",position:20,sceneOrder:2}),0);
  // Scene B has NO remaining matches at all -> fall through to normal
  // ordering: the first match at/after B's own canonical sceneOrder (2) --
  // here that's scene C's own match (sceneOrder 3).
  const flatNoBLeft=[{sceneId:"C",from:3,to:6,sceneOrder:3}];
  assert.equal(pickPostReplaceActiveIndex(flatNoBLeft,{sceneId:"B",position:5,sceneOrder:2}),0);
  // No matches anywhere.
  assert.equal(pickPostReplaceActiveIndex([],{sceneId:"B",position:5,sceneOrder:2}),-1);
}

// 3b. Integration: replacing the MIDDLE occurrence in a scene with several
// matches keeps the active result LOCAL to that same scene (the next
// remaining one), never jumping to another scene merely because the flat
// index shifted.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([
    {id:"p1",title:"П1",chapterId:"chapter-1",sceneText:"Кот один. Кот два. Кот три.",included:true,sceneTextDoc:null},
    {id:"p2",title:"П2",chapterId:"chapter-1",sceneText:"И кот здесь.",included:true,sceneTextDoc:null}
  ]);
  const p1View=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const p1RegId=registerMountedScene("p1",{view:p1View,surfaceId:"textModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(p1View,controller,"p1");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");

  const before=controller.getSnapshot();
  const flatBefore=flattenProjectMatches(before.projectResult);
  assert.equal(flatBefore.length,4,"p1:3 + p2:1");
  // Target the MIDDLE occurrence in p1 (flat index 1, "Кот два").
  controller.activateProjectMatch(flatBefore[1].matchId);

  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(p1View.state.doc.textContent,"Кот один. пёс два. Кот три.");

  const after=controller.getSnapshot();
  const flatAfter=flattenProjectMatches(after.projectResult);
  assert.equal(flatAfter.length,3,"p1:2 + p2:1");
  // The active result must remain in p1 (the next remaining match there),
  // never jump to p2 merely because indices shifted.
  assert.equal(after.activeProjectMatchId,flatAfter[after.activeProjectMatchIndex].matchId);
  assert.equal(flatAfter[after.activeProjectMatchIndex].sceneId,"p1","active result must stay LOCAL to the scene just edited while it still has matches");

  unregisterMountedScene("p1",p1RegId);
}

// 3c. Integration: replacing the LAST remaining match in a scene falls
// through to the next scene in canonical order -- never a manual/instant
// index-0 jump, and only because the scene genuinely has nothing left.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([
    {id:"q1",title:"Q1",chapterId:"chapter-1",sceneText:"Кот один.",included:true,sceneTextDoc:null},
    {id:"q2",title:"Q2",chapterId:"chapter-1",sceneText:"И кот здесь. И кот там.",included:true,sceneTextDoc:null}
  ]);
  const q1View=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const q1RegId=registerMountedScene("q1",{view:q1View,surfaceId:"textModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(q1View,controller,"q1");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  const flatBefore=flattenProjectMatches(before.projectResult);
  controller.activateProjectMatch(flatBefore[0].matchId); // q1's only match

  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);

  const after=controller.getSnapshot();
  const flatAfter=flattenProjectMatches(after.projectResult);
  assert.equal(flatAfter.length,2,"q1:0 + q2:2");
  assert.equal(flatAfter[after.activeProjectMatchIndex].sceneId,"q2","q1 has no matches left -- falls through to the next scene in canonical order");

  unregisterMountedScene("q1",q1RegId);
}

// 3d. If no matches remain anywhere, the active result clears safely.
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([{id:"only","title":"Только","chapterId":"chapter-1",sceneText:"Кот один.",included:true,sceneTextDoc:null}]);
  const view=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const regId=registerMountedScene("only",{view,surfaceId:"textModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(view,controller,"only");
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);
  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  const after=controller.getSnapshot();
  assert.equal(after.projectResult.totalMatches,0);
  assert.equal(after.activeProjectMatchIndex,-1);
  assert.equal(after.activeProjectMatchId,null);
  unregisterMountedScene("only",regId);
}

// ================================================================
// 4. Goal D -- selection/focus after Replace (empty and non-empty).
// ================================================================
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("sel-empty","Сцена","chapter-1","Кот сидел тихо.")]);
  const view=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const regId=registerMountedScene("sel-empty",{view,surfaceId:"textModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(view,controller,"sel-empty");
  controller.open();controller.setScope("project");controller.setQuery("Кот ");controller.setReplaceText("");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);
  const result=controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(view.state.doc.textContent,"сидел тихо.");
  // A well-defined, collapsed caret exactly at the deletion point -- never
  // an invalid/vanished selection.
  const sel=view.state.selection;
  assert.equal(sel.empty,true);
  assert.equal(sel.from,1,"caret lands exactly at the deletion point");
  unregisterMountedScene("sel-empty",regId);
}
_resetMountedSceneRegistryForTests();
{
  const project=makeProject([scene("sel-nonempty","Сцена","chapter-1","Кот сидел тихо.")]);
  const view=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const regId=registerMountedScene("sel-nonempty",{view,surfaceId:"textModal",activate(){}});
  const controller=createFindReplaceController({getProjectData:()=>project});
  attachToController(view,controller,"sel-nonempty");
  controller.open();controller.setScope("project");controller.setQuery("Кот");controller.setReplaceText("Пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);
  controller.replaceProjectCurrent();
  const sel=view.state.selection;
  assert.equal(sel.empty,true);
  assert.equal(sel.from,1+"Пёс".length,"caret lands right after the inserted replacement");
  unregisterMountedScene("sel-nonempty",regId);
}

console.log("find-replace project-replace unit tests: OK");
