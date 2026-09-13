// Find/Replace Stage D2.1.2: project-wide SINGLE Replace planning.
// Headless -- no DOM, no modal/route knowledge, exactly like Stage B
// (find-replace-model.js) and Stage D1's own project search
// (find-replace-project-search.js).
//
// Manual acceptance of D2.1/D2.1.1 rejected their "persist immediately"
// contract: a project-wide Single Replace must instead be an ORDINARY,
// UNSAVED local edit of the scene's own ACTIVE editor -- exactly like the
// user had typed it there themselves. It must NOT read/write canonical
// project data, must NOT touch any OTHER mounted registration of the same
// scene, and must NOT call updateSceneText/commitDataChange (or
// bulkUpdateSceneText, which stays entirely unwired). Persistence happens
// ONLY through the scene's own existing, explicit Save flow, afterward,
// exactly like any other typed change.
//
// This collapses what used to be a multi-step, async, mounted-agreement-
// gated commit (see git history / docs/find-replace-architecture.md's
// Stage D2.1 section for the superseded design) into one synchronous,
// pure planning step against the ONE view the caller identifies as the
// active target -- find-replace-controller.js's replaceProjectCurrent owns
// identifying that view (its own attachedSceneId/view, never a heuristic
// over the mounted-scene registry) and owns the actual dispatch/selection/
// focus; this module only ever resolves + builds the replacement.
//
// Reuses, never reimplements:
//   - find-replace-project-search.js's reresolveMatch (the SAME stale-
//     safety policy navigation already relies on) -- a project result's
//     from/to is a NAVIGATION SNAPSHOT, never trusted blindly for mutation.
//   - find-replace-model.js's replaceOneMatch (the SAME matcher/replacement
//     engine Find itself uses -- Find and Replace can never disagree on
//     what "a match" is).
import {reresolveMatch} from "./find-replace-project-search.js";
import {replaceOneMatch} from "./find-replace-model.js";

// Pure: resolves `matchRange` against `doc`'s CURRENT content (never the
// stale from/to it was found at) and builds the replacement as a Stage B
// `Transform` -- no EditorView, no dispatch, no history/selection decision.
// The caller (find-replace-controller.js) replays `.steps` onto its own
// live `Transaction` and decides selection/focus/history there, exactly
// the same shape scene-scope replaceCurrent() already uses for its own
// (unrelated) EditorView.
//
// Returns:
//   {ok:false,reason:"stale"} -- the intended occurrence can no longer be
//     safely resolved against the current document; caller must not mutate
//     anything (never a blind offset reuse).
//   {ok:true,changed:false} -- replacement is a no-op (e.g. replacement
//     text identical to the matched text); caller must not dispatch/dirty
//     anything.
//   {ok:true,changed:true,transform,resolvedMatch} -- the real replacement,
//     ready to be replayed as one normal (or history-isolated) transaction.
export function buildProjectReplacement(doc,matchRange,{query,caseSensitive=false,replacementText=""}={}){
  const resolved=reresolveMatch(doc,query,{caseSensitive},matchRange);
  if(!resolved)return {ok:false,reason:"stale"};
  const transform=replaceOneMatch(doc,resolved,replacementText||"");
  if(transform.doc.eq(doc))return {ok:true,changed:false};
  return {ok:true,changed:true,transform,resolvedMatch:resolved};
}
