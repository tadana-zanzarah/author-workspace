// Find/Replace Stage D2.2.1: project-wide Replace ALL ("Заменить все" in
// "Весь проект" scope) -- the multi-scene write path. Headless -- no DOM, no
// modal/route knowledge, exactly like Stage B (find-replace-model.js), Stage
// D1's project search (find-replace-project-search.js), and Stage D2.1's
// single-Replace planner (find-replace-project-replace.js).
//
// Product contract (see docs/find-replace-architecture.md's D2.2.1 section
// for the full writeup):
//   1. FRESH PLAN, ALWAYS: planProjectReplaceAll re-derives every scene's
//      matches from its CURRENT authoritative doc at call time -- it never
//      trusts a project search result's own stored from/to/matches. The
//      caller (find-replace-controller.js's replaceProjectAll) calls this
//      synchronously, immediately before committing, from live `query`/
//      `caseSensitive`/`replaceText` STRINGS only -- never from
//      `projectResult`/`flattenProjectMatches`.
//   2. WHOLE PROJECT, ALWAYS: every non-deleted project scene participates,
//      `included:false` scenes included -- canonicalProjectScenes (Stage D1)
//      already returns exactly that set with no extra filtering needed here.
//   3. LIVE DOC IS AUTHORITATIVE: a scene with exactly one live mounted
//      registration (or several that agree on content) is planned against
//      THAT doc, never the possibly-stale persisted one -- see
//      resolveSceneReplacementSource below. This is what lets an author's
//      own unsaved in-progress edits survive Replace All instead of being
//      silently clobbered by a replacement computed against stale canonical
//      text.
//   4. CONFLICTING REGISTRATIONS ABORT THE WHOLE OPERATION, BEFORE ANY WRITE:
//      if ANY scene in the project has two or more VISIBLE (see the D2.2.1
//      corrective-pass note on resolveSceneReplacementSource below -- an
//      invisible, stale-but-still-registered surface is never on its own a
//      conflict participant) live registrations that disagree on content,
//      planning stops and reports {ok:false,reason:"conflict",
//      conflictedSceneIds} -- zero scenes are ever written, even ones that
//      would have been unaffected by the conflict. This mirrors mounted-
//      scene-registry.js's own refusal to silently pick a winner AMONG
//      genuinely live candidates (see that file's getPreferredLiveSceneView
//      doc comment for why that function's own further ACTIVATION tie-break
//      is deliberately NOT reused here -- it always resolves to SOME answer,
//      which is exactly wrong for a write).
//   5. NO-OP IS A DEFINED, SAFE OUTCOME: an empty query, a query with no
//      matches anywhere, or a batch whose every computed replacement is a
//      pure no-op (replacement text identical to every matched occurrence)
//      all report {ok:true,changed:false} -- the caller must not commit
//      anything, dirty anything, or fabricate a replaced count.
// The actual multi-scene WRITE (local commitDataChange / cloud
// bulkUpdateSceneText) is deliberately NOT this module's job -- planning
// stays pure/synchronous/side-effect-free, matching find-replace-project-
// replace.js's own buildProjectReplacement. The caller commits the plan's
// already-computed {sceneId,sceneText,sceneTextDoc} rows through whichever
// single atomic write its environment provides (see find-replace-
// controller.js's replaceProjectAll and js/import-export.js's
// commitProjectReplaceAllScenes), then calls syncMountedScenesAfterReplaceAll
// below to bring every live mounted registration up to date with what was
// actually committed.
import {sceneDocSchema} from "./scene-doc-schema.js";
import {loadSceneDocument,serializeSceneDocument} from "./scene-doc-convert.js";
import {canonicalProjectScenes} from "./find-replace-project-search.js";
import {findMatches,replaceAllMatches} from "./find-replace-model.js";
import {getMountedSceneRegistrations,isViewVisible} from "./mounted-scene-registry.js";
import {Selection} from "prosemirror-state";

function isViewUsable(view){
  return !!view&&!view.isDestroyed;
}

