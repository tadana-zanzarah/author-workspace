import assert from "node:assert/strict";
import {EditorState} from "prosemirror-state";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {plainTextToDoc,loadSceneDocument} from "../js/editor/scene-doc-convert.js";
import {findMatches} from "../js/editor/find-replace-model.js";
import {flattenProjectMatches} from "../js/editor/find-replace-project-search.js";
import {registerMountedScene,unregisterMountedScene,_resetMountedSceneRegistryForTests} from "../js/editor/mounted-scene-registry.js";
import {resolveMountedSceneAgreement,replaceProjectMatch,syncMountedRegistrations} from "../js/editor/find-replace-project-replace.js";
import {createFindReplaceController} from "../js/editor/find-replace-controller.js";

// Find/Replace Stage D2.1: safe single Replace in project scope, exercised
// headlessly -- real ProseMirror schema/docs/EditorState throughout (never a
// mocked schema), fake "view" stand-ins (only `.state`/`.isDestroyed`/
// `.dispatch` are ever read by production code -- see mounted-scene-
// registry.test.mjs's own identical fakeView convention), and injected
// saveSceneText/rebaseSceneDirtyBaseline callbacks standing in for the real
// cloud/local write path and the real dirty-tracker glue (js/import-
// export.js's saveSceneTextCanonical / js/app.js's rebaseSceneTextDirtyBaseline)
// -- proving the ORCHESTRATION is correct regardless of which real backend
// sits behind it.
function scene(id,title,chapterId,sceneText,{included=true}={}){
  return {id,title,chapterId,sceneText,included,sceneTextDoc:null};
}
// find-replace-project-search.js's searchProject() attaches `occurrenceIndex`
// to each raw findMatches() result before it ever reaches a caller (see its
// own matches.map(...)) -- a real matchRange handed to replaceProjectMatch
// always carries it. Mirror that here rather than passing a raw findMatches()
// entry, which would lack the field entirely.
function withOccurrenceIndex(rawMatches){
  return rawMatches.map((match,occurrenceIndex)=>({...match,occurrenceIndex}));
}
function firstMatch(sceneObj,query,options={}){
  return withOccurrenceIndex(findMatches(loadSceneDocument(schema,sceneObj),query,options))[0];
}
// A real EditorState (no DOM/EditorView needed -- EditorState itself has no
// DOM dependency) wrapped just enough to look like the registry's own
// `{view,surfaceId,activate}` `view` shape to production code.
function fakeView(doc){
  const view={isDestroyed:false,dispatchCount:0};
  view.state=EditorState.create({schema,doc});
  view.dispatch=tr=>{view.dispatchCount++;view.state=view.state.apply(tr)};
  return view;
}
function makeApp(scenes){
  const project={chapters:[{id:"chapter-1",title:"Глава 1"}],scenes};
  const saveCalls=[];
  const rebaseCalls=[];
  async function saveSceneText(sceneId,{sceneText,sceneTextDoc}){
    saveCalls.push({sceneId,sceneText,sceneTextDoc});
    const target=project.scenes.find(s=>s.id===sceneId);
    if(!target)return {ok:false,code:"NOT_FOUND"};
    target.sceneText=sceneText;target.sceneTextDoc=sceneTextDoc;
    return {ok:true};
  }
  function rebaseSceneDirtyBaseline(sceneId,docJSON){rebaseCalls.push({sceneId,docJSON})}
  return {project,getProjectData:()=>project,saveSceneText,rebaseSceneDirtyBaseline,saveCalls,rebaseCalls};
}

_resetMountedSceneRegistryForTests();

// ================================================================
// 1. Pure/current-match stale-safety (no mounted registrations at all --
//    resolveMountedSceneAgreement returns "none", so currentDoc is always
//    the persisted document; reresolveMatch is the only thing doing the
//    real work here).
// ================================================================

