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
import {searchProject,flattenProjectMatches} from "./find-replace-project-search.js";
import {getMountedSceneRegistrations} from "./mounted-scene-registry.js";
import {TextSelection} from "prosemirror-state";

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

function revealDocPosition(view,pos){
  if(!isViewUsable(view))return;
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
export function createFindReplaceController({getProjectData=null,navigateToSceneMatch=null}={}){
  let view=null;
  // Final D1 hardening pass: the sceneId the ATTACHED view is currently
  // showing, threaded in by attachView's caller (which always already knows
  // it -- see scene-editor-controller.js's own two attachView call sites).
  // This is the ONLY thing project-scope "which scene is currently attached"
  // logic below is allowed to compare against now (pickInitialProjectMatchIndex/
  // resolveProjectIndexFromCaret) -- never ProseMirror Node#eq/doc-content
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
  // Every EditorView currently carrying a project-scope decoration set --
  // see applyProjectDecorations/clearAllProjectDecorations below. Tracked
  // explicitly (rather than re-deriving it) so a scene that drops OUT of the
  // current results, or whose view got destroyed, is still reliably cleared.
  let projectDecoratedViews=new Set();
  const listeners=new Set();

  function snapshot(){
    const flatProjectMatches=projectResult?flattenProjectMatches(projectResult):[];
    const activeProjectMatch=activeProjectMatchIndex>=0?flatProjectMatches[activeProjectMatchIndex]:null;
    return {
      query,replaceText,caseSensitive,open:open_,matchCount:matches.length,activeIndex,openSequence,focusTarget,
      scope,projectResult,activeProjectMatchIndex,activeProjectMatchId:activeProjectMatch?.matchId??null
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

  // Second corrective pass (manual-test regression fix, items 1/2): the
  // project-scope counterpart of resolveSceneIndexFromCaret above -- Find
  // Next/Previous must follow the caret in WHATEVER scene the user is
  // CURRENTLY looking at (the attached `view`, which "Весь текст"'s own
  // focus handling already retargets to whichever mounted scene the user
  // just clicked into -- see scene-editor-controller.js's activate()), not
  // the scene the stored activeProjectMatchIndex happens to still point at.
  // `flat` is already in canonical project order (chapters -> scenes ->
  // matches-in-scene, see find-replace-project-search.js), and one scene's
  // own matches are always CONTIGUOUS within it (flattenProjectMatches
  // builds it scene-by-scene) -- so "does entry j come before/after the
  // current scene's own block" is just a flat-index comparison against that
  // block's own first/last index.
  //
  // Final D1 hardening pass: identifies "which flat entries belong to the
  // attached scene" via `attachedSceneId` (set by attachView's caller) --
  // NEVER via ProseMirror Node#eq/doc-content comparison, which cannot tell
  // apart two different scenes sharing byte-for-byte identical prose (see
  // pickInitialProjectMatchIndex's own comment on why this matters before
  // Stage D2).
  //
  // Returns null when the attached view's scene has no matches of its own
  // in the current results (nothing live to compare the caret against) --
  // callers fall back to the previous plain modular-step behavior in that
  // case, exactly like pickInitialProjectMatchIndex's own fallback.
  function resolveProjectIndexFromCaret(flat,direction){
    if(!flat.length||!attachedSceneId||!isViewUsable(view))return null;
    const sceneIndices=[];
    flat.forEach((entry,index)=>{if(entry.sceneId===attachedSceneId)sceneIndices.push(index)});
    if(!sceneIndices.length)return null;
    const firstInScene=sceneIndices[0],lastInScene=sceneIndices[sceneIndices.length-1];
    const caret=view.state.selection.from;
    const containingLocal=sceneIndices.find(index=>caret>=flat[index].from&&caret<flat[index].to);
    if(direction>0){
      if(containingLocal!==undefined)return (containingLocal+1)%flat.length;
      const afterInScene=sceneIndices.find(index=>flat[index].from>=caret);
      if(afterInScene!==undefined)return afterInScene;
      // Caret is after every match in this scene -- continue into whatever
      // comes next in canonical order (naturally the next scene's own first
      // match, since scenes are contiguous blocks in `flat`), wrapping to
      // the very first project result if this scene's matches are the last.
      return lastInScene+1<flat.length?lastInScene+1:0;
    }
    if(containingLocal!==undefined)return (containingLocal-1+flat.length)%flat.length;
    for(let index=sceneIndices.length-1;index>=0;index--){
      if(flat[sceneIndices[index]].to<=caret)return sceneIndices[index];
    }
    // Caret is before every match in this scene -- continue backward into
    // whatever comes before in canonical order, wrapping to the very last
    // project result if this scene's matches are the first.
    return firstInScene>0?firstInScene-1:flat.length-1;
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
  function recomputeProject(){
    if(!open_||!query||typeof getProjectData!=="function"){
      projectResult=null;activeProjectMatchIndex=-1;
      applyProjectDecorations();
      notify();
      return;
    }
    projectResult=searchProject(getProjectData(),query,{caseSensitive});
    const flat=flattenProjectMatches(projectResult);
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
    if(!flat.length)activeProjectMatchIndex=-1;
    else if(activeProjectMatchIndex<0)activeProjectMatchIndex=pickInitialProjectMatchIndex(flat);
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
  function triggerProjectNavigation(){
    if(typeof navigateToSceneMatch!=="function")return;
    const flat=projectResult?flattenProjectMatches(projectResult):[];
    const target=flat[activeProjectMatchIndex];
    if(!target)return;
    navigateToSceneMatch(target.sceneId,{from:target.from,to:target.to,text:target.text,occurrenceIndex:target.occurrenceIndex},{query,caseSensitive})?.catch?.(()=>{});
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
  // resolveProjectIndexFromCaret above deliberately read the LIVE selection
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
  // branches below now resolve the navigation ORIGIN from the live caret
  // (resolveSceneIndexFromCaret/resolveProjectIndexFromCaret) rather than
  // blindly stepping the stored index -- a plain `%length` step is used only
  // as the fallback for a scene the resolver can't say anything about (no
  // usable view, or -- project scope -- the attached scene has no matches of
  // its own in the current results), preserving the previous behavior for
  // that narrow case.
  function next(){
    if(scope==="project"){
      const flat=projectResult?flattenProjectMatches(projectResult):[];
      if(!flat.length)return;
      const resolved=resolveProjectIndexFromCaret(flat,1);
      activeProjectMatchIndex=resolved!==null?resolved:(activeProjectMatchIndex+1)%flat.length;
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
      const resolved=resolveProjectIndexFromCaret(flat,-1);
      activeProjectMatchIndex=resolved!==null?resolved:(activeProjectMatchIndex-1+flat.length)%flat.length;
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
    const transform=replaceOneMatch(view.state.doc,matches[activeIndex],replaceText);
    const tr=view.state.tr;
    transform.steps.forEach(step=>tr.step(step));
    view.dispatch(tr);
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
    const count=matches.length;
    const transform=replaceAllMatches(view.state.doc,matches,replaceText);
    const tr=view.state.tr;
    transform.steps.forEach(step=>tr.step(step));
    view.dispatch(tr);
    return {count};
  }

  function subscribe(listener){
    listeners.add(listener);
    listener(snapshot());
    return ()=>listeners.delete(listener);
  }

  return {
    attachView,detachView,handleTransaction,
    setQuery,setReplaceText,setCaseSensitive,
    open,close,next,previous,replaceCurrent,replaceAll,
    setScope,activateProjectMatch,
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
export {isViewUsable,revealDocPosition};
