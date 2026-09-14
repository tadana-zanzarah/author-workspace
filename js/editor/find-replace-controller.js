// Find/Replace Stage C: the reusable controller. Owns all Find/Replace
// STATE (query, replace text, case-sensitive option, current match list,
// active match index, open/closed) and every operation that touches an
// EditorView (navigate, replace, replace all, decoration refresh). The panel
// (find-replace-panel.js) owns DOM rendering/events only and talks to this
// controller through the small API returned below -- never the other way
// around, and never directly to ProseMirror.
//
// One controller instance is bound to at most ONE EditorView at a time via
// attachView()/detachView() -- for the standalone "Текст сцены" and Scene
// modal surfaces that view never changes for the controller's lifetime; for
// "Весь текст" (one shared controller across N mounted scenes, exactly like
// the existing shared formatting toolbar) the group's own activate(sceneId)
// calls attachView() again on every focus change, retargeting this same
// controller/panel to whichever scene editor is now active. attachView
// always clears decorations from the PREVIOUSLY attached view first, so
// stale highlights can never linger on a scene editor this controller no
// longer targets.
//
// Uses the Stage B engine (find-replace-model.js) exactly as-is -- no
// matching/replacement logic is duplicated or reimplemented here.
import {findMatches,replaceOneMatch,replaceAllMatches} from "./find-replace-model.js";
import {findReplacePluginKey,buildMatchDecorations} from "./find-replace-decorations.js";
import {searchProject,flattenProjectMatches,reresolveFlatMatchIndex,pickPostReplaceActiveIndex} from "./find-replace-project-search.js";
import {getMountedSceneRegistrations} from "./mounted-scene-registry.js";
import {buildProjectReplacement} from "./find-replace-project-replace.js";
import {TextSelection} from "prosemirror-state";
import {closeHistory} from "prosemirror-history";

function isViewUsable(view){
  return !!view&&!view.isDestroyed;
}

// Corrective pass: ProseMirror's own tr.scrollIntoView() turned out NOT to
// scroll anything here, and this is worth explaining precisely rather than
// just patching around it silently. EditorView.scrollToSelection() (the
// internal handler scrollIntoView's meta flag triggers) starts from
// `view.domSelectionRange().focusNode` -- the REAL BROWSER DOM Selection's
// focus node, not the ProseMirror model selection -- and does nothing at all
// if that node isn't inside the editor's own DOM. While the Find input holds
// keyboard focus (which it deliberately does throughout navigation -- see
// dispatchNavigation below), the browser's actual DOM Selection is NOT
// inside the editor, so the built-in mechanism silently no-ops every time,
// regardless of how correctly the ProseMirror-model selection itself was
// set. This function reimplements the "scroll the nearest scrollable
// ancestor" behavior directly against `view.coordsAtPos()` (a public,
// focus-independent EditorView API), walking up from the editor's own DOM
// node (the SAME element as .rte-editor's overflow-y:auto container in all
// three surfaces, so this covers standalone/Scene-modal/"Весь текст"
// uniformly) and, if the target position isn't already within a scrollable
// ancestor's visible bounds, adjusting that ancestor's scrollTop just enough
// to reveal it. Walking upward (not stopping at the first scrollable
// ancestor) is what lets "Весь текст" additionally scroll its own outer
// modal list when a whole Scene block is out of view, without ever needing
// surface-specific code.
//
// Second corrective pass -- two real bugs found by actually reproducing a
// realistic "Весь текст" case (many scenes, one long, scrolled away, a
// single big navigation jump -- not just many small incremental Next
// presses, which happened to mostly "catch up" one step at a time and
// masked this) and inspecting the resulting DOM geometry rather than
// trusting that "a scrollTop changed" meant success:
//
// 1. `coords` was computed ONCE, before the ancestor loop, and reused for
//    every ancestor. After adjusting the FIRST (innermost) scrollable
//    ancestor's scrollTop, the match's actual on-screen position changes --
//    continuing to use the pre-scroll coordinates for the NEXT (outer)
//    ancestor's visibility check made that decision against stale data.
//    Fixed by recomputing view.coordsAtPos(pos) fresh at the start of each
//    ancestor's own check.
// 2. The "visible top boundary" of a scrollable ancestor was just its own
//    getBoundingClientRect().top plus a small fixed margin -- correct for
//    an ordinary container, but "Весь текст"'s outer .modal has the sticky
//    toolbar+Find/Replace wrapper (.rte-sticky-controls, see css/editor.css)
//    pinned across its own top ~100px, which is geometrically INSIDE the
//    modal's rect but visually opaque on top of the manuscript. A match
//    landing in that band was previously reported/left as "within the
//    modal's bounds" while being completely hidden under the controls.
//    Fixed by measuring any sticky-positioned child currently pinned at a
//    container's own top edge and treating its height as additional
//    obstruction the reveal must scroll past. Generic (inspects the
//    scrollable container's own children, not anything surface-specific),
//    so it applies correctly if a future surface ever adds its own sticky
//    header, and does nothing extra for containers (the two .rte-editor
//    levels) that have no sticky children at all.
function stickyTopObstruction(container){
  const containerTop=container.getBoundingClientRect().top;
  let obstruction=0;
  for(const child of container.children){
    if(getComputedStyle(child).position!=="sticky")continue;
    const childRect=child.getBoundingClientRect();
    if(childRect.top<=containerTop+1&&childRect.bottom>containerTop)obstruction=Math.max(obstruction,childRect.bottom-containerTop);
  }
  return obstruction;
}

// Find/Replace Stage D2.1.3 (Finding 1/11): collapses the view's REAL
// selection to a plain caret whenever it's a non-collapsed range this
// module itself set to represent an ACTIVE Find match (Stage C's own
// Word/browser-Find-style "the match becomes the actual selection" design,
// kept as-is -- this function never touches a selection the USER made by
// dragging/shift-selecting; it only ever runs at moments this controller
// itself is about to move on from a match, see call sites below).
//
// Root cause traced via prosemirror-history's own source
// (node_modules/prosemirror-history/dist/index.js): a real, undo-recorded
// transaction bookmarks `oldState.selection` (via `.getBookmark()`) as the
// selection Undo will restore -- REGARDLESS of whether that selection was
// ever itself added to history. `dispatchNavigation()`/find-replace-
// navigation.js's `selectAndReveal()` intentionally set the LIVE selection
// to a match's full range (addToHistory:false, so the selection CHANGE
// itself is never an undo step) -- but if that range is still the live
// selection the instant a LATER real edit (Replace) is dispatched, Undo of
// THAT edit restores the match-range selection verbatim: a genuine,
// visible, non-collapsed selection reappearing with no current Find
// operation to justify it. Collapsing to a caret immediately before any
// real, undo-recorded dispatch (replaceCurrent/replaceProjectCurrent/
// replaceAll) removes the stale range from history's own bookmark at the
// source, rather than trying to clean it up after the fact.
//
// Also called wherever a scope switch or an empty-match recompute is about
// to leave a stale match-range selection with no active Find operation left
// to justify it (setScope/recomputeAndReveal below) -- the same "three
// different visual states" distinction (Finding 11): decoration and active-
// match STATE persist independently in `matches`/`activeIndex`/
// `projectResult`; only the REAL selection is reset here, and only when
// nothing is about to immediately re-claim it via a genuine navigation
// reveal.
function collapseSelectionIfRange(targetView){
  if(!isViewUsable(targetView))return;
  if(targetView.state.selection.empty)return; // already a caret -- nothing to do
  const pos=targetView.state.selection.from;
  targetView.dispatch(targetView.state.tr.setSelection(TextSelection.create(targetView.state.doc,pos)).setMeta("addToHistory",false));
}

function revealDocPosition(view,pos){
  if(!isViewUsable(view))return;
  // Find/Replace Stage D2.1.3 (Finding 4): replaceCurrent/replaceProjectCurrent
  // now call this from headless unit tests (find-replace-project-replace.
  // test.mjs's own `fakeView` -- a real EditorState with no real EditorView/
  // DOM at all, deliberately, per that file's own comment: "EditorState has
  // no DOM dependency at all -- only EditorView needs a real DOM"). Reveal is
  // a pure DOM-geometry concern with nothing to verify without a real `view.
  // dom`; every actual reveal behavior is covered by the browser test suites
  // instead (find-replace-*-browser.test.mjs). A view missing `.dom` is
  // never a real, usable EditorView in the running app, so this is not a
  // silently-accepted invalid state anywhere outside these intentionally
  // headless tests.
  if(!view.dom)return;
  const margin=16;
  let node=view.dom.parentElement;
  while(node&&node!==document.body&&node!==document.documentElement){
    const style=getComputedStyle(node);
    const scrollableY=/(auto|scroll)/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1;
    if(scrollableY){
      let coords;
      try{coords=view.coordsAtPos(pos)}catch{return}
      const rect=node.getBoundingClientRect();
      const topBound=rect.top+stickyTopObstruction(node)+margin;
      const bottomBound=rect.bottom-margin;
      if(coords.top<topBound)node.scrollTop-=(topBound-coords.top);
      else if(coords.bottom>bottomBound)node.scrollTop+=(coords.bottom-bottomBound);
    }
    node=node.parentElement;
  }
}