// 1a. Stored old offset still valid -> Replace works.
{
  const app=makeApp([scene("s1","Сцена 1","chapter-1","Кот сидел на окне.")]);
  const match=firstMatch(app.project.scenes[0],"кот");
  const result=await replaceProjectMatch({sceneId:"s1",matchRange:match,query:"кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.project.scenes[0].sceneText,"Пёс сидел на окне.");
}

// 1b. Text shifted before Replace (an unrelated earlier edit moved
// everything) -- the stale from/to no longer point at the right place, but
// the occurrenceIndex fallback still resolves the correct, only occurrence.
{
  const app=makeApp([scene("s2","Сцена 2","chapter-1","Кот сидел.")]);
  const staleMatch=firstMatch(app.project.scenes[0],"кот");
  app.project.scenes[0].sceneText="Однажды кот сидел.";
  const result=await replaceProjectMatch({sceneId:"s2",matchRange:staleMatch,query:"кот",replacementText:"пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.project.scenes[0].sceneText,"Однажды пёс сидел.","must re-resolve against CURRENT text, never the stale offset");
}

// 1c. Intended occurrence no longer resolvable (the word is simply gone) ->
// zero mutation.
{
  const app=makeApp([scene("s3","Сцена 3","chapter-1","Кот сидел.")]);
  const staleMatch=firstMatch(app.project.scenes[0],"кот");
  app.project.scenes[0].sceneText="Пёс сидел.";
  const result=await replaceProjectMatch({sceneId:"s3",matchRange:staleMatch,query:"кот",replacementText:"пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,false);assert.equal(result.reason,"stale");
  assert.equal(app.saveCalls.length,0,"an unresolvable match must never fall back to a blind mutation");
  assert.equal(app.project.scenes[0].sceneText,"Пёс сидел.");
}

// 1d. Replacement longer than the search text.
{
  const app=makeApp([scene("s4","Сцена 4","chapter-1","Кот сидел.")]);
  const match=firstMatch(app.project.scenes[0],"кот");
  const result=await replaceProjectMatch({sceneId:"s4",matchRange:match,query:"кот",replacementText:"котёнок",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.changed,true);
  assert.equal(app.project.scenes[0].sceneText,"котёнок сидел.");
}

// 1e. Replacement shorter than the search text.
{
  const app=makeApp([scene("s5","Сцена 5","chapter-1","Котёнок сидел.")]);
  const match=firstMatch(app.project.scenes[0],"котёнок");
  const result=await replaceProjectMatch({sceneId:"s5",matchRange:match,query:"котёнок",replacementText:"кот",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.changed,true);
  assert.equal(app.project.scenes[0].sceneText,"кот сидел.");
}

// 1f. Empty replacement deletes the match (Stage B's own deleteRange
// branch, reused unchanged).
{
  const app=makeApp([scene("s6","Сцена 6","chapter-1","Кот сидел тихо.")]);
  const match=firstMatch(app.project.scenes[0],"Кот ");
  const result=await replaceProjectMatch({sceneId:"s6",matchRange:match,query:"Кот ",replacementText:"",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.changed,true);
  assert.equal(app.project.scenes[0].sceneText,"сидел тихо.");
}

// 1g. Replacement identical to the matched text -> no effective write: no
// persistence, no dirty-baseline rebase.
{
  const app=makeApp([scene("s7","Сцена 7","chapter-1","Кот сидел.")]);
  const match=firstMatch(app.project.scenes[0],"Кот");
  const result=await replaceProjectMatch({sceneId:"s7",matchRange:match,query:"Кот",replacementText:"Кот",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText,rebaseSceneDirtyBaseline:app.rebaseSceneDirtyBaseline});
  assert.equal(result.ok,true);assert.equal(result.changed,false);
  assert.equal(app.saveCalls.length,0,"an identical replacement must never persist anything");
  assert.equal(app.rebaseCalls.length,0);
  assert.equal(app.project.scenes[0].sceneText,"Кот сидел.");
}

// ================================================================
// 2. Identity: two scenes with byte-for-byte identical text remain
//    distinguished by sceneId -- only the active target scene changes.
// ================================================================
{
  const sceneA=scene("twin-a","Твин А","chapter-1","Кот сидел.");
  const sceneB=scene("twin-b","Твин Б","chapter-1","Кот сидел.");
  const app=makeApp([sceneA,sceneB]);
  const match=firstMatch(sceneA,"Кот");
  const result=await replaceProjectMatch({sceneId:"twin-a",matchRange:match,query:"Кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.project.scenes.find(s=>s.id==="twin-a").sceneText,"Пёс сидел.");
  assert.equal(app.project.scenes.find(s=>s.id==="twin-b").sceneText,"Кот сидел.","the identical sibling scene must remain untouched -- identity is sceneId, never doc content");
}

// ================================================================
// 3. included:false -- Replace must work in an excluded scene and must
//    never touch `included` or any unrelated scene metadata.
// ================================================================
{
  const target=scene("excluded-1","Скрытая","chapter-1","Кот сидел.",{included:false});
  const app=makeApp([target]);
  const match=firstMatch(target,"Кот");
  const result=await replaceProjectMatch({sceneId:"excluded-1",matchRange:match,query:"Кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.project.scenes[0].sceneText,"Пёс сидел.");
  assert.equal(app.project.scenes[0].included,false,"included must never be modified by Replace");
}

// ================================================================
// 4. Mounted-state agreement (product brief cases A-E).
// ================================================================

// 4a. No live registration -> persisted doc is current; exactly one save
// call (the commit itself), no separate sync save.
{
  _resetMountedSceneRegistryForTests();
  const app=makeApp([scene("agree-none","Сцена","chapter-1","Кот сидел на окне.")]);
  const agreement=resolveMountedSceneAgreement("agree-none");
  assert.equal(agreement.status,"none");
  const match=firstMatch(app.project.scenes[0],"кот");
  const result=await replaceProjectMatch({sceneId:"agree-none",matchRange:match,query:"кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.saveCalls.length,1);
}

// 4b. One live registration whose doc already equals persisted -> still
// exactly one save call (no unnecessary sync save).
{
  _resetMountedSceneRegistryForTests();
  const app=makeApp([scene("agree-equal","Сцена","chapter-1","Кот сидел на окне.")]);
  const persistedDoc=loadSceneDocument(schema,app.project.scenes[0]);
  const view=fakeView(persistedDoc);
  const regId=registerMountedScene("agree-equal",{view,surfaceId:"textModal",activate(){}});
  const agreement=resolveMountedSceneAgreement("agree-equal");
  assert.equal(agreement.status,"agree");
  const match=firstMatch(app.project.scenes[0],"кот");
  const result=await replaceProjectMatch({sceneId:"agree-equal",matchRange:match,query:"кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.saveCalls.length,1,"live doc already equals persisted -> no separate sync save needed");
  unregisterMountedScene("agree-equal",regId);
}

// 4c. One live registration NEWER than persisted -> the agreed live text is
// synchronized through the canonical save path FIRST, then the replacement
// commits on top of it -- two save calls, two dirty-baseline rebases, in
// that order.
{
  _resetMountedSceneRegistryForTests();
  const app=makeApp([scene("agree-newer","Сцена","chapter-1","Кот сидел.")]);
  const liveDoc=plainTextToDoc(schema,"Кот сидел. Ещё кот пришёл.");
  const view=fakeView(liveDoc);
  const regId=registerMountedScene("agree-newer",{view,surfaceId:"sceneModal",activate(){}});
  const match=withOccurrenceIndex(findMatches(liveDoc,"кот"))[0];
  const result=await replaceProjectMatch({sceneId:"agree-newer",matchRange:match,query:"кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText,rebaseSceneDirtyBaseline:app.rebaseSceneDirtyBaseline});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.saveCalls.length,2,"an unsynchronized live doc must be saved first, THEN the replacement commit");
  assert.equal(app.saveCalls[0].sceneText,"Кот сидел. Ещё кот пришёл.","the sync save persists the AGREED LIVE text verbatim, unreplaced");
  assert.equal(app.saveCalls[1].sceneText,"Пёс сидел. Ещё кот пришёл.","the commit save reflects the replacement on top of the synced text");
  assert.equal(app.rebaseCalls.length,2,"both the sync save and the commit save must rebase the dirty baseline");
  unregisterMountedScene("agree-newer",regId);
}

// 4d. Multiple registrations with IDENTICAL current docs -> treated as one
// agreed live state (same "differs from persisted -> sync first" behavior).
{
  _resetMountedSceneRegistryForTests();
  const app=makeApp([scene("agree-multi","Сцена","chapter-1","Кот сидел.")]);
  const doc=plainTextToDoc(schema,"Кот сидел. Кот встал.");
  const viewA=fakeView(doc),viewB=fakeView(doc);
  const idA=registerMountedScene("agree-multi",{view:viewA,surfaceId:"textModal",activate(){}});
  const idB=registerMountedScene("agree-multi",{view:viewB,surfaceId:"allScenesModal",activate(){}});
  const agreement=resolveMountedSceneAgreement("agree-multi");
  assert.equal(agreement.status,"agree");
  const match=withOccurrenceIndex(findMatches(doc,"кот"))[0];
  const result=await replaceProjectMatch({sceneId:"agree-multi",matchRange:match,query:"кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText});
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(app.saveCalls.length,2,"agreed live doc differs from persisted -> sync save + commit save");
  unregisterMountedScene("agree-multi",idA);unregisterMountedScene("agree-multi",idB);
}

// 4e. Multiple registrations that DISAGREE -> conflict, safe abort, zero
// mutation, never an arbitrarily chosen winner.
{
  _resetMountedSceneRegistryForTests();
  const app=makeApp([scene("agree-conflict","Сцена","chapter-1","Кот сидел.")]);
  const viewA=fakeView(plainTextToDoc(schema,"Кот сидел здесь."));
  const viewB=fakeView(plainTextToDoc(schema,"Кот сидел там."));
  const idA=registerMountedScene("agree-conflict",{view:viewA,surfaceId:"textModal",activate(){}});
  const idB=registerMountedScene("agree-conflict",{view:viewB,surfaceId:"allScenesModal",activate(){}});
  assert.equal(resolveMountedSceneAgreement("agree-conflict").status,"conflict");
  const match=withOccurrenceIndex(findMatches(viewA.state.doc,"кот"))[0];
  const result=await replaceProjectMatch({sceneId:"agree-conflict",matchRange:match,query:"кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:app.saveSceneText,rebaseSceneDirtyBaseline:app.rebaseSceneDirtyBaseline});
  assert.equal(result.ok,false);assert.equal(result.reason,"conflict");
  assert.equal(app.saveCalls.length,0,"a conflict must abort BEFORE any mutation");
  assert.equal(app.rebaseCalls.length,0);
  unregisterMountedScene("agree-conflict",idA);unregisterMountedScene("agree-conflict",idB);
}

// ================================================================
// 5. Failure/atomicity: a failed precondition sync or a failed commit must
//    never produce a fake committed state.
// ================================================================

// 5a. Precondition sync-save failure aborts before the replacement is even
// attempted -- canonical state is untouched.
{
  _resetMountedSceneRegistryForTests();
  const app=makeApp([scene("fail-sync","Сцена","chapter-1","Кот сидел.")]);
  const liveDoc=plainTextToDoc(schema,"Кот сидел. Ещё кот.");
  const view=fakeView(liveDoc);
  const regId=registerMountedScene("fail-sync",{view,surfaceId:"textModal",activate(){}});
  const failingSave=async()=>({ok:false,code:"REVISION_CONFLICT"});
  const match=withOccurrenceIndex(findMatches(liveDoc,"кот"))[0];
  const rebaseCalls=[];
  const result=await replaceProjectMatch({sceneId:"fail-sync",matchRange:match,query:"кот",replacementText:"пёс",getProjectData:app.getProjectData,saveSceneText:failingSave,rebaseSceneDirtyBaseline:(id,doc)=>rebaseCalls.push(id)});
  assert.equal(result.ok,false);assert.equal(result.reason,"sync-failed");
  assert.equal(app.project.scenes[0].sceneText,"Кот сидел.","canonical state must not change when the precondition sync save fails");
  assert.equal(rebaseCalls.length,0);
  unregisterMountedScene("fail-sync",regId);
}

// 5b. Commit-save failure -> reports failure, no fake success, no dirty
// rebase.
{
  const app=makeApp([scene("fail-commit","Сцена","chapter-1","Кот сидел.")]);
  const match=firstMatch(app.project.scenes[0],"Кот");
  const failingSave=async()=>({ok:false,code:"REVISION_CONFLICT"});
  const result=await replaceProjectMatch({sceneId:"fail-commit",matchRange:match,query:"Кот",replacementText:"Пёс",getProjectData:app.getProjectData,saveSceneText:failingSave,rebaseSceneDirtyBaseline:app.rebaseSceneDirtyBaseline});
  assert.equal(result.ok,false);assert.equal(result.reason,"persist-failed");
  assert.equal(app.rebaseCalls.length,0,"a failed commit must never rebase any dirty baseline");
}

// 5c. Missing dependencies refuse safely rather than crashing or faking
// success.
{
  const result=await replaceProjectMatch({sceneId:"whatever",matchRange:{from:0,to:1,text:"x",occurrenceIndex:0},query:"x"});
  assert.equal(result.ok,false);assert.equal(result.reason,"not-configured");
}

// ================================================================
// 6. Post-commit mounted-registration synchronization.
// ================================================================
_resetMountedSceneRegistryForTests();
{
  const baseDoc=plainTextToDoc(schema,"Кот сидел.");
  const committedDoc=plainTextToDoc(schema,"Пёс сидел.");
  const viewMounted=fakeView(baseDoc);
  const viewHidden=fakeView(baseDoc); // stands in for a closed-but-still-registered surface
  const viewAlreadyCommitted=fakeView(committedDoc);
  const viewOtherScene=fakeView(baseDoc);
  const id1=registerMountedScene("sync-scene",{view:viewMounted,surfaceId:"textModal",activate(){}});
  const id2=registerMountedScene("sync-scene",{view:viewHidden,surfaceId:"allScenesModal",activate(){}});
  const id3=registerMountedScene("sync-scene",{view:viewAlreadyCommitted,surfaceId:"sceneModal",activate(){}});
  const idOther=registerMountedScene("sync-other-scene",{view:viewOtherScene,surfaceId:"textModal",activate(){}});

  const synced=syncMountedRegistrations("sync-scene",committedDoc);

  assert.equal(synced.length,2,"only the registrations that actually differed from the committed doc are touched");
  assert.ok(viewMounted.state.doc.eq(committedDoc),"every mounted registration must end up showing the committed doc");
  assert.ok(viewHidden.state.doc.eq(committedDoc),"a hidden-but-mounted registration must not remain stale");
  assert.equal(viewAlreadyCommitted.dispatchCount,0,"a registration already showing the exact committed doc must not be mutated");
  assert.ok(viewOtherScene.state.doc.eq(baseDoc),"a registration for an unrelated scene must never be touched");

  unregisterMountedScene("sync-scene",id1);unregisterMountedScene("sync-scene",id2);unregisterMountedScene("sync-scene",id3);
  unregisterMountedScene("sync-other-scene",idOther);
}

// addToHistory:false is enforced on every synchronization dispatch -- a
// project-wide Replace must never become a ProseMirror undo entry.
{
  _resetMountedSceneRegistryForTests();
  const baseDoc=plainTextToDoc(schema,"Кот сидел.");
  const committedDoc=plainTextToDoc(schema,"Пёс сидел.");
  const view=fakeView(baseDoc);
  let capturedTr=null;
  const realDispatch=view.dispatch;
  view.dispatch=tr=>{capturedTr=tr;realDispatch(tr)};
  const id=registerMountedScene("sync-history",{view,surfaceId:"textModal",activate(){}});
  syncMountedRegistrations("sync-history",committedDoc);
  assert.ok(capturedTr,"a dispatch must have happened");
  assert.equal(capturedTr.getMeta("addToHistory"),false,"post-commit sync must never become a ProseMirror undo entry");
  unregisterMountedScene("sync-history",id);
}

// ================================================================
// 7. Controller-level integration: find-replace-controller.js's
//    replaceProjectCurrent, end to end -- active global match -> commit ->
//    mounted sync -> fresh project search -> next active match.
// ================================================================
_resetMountedSceneRegistryForTests();
{
  const project={chapters:[{id:"chapter-1",title:"Глава 1"}],scenes:[
    {id:"p1",title:"П1",chapterId:"chapter-1",sceneText:"Кот тут. Кот там.",included:true,sceneTextDoc:null},
    {id:"p2",title:"П2",chapterId:"chapter-1",sceneText:"И кот здесь.",included:true,sceneTextDoc:null}
  ]};
  const saveCalls=[],rebaseCalls=[];
  async function saveSceneText(sceneId,{sceneText,sceneTextDoc}){
    saveCalls.push(sceneId);
    const target=project.scenes.find(s=>s.id===sceneId);
    target.sceneText=sceneText;target.sceneTextDoc=sceneTextDoc;
    return {ok:true};
  }
  function rebaseSceneDirtyBaseline(sceneId){rebaseCalls.push(sceneId)}

  const p1View=fakeView(loadSceneDocument(schema,project.scenes[0]));
  const p1RegId=registerMountedScene("p1",{view:p1View,surfaceId:"textModal",activate(){}});

  const controller=createFindReplaceController({getProjectData:()=>project,saveSceneText,rebaseSceneDirtyBaseline});
  controller.open();
  controller.setScope("project");
  controller.setQuery("кот");
  controller.setReplaceText("пёс");

  const before=controller.getSnapshot();
  assert.equal(before.projectResult.totalMatches,3,"p1:2 + p2:1");
  const flatBefore=flattenProjectMatches(before.projectResult);
  // Target p1's SECOND occurrence specifically (flat index 1) -- proving
  // Replace acts on whichever match is actually active, not always the
  // first.
  assert.equal(flatBefore[1].sceneId,"p1");
  controller.activateProjectMatch(flatBefore[1].matchId);

  const result=await controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  assert.equal(project.scenes[0].sceneText,"Кот тут. пёс там.");
  assert.deepEqual(saveCalls,["p1"]);
  assert.deepEqual(rebaseCalls,["p1"]);
  assert.ok(p1View.state.doc.eq(loadSceneDocument(schema,project.scenes[0])),"the mounted p1 registration must reflect the committed text");

  const after=controller.getSnapshot();
  // Fresh state, never a manually patched count: p1 now has 1 "кот" match
  // ("Кот"), p2 still has its own 1 -- total 2 matches across 2 scenes.
  assert.equal(after.projectResult.totalMatches,2,"fresh search must reflect actual post-replace state");
  assert.equal(after.projectResult.affectedSceneCount,2);
  // Active match after Replace: the removed match (flat index 1) is gone,
  // so keeping the SAME numeric index (recomputeProject's existing clamp
  // policy) now names whatever took its place -- p2's own match, the next
  // one in canonical order -- never a reset to the very first result.
  const flatAfter=flattenProjectMatches(after.projectResult);
  assert.equal(after.activeProjectMatchIndex,1);
  assert.equal(flatAfter[1].sceneId,"p2");
  assert.equal(after.activeProjectMatchId,flatAfter[1].matchId);

  unregisterMountedScene("p1",p1RegId);
}

// 7b. If no matches remain after Replace, the active match clears safely
// (never a stale index into an empty list).
_resetMountedSceneRegistryForTests();
{
  const project={chapters:[{id:"chapter-1",title:"Глава 1"}],scenes:[
    {id:"only","title":"Только","chapterId":"chapter-1",sceneText:"Кот один.",included:true,sceneTextDoc:null}
  ]};
  async function saveSceneText(sceneId,{sceneText,sceneTextDoc}){
    const target=project.scenes.find(s=>s.id===sceneId);
    target.sceneText=sceneText;target.sceneTextDoc=sceneTextDoc;
    return {ok:true};
  }
  const controller=createFindReplaceController({getProjectData:()=>project,saveSceneText});
  controller.open();controller.setScope("project");controller.setQuery("кот");controller.setReplaceText("пёс");
  const before=controller.getSnapshot();
  controller.activateProjectMatch(before.projectResult.scenes[0].matches[0].matchId);
  const result=await controller.replaceProjectCurrent();
  assert.equal(result.ok,true);assert.equal(result.changed,true);
  const after=controller.getSnapshot();
  assert.equal(after.projectResult.totalMatches,0);
  assert.equal(after.activeProjectMatchIndex,-1);
  assert.equal(after.activeProjectMatchId,null);
}

// 7c. Guards: refuses to run under the wrong scope, and refuses safely with
// no active match / no configuration, never throwing.
{
  const controller=createFindReplaceController({});
  const wrongScope=await controller.replaceProjectCurrent();
  assert.equal(wrongScope.ok,false);assert.equal(wrongScope.reason,"wrong-scope");

  controller.open();controller.setScope("project");
  const noConfig=await controller.replaceProjectCurrent();
  assert.equal(noConfig.ok,false);
}

// Scene-scope replaceCurrent/replaceAll must still refuse to run under
// project scope, and vice versa -- the D2.1 guard is a mirror of the
// existing D1 one, never a replacement for it.
{
  const controller=createFindReplaceController({});
  controller.open();controller.setScope("project");
  assert.equal(controller.replaceCurrent(),false);
  assert.deepEqual(controller.replaceAll(),{count:0});
}

console.log("find-replace project-replace unit tests: OK");
