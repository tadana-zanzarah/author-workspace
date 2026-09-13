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
import {findMatches} from "./find-replace-model.js";
import {findReplacePluginKey,buildMatchDecorations} from "./find-replace-decorations.js";
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

// Final D1 hardening pass (item 2): case B (below) mounts a BRAND NEW
// surface -- a fresh mountSceneEditor() call creates its own, independent,
// closed find-replace-controller instance (see scene-editor-controller.js)
// with no connection at all to the ORIGINATING controller that drove this
// navigation. Left alone, nothing would ever decorate that destination: the
// only visual trace of "this is a match" would be the real editor Selection
// selectAndReveal already sets -- which is exactly the reported regression,
// a plain native-selection look instead of the accepted strong/dim
// decoration pair. This reuses the EXACT SAME primitives every other surface
// uses (findMatches, buildMatchDecorations, findReplacePluginKey) -- no
// second highlighting system: every match in the destination scene gets the
// normal dim treatment, the one just navigated to gets the strong "active"
// one, and (per the scoped `::selection` CSS from the previous corrective
// pass) that treatment is already focus-independent and survives an
// arbitrary user selection, with zero extra work needed here.
//
// No lifecycle hook or `setTimeout` needed: by the time this is called, the
// caller has already `await`-ed openSceneForEditing(sceneId), and that
// promise only resolves after the destination view has been SYNCHRONOUSLY
// mounted and registered (openSceneText -> requestEditorTransition's own
// openAction() call runs mountSceneEditor() with no async gap in between) --
// so `view` here is always the real, already-mounted destination, never a
// pending/about-to-mount one.
function applyFallbackSceneDecorations(view,query,caseSensitive,resolvedMatch){
  const allMatches=findMatches(view.state.doc,query,{caseSensitive});
  const activeIndex=allMatches.findIndex(match=>match.from===resolvedMatch.from&&match.to===resolvedMatch.to);
  const tr=view.state.tr
    .setMeta(findReplacePluginKey,{decorations:buildMatchDecorations(view.state.doc,allMatches,activeIndex)})
    .setMeta("addToHistory",false);
  view.dispatch(tr);
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
// Find/Replace Stage D2.1.1 (Goal A): options.replaceText, together with
// query/caseSensitive, is bundled into a small `projectSession` object
// (`{query,caseSensitive,replaceText,target}`) and handed to
// `openSceneForEditing` as a second argument whenever case B has to open a
// scene nowhere previously mounted -- the ONE existing hook this app already
// has for "open this scene for editing" is also the smallest point where the
// current project-wide Find/Replace session can be handed to whatever fresh
// controller that open ends up creating (see
// find-replace-controller.js's adoptProjectSession, and
// scene-editor-controller.js's mountSceneEditor, which is the one place that
// actually threads it through to that new controller before attaching the
// view). This is a plain, caller-owned, one-shot object -- never a new
// global/state-sharing mechanism, and callers that don't pass
// `openSceneForEditing` a version that understands the second argument are
// unaffected (existing callers elsewhere in the app -- e.g. opening a scene
// from a plain scene card -- simply never construct a `projectSession` at
// all, since only THIS function ever builds one).
//
// Returns {ok:true} on success, or {ok:false,reason} for every rejected case
// -- callers decide how/whether to surface a reason; this function never
// throws for an ordinary "can't navigate right now" outcome.
export async function navigateToSceneMatch(sceneId,matchRange,{query,caseSensitive=false,replaceText="",openSceneForEditing}={}){
  let preferred=getPreferredLiveSceneView(sceneId);
  let mountedByFallback=false;
  // Modal-lifecycle regression fix: `preferred.status==="ok"` alone is NOT
  // enough to treat a scene as "already mounted, safe to just activate in
  // place" (case A) -- a single-editor surface (standalone "Текст сцены",
  // Scene modal) only ever destroys its PREVIOUS mount defensively on its
  // NEXT open (this app's existing, accepted pattern; see scenes.js), so a
  // registration from an earlier visit can remain `status:"ok"` (registered,
  // not destroyed) for a LONG time after the surface showing it was closed
  // -- `getPreferredLiveSceneView`'s own "fall back to the full usable set
  // when nothing is currently visible" policy (needed by OTHER callers like
  // find-replace-project-search.js, which legitimately wants the best
  // available live content regardless of on-screen visibility) means it
  // still reports that stale, hidden registration as "ok" when it is the
  // ONLY one on record. Taking case A on it called that registration's own
  // `activate()`, which just re-showed the SAME already-closed modal
  // directly -- completely bypassing openSceneForEditing/
  // requestEditorTransition's "close whichever surface is currently open
  // first" step, leaving the PREVIOUSLY-open surface (e.g. "Весь текст")
  // stuck at `display:flex` underneath the reopened one: two simultaneously
  // "open" modals, exactly the invisible-overlay/blocked-controls state
  // manual testing found on a REPEATED unmounted-scene navigation. The fix:
  // require `preferred.visible` too -- a registration that is only "ok"
  // via that no-one-was-visible fallback is NOT a valid case-A target here;
  // treat it the same as "not mounted" and go through the real open flow
  // (case B), which correctly destroys the stale mount and runs the single-
  // surface transition before showing anything.
  // Find/Replace Stage D2.1.1 (Goal A): built unconditionally -- this
  // function is only ever reached from project-scope controller code
  // (next()/previous()/activateProjectMatch(), all gated on scope==="project"
  // -- see find-replace-controller.js), so a real project session always
  // exists to hand off here. A caller/test that omits query entirely still
  // produces a harmless, inert session object; adoptProjectSession treats an
  // empty query the same as never having adopted one (recomputeProject's own
  // existing `!query` guard already handles that).
  const projectSession={query,caseSensitive,replaceText,target:{sceneId,from:matchRange.from,to:matchRange.to,text:matchRange.text,occurrenceIndex:matchRange.occurrenceIndex}};
  if(!preferred||preferred.status!=="ok"||!preferred.visible){
    if(typeof openSceneForEditing!=="function")return {ok:false,reason:"not-mounted"};
    const opened=await openSceneForEditing(sceneId,{projectSession});
    if(!opened)return {ok:false,reason:"open-declined"};
    preferred=getPreferredLiveSceneView(sceneId);
    if(!preferred||preferred.status!=="ok")return {ok:false,reason:"open-failed"};
    mountedByFallback=true;
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
  // Final D1 hardening pass (item 2): ONLY for a scene mounted just now via
  // the fallback -- an already-mounted (case A) registration is already
  // being decorated by the ORIGINATING controller's own applyProjectDecorations
  // (called right before this function, in next()/previous()/
  // activateProjectMatch()); dispatching decorations here too for that case
  // would reintroduce the exact "two competing decoration dispatchers"
  // regression the first corrective pass already fixed.
  if(mountedByFallback)applyFallbackSceneDecorations(view,query,caseSensitive,resolved);
  return {ok:true};
}
