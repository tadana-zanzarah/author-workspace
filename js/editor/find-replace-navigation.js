// Find/Replace Stage D1 (corrective pass): the reusable navigation adapter,
// navigateToSceneMatch(sceneId, matchRange, options). This is the ONLY place
// project search results turn into "select this exact occurrence inside a
// real editor" -- the project search layer itself
// (find-replace-project-search.js) never touches modals, routes, or
// EditorViews, exactly as docs/find-replace-architecture.md requires.
//
// Two cases (product brief section 8):
//   A. The scene already has a suitable mounted registration (mounted-scene-
//      registry.js) -- activate/reveal that surface, target that exact
//      EditorView, select the match, scroll it into view (Stage C's own
//      reveal behavior, reused via find-replace-controller.js's exported
//      revealDocPosition -- not reimplemented).
//   B. Otherwise -- delegate through the caller-supplied generic
//      `openSceneForEditing(sceneId)` (the current implementation passes
//      `openSceneText`, per the product brief) and, once mounted, resolve and
//      select the same way.
// This module has zero knowledge of modals/routes beyond calling that one
// injected function -- it stays future-route-compatible by construction.
//
// Corrective pass (manual-test regression fix): this module used to ALSO
// dispatch its own single-match decoration here (a second, competing
// highlighting mechanism on top of find-replace-controller.js's own
// all-matches-in-the-scene decoration set). That produced exactly the
// regression manual testing found: switching to "Весь проект" cleared the
// controller's own decorations, this module's ad hoc single-match decoration
// only ever covered the one just-navigated-to match (never "all matches in
// every participating mounted scene"), and having two independent decoration
// dispatchers racing against the same view/plugin key made the outcome
// dependent on dispatch order. Decoration is now ENTIRELY the controller's
// job (see find-replace-controller.js's applyProjectDecorations) -- this
// module only ever sets the real editor SELECTION (to the exact, freshly
// re-resolved match range -- never a wider one) and reveals/scrolls it into
// view. One highlighting system, reused/generalized from Stage C, per the
// product brief's own instruction.
import {TextSelection} from "prosemirror-state";
import {getPreferredLiveSceneView} from "./mounted-scene-registry.js";
import {reresolveMatch} from "./find-replace-project-search.js";
import {findReplacePluginKey} from "./find-replace-decorations.js";
import {isViewUsable,revealDocPosition} from "./find-replace-controller.js";

// Second corrective pass (manual-test regression fix, item 5): tags this
// selection change with the same explicit `navigation:true` meta
// find-replace-controller.js's own dispatchNavigation() uses -- see that
// function's own doc comment for the full reasoning (an explicit,
// inspectable marker rather than a timing heuristic for "this selection
// change is the controller's own programmatic navigation, not a user-driven
// one"). No `decorations` field here: decoration is entirely
// find-replace-controller.js's job (applyProjectDecorations), called by the
// controller separately: before this function runs (see next()/previous()/
// activateProjectMatch()).
function selectAndReveal(view,match){
  const selection=TextSelection.create(view.state.doc,match.from,match.to);
  const tr=view.state.tr.setSelection(selection).scrollIntoView()
    .setMeta(findReplacePluginKey,{navigation:true})
    .setMeta("addToHistory",false);
  view.dispatch(tr);
  revealDocPosition(view,match.from);
  view.focus();
}

// matchRange: {from,to,text,occurrenceIndex} -- exactly what
// find-replace-project-search.js's per-match result entries carry.
// options.query/options.caseSensitive are required for stale revalidation
// (see find-replace-project-search.js's reresolveMatch); options.
// openSceneForEditing is the case-B fallback described above (may be async;
// its return value is treated as "did the transition proceed" -- falsy means
// the user declined an unsaved-changes prompt or similar, and navigation
// stops there without pretending to have navigated).
//
// Returns {ok:true} on success, or {ok:false,reason} for every rejected case
// -- callers decide how/whether to surface a reason; this function never
// throws for an ordinary "can't navigate right now" outcome.
export async function navigateToSceneMatch(sceneId,matchRange,{query,caseSensitive=false,openSceneForEditing}={}){
  let preferred=getPreferredLiveSceneView(sceneId);
  if(!preferred||preferred.status!=="ok"){
    if(typeof openSceneForEditing!=="function")return {ok:false,reason:"not-mounted"};
    const opened=await openSceneForEditing(sceneId);
    if(!opened)return {ok:false,reason:"open-declined"};
    preferred=getPreferredLiveSceneView(sceneId);
    if(!preferred||preferred.status!=="ok")return {ok:false,reason:"open-failed"};
  }
  const {registration}=preferred;
  if(!isViewUsable(registration.view))return {ok:false,reason:"view-destroyed"};
  registration.activate?.();
  const view=registration.view;
  if(!isViewUsable(view))return {ok:false,reason:"view-destroyed"};
  // Stale-result safety (product brief section 9): never trust matchRange's
  // from/to blindly -- re-derive the intended occurrence against whatever is
  // actually in the document right now, deterministically (see
  // reresolveMatch's own documented policy).
  const resolved=reresolveMatch(view.state.doc,query,{caseSensitive},matchRange);
  if(!resolved)return {ok:false,reason:"stale"};
  selectAndReveal(view,resolved);
  return {ok:true};
}