// Resolves the authoritative doc for ONE scene, per the live-doc policy
// above. Never uses mounted-scene-registry.js's own getPreferredLiveSceneView
// wholesale (that function additionally breaks a genuine disagreement by
// most-recent-activation, which is exactly the "arbitrarily prefer a winner"
// this module's own conflict policy must never do for a WRITE) -- but it DOES
// reuse that same file's `isViewVisible` visibility narrowing, for a
// corrective reason found during D2.2.1 manual acceptance (see below).
//
// D2.2.1 corrective pass -- false conflict from a stale-but-still-registered
// surface: this app's existing, accepted "defensive destroy-before-create"
// pattern (mounted-scene-registry.js's own doc comment; also
// scene-editor-view.js/js/scenes.js) means closing a single-editor surface
// (standalone "Текст сцены", the Scene modal) via anything OTHER than that
// exact surface's own next open -- Cancel, Escape, backdrop, OR the generic
// dirty-guard "discard and open the scene elsewhere" flow every ordinary
// scene-list navigation already uses -- only HIDES the modal
// (`style.display="none"`); it does not destroy that surface's ProseMirror
// mount or unregister it. Manual acceptance reproduced exactly this: Текст
// сцены held an unsaved edit; navigating to the Scene modal for the SAME
// scene through the ordinary "discard unsaved changes" confirmation (a
// completely normal, supported action, not the same-scene seamless
// Редактор сцены <-> Текст сцены switch button) left the OLD textModal
// registration alive and registered, now genuinely disagreeing in content
// with the freshly-mounted sceneModal one -- a real Node#eq mismatch, so the
// PREVIOUS version of this function correctly, but unhelpfully, reported a
// conflict for two registrations the user could not simultaneously see or
// edit (one belongs to a modal that is not even open). Reload "fixed" it only
// because reloading resets every module-level JS variable AND the whole
// mounted-scene-registry Map, discarding the orphan along with everything
// else -- not because anything about the underlying state was actually
// resolved by the user.
//
// Fix: narrow to VISIBLE registrations first (the exact same
// `isViewVisible`/candidate-narrowing step getPreferredLiveSceneView already
// uses, reused verbatim rather than reimplemented), falling back to the full
// usable set only if NONE of them are currently visible. A registration
// whose own surface isn't open cannot represent "someone is concurrently
// editing this" at all, so it is never a legitimate conflict participant on
// its own -- this does NOT weaken genuine-conflict detection: two (or more)
// SIMULTANEOUSLY VISIBLE registrations that disagree (e.g. "Текст сцены" and
// "Весь текст" both open at once, showing different unsaved content for the
// same scene) still fail the agreement check below exactly as before, and a
// scene whose ONLY registrations are all invisible still runs the full
// agreement check against that full set (never an unconditional "pick the
// first one") -- so an invisible orphan disagreeing with ANOTHER invisible
// orphan is still correctly reported as a conflict, just never blamed on a
// registration nothing in the running app can currently show the user.
//
// Returns:
//   {status:"none",doc}      -- no live registration; `doc` is the persisted
//                                one, loaded fresh from `scene`.
//   {status:"agree",doc}     -- one candidate, or several that agree on
//                                content (ProseMirror Node#eq) -- `doc` is
//                                that agreed content.
//   {status:"conflict"}      -- two or more candidates disagree.
export function resolveSceneReplacementSource(scene){
  const persistedDoc=loadSceneDocument(sceneDocSchema,scene);
  const usable=getMountedSceneRegistrations(scene.id).filter(registration=>isViewUsable(registration.view));
  if(!usable.length)return {status:"none",doc:persistedDoc};
  const visibleOnes=usable.filter(registration=>isViewVisible(registration.view));
  const candidates=visibleOnes.length?visibleOnes:usable;
  const firstDoc=candidates[0].view.state.doc;
  const allAgree=candidates.every(registration=>registration.view.state.doc.eq(firstDoc));
  if(!allAgree)return {status:"conflict"};
  return {status:"agree",doc:firstDoc};
}