// Editor-handoff Stage D2.1.5: the counterpart of revealDocPosition above --
// instead of scrolling TO a doc position, finds the doc position CURRENTLY
// at the top of the visible viewport, for surfaces that scrolled without
// ever moving the selection there (Priority 3's "viewport fallback": the
// author scrolled to review a passage but never clicked/placed a caret in
// it). Walks the exact same scrollable-ancestor chain as revealDocPosition
// (first ancestor with a real vertical scrollbar), accounts for the same
// sticky-header obstruction, then asks ProseMirror's own view.posAtCoords
// (the inverse of coordsAtPos) what doc position renders just below that
// visible top edge. Returns null when nothing can be determined (no
// scrollable ancestor, or posAtCoords can't resolve a position there) --
// callers must fall back to the captured selection in that case, never
// throw or invent a position.
function captureViewportAnchor(view){
  if(!isViewUsable(view)||!view.dom)return null;
  const margin=16;
  let node=view.dom.parentElement;
  while(node&&node!==document.body&&node!==document.documentElement){
    const style=getComputedStyle(node);
    const scrollableY=/(auto|scroll)/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1;
    if(scrollableY){
      const rect=node.getBoundingClientRect();
      const topBound=rect.top+stickyTopObstruction(node)+margin;
      const coords=view.posAtCoords({left:rect.left+rect.width/2,top:topBound+2});
      return coords?coords.pos:null;
    }
    node=node.parentElement;
  }
  return null;
}

