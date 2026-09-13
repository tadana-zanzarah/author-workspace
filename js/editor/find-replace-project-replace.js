// Find/Replace Stage D2.1: safe SINGLE Replace in project-wide ("Весь
// проект") scope, plus the minimal live-state synchronization it needs.
// Headless -- no DOM, no modal/route knowledge, exactly like Stage B
// (find-replace-model.js) and Stage D1's own project search
// (find-replace-project-search.js). This file must NOT implement Replace
// All (Stage D2.x/later, see docs/find-replace-architecture.md) and must
// NOT call bulkUpdateSceneText -- a single project-wide Replace commits
// through exactly the same single-scene canonical write path a normal
// scene-scope Save already uses, injected as `saveSceneText` (never a
// parallel write mechanism, never imported directly -- see this module's own
// factory-style dependency-injection, matching getProjectData/
// navigateToSceneMatch in find-replace-controller.js).
//
// Reuses, never reimplements:
//   - find-replace-project-search.js's reresolveMatch (the SAME stale-safety
//     policy navigation already relies on) -- a project result's from/to is a
//     NAVIGATION SNAPSHOT, never trusted blindly for mutation.
//   - find-replace-model.js's replaceOneMatch (the SAME matcher/replacement
//     engine Find itself uses -- Find and Replace can never disagree on what
//     "a match" is).
//   - scene-doc-convert.js's loadSceneDocument/serializeSceneDocument (the
//     SAME persisted<->doc conversion every other save path uses).
//   - mounted-scene-registry.js's getMountedSceneRegistrations (the SAME
//     registry Stage D1 search/navigation/decorations already depend on).
import {sceneDocSchema} from "./scene-doc-schema.js";
import {loadSceneDocument,serializeSceneDocument} from "./scene-doc-convert.js";
import {reresolveMatch} from "./find-replace-project-search.js";
import {replaceOneMatch} from "./find-replace-model.js";
import {getMountedSceneRegistrations} from "./mounted-scene-registry.js";
import {Selection} from "prosemirror-state";

function isViewUsable(view){
  return !!view&&!view.isDestroyed;
}

// Pre-commit synchronization gate (product brief cases A-E). Compares
// document CONTENT (ProseMirror Node#eq), never object identity and never a
// "preferred"/visible-first tie-break like mounted-scene-registry.js's own
// getPreferredLiveSceneView -- that function is built to always resolve to
// SOME single answer (useful for search/navigation, which need a best-effort
// live doc even when views disagree), which is exactly wrong here: D2.1 must
// never silently pick a winner among disagreeing live copies of the same
// scene. Stable scene identity is `sceneId` (the registry's own key) --
// never doc content -- exactly as the D2.0 audit's "Final D1 hardening pass"
// section requires throughout Find/Replace.
//
// Returns one of:
//   {status:"none"}             -- no live (non-destroyed) registration at all
//   {status:"agree",doc}        -- every live registration's doc agrees
//                                   (trivially true for exactly one) -- `doc`
//                                   is that agreed content
//   {status:"conflict"}         -- two or more live registrations disagree
export function resolveMountedSceneAgreement(sceneId){
  const usable=getMountedSceneRegistrations(sceneId).filter(registration=>isViewUsable(registration.view));
  if(!usable.length)return {status:"none"};
  const firstDoc=usable[0].view.state.doc;
  const allAgree=usable.every(registration=>registration.view.state.doc.eq(firstDoc));
  if(!allAgree)return {status:"conflict"};
  return {status:"agree",doc:firstDoc};
}