// The pure planner. `projectData` is the caller's own fresh
// getProjectData() result; `query`/`caseSensitive`/`replaceText` are plain
// strings/booleans -- never a `projectResult`/`matches` snapshot. Returns:
//   {ok:true,changed:false,affectedSceneCount:0,totalMatchCount:0,scenes:[]}
//     -- empty query, no matches anywhere, or every computed replacement was
//        a no-op. Nothing to commit.
//   {ok:false,reason:"conflict",conflictedSceneIds:[...]}
//     -- at least one scene's live registrations disagree; zero scenes were
//        even searched past that point being discovered for THAT scene, and
//        the whole operation is refused regardless of what any other scene
//        would have produced.
//   {ok:true,changed:true,affectedSceneCount,totalMatchCount,scenes:[
//     {sceneId,matches,replacementText,doc,sceneText,sceneTextDoc,matchCount,
//      sourceWasLive}
//   ]} -- every scene with a real change, canonical project order. `matches`/
//        `replacementText`/`doc` are kept so syncMountedScenesAfterReplaceAll
//        below can push the exact same computed result into every live
//        registration without recomputing anything twice; `sceneText`/
//        `sceneTextDoc` are the already-serialized values (scene-doc-
//        convert.js's own serializeSceneDocument -- same conversion every
//        other save path uses) ready to hand to either the local
//        commitDataChange mutator or the cloud bulkUpdateSceneText
//        replacements array (as metadata:{richText:sceneTextDoc}, matching
//        update_scene_text/bulk_update_scene_text's own set-not-merge
//        contract).
export function planProjectReplaceAll(projectData,query,{caseSensitive=false,replaceText=""}={}){
  if(!query)return {ok:true,changed:false,affectedSceneCount:0,totalMatchCount:0,scenes:[]};
  const conflictedSceneIds=[];
  const sceneResults=[];
  let totalMatchCount=0;
  for(const {scene} of canonicalProjectScenes(projectData)){
    const source=resolveSceneReplacementSource(scene);
    if(source.status==="conflict"){conflictedSceneIds.push(scene.id);continue}
    const doc=source.doc;
    const matches=findMatches(doc,query,{caseSensitive});
    if(!matches.length)continue;
    const transform=replaceAllMatches(doc,matches,replaceText||"");
    if(transform.doc.eq(doc))continue; // every occurrence's replacement was a no-op for this scene
    const {sceneText,sceneTextDoc}=serializeSceneDocument(transform.doc);
    totalMatchCount+=matches.length;
    sceneResults.push({
      sceneId:scene.id,matches,replacementText:replaceText||"",doc:transform.doc,
      sceneText,sceneTextDoc,matchCount:matches.length,sourceWasLive:source.status==="agree"
    });
  }
  // Whole-project conflict scan (see the module doc comment, point 4): a
  // conflict found on a scene THIS query would never even have matched is
  // still disqualifying -- the conflict means "we cannot safely determine
  // what this scene's current content even is", which makes it impossible
  // to know it would have been unaffected. Discovered eagerly, before any
  // plan is returned as usable, so the caller can NEVER partially commit
  // past this point.
  if(conflictedSceneIds.length)return {ok:false,reason:"conflict",conflictedSceneIds};
  if(!sceneResults.length)return {ok:true,changed:false,affectedSceneCount:0,totalMatchCount:0,scenes:[]};
  return {ok:true,changed:true,affectedSceneCount:sceneResults.length,totalMatchCount,scenes:sceneResults};
}

// Shared "bring `view` to `committedDoc`" transaction builder -- same
// dual-strategy shape find-replace-project-replace.js's own (superseded,
// single-match) syncMountedRegistrations used for Stage D2.1: PREFER
// replaying the exact same computed replacement (replaceAllMatches with the
// SAME `matches`/`replacementText` the plan already computed) as this view's
// own small transaction, verified safe by checking the replay's own
// resulting doc against `committedDoc` before trusting it; a wholesale
// "swap the entire document content" transaction is the fallback, used only
// when the replay can't be verified (the view's doc diverged from the
// planned "before" doc during the one async gap a cloud commit has --
// local/commitDataChange commits are synchronous, so this fallback is
// unreachable for local saves). The replay preserves whatever ELSE is
// already in that view's own prosemirror-history undo stack (a small,
// localized transform rebases cleanly); the wholesale fallback does not
// guarantee that, but it is still always CORRECT content-wise, and is the
// only safe option once the replay can no longer be trusted.
//
// Returns `null` when `view` already shows `committedDoc` (nothing to do),
// otherwise `{tr,isReplay}`. The caller is responsible for tagging the
// transaction `addToHistory:false` and dispatching it -- Project Replace All
// deliberately never gives ANY mounted registration (including the one the
// user happens to be looking at) an undo-able entry for itself, since
// project-level Undo is explicitly out of scope for D2.2.1 (see
// docs/find-replace-architecture.md) -- ordinary per-editor Undo for
// whatever the user typed before/after Replace All is completely unaffected,
// this dispatch just never becomes a new entry in it.
export function buildSyncTransaction(view,committedDoc,{matches=null,replacementText=null}={}){
  if(view.state.doc.eq(committedDoc))return null;
  if(matches&&replacementText!=null){
    try{
      const replay=replaceAllMatches(view.state.doc,matches,replacementText);
      if(replay.doc.eq(committedDoc)){
        const tr=view.state.tr;
        replay.steps.forEach(step=>tr.step(step));
        return {tr,isReplay:true};
      }
    }catch{
      // `matches`' positions don't apply to this view's current doc (it
      // diverged since planning) -- fall through to the wholesale fallback.
    }
  }
  const tr=view.state.tr.replaceWith(0,view.state.doc.content.size,committedDoc.content);
  const oldHead=view.state.selection?.head??0;
  const clampedHead=Math.max(0,Math.min(oldHead,tr.doc.content.size));
  tr.setSelection(Selection.near(tr.doc.resolve(clampedHead)));
  return {tr,isReplay:false};
}