// Find/Replace Stage D1: `getProjectData`/`navigateToSceneMatch` are optional
// dependency-injection hooks for the new "Весь проект" scope -- every Stage C
// caller/test that omits them keeps working exactly as before
// (setScope("project") simply produces an empty, inert project result rather
// than throwing). Deliberately NOT a direct import of find-replace-
// navigation.js here: that module imports isViewUsable/revealDocPosition
// FROM this file, so this file taking a concrete dependency back on it would
// make the two modules mutually import each other for no real benefit -- the
// integration point (scene-editor-controller.js) already imports find-
// replace-navigation.js and wires its real navigateToSceneMatch in here as a
// plain callback, keeping this file's own dependency graph one-directional
// (only find-replace-project-search.js and mounted-scene-registry.js, never
// navigation).
//   - getProjectData(): () => the current canonical project data object
//     (`{chapters,scenes,...}`) -- called fresh on every project search, so
//     it always sees the live project, never a stale captured copy.
//   - navigateToSceneMatch(sceneId,matchRange,{query,caseSensitive}): the
//     real find-replace-navigation.js adapter, pre-bound by the caller to
//     its own openSceneForEditing fallback. This file is the ONLY thing that
//     manages Find/Replace decorations (see applyProjectDecorations below);
//     the navigation adapter only ever moves the real editor selection.
//   - getNavigableSceneIds(): () => array of scene ids that project-scope
//     Next/Previous (see next()/previous() below) are allowed to land on --
//     NOT every scene in the current project search result. Modal-lifecycle-
//     adjacent fix (manual-test regressions, product brief item 3): arrow
//     navigation must stay within "the current visible editing context",
//     never silently open (or jump into) a scene the user isn't looking at
//     -- that is exactly what clicking a project-results row is for, and
//     that path (activateProjectMatch below) is deliberately left
//     unrestricted. "Весь текст" passes its OWN group's sceneIds() here
//     (createSceneEditorGroup in scene-editor-controller.js) -- exactly the
//     scenes mounted inside THAT "Весь текст" instance, never scenes merely
//     open elsewhere (a second standalone modal on the same scene, say).
//     Standalone "Текст сцены" and the Scene modal never pass this at all --
//     see currentNavigableSceneIds() below for why omitting it makes the
//     domain default to "just the one attached scene", which is exactly
//     their required behavior with zero extra wiring at either call site.
// Find/Replace Stage D2.1.2: project-wide Single Replace is now an ordinary,
// UNSAVED local edit of the active target EditorView (see
// replaceProjectCurrent below) -- it never persists anything itself, so this
// factory no longer takes any save/persistence dependency at all. Normal
// Save (the scene's own existing Save flow, unchanged) is the only
// persistence path; find-replace-project-replace.js's buildProjectReplacement
// is pure planning with no I/O.
export function createFindReplaceController({getProjectData=null,navigateToSceneMatch=null,getNavigableSceneIds=null}={}){
  let view=null;
  // Final D1 hardening pass: the sceneId the ATTACHED view is currently
  // showing, threaded in by attachView's caller (which always already knows
  // it -- see scene-editor-controller.js's own two attachView call sites).
  // This is the ONLY thing project-scope "which scene is currently attached"
  // logic below is allowed to compare against now (pickInitialProjectMatchIndex/
  // resolveProjectDomainIndexFromCaret) -- never ProseMirror Node#eq/doc-content
  // comparison, which cannot tell apart two different scenes that happen to
  // contain byte-for-byte identical prose. (applyProjectDecorations still
  // uses Node#eq for a DIFFERENT, legitimate purpose -- see its own comment
  // -- a staleness check on POSITIONS already correctly scoped to one sceneId
  // via the registry, never an identity decision.)
  let attachedSceneId=null;
  let query="";
  let replaceText="";
  let caseSensitive=false;
  let open_=false;
  let matches=[];
  let activeIndex=-1;
  let openSequence=0; // bumped by every open() call -- see open() below for why
  let focusTarget="find"; // "find" | "replace" -- which input the panel should focus for this openSequence
  // Find/Replace Stage D1: "scene" (Stage C's only mode, unchanged) or
  // "project" ("Весь проект" -- see recomputeProject/setScope below). Every
  // scene-scope code path below is gated so it behaves identically to Stage
  // C whenever scope is "scene", which is the default and the only value any
  // pre-D1 caller ever sees.
  let scope="scene";
  let projectResult=null; // last searchProject() result, or null
  let activeProjectMatchIndex=-1; // index into flattenProjectMatches(projectResult)
  // Find/Replace Stage D2.1.1: set (only) by adoptProjectSession below, for
  // exactly one upcoming recomputeProject() -- see that function's own
  // "fresh activation" branch. Carries the {sceneId,from,to,text,
  // occurrenceIndex} of the specific match a project-result navigation was
  // headed for, so a BRAND-NEW controller (mounted fresh as the destination
  // of a project-result click that had to open a scene nowhere previously
  // open) can land its own active match on that exact result instead of a
  // meaningless caret-relative guess against a just-mounted, empty-caret
  // view. Cleared the instant it's consumed (or found unresolvable) so it
  // can never leak into a later, unrelated recompute.
  let pendingActiveTarget=null;
  // Find/Replace Stage D2.1.2 (Goal J -- active-result locality after
  // Replace): set (only) by replaceProjectCurrent below, for exactly the one
  // recomputeProject() its own dispatch synchronously triggers (via
  // handleTransaction -- see that function's own comment). Carries
  // `{sceneId,position,sceneOrder}` -- the scene and approximate document
  // position the just-replaced match used to occupy -- so that recompute can
  // prefer a LOCAL remaining match (the next one after the edit in the same
  // scene, else the nearest one before it) over the old, non-local "keep the
  // same numeric flat index" policy, which could otherwise land on an
  // unrelated scene's own first match purely because indices shifted.
  // Cleared the instant it's consumed.
  let pendingPostReplaceLocality=null;
  // Every EditorView currently carrying a project-scope decoration set --
  // see applyProjectDecorations/clearAllProjectDecorations below. Tracked
  // explicitly (rather than re-deriving it) so a scene that drops OUT of the
  // current results, or whose view got destroyed, is still reliably cleared.
  let projectDecoratedViews=new Set();
  const listeners=new Set();

  // D1.1 fix: the panel used to render the arrow counter's denominator
  // straight off `projectResult.totalMatches` -- the GLOBAL project match
  // count, including scenes outside the current surface's own navigation
  // domain (see `navigableProjectMatches`/`currentNavigableSceneIds` below,
  // the exact same domain `next()`/`previous()` already restrict themselves
  // to). That made the counter claim reachability the arrows didn't actually
  // have ("1 из 29" while the 29th match lived in a scene Next/Previous can
  // never land on). `domainMatches` here is the SAME `navigableProjectMatches
  // (flat)` call `next()`/`previous()` use -- one definition of "navigable",
  // never a second one reimplemented in the panel -- so `navigableMatchCount`/
  // `activeNavigableMatchIndex` are exactly what the arrow counter needs.
  //
  // D1.1 follow-up: the project-results SUMMARY (as opposed to the arrow
  // counter) is a different, surface-INDEPENDENT concept -- how many of the
  // project's affected scenes are configured as not included in the general
  // text (the existing "Включить сцену в общий текст и выгрузку" setting) --
  // and must read identically on all three surfaces. That count already
  // lives on `projectResult.excludedSceneCount` (find-replace-project-
  // search.js, derived from the canonical `scene.included` flag, a SUBSET of
  // `affectedSceneCount`, never a match count and never navigation-domain-
  // relative), so the panel reads it straight off `snapshot.projectResult`
  // with no separate field needed here.
  function snapshot(){
    const flatProjectMatches=projectResult?flattenProjectMatches(projectResult):[];
    const activeProjectMatch=activeProjectMatchIndex>=0?flatProjectMatches[activeProjectMatchIndex]:null;
    const domainMatches=scope==="project"&&projectResult?navigableProjectMatches(flatProjectMatches):[];
    const activeNavigableMatchIndex=activeProjectMatch?domainIndexForMatchId(domainMatches,activeProjectMatch.matchId):-1;
    return {
      query,replaceText,caseSensitive,open:open_,matchCount:matches.length,activeIndex,openSequence,focusTarget,
      scope,projectResult,activeProjectMatchIndex,activeProjectMatchId:activeProjectMatch?.matchId??null,
      navigableMatchCount:domainMatches.length,
      activeNavigableMatchIndex,
      // Find/Replace Stage D2.1.4 (Finding 1): whether replaceProjectCurrent()
      // would actually be allowed to run right now -- see
      // resolveProjectReplaceTarget/canReplaceProjectCurrent above. The panel
      // uses this (never the weaker "an active result id exists" check) to
      // decide the Replace button's disabled state.
      projectReplaceEligible:canReplaceProjectCurrent()
    };
  }
  function notify(){
    const value=snapshot();
    listeners.forEach(listener=>listener(value));
  }

  function dispatchDecorations(targetView,decorations){
    if(!isViewUsable(targetView))return;
    targetView.dispatch(targetView.state.tr.setMeta(findReplacePluginKey,{decorations}).setMeta("addToHistory",false));
  }

  // buildMatchDecorations([]) always returns DecorationSet.empty -- used
  // deliberately everywhere below that needs to CLEAR highlights, rather than
  // ever passing a falsy `decorations` value through to the plugin: the
  // plugin's own apply() treats a falsy `meta.decorations` as "no update
  // supplied" (so it can fall through to its normal doc-change mapping
  // instead), meaning `null` would silently fail to clear anything -- an
  // explicit empty set is the only value that actually clears.
  function currentDecorations(){
    if(!isViewUsable(view))return null;
    return buildMatchDecorations(view.state.doc,matches,activeIndex);
  }

  // Manual-test regression fix (product brief item 3): "opening Find/Replace
  // or initiating a search must not blindly activate match #1" -- the caret/
  // selection already in the editor decides which match starts active:
  //   - a match containing the caret (half-open [from,to), so a caret sitting
  //     exactly AT a match's own end counts as "just past it", not inside);
  //   - otherwise the first match at/after the caret;
  //   - otherwise (caret is after every match) wrap to the first match.
  // `selection.from` is the reference point uniformly, whether the current
  // selection is collapsed (an actual caret) or a real range (its start) --
  // simple and deterministic rather than trying to special-case both edges.
  // This ONLY governs a genuinely FRESH activation (activeIndex was -1) --
  // recompute()'s other branch (clamping activeIndex back into range after
  // matches shrank from an edit/replace) is untouched, preserving Stage C's
  // own "stay roughly where you were" policy for that unrelated case.
  function pickInitialActiveIndex(freshMatches,targetView){
    if(!freshMatches.length)return -1;
    if(!isViewUsable(targetView))return 0;
    const caret=targetView.state.selection.from;
    const containing=freshMatches.findIndex(m=>caret>=m.from&&caret<m.to);
    if(containing>=0)return containing;
    const atOrAfter=freshMatches.findIndex(m=>m.from>=caret);
    if(atOrAfter>=0)return atOrAfter;
    return 0;
  }

  // Second corrective pass (manual-test regression fix, item 1): Find Next/
  // Previous must follow wherever the user's caret/selection ACTUALLY is
  // right now, not blindly step the stored activeIndex -- otherwise manually
  // clicking elsewhere in the editor and pressing Next silently ignores that
  // move and continues from the old position. Read fresh from
  // `view.state.selection` on every call (never cached/reactively tracked --
  // see this function's own module-level doc comment on why no "was this a
  // user selection" flag is needed for correctness): after OUR OWN
  // navigation dispatch, the real selection is already sitting exactly on
  // `matches[activeIndex]`, so re-deriving "current" from it here reproduces
  // the identical index and this never oscillates or skips; if the user has
  // since moved the caret/selection themselves, this naturally picks THAT
  // position up instead, with no separate bookkeeping required.
  //
  // direction: +1 for Next, -1 for Previous.
  //   - caret inside a match -> that match IS "current"; Next targets the
  //     one strictly after it, Previous the one strictly before (wrapping at
  //     either end of the list).
  //   - caret not inside any match -> Next targets the first match at/after
  //     the caret; Previous targets the last match strictly before it;
  //     wrapping to the first/last match respectively only when the caret is
  //     positioned after/before every match.
  function resolveSceneIndexFromCaret(currentMatches,targetView,direction){
    if(!currentMatches.length||!isViewUsable(targetView))return null;
    const caret=targetView.state.selection.from;
    const containing=currentMatches.findIndex(m=>caret>=m.from&&caret<m.to);
    if(direction>0){
      if(containing>=0)return (containing+1)%currentMatches.length;
      const atOrAfter=currentMatches.findIndex(m=>m.from>=caret);
      return atOrAfter>=0?atOrAfter:0;
    }
    if(containing>=0)return (containing-1+currentMatches.length)%currentMatches.length;
    for(let index=currentMatches.length-1;index>=0;index--){
      if(currentMatches[index].to<=caret)return index;
    }
    return currentMatches.length-1;
  }

  // The one place matches are (re)computed, from the CURRENT view.state.doc
  // -- never from a stale snapshot. Called after every relevant document
  // change, option change, or query edit, so a from/to pair is never held
  // past the document state it was computed against. Keeping the previous
  // activeIndex (clamped into the new match count) rather than always
  // resetting to 0 is a deliberate, simple "stay roughly where you were"
  // policy -- not an attempt at exact match identity preservation across an
  // edit, which the product brief explicitly says not to over-engineer.
  function recompute(){
    // Find/Replace Stage D1: the ONE gate that redirects every existing
    // scene-scope trigger (attachView, handleTransaction, setQuery,
    // setCaseSensitive -- all of which call recompute()/recomputeAndReveal()
    // exactly as Stage C left them, unmodified below) to the project search
    // instead, whenever scope is "project". Scene-scope activeIndex is left
    // at -1 throughout project scope (see setScope), so recomputeAndReveal's
    // own "reveal the active match" step safely never fires while in project
    // scope -- typing a project-scope query recomputes RESULTS only, it
    // never auto-navigates (see product brief section 12).
    if(scope==="project"){recomputeProject();return}
    if(!isViewUsable(view)){matches=[];activeIndex=-1;notify();return}
    if(!open_||!query){
      matches=[];activeIndex=-1;
      dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1));
      notify();
      return;
    }
    matches=findMatches(view.state.doc,query,{caseSensitive});
    if(!matches.length)activeIndex=-1;
    else if(activeIndex<0)activeIndex=pickInitialActiveIndex(matches,view);
    else if(activeIndex>=matches.length)activeIndex=0;
    dispatchDecorations(view,currentDecorations());
    notify();
  }

  // Project-scope counterpart of pickInitialActiveIndex above: prefers a
  // caret-relative match WITHIN WHATEVER SCENE IS CURRENTLY OPEN in the
  // attached `view`, if that scene participates in the project results at
  // all -- identified by `attachedSceneId` (set by attachView's caller,
  // which always already knows it), NEVER by comparing document content.
  // Final D1 hardening pass: this used to match flat entries via ProseMirror
  // Node#eq against the attached view's doc, which cannot distinguish two
  // DIFFERENT scenes that happen to contain byte-for-byte identical prose --
  // a real correctness gap flagged before Stage D2 (which needs to trust
  // scene identity for project-wide writes). Falls back to the very first
  // overall result when the current scene has no matches (or there's no
  // attached scene at all) -- there is no single sensible "caret" to prefer
  // among scenes the user isn't even looking at.
  function pickInitialProjectMatchIndex(flat){
    if(!flat.length)return -1;
    if(!attachedSceneId||!isViewUsable(view))return 0;
    const inCurrentScene=[];
    flat.forEach((match,index)=>{if(match.sceneId===attachedSceneId)inCurrentScene.push({match,index})});
    if(!inCurrentScene.length)return 0;
    const caret=view.state.selection.from;
    const containing=inCurrentScene.find(({match})=>caret>=match.from&&caret<match.to);
    if(containing)return containing.index;
    const atOrAfter=inCurrentScene.find(({match})=>match.from>=caret);
    if(atOrAfter)return atOrAfter.index;
    return inCurrentScene[0].index;
  }

  // Final D1 fix (arrow-navigation scope, product brief item 3): the set of
  // scene ids project-scope Next/Previous may land on right now. Defaults to
  // "just the currently attached scene" when the caller never supplied
  // getNavigableSceneIds (standalone "Текст сцены", Scene modal) -- those
  // single-editor surfaces only ever have ONE scene open at all, so that is
  // already the whole of "the current visible editing context" for them.
  // "Весь текст" supplies its own group's mounted-scene-id list instead, so
  // the domain there is every scene actually mounted in THAT modal, not the
  // one merely under keyboard focus.
  function currentNavigableSceneIds(){
    if(typeof getNavigableSceneIds==="function"){
      const ids=getNavigableSceneIds();
      return new Set(Array.isArray(ids)?ids:[]);
    }
    return attachedSceneId?new Set([attachedSceneId]):new Set();
  }

  // `flat` is already in canonical project order; filtering it down to the
  // navigable domain preserves that order (and each remaining scene's own
  // matches stay contiguous, since filtering only ever removes OTHER
  // scenes' entries) -- so every position/wrap computation below can treat
  // `domainMatches` exactly like a smaller, self-contained `flat`, with no
  // separate "is this index's scene actually reachable" check needed
  // anywhere else.
  function navigableProjectMatches(flat){
    const ids=currentNavigableSceneIds();
    return flat.filter(entry=>ids.has(entry.sceneId));
  }

  function domainIndexForMatchId(domainMatches,matchId){
    if(matchId==null)return -1;
    return domainMatches.findIndex(entry=>entry.matchId===matchId);
  }

  // Second corrective pass (manual-test regression fix, items 1/2), narrowed
  // by the final D1 fix above: Find Next/Previous must follow the caret in
  // WHATEVER scene the user is CURRENTLY looking at (the attached `view`,
  // which "Весь текст"'s own focus handling already retargets to whichever
  // mounted scene the user just clicked into -- see scene-editor-
  // controller.js's activate()), not the scene the stored
  // activeProjectMatchIndex happens to still point at -- but ONLY within
  // `domainMatches` (see navigableProjectMatches above), never the full
  // project result. This is what makes stepping past the attached scene's
  // own last/first match continue into the NEXT/PREVIOUS scene *in the
  // navigable domain* (Весь текст: another currently-mounted scene; single-
  // editor surfaces: nothing else is ever in the domain, so this always
  // wraps back within the one open scene instead) rather than into the
  // canonically-next scene in the whole project, which could be excluded or
  // simply not open anywhere -- exactly the "arrows must never auto-open an
  // unmounted scene" requirement, satisfied here by construction rather than
  // by special-casing the navigation call itself.
  //
  // Returns null when the attached scene has no matches of its own in the
  // current results (nothing live to compare the caret against) -- callers
  // fall back to a plain modular step within `domainMatches` in that case.
  function resolveProjectDomainIndexFromCaret(domainMatches,direction){
    if(!domainMatches.length||!attachedSceneId||!isViewUsable(view))return null;
    const sceneIndices=[];
    domainMatches.forEach((entry,index)=>{if(entry.sceneId===attachedSceneId)sceneIndices.push(index)});
    if(!sceneIndices.length)return null;
    const firstInScene=sceneIndices[0],lastInScene=sceneIndices[sceneIndices.length-1];
    const caret=view.state.selection.from;
    const containingLocal=sceneIndices.find(index=>caret>=domainMatches[index].from&&caret<domainMatches[index].to);
    if(direction>0){
      if(containingLocal!==undefined)return (containingLocal+1)%domainMatches.length;
      const afterInScene=sceneIndices.find(index=>domainMatches[index].from>=caret);
      if(afterInScene!==undefined)return afterInScene;
      // Caret is after every match in this scene -- continue into whatever
      // comes next in canonical order AMONG NAVIGABLE SCENES ONLY, wrapping
      // to the very first navigable result if this scene's matches are last.
      return lastInScene+1<domainMatches.length?lastInScene+1:0;
    }
    if(containingLocal!==undefined)return (containingLocal-1+domainMatches.length)%domainMatches.length;
    for(let index=sceneIndices.length-1;index>=0;index--){
      if(domainMatches[sceneIndices[index]].to<=caret)return sceneIndices[index];
    }
    // Caret is before every match in this scene -- continue backward into
    // whatever comes before in canonical order AMONG NAVIGABLE SCENES ONLY,
    // wrapping to the very last navigable result if this scene's matches are
    // first.
    return firstInScene>0?firstInScene-1:domainMatches.length-1;
  }

  // The project-scope counterpart of recompute() above -- searches the WHOLE
  // project (via find-replace-project-search.js), never the attached `view`
  // alone. `getProjectData` is called fresh every time (never cached), so
  // this always reflects the live project, including live-vs-persisted doc
  // resolution through the mounted-scene registry (see find-replace-project-
  // search.js's own resolveSceneDoc). A missing `getProjectData` (a caller
  // that never wired project search in) degrades to an inert empty result
  // rather than throwing, matching every other optional-dependency guard in
  // this file.
  // Find/Replace Stage D2.1.1: which match should become active on a
  // genuinely FRESH project-scope activation (activeProjectMatchIndex was
  // -1). Prefers `pendingActiveTarget` (an exact result a project-session
  // handoff is aiming for -- see adoptProjectSession) when it can still be
  // resolved against the fresh `flat` list; falls back to the existing
  // caret-relative pickInitialProjectMatchIndex policy otherwise (covers
  // every pre-D2.1.1 fresh-activation case unchanged, and the case where
  // the target itself can no longer be found).
  function resolveFreshProjectActiveIndex(flat){
    if(pendingActiveTarget){
      const resolved=reresolveFlatMatchIndex(flat,pendingActiveTarget);
      if(resolved>=0)return resolved;
    }
    return pickInitialProjectMatchIndex(flat);
  }

  function recomputeProject(){
    if(!open_||!query||typeof getProjectData!=="function"){
      projectResult=null;activeProjectMatchIndex=-1;pendingActiveTarget=null;pendingPostReplaceLocality=null;
      applyProjectDecorations();
      notify();
      return;
    }
    projectResult=searchProject(getProjectData(),query,{caseSensitive});
    const flat=flattenProjectMatches(projectResult);
    // Find/Replace Stage D2.1.2 (Goal J): a pending post-Replace locality
    // target takes priority over every other branch below -- it's set
    // (see replaceProjectCurrent) immediately before the dispatch that
    // triggers THIS exact recompute (via handleTransaction), so it is
    // always consumed on the very next recompute after a Replace, never a
    // later, unrelated one.
    if(pendingPostReplaceLocality){
      const locality=pendingPostReplaceLocality;
      pendingPostReplaceLocality=null;
      activeProjectMatchIndex=flat.length?pickPostReplaceActiveIndex(flat,locality):-1;
      applyProjectDecorations();
      notify();
      return;
    }
    // "Clamp, don't always reset to 0 -- except on a genuinely FRESH
    // activation, where the caret decides" mirrors scene-scope recompute()
    // above. The clamp branch matters here specifically because
    // navigateToSceneMatch's case-A path (an already-mounted registration)
    // calls attachView() as part of activating that scene, and attachView()
    // itself always runs recomputeAndReveal()/recompute() -- which, in
    // project scope, means clicking a project result triggers a SYNCHRONOUS
    // re-entrant recomputeProject() as a side effect of navigating to it.
    // Always resetting to index 0 here would silently clobber
    // activateProjectMatch's own just-set activeProjectMatchIndex back to
    // the FIRST result every time the user clicked anything else.
    //
    // Find/Replace Stage D2.1.1: a genuinely fresh activation (activeIndex
    // was -1) prefers `pendingActiveTarget` (set by adoptProjectSession)
    // over the caret-relative pickInitialProjectMatchIndex guess -- see
    // pendingActiveTarget's own declaration comment. This is exactly the
    // "genuinely fresh activation" case a brand-new, just-mounted controller
    // hits on its own first recompute, so it needs no special re-entrancy
    // handling beyond what this branch already has.
    if(!flat.length){activeProjectMatchIndex=-1;pendingActiveTarget=null}
    else if(activeProjectMatchIndex<0){
      activeProjectMatchIndex=resolveFreshProjectActiveIndex(flat);
      pendingActiveTarget=null;
    }
    else if(activeProjectMatchIndex>=flat.length)activeProjectMatchIndex=0;
    applyProjectDecorations();
    notify();
  }

  function activeProjectMatchIdValue(){
    if(activeProjectMatchIndex<0||!projectResult)return null;
    const flat=flattenProjectMatches(projectResult);
    return flat[activeProjectMatchIndex]?.matchId??null;
  }

  // Manual-test regression fix (product brief item 1): switching to "Весь
  // проект" used to simply CLEAR the attached view's decorations and never
  // show anything in their place -- this is the single place that replaces
  // that with the real thing: for every scene the current project result
  // actually includes, find every LIVE mounted registration for it (there
  // can be more than one -- see mounted-scene-registry.js) -- identified
  // exclusively by `sceneResult.sceneId` via getMountedSceneRegistrations,
  // never by comparing document content -- and, whenever that registration's
  // own doc still matches EXACTLY what was searched (Node#eq -- NOT a scene-
  // identity decision here, the registration is already known to belong to
  // this exact sceneId; this is a STALENESS check only: if the doc doesn't
  // match, it has moved on since this search ran, and using stale positions
  // on it is exactly what product brief item 2 asks NOT to do, so that
  // registration is just left undecorated until the next recompute catches
  // up), dispatch the SAME accepted Stage C decoration set (find-replace-
  // decorations.js's buildMatchDecorations -- every match dim, the active
  // one strong) -- never a second/different highlighting mechanism.
  // Previously decorated views that no longer qualify (scope left "project",
  // the scene dropped out of the results, or its doc is now stale) are
  // explicitly cleared, so nothing lingers -- see clearAllProjectDecorations
  // for the full-clear case (leaving scope/closing) this function itself
  // doesn't need to special-case.
  function applyProjectDecorations(){
    const nextViews=new Set();
    if(scope==="project"&&projectResult){
      const activeMatchId=activeProjectMatchIdValue();
      for(const sceneResult of projectResult.scenes){
        for(const registration of getMountedSceneRegistrations(sceneResult.sceneId)){
          const registeredView=registration.view;
          if(!isViewUsable(registeredView))continue;
          if(!registeredView.state.doc.eq(sceneResult.doc))continue;
          const activeIndexInScene=sceneResult.matches.findIndex(match=>match.matchId===activeMatchId);
          dispatchDecorations(registeredView,buildMatchDecorations(registeredView.state.doc,sceneResult.matches,activeIndexInScene));
          nextViews.add(registeredView);
        }
      }
    }
    for(const previousView of projectDecoratedViews){
      if(!nextViews.has(previousView)&&isViewUsable(previousView))dispatchDecorations(previousView,buildMatchDecorations(previousView.state.doc,[],-1));
    }
    projectDecoratedViews=nextViews;
  }

  // Clears every view currently carrying project-scope decorations -- called
  // when leaving project scope or closing the panel entirely (product brief
  // item 1: "no stale decorations left behind"). Distinct from
  // applyProjectDecorations's own trailing cleanup above, which only clears
  // views that dropped OUT of an otherwise-still-active project result.
  function clearAllProjectDecorations(){
    for(const previousView of projectDecoratedViews){
      if(isViewUsable(previousView))dispatchDecorations(previousView,buildMatchDecorations(previousView.state.doc,[],-1));
    }
    projectDecoratedViews=new Set();
  }

  // Delegates one project result's navigation to the injected adapter (the
  // real find-replace-navigation.js's navigateToSceneMatch, pre-bound to this
  // surface's openSceneForEditing fallback by the caller -- see this
  // factory's own doc comment above). Fire-and-forget from this file's point
  // of view: an expected "can't navigate" outcome (stale/not-mounted/
  // declined) is reported via the adapter's own return value, never a
  // thrown/rejected promise, so nothing here needs to react to it; `.catch`
  // is only a defensive backstop against a genuinely unexpected rejection.
  //
  // Find/Replace Stage D2.1.1: also passes `replaceText` (alongside the
  // already-existing `query`/`caseSensitive`) -- navigateToSceneMatch bundles
  // these three into the project-session it hands to adoptProjectSession
  // when navigation has to open a scene nowhere previously open (case B).
  // This controller never reaches into the destination directly; it only
  // ever hands the adapter what it needs, exactly as before.
  function triggerProjectNavigation(){
    if(typeof navigateToSceneMatch!=="function")return;
    const flat=projectResult?flattenProjectMatches(projectResult):[];
    const target=flat[activeProjectMatchIndex];
    if(!target)return;
    navigateToSceneMatch(target.sceneId,{from:target.from,to:target.to,text:target.text,occurrenceIndex:target.occurrenceIndex},{query,caseSensitive,replaceText})?.catch?.(()=>{});
  }

  // recompute() is deliberately PASSIVE: it never moves the selection or
  // scrolls. It runs on every doc-changing transaction (handleTransaction
  // below), including edits far away from the panel entirely -- forcing the
  // view to jump to the active match on every keystroke elsewhere in the
  // document would fight the author's own typing cursor. Explicit
  // user-initiated actions (opening the panel, typing/changing the query or
  // case option, retargeting to a newly active scene) are exactly the
  // moments a jump-to-current-match IS expected, so those call this wrapper
  // instead, which reveals the match right after recomputing.
  function recomputeAndReveal(){
    recompute();
    if(activeIndex>=0)dispatchNavigation();
    // Finding 1/11: no active scene-scope match to reveal (project scope
    // always takes this branch too, since `activeIndex` is scene-scope-only
    // and stays -1 there) -- collapse any stale match-range selection left
    // over from an earlier Find operation that is no longer current, rather
    // than letting it linger as an unexplained real selection.
    else collapseSelectionIfRange(view);
  }

  // Navigation moves the REAL editor selection to the active match's range
  // (matching how Word/browser Find behave -- the match becomes the actual
  // selection, with the decoration on top distinguishing "active" from the
  // other, dimmer highlighted matches), combined with the decoration update
  // into ONE dispatch, and then explicitly reveals it (see revealDocPosition
  // above for why the transaction's own scrollIntoView() alone is not
  // sufficient while the Find input holds focus). A pure selection change
  // never touches `doc`, so it can never make the scene dirty and is ignored
  // by handleTransaction's docChanged guard.
  //
  // Second corrective pass (manual-test regression fix, item 5): `navigation:
  // true` on this same meta object is the explicit, non-timing-based marker
  // that THIS PARTICULAR selection change is the controller's own
  // programmatic navigation, not a user-driven caret/selection move -- the
  // find-replace-navigation.js adapter tags its own selectAndReveal
  // transaction the same way (same plugin key, same field). Nothing in this
  // file currently NEEDS to read it back (resolveSceneIndexFromCaret/
  // resolveProjectDomainIndexFromCaret above deliberately read the LIVE selection
  // fresh on every Next/Previous call instead of reactively tracking it --
  // after our own navigation the live selection already sits exactly on the
  // match we just set, so re-deriving "current" from it reproduces the same
  // index with no drift, whether the caret got there via this dispatch or a
  // genuine user click), but the flag is set explicitly and unconditionally
  // regardless, so any future consumer (or handleTransaction, whose existing
  // `tr.getMeta(findReplacePluginKey)` early-return already relies on this
  // exact meta object's presence) has one unambiguous, inspectable signal to
  // check instead of a `setTimeout`/timing heuristic.
  function dispatchNavigation(){
    if(!isViewUsable(view)||activeIndex<0||!matches[activeIndex])return;
    const match=matches[activeIndex];
    const selection=TextSelection.create(view.state.doc,match.from,match.to);
    const tr=view.state.tr.setSelection(selection).scrollIntoView()
      .setMeta(findReplacePluginKey,{decorations:buildMatchDecorations(view.state.doc,matches,activeIndex),navigation:true})
      .setMeta("addToHistory",false);
    view.dispatch(tr);
    revealDocPosition(view,match.from);
  }

  // Find/Replace Stage D2.1.1 (Goal A -- preserve the project-wide session
  // across explicit cross-scene result navigation): hydrates a BRAND-NEW
  // controller instance (one just created for a scene that had to be opened
  // fresh -- find-replace-navigation.js's case B, "not mounted anywhere") in
  // "Весь проект" scope with the ORIGINATING controller's own current query/
  // replaceText/caseSensitive/target -- called once, by the mount code
  // (scene-editor-controller.js's mountSceneEditor), BEFORE attachView so
  // the FIRST recomputeProject that attachView's own recomputeAndReveal
  // triggers already runs with the adopted query/scope/options rather than
  // this controller's own empty defaults.
  //
  // Deliberately does NOT copy `projectResult`/`activeProjectMatchIndex`
  // across -- the destination's own upcoming recomputeProject() runs a
  // FRESH searchProject() instead (canonical project data may have moved on
  // since the originating controller's own last search, and Find/Replace
  // never trusts a stale result snapshot for anything beyond
  // rendering/navigation -- see docs/find-replace-architecture.md). `target`
  // (optional) is the specific match this session-transfer is aiming for --
  // stashed as `pendingActiveTarget` so that upcoming fresh search lands its
  // own active match on exactly that result (see
  // resolveFreshProjectActiveIndex above) instead of a meaningless caret-
  // relative guess against a view that was just mounted with no real caret
  // history.
  //
  // This is a one-shot handoff, not a new state-sharing mechanism: `session`
  // is a small, plain, caller-owned object (built fresh by
  // find-replace-navigation.js for this one call) -- nothing here retains a
  // reference back to the originating controller, and nothing here is a
  // permanent global. A caller that never adopts a session (every existing
  // mount path, and case B navigation with no active project session on the
  // originating controller) leaves this a complete no-op, matching every
  // other optional-dependency guard in this file.
  // Find/Replace Stage D2.1.2 (Goal I -- explicit full-scene <-> text-only
  // switch for the SAME scene): the counterpart of adoptProjectSession, for
  // a caller that wants to hand THIS controller's current project session to
  // whatever it opens next (a manual same-scene surface switch, never a
  // project-result click -- that path already builds its own session
  // inline in find-replace-navigation.js). Returns `null` outside project
  // scope -- there is nothing project-specific to preserve when scope is
  // "scene". Originally carried no `target` at all: a surface switch wasn't
  // considered "aimed at" any one particular match, so the destination's
  // fresh search just used its existing caret-relative
  // pickInitialProjectMatchIndex default (see resolveFreshProjectActiveIndex).
  // Editor-handoff Stage D2.1.5 revisited this: see this function's own
  // updated doc comment below for why a same-scene `target` is now included
  // when one applies.
  // Find/Replace Stage D2.1.3 (Finding 8): originally project-scope-only (a
  // scene-scope session was simply never exported, so a same-scene surface
  // switch while scope was "Эта сцена" silently dropped query/replaceText/
  // caseSensitive/open state). Generalized to cover BOTH scopes -- `scope`
  // is now part of the exported object itself, so the adopter on the
  // destination knows which mode to restore rather than assuming "project"
  // unconditionally. `open` (the panel's own open/closed state) is included
  // for the same reason: a session export used to always force the
  // destination panel open regardless of whether the SOURCE panel was
  // actually open, which is its own smaller instance of the same bug this
  // finding is about.
  // Editor-handoff Stage D2.1.5 (Priority 1 -- active Find target survives a
  // surface switch): `target` now carries the CURRENT active project match,
  // but ONLY when it belongs to the scene actually being handed off
  // (attachedSceneId) -- exactly the existing `adoptProjectSession(session)`
  // shape D2.1.1/D2.1.2 already built for cross-scene project-result
  // navigation, reused here rather than inventing a second "aim at this
  // match" mechanism. An active match in some OTHER scene (see D2.1.4
  // Finding 1 -- this can legitimately happen once the current scene's own
  // matches are exhausted) is deliberately left out: a same-scene surface
  // switch has nothing to do with THAT match, and forcing it into
  // `pendingActiveTarget` would incorrectly try to resolve an unrelated
  // scene's occurrence against the doc about to be installed here.
  function exportProjectSession(){
    const flat=projectResult?flattenProjectMatches(projectResult):[];
    const activeMatch=activeProjectMatchIndex>=0?flat[activeProjectMatchIndex]:null;
    const target=scope==="project"&&activeMatch&&activeMatch.sceneId===attachedSceneId
      ?{sceneId:activeMatch.sceneId,from:activeMatch.from,to:activeMatch.to,text:activeMatch.text,occurrenceIndex:activeMatch.occurrenceIndex}
      :null;
    return {scope,query,replaceText,caseSensitive,open:open_,target};
  }

  function adoptProjectSession(session){
    if(!session)return;
    // Find/Replace Stage D2.1.3 (Finding 8): `scope` defaults to "project"
    // when omitted -- every pre-existing caller (find-replace-navigation.js's
    // own inline session, built for cross-scene project-result navigation)
    // never set this field and always meant "project", so this preserves
    // their exact prior behavior unchanged.
    scope=session.scope==="scene"?"scene":"project";
    query=session.query||"";
    replaceText=session.replaceText||"";
    caseSensitive=!!session.caseSensitive;
    // `open` defaults to true when omitted, for the same backward-
    // compatibility reason: the pre-existing cross-scene navigation session
    // always wanted the destination panel open on arrival.
    open_=session.open!==false;
    matches=[];activeIndex=-1;
    projectResult=null;activeProjectMatchIndex=-1;
    // A scene-scope session has no cross-scene "exact result" to aim for --
    // the destination's own upcoming recompute() (scene-scope, unlike
    // recomputeProject) already re-runs the search fresh against the live
    // destination doc and falls back to its existing caret-relative
    // pickInitialActiveIndex default, exactly the "deterministic current-
    // scene result" fallback this finding asks for.
    pendingActiveTarget=scope==="scene"?null:(session.target||null);
  }

  // attachView is also how a fresh mount first hands the controller its
  // view, and how "Весь текст" retargets on every focus change.
  //
  // Final D1 hardening pass: `sceneId` is now a required second argument
  // (every real caller -- scene-editor-controller.js's mountSceneEditor and
  // createSceneEditorGroup's own activate() -- already has it in scope; see
  // this file's own top-of-factory comment on `attachedSceneId` for why this
  // replaces every ProseMirror Node#eq-based "which scene is this" check
  // below). A caller that omits it (an old test double, say) degrades to
  // `attachedSceneId=null`, which just makes the project-scope caret
  // resolvers above fall back to their existing "nothing live to compare
  // against" behavior -- never a crash, never a silent wrong-scene guess.
  function attachView(newView,sceneId=null){
    if(view===newView)return;
    if(isViewUsable(view))dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1)); // clear stale highlights on the PREVIOUS view
    view=newView;
    attachedSceneId=sceneId;
    matches=[];activeIndex=-1;
    recomputeAndReveal();
  }
  function detachView(oldView){
    projectDecoratedViews.delete(oldView); // never hold a reference past its own destroy
    if(view!==oldView)return;
    if(isViewUsable(oldView))dispatchDecorations(oldView,buildMatchDecorations(oldView.state.doc,[],-1));
    view=null;attachedSceneId=null;matches=[];activeIndex=-1;
    notify();
  }

  // Called from the editor's own onUpdate hook for EVERY transaction on the
  // currently-attached view. Ignores our own decoration-only dispatches
  // (meta present -> this transaction *is* the recompute's own output, not a
  // new change to react to) and selection-only transactions (nothing to
  // recompute). Reacts to any real document change -- typing, formatting,
  // Undo/Redo, Replace/Replace All alike -- by recomputing fresh, which is
  // exactly what prevents ever navigating/replacing against stale positions.
  //
  // Find/Replace Stage D1 limitation (see this stage's completion report):
  // in project scope, recompute() (via the scope gate above) refreshes
  // project results whenever THIS attached view's own doc changes -- the
  // realistic case of "author edits the scene they're currently in while the
  // project-search panel is open". It does NOT know about edits happening in
  // a completely different surface/controller instance (e.g. a second modal
  // open at the same time) -- that would need a project-wide edit event bus,
  // which is a larger change than this stage's product brief calls for.
  function handleTransaction(newState,tr){
    if(tr.getMeta(findReplacePluginKey))return;
    if(!tr.docChanged)return;
    recompute();
  }

  function setQuery(value){
    query=value;
    activeIndex=-1;
    recomputeAndReveal();
  }
  function setReplaceText(value){
    replaceText=value;
    notify();
  }
  function setCaseSensitive(value){
    caseSensitive=!!value;
    activeIndex=-1;
    recomputeAndReveal();
  }

  // open()/close() are the panel-visibility state -- decorations only ever
  // render while open, so closing always clears them immediately rather than
  // leaving a frozen highlight set behind. The panel is one compact row with
  // Find AND Replace controls always shown together (see
  // find-replace-panel.js) -- there is no separate "find" vs "replace"
  // LAYOUT mode -- but Ctrl+F and Ctrl+H are still two distinct actions:
  // since both inputs are always visible together now, which one gets
  // FOCUSED is the only thing left for them to usefully differ on. `target`
  // ("find" or "replace") records that; the panel reads it to focus the
  // right input.
  //
  // openSequence bumps on EVERY open() call, not only on a closed->open
  // transition, so the panel can tell "the user just explicitly asked for
  // this" apart from any other snapshot change and (re)focus accordingly --
  // including the case where the panel was already open and Ctrl+F/Ctrl+H is
  // pressed again (same target or the other one), which should still
  // refocus/reselect that input.
  function open(target="find"){
    open_=true;
    focusTarget=target==="replace"?"replace":"find";
    openSequence++;
    recomputeAndReveal();
  }
  // Closing also returns focus to the editor itself (never left stranded on
  // a now-hidden panel control) -- `view` is already the live EditorView
  // this controller owns, so it is simplest and most reliable to do this
  // here rather than have every caller (button click, Escape) repeat it.
  // Find/Replace Stage D1: also clears project-scope state and any project
  // decorations left on ANY mounted scene, not just the attached `view`
  // (closing this panel is exactly the "the user is done looking at project
  // results" moment -- product brief item 1's "no stale decorations left
  // behind").
  function close(){
    open_=false;
    matches=[];activeIndex=-1;
    if(scope==="project"){
      projectResult=null;activeProjectMatchIndex=-1;
      clearAllProjectDecorations();
    }
    if(isViewUsable(view)){
      dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1));
      view.focus();
    }
    notify();
  }

  // Find/Replace Stage D1: switches between "scene" (Stage C's only mode)
  // and "project" ("Весь проект"). A no-op if already in the requested
  // scope. Leaving project scope clears its result state and every project
  // decoration currently showing (on however many mounted scenes), then
  // restores ordinary current-scene highlighting via the normal recompute
  // path; entering it clears the ATTACHED view's own scene-scope decoration
  // set (a different decoration set than project scope's own -- see
  // applyProjectDecorations, which recomputeProject below immediately calls
  // and which DOES decorate every mounted scene the search actually found,
  // fixing the manual-test regression where project scope used to leave
  // every editor undecorated).
  function setScope(newScope){
    const next_=newScope==="project"?"project":"scene";
    if(scope===next_)return;
    // Finding 1/10: a scope switch never itself re-navigates to a specific
    // match (scene scope only reveals one if recomputeAndReveal below finds
    // one; project scope deliberately never auto-navigates on scope entry
    // -- see recomputeProject's own comment) -- collapse any match-range
    // selection left over from whichever scope is being LEFT first, so a
    // stale "active match" selection from the previous scope (or one Undo
    // just restored) can never survive a scope toggle unexplained.
    collapseSelectionIfRange(view);
    scope=next_;
    activeIndex=-1;
    if(scope==="scene"){
      projectResult=null;activeProjectMatchIndex=-1;
      clearAllProjectDecorations();
      recomputeAndReveal();
      return;
    }
    matches=[];
    if(isViewUsable(view))dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1));
    activeProjectMatchIndex=-1;
    recomputeProject();
  }

  // Second corrective pass (manual-test regression fix, items 1/2): both
  // branches below resolve the navigation ORIGIN from the live caret
  // (resolveSceneIndexFromCaret/resolveProjectDomainIndexFromCaret) rather
  // than blindly stepping the stored index -- a plain `%length` step is used
  // only as the fallback for a scene the resolver can't say anything about
  // (no usable view, or -- project scope -- the attached scene has no
  // matches of its own in the current results).
  //
  // Final D1 fix (product brief item 3): the project-scope branch below
  // steps through `domainMatches` (navigableProjectMatches(flat)), never the
  // raw `flat` array -- so both the caret-relative resolution AND its plain-
  // modular-step fallback can only ever land on a match belonging to a scene
  // in the current navigable domain (see currentNavigableSceneIds' own
  // comment: every mounted scene in "Весь текст", or just the one open scene
  // in standalone/Scene modal). `activeProjectMatchIndex` itself keeps
  // indexing into `flat` (every other reader -- snapshot(), applyProject-
  // Decorations, activateProjectMatch -- already assumes that), so the
  // resolved domain match is translated back to its own flat index by
  // matchId (stable, never a raw position) before being stored. Because
  // every domain match's scene is -- by construction -- already mounted and
  // currently visible, triggerProjectNavigation()'s call into
  // navigateToSceneMatch always resolves via case A (activate the existing,
  // on-screen registration) here; it can no longer reach case B's "open a
  // scene that isn't currently open" fallback from an arrow press, which is
  // exactly the required "arrows must never auto-open an unmounted scene"
  // behavior -- achieved by restricting the candidate pool, not by changing
  // the navigation call itself. Explicit result-row clicks
  // (activateProjectMatch below) are untouched and stay fully unrestricted.
  function next(){
    if(scope==="project"){
      const flat=projectResult?flattenProjectMatches(projectResult):[];
      if(!flat.length)return;
      const domainMatches=navigableProjectMatches(flat);
      if(!domainMatches.length)return; // nothing in the current visible editing context to move to
      const resolved=resolveProjectDomainIndexFromCaret(domainMatches,1);
      let domainIndex=resolved;
      if(domainIndex===null){
        const currentDomainIndex=domainIndexForMatchId(domainMatches,activeProjectMatchIdValue());
        domainIndex=currentDomainIndex>=0?(currentDomainIndex+1)%domainMatches.length:0;
      }
      activeProjectMatchIndex=flat.findIndex(entry=>entry.matchId===domainMatches[domainIndex].matchId);
      applyProjectDecorations();
      triggerProjectNavigation();
      notify();
      return;
    }
    if(!matches.length)return;
    const resolved=resolveSceneIndexFromCaret(matches,view,1);
    activeIndex=resolved!==null?resolved:(activeIndex+1)%matches.length;
    dispatchNavigation();
    notify();
  }
  function previous(){
    if(scope==="project"){
      const flat=projectResult?flattenProjectMatches(projectResult):[];
      if(!flat.length)return;
      const domainMatches=navigableProjectMatches(flat);
      if(!domainMatches.length)return;
      const resolved=resolveProjectDomainIndexFromCaret(domainMatches,-1);
      let domainIndex=resolved;
      if(domainIndex===null){
        const currentDomainIndex=domainIndexForMatchId(domainMatches,activeProjectMatchIdValue());
        domainIndex=currentDomainIndex>=0?(currentDomainIndex-1+domainMatches.length)%domainMatches.length:0;
      }
      activeProjectMatchIndex=flat.findIndex(entry=>entry.matchId===domainMatches[domainIndex].matchId);
      applyProjectDecorations();
      triggerProjectNavigation();
      notify();
      return;
    }
    if(!matches.length)return;
    const resolved=resolveSceneIndexFromCaret(matches,view,-1);
    activeIndex=resolved!==null?resolved:(activeIndex-1+matches.length)%matches.length;
    dispatchNavigation();
    notify();
  }

  // Jumps directly to one specific project result (a clicked row in the
  // result list), by its stable matchId -- never by a raw array index the
  // panel would have to keep in sync itself. applyProjectDecorations runs
  // BEFORE triggerProjectNavigation so the strong active-match treatment
  // lands even if navigation itself can't complete (stale/not-mounted/
  // declined) -- highlighting-which-result-is-active and actually-jumping-
  // the-editor-there are two distinct, independently useful outcomes.
  function activateProjectMatch(matchId){
    if(scope!=="project"||!projectResult)return;
    const flat=flattenProjectMatches(projectResult);
    const index=flat.findIndex(match=>match.matchId===matchId);
    if(index<0)return;
    activeProjectMatchIndex=index;
    applyProjectDecorations();
    triggerProjectNavigation();
    notify();
  }

  // Replace current: exactly the active match, via the Stage B single-match
  // helper. The resulting document change flows through handleTransaction
  // like any other edit, which recomputes matches fresh -- since the
  // replaced match is now gone, the SAME numeric activeIndex (clamped by
  // recompute) naturally lands on what was the next remaining match, with no
  // separate "find the next match" bookkeeping needed here.
  // Find/Replace Stage D1 guard: "never perform a current-scene mutation
  // under a project-scope label" (product brief section 14) -- the panel
  // already disables these buttons in project scope, but this file never
  // relies on the UI alone to enforce that; calling either function
  // programmatically while scope is "project" is also a safe no-op.
  function replaceCurrent(){
    if(scope==="project")return false;
    if(!isViewUsable(view)||activeIndex<0||!matches[activeIndex])return false;
    // Finding 1: collapse a live match-range selection to a caret BEFORE
    // capturing `view.state.tr` below -- prosemirror-history bookmarks
    // `view.state.selection` (the state as it is AT THIS POINT) as the
    // selection Undo will restore for the transaction about to be built
    // from it; doing this after building `tr` would be too late; setting
    // `tr`'s own final selection later (already done below) has no effect
    // on that bookmark at all, since it comes from the state BEFORE `tr`.
    collapseSelectionIfRange(view);
    const match=matches[activeIndex];
    const transform=replaceOneMatch(view.state.doc,match,replaceText);
    const tr=view.state.tr;
    transform.steps.forEach(step=>tr.step(step));
    // Find/Replace Stage D2.1.2 (Goal D/E audit): explicit, deterministic
    // caret placement right after the replacement (or exactly at the
    // deletion point for an empty replacement) -- never rely solely on
    // ProseMirror's default mapping of whatever selection happened to be
    // set before this dispatch (that selection may be stale/elsewhere if
    // the user moved the caret since the match was found/navigated to).
    // closeHistory guarantees this Replace starts its own undo group
    // regardless of how little time elapsed since the user's last real
    // edit -- prosemirror-history's own time-based grouping could otherwise
    // silently coalesce a fast Replace with whatever was just typed.
    const caretPos=Math.min(match.from+(replaceText?replaceText.length:0),tr.doc.content.size);
    tr.setSelection(TextSelection.create(tr.doc,caretPos)).scrollIntoView();
    view.dispatch(closeHistory(tr));
    view.focus();
    // Finding 4: PM's own `.scrollIntoView()` transaction flag above knows
    // nothing about a sticky-positioned header pinned over part of a
    // scrollable ancestor (see stickyTopObstruction/revealDocPosition) --
    // exactly the "Весь текст" toolbar+Find/Replace strip. Without this, a
    // Replace on a match sitting in that band silently mutates it while
    // leaving it visually hidden underneath the controls. Reuse the SAME
    // reveal primitive dispatchNavigation()/selectAndReveal() already use,
    // rather than a second reveal mechanism.
    revealDocPosition(view,caretPos);
    return true;
  }

  // Replace All: every current match, as the Stage B helper's single
  // Transform -- replayed onto one real Transaction and dispatched once, so
  // it is exactly one prosemirror-history undo step regardless of match
  // count (see find-replace-model.js's own guarantees). Never auto-saves --
  // this is an ordinary live editor edit; the surface's existing Save button
  // and dirty-tracking pick it up exactly as they would any other typed
  // change. Current-scene/current-active-scene scope only -- this operates
  // on `view`, the one attached EditorView, never anything else; project-
  // wide scope is explicitly Stage D's job, not this one's.
  function replaceAll(){
    if(scope==="project")return {count:0};
    if(!isViewUsable(view)||!matches.length)return {count:0};
    // Finding 1: see replaceCurrent's identical comment above.
    collapseSelectionIfRange(view);
    const count=matches.length;
    const transform=replaceAllMatches(view.state.doc,matches,replaceText);
    const tr=view.state.tr;
    transform.steps.forEach(step=>tr.step(step));
    view.dispatch(tr);
    return {count};
  }

  // Find/Replace Stage D2.1.2: project-wide Single Replace -- "Replace
  // changes ONLY the currently active global match" (unchanged product
  // rule), but NOW as an ordinary, UNSAVED local edit of the ACTIVE TARGET
  // EditorView, never an immediate persist. Manual acceptance rejected
  // D2.1/D2.1.1's "persist immediately, then treat the editor as if it had
  // already been saved" contract -- see docs/find-replace-architecture.md.
  //
  // The active target is this controller's OWN attachedSceneId/view --
  // reused identity, never a heuristic over the mounted-scene registry (a
  // scene can have other, secondary registrations; this never touches
  // them, exactly like an ordinary user typing into `view` never touches
  // them either). If the active global match's scene isn't the one this
  // controller is actually attached to right now (e.g. navigation to it
  // previously failed/was declined), there is no well-defined "the working
  // copy" to edit -- refuse safely (`no-active-editor`) rather than
  // inventing one (never persist-first, never rebuild the editor from
  // canonical state, never synchronize the active view from anything).
  //
  // The project result (`projectResult`/`flat`) is a NAVIGATION SNAPSHOT,
  // never a write plan: `buildProjectReplacement` re-resolves the target
  // against `view.state.doc`'s CURRENT content (reresolveMatch's stale-
  // safety policy, unchanged) before building the replacement.
  //
  // Scene-scope replaceCurrent()/replaceAll() above already refuse to run
  // under scope "project"; this is the mirror guard -- it refuses to run
  // under scope "scene", so the two can never be invoked against the wrong
  // mode even if a caller bypasses the panel's own disabled-button gating.
  // Find/Replace Stage D2.1.4 (Finding 1): the SINGLE source of truth for
  // whether replaceProjectCurrent() may run right now -- shared by the
  // runtime guard below (which stays the real defense-in-depth: nothing here
  // removes it) and the panel's own Replace-button eligibility (see
  // canReplaceProjectCurrent below), so the UI's disabled state and the
  // actual mutation guard can never drift apart. Manual acceptance found
  // that "there is an active global result" alone (the old gate) was not
  // enough -- exhausting the current scene's matches can leave the active
  // global result pointing at a scene nothing has navigated to (often an
  // `included:false` one, surfaced first purely by canonical order), and the
  // button stayed clickable only to be silently refused on click. Eligibility
  // is stricter: an active match must exist, it must belong to the scene
  // currently ATTACHED (open for editing) on this surface, and that view
  // must be usable. Returns {ok:true,target} or {ok:false,reason}.
  function resolveProjectReplaceTarget(){
    if(scope!=="project")return {ok:false,reason:"wrong-scope"};
    if(!projectResult)return {ok:false,reason:"no-active-match"};
    const flat=flattenProjectMatches(projectResult);
    const target=flat[activeProjectMatchIndex];
    if(!target)return {ok:false,reason:"no-active-match"};
    if(attachedSceneId!==target.sceneId||!isViewUsable(view))return {ok:false,reason:"no-active-editor"};
    return {ok:true,target};
  }

  // Deliberately does NOT independently re-verify "is this match still
  // re-resolvable against the live doc" (buildProjectReplacement's own
  // reresolveMatch stale-check, below) on every render -- `projectResult`
  // is always a FRESH search re-run synchronously after every doc-changing
  // transaction (recomputeProject, via handleTransaction), so whenever the
  // active match's scene IS the attached, usable view, that match is
  // already known-current against the live doc at render time. Duplicating
  // a full re-search here on every keystroke/render for a race window that
  // buildProjectReplacement already closes at actual Replace time would be
  // redundant work for no real safety gain -- the runtime guard in
  // replaceProjectCurrent (via resolveProjectReplaceTarget/
  // buildProjectReplacement) remains the authoritative check either way.
  function canReplaceProjectCurrent(){
    return resolveProjectReplaceTarget().ok;
  }

  function replaceProjectCurrent(){
    const resolved=resolveProjectReplaceTarget();
    if(!resolved.ok)return resolved;
    const target=resolved.target;
    const outcome=buildProjectReplacement(view.state.doc,{from:target.from,to:target.to,text:target.text,occurrenceIndex:target.occurrenceIndex},{query,caseSensitive,replacementText:replaceText});
    // Failure (stale) or a no-op (changed:false): zero mutation, so nothing
    // here may dispatch into the view, touch dirty state, or re-search --
    // the caller (the panel) surfaces `outcome` itself; this file never
    // fabricates UI feedback.
    if(!outcome.ok||!outcome.changed)return outcome;
    // Finding 1: see replaceCurrent's identical comment above.
    collapseSelectionIfRange(view);
    const tr=view.state.tr;
    outcome.transform.steps.forEach(step=>tr.step(step));
    // Goal D/E: explicit, deterministic caret placement (never left to
    // default step-mapping of a possibly-stale prior selection) -- right
    // after the inserted replacement, or exactly at the deletion point for
    // an empty replacement. Valid for a SINGLE-match replacement
    // specifically: `resolvedMatch.from` in the doc BEFORE this transform
    // is untouched by it (nothing to its left was touched), so it remains a
    // valid position in `tr.doc` after the steps are applied.
    const caretPos=Math.min(outcome.resolvedMatch.from+(replaceText?replaceText.length:0),tr.doc.content.size);
    tr.setSelection(TextSelection.create(tr.doc,caretPos)).scrollIntoView();
    // Finding 4: see replaceCurrent's identical comment above -- project-
    // scope Replace needs the same sticky-aware reveal, not just PM's own
    // scrollIntoView() flag. Dispatched a few lines below; revealDocPosition
    // is called right after that dispatch so it measures the POST-replace
    // geometry (matching dispatchNavigation's own dispatch-then-reveal order).
    // Goal J: tells the upcoming recompute (triggered synchronously by this
    // very dispatch, via handleTransaction -- see pendingPostReplaceLocality's
    // own declaration comment) to prefer a LOCAL remaining match in this
    // same scene over the old "keep the same numeric index" default.
    pendingPostReplaceLocality={sceneId:target.sceneId,position:target.from,sceneOrder:target.sceneOrder};
    // closeHistory guarantees this Replace starts its own undo group
    // regardless of timing since the user's last real edit (Goal L) -- no
    // `addToHistory:false` anywhere: this is a normal, undo-able local edit,
    // picked up by the scene's own existing dirty-tracking/Save flow exactly
    // like any other typed change. Nothing else is dispatched into any other
    // registration of this scene -- a secondary mounted copy (if any) is
    // simply left alone, precisely as an ordinary typed edit would leave it.
    view.dispatch(closeHistory(tr));
    view.focus(); // Goal D: the active editor stays the user-facing focus context
    revealDocPosition(view,caretPos);
    return {ok:true,changed:true,sceneId:target.sceneId};
  }

  function subscribe(listener){
    listeners.add(listener);
    listener(snapshot());
    return ()=>listeners.delete(listener);
  }

  return {
    attachView,detachView,handleTransaction,
    setQuery,setReplaceText,setCaseSensitive,
    open,close,next,previous,replaceCurrent,replaceAll,replaceProjectCurrent,
    setScope,activateProjectMatch,adoptProjectSession,exportProjectSession,
    subscribe,getSnapshot:snapshot,
    get view(){return view}
  };
}

// Find/Replace Stage D1: exported (Stage C kept these module-private) so the
// project-wide navigation adapter (find-replace-navigation.js) can reuse the
// exact same "reveal a doc position inside whichever scrollable ancestor is
// hiding it" logic instead of re-implementing the sticky-header-aware
// geometry walk this file already carefully tuned across several corrective
// passes. No behavior here changed for Stage C's own current-scene callers.
// Editor-handoff Stage D2.1.5: captureViewportAnchor is exported for the
// same reason -- scene-editor-controller.js's own surface-handoff capture
// reuses this exact geometry rather than re-implementing it.
export {isViewUsable,revealDocPosition,captureViewportAnchor};