// One project-wide Replace, targeting exactly the ONE match named by
// `matchRange` (the caller's currently active global match -- see
// find-replace-controller.js's replaceProjectCurrent). Never touches any
// other match, never any other scene.
//
// Dependencies (both required; a caller that omits either gets a safe
// "not-configured" refusal, never a crash or a silent no-op pretending
// success -- matching every other optional-dependency guard in this Find/
// Replace subsystem):
//   - getProjectData(): () => the current canonical project data object,
//     called fresh (never cached) -- same contract as
//     find-replace-controller.js's own getProjectData.
//   - saveSceneText(sceneId,{sceneText,sceneTextDoc}): the real single-scene
//     canonical write (cloud updateSceneText/runCloudMutation or local
//     commitDataChange, wired by the caller -- see
//     js/import-export.js's saveSceneTextCanonical) -- returns a result
//     object whose `.ok` this function trusts as the ONLY success signal. A
//     falsy/failing result aborts immediately with no further mutation, no
//     registry sync, no dirty-baseline rebase -- never a fake committed
//     state.
//   - rebaseSceneDirtyBaseline(sceneId,sceneTextDocJSON): optional. Called
//     once per successful saveSceneText call (both the precondition sync
//     save below AND the final replacement commit, since either one can
//     persist a doc some open form's own dirty baseline still needs to catch
//     up to) -- never called on failure.
//
// Flow (product brief's own D2.1 semantics, in order):
//   1. Resolve the scene by stable sceneId.
//   2. Run the live-state agreement gate above; conflict aborts before any
//      mutation. If the agreed live doc differs from the persisted one, sync
//      it through the SAME canonical save path first (case C/D) -- this is a
//      plain, ordinary text-only save, not a Replace.
//   3. Resolve the target match against the now-current agreed document via
//      reresolveMatch (exact position/text match, else same occurrenceIndex,
//      else abort -- never a blind offset reuse).
//   4. Build the replacement via replaceOneMatch (Stage B).
//   5. No effective document change (e.g. replacement text identical to the
//      matched text) -> report `changed:false`, no persistence, no dirty
//      state, no editor history.
//   6. Otherwise commit through saveSceneText. Failure aborts with no
//      registry sync/dirty rebase; success reports the committed doc for the
//      caller to push into every mounted registration (see
//      syncMountedRegistrations below) and to trigger a fresh project
//      search.
export async function replaceProjectMatch({sceneId,matchRange,query,caseSensitive=false,replacementText="",getProjectData,saveSceneText,rebaseSceneDirtyBaseline}={}){
  if(typeof getProjectData!=="function"||typeof saveSceneText!=="function")return {ok:false,reason:"not-configured"};
  const projectData=getProjectData();
  const scene=(projectData?.scenes||[]).find(s=>s.id===sceneId);
  if(!scene)return {ok:false,reason:"scene-not-found"};

  const persistedDoc=loadSceneDocument(sceneDocSchema,scene);
  const agreement=resolveMountedSceneAgreement(sceneId);
  if(agreement.status==="conflict")return {ok:false,reason:"conflict"};

  let currentDoc=persistedDoc;
  if(agreement.status==="agree"&&!agreement.doc.eq(persistedDoc)){
    const {sceneText,sceneTextDoc}=serializeSceneDocument(agreement.doc);
    const syncResult=await saveSceneText(sceneId,{sceneText,sceneTextDoc});
    if(!syncResult?.ok)return {ok:false,reason:"sync-failed",error:syncResult};
    rebaseSceneDirtyBaseline?.(sceneId,sceneTextDoc);
    currentDoc=agreement.doc;
  } else if(agreement.status==="agree"){
    currentDoc=agreement.doc;
  }

  const resolved=reresolveMatch(currentDoc,query,{caseSensitive},matchRange);
  if(!resolved)return {ok:false,reason:"stale"};

  const transform=replaceOneMatch(currentDoc,resolved,replacementText||"");
  if(transform.doc.eq(currentDoc))return {ok:true,changed:false,sceneId,doc:currentDoc};

  const {sceneText,sceneTextDoc}=serializeSceneDocument(transform.doc);
  const commitResult=await saveSceneText(sceneId,{sceneText,sceneTextDoc});
  if(!commitResult?.ok)return {ok:false,reason:"persist-failed",error:commitResult};
  rebaseSceneDirtyBaseline?.(sceneId,sceneTextDoc);
  // `resolved`/`replacementText` are handed back so the caller can ask
  // syncMountedRegistrations to REPLAY this exact localized replacement
  // (rather than a wholesale document swap) into every agreeing mounted
  // view -- see that function's own doc comment for why this matters for
  // an unrelated pending edit already sitting in that view's own undo
  // history.
  return {ok:true,changed:true,sceneId,doc:transform.doc,sceneText,sceneTextDoc,resolvedMatch:resolved,replacementText:replacementText||""};
}

// Pushes a just-committed doc into EVERY currently mounted registration for
// this scene (never only the visible/preferred one -- product brief item 7:
// "hidden-but-mounted registrations must not remain stale"). A registration
// whose view already shows the exact committed content is left untouched
// (no unnecessary doc mutation/history disturbance). Every dispatch is
// tagged `addToHistory:false` -- this is an externally committed project
// operation, never a ProseMirror undo entry in any editor (Ctrl/Cmd+Z must
// keep referring only to that editor's own ordinary history).
//
// `resolvedMatch`/`replacementText` (both optional -- callers with neither,
// e.g. tests exercising this function in isolation, get the wholesale
// fallback below unconditionally) are the SAME values replaceProjectMatch
// just committed with. When given, the PREFERRED path replays that exact
// localized replacement (via replaceOneMatch, never re-implemented) as this
// registration's OWN small transaction -- verified safe by checking the
// replay's own resulting doc against `committedDoc` before using it. This
// matters because a wholesale "replace the entire document content" edit
// (the fallback) maps every OTHER pending change already in that view's own
// undo history through a transform that deletes and reinserts everything --
// prosemirror-history's own rebasing can no longer safely preserve an
// unrelated in-progress edit's undo entry across a change that drastic, even
// though the wholesale edit itself still correctly never becomes its OWN
// undo step. A small, localized replay (the same shape an ordinary user
// edit would produce) leaves the rest of that view's history exactly as
// rebaseable as any other unrelated edit would. The wholesale fallback is
// still what guarantees correctness for a registration that genuinely
// diverged during the one async gap in the whole flow (the `await
// saveSceneText(...)` call) -- replaying stale positions against a doc that
// changed underneath them could land on the wrong content, so the replay is
// only trusted when it verifiably reproduces the exact committed result.
export function syncMountedRegistrations(sceneId,committedDoc,{resolvedMatch=null,replacementText=null}={}){
  const syncedRegistrationIds=[];
  for(const registration of getMountedSceneRegistrations(sceneId)){
    const view=registration.view;
    if(!isViewUsable(view))continue;
    if(view.state.doc.eq(committedDoc))continue;
    let tr=null;
    if(resolvedMatch&&replacementText!=null){
      try{
        const localTransform=replaceOneMatch(view.state.doc,resolvedMatch,replacementText);
        if(localTransform.doc.eq(committedDoc)){
          tr=view.state.tr;
          localTransform.steps.forEach(step=>tr.step(step));
        }
      }catch{
        tr=null; // resolvedMatch's positions don't apply to this view's own current doc -- fall through
      }
    }
    if(!tr){
      tr=view.state.tr.replaceWith(0,view.state.doc.content.size,committedDoc.content);
      const oldHead=view.state.selection?.head??0;
      const clampedHead=Math.max(0,Math.min(oldHead,tr.doc.content.size));
      tr.setSelection(Selection.near(tr.doc.resolve(clampedHead)));
    }
    tr.setMeta("addToHistory",false);
    view.dispatch(tr);
    syncedRegistrationIds.push(registration.registrationId);
  }
  return syncedRegistrationIds;
}
