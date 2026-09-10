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

// Find/Replace Stage D1: `getProjectData`/`navigateToSceneMatch`/
// `clearProjectNavigationHighlight` are optional dependency-injection hooks
// for the new "Весь проект" scope -- every Stage C caller/test that omits
// them keeps working exactly as before (setScope("project") simply produces
// an empty, inert project result rather than throwing). Deliberately NOT a
// direct import of find-replace-navigation.js here: that module imports
// isViewUsable/revealDocPosition FROM this file, so this file taking a
// concrete dependency back on it would make the two modules mutually
// import each other for no real benefit -- the integration point
// (scene-editor-controller.js) already imports find-replace-navigation.js
// and wires its real navigateToSceneMatch/clearProjectNavigationHighlight in
// here as plain callbacks, keeping this file's own dependency graph
// one-directional (only find-replace-project-search.js, never navigation).
//   - getProjectData(): () => the current canonical project data object
//     (`{chapters,scenes,...}`) -- called fresh on every project search, so
//     it always sees the live project, never a stale captured copy.
//   - navigateToSceneMatch(sceneId,matchRange,{query,caseSensitive}): the
//     real find-replace-navigation.js adapter, pre-bound by the caller to
//     its own openSceneForEditing fallback.
//   - clearProjectNavigationHighlight(): clears whatever editor highlight a
//     previous project-result navigation left behind -- called when leaving
//     project scope or closing the panel (see setScope/close below).
export function createFindReplaceController({getProjectData=null,navigateToSceneMatch=null,clearProjectNavigationHighlight=null}={}){
  let view=null;
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
    else if(activeIndex<0||activeIndex>=matches.length)activeIndex=0;
    dispatchDecorations(view,currentDecorations());
    notify();
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
      notify();
      return;
    }
    projectResult=searchProject(getProjectData(),query,{caseSensitive});
    const flat=flattenProjectMatches(projectResult);
    // Same "clamp, don't always reset to 0" policy as scene-scope recompute()
    // above -- important here specifically because navigateToSceneMatch's
    // case-A path (an already-mounted registration) calls attachView() as
    // part of activating that scene, and attachView() itself always runs
    // recomputeAndReveal()/recompute() -- which, in project scope, means
    // clicking a project result triggers a SYNCHRONOUS re-entrant
    // recomputeProject() as a side effect of navigating to it. Always
    // resetting to index 0 here would silently clobber activateProjectMatch's
    // own just-set activeProjectMatchIndex back to the FIRST result every
    // time the user clicked anything else.
    if(!flat.length)activeProjectMatchIndex=-1;
    else if(activeProjectMatchIndex<0||activeProjectMatchIndex>=flat.length)activeProjectMatchIndex=0;
    notify();
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
  function dispatchNavigation(){
    if(!isViewUsable(view)||activeIndex<0||!matches[activeIndex])return;
    const match=matches[activeIndex];
    const selection=TextSelection.create(view.state.doc,match.from,match.to);
    const tr=view.state.tr.setSelection(selection).scrollIntoView()
      .setMeta(findReplacePluginKey,{decorations:buildMatchDecorations(view.state.doc,matches,activeIndex)})
      .setMeta("addToHistory",false);
    view.dispatch(tr);
    revealDocPosition(view,match.from);
  }

  // attachView is also how a fresh mount first hands the controller its
  // view, and how "Весь текст" retargets on every focus change.
  function attachView(newView){
    if(view===newView)return;
    if(isViewUsable(view))dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1)); // clear stale highlights on the PREVIOUS view
    view=newView;
    matches=[];activeIndex=-1;
    recomputeAndReveal();
  }
  function detachView(oldView){
    if(view!==oldView)return;
    if(isViewUsable(oldView))dispatchDecorations(oldView,buildMatchDecorations(oldView.state.doc,[],-1));
    view=null;matches=[];activeIndex=-1;
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
  // Find/Replace Stage D1: also clears project-scope state and whatever
  // project-navigation highlight might currently be showing on some OTHER
  // scene's editor (closing this panel is exactly the "the user is done
  // looking at project results" moment -- see product brief section 13's "no
  // stale decorations left behind").
  function close(){
    open_=false;
    matches=[];activeIndex=-1;
    if(scope==="project"){
      projectResult=null;activeProjectMatchIndex=-1;
      clearProjectNavigationHighlight?.();
    }
    if(isViewUsable(view)){
      dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1));
      view.focus();
    }
    notify();
  }

  // Find/Replace Stage D1: switches between "scene" (Stage C's only mode)
  // and "project" ("Весь проект"). A no-op if already in the requested
  // scope. Leaving project scope clears its result state and any lingering
  // project-navigation highlight, then restores ordinary current-scene
  // highlighting via the normal recompute path; entering it clears the
  // current view's scene-scope decorations (project scope does not decorate
  // every match in the attached view -- see product brief section 13) and
  // runs an initial project search for whatever query is already typed.
  function setScope(newScope){
    const next_=newScope==="project"?"project":"scene";
    if(scope===next_)return;
    scope=next_;
    activeIndex=-1;
    if(scope==="scene"){
      projectResult=null;activeProjectMatchIndex=-1;
      clearProjectNavigationHighlight?.();
      recomputeAndReveal();
      return;
    }
    matches=[];
    if(isViewUsable(view))dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1));
    activeProjectMatchIndex=-1;
    recomputeProject();
  }

  function next(){
    if(scope==="project"){
      const flat=projectResult?flattenProjectMatches(projectResult):[];
      if(!flat.length)return;
      activeProjectMatchIndex=(activeProjectMatchIndex+1)%flat.length;
      triggerProjectNavigation();
      notify();
      return;
    }
    if(!matches.length)return;
    activeIndex=(activeIndex+1)%matches.length;
    dispatchNavigation();
    notify();
  }
  function previous(){
    if(scope==="project"){
      const flat=projectResult?flattenProjectMatches(projectResult):[];
      if(!flat.length)return;
      activeProjectMatchIndex=(activeProjectMatchIndex-1+flat.length)%flat.length;
      triggerProjectNavigation();
      notify();
      return;
    }
    if(!matches.length)return;
    activeIndex=(activeIndex-1+matches.length)%matches.length;
    dispatchNavigation();
    notify();
  }

  // Jumps directly to one specific project result (a clicked row in the
  // result list), by its stable matchId -- never by a raw array index the
  // panel would have to keep in sync itself.
  function activateProjectMatch(matchId){
    if(scope!=="project"||!projectResult)return;
    const flat=flattenProjectMatches(projectResult);
    const index=flat.findIndex(match=>match.matchId===matchId);
    if(index<0)return;
    activeProjectMatchIndex=index;
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