// Pushes every committed scene's final doc into EVERY currently live mounted
// registration for that scene (never only the one used as the planning
// source -- see rule 3/9 in docs/find-replace-architecture.md: a "None
// conflict" scene can still have several AGREEING registrations, and every
// one of them must end synchronized, not just the first). Every dispatch is
// synchronization-only (`addToHistory:false`) -- see buildSyncTransaction's
// own doc comment for why Project Replace All never gives any registration
// an undo entry for itself. Never touches a scene that isn't part of
// `sceneResults` (an unrelated, untouched scene's own mounted views are left
// completely alone), and never re-reads canonical/project data itself -- it
// only ever replays the EXACT computed replacement the plan already built.
// Returns the list of {sceneId,registrationId} actually synced, purely for
// the caller's own optional bookkeeping (e.g. dirty-baseline rebase --
// see js/import-export.js's rebaseSceneTextDirtyBaseline, called once per
// COMMITTED scene regardless of this list, since rebaseExtra is already a
// safe no-op for a tracker that isn't active/doesn't concern that scene).
export function syncMountedScenesAfterReplaceAll(sceneResults){
  const synced=[];
  for(const {sceneId,doc,matches,replacementText} of sceneResults){
    for(const registration of getMountedSceneRegistrations(sceneId)){
      const view=registration.view;
      if(!isViewUsable(view))continue;
      const built=buildSyncTransaction(view,doc,{matches,replacementText});
      if(!built)continue;
      built.tr.setMeta("addToHistory",false);
      view.dispatch(built.tr);
      synced.push({sceneId,registrationId:registration.registrationId});
    }
  }
  return synced;
}

// Find/Replace Stage D2.2.2: the exact "material change" test the
// confirmation flow's mandatory post-confirmation freshness re-check (see
// find-replace-controller.js's replaceProjectAll) uses to decide "does the
// plan the user just confirmed still describe the operation about to be
// committed, or must they be asked again against fresh numbers". Per
// docs/find-replace-architecture.md's D2.2.2 section, a change is material
// when the total replacement count changes, the affected SCENE COUNT
// changes, or -- even at an unchanged count -- the affected scene SET
// itself changes (one scene dropping out while a different one appears,
// same count, is still a materially different operation the user has not
// actually seen/authorized). Never compares scene CONTENT/text itself --
// that comparison is exactly what planProjectReplaceAll's own fresh
// findMatches/replaceAllMatches call already re-derives from scratch; this
// function only ever compares the two already-built plans' own summary
// shape, both pure/synchronous, no I/O.
export function projectReplacePlansMateriallyDiffer(previousPlan,nextPlan){
  if(previousPlan.totalMatchCount!==nextPlan.totalMatchCount)return true;
  if(previousPlan.affectedSceneCount!==nextPlan.affectedSceneCount)return true;
  const previousSceneIds=new Set(previousPlan.scenes.map(sceneResult=>sceneResult.sceneId));
  return nextPlan.scenes.some(sceneResult=>!previousSceneIds.has(sceneResult.sceneId));
}
