// Find/Replace Stage C: the reusable controller. Owns all Find/Replace
// STATE (query, replace text, case-sensitive option, current match list,
// active match index, open/closed mode) and every operation that touches an
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
import {TextSelection} from "prosemirror-state";

function isViewUsable(view){
  return !!view&&!view.isDestroyed;
}

export function createFindReplaceController(){
  let view=null;
  let query="";
  let replaceText="";
  let caseSensitive=false;
  let mode="closed"; // "closed" | "find" | "replace"
  let matches=[];
  let activeIndex=-1;
  let openSequence=0; // bumped by every open() call -- see open() below for why
  const listeners=new Set();

  function snapshot(){
    return {query,replaceText,caseSensitive,mode,matchCount:matches.length,activeIndex,openSequence};
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
    if(!isViewUsable(view)){matches=[];activeIndex=-1;notify();return}
    if(mode==="closed"||!query){
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
  // other, dimmer highlighted matches) and asks ProseMirror to scroll it into
  // view, combined with the decoration update into ONE dispatch. A pure
  // selection change never touches `doc`, so it can never make the scene
  // dirty and is ignored by handleTransaction's docChanged guard.
  function dispatchNavigation(){
    if(!isViewUsable(view)||activeIndex<0||!matches[activeIndex])return;
    const match=matches[activeIndex];
    const selection=TextSelection.create(view.state.doc,match.from,match.to);
    const tr=view.state.tr.setSelection(selection).scrollIntoView()
      .setMeta(findReplacePluginKey,{decorations:buildMatchDecorations(view.state.doc,matches,activeIndex)})
      .setMeta("addToHistory",false);
    view.dispatch(tr);
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
  // leaving a frozen highlight set behind. openSequence bumps on EVERY open()
  // call, not only on a closed->open transition, so the panel can tell "the
  // user just explicitly asked for Find" apart from any other snapshot
  // change and (re)focus the Find input accordingly -- including the case
  // where the panel was already open and Ctrl+F/the toolbar button was
  // pressed again, which should still refocus/reselect it.
  function open(nextMode="find"){
    mode=nextMode;
    openSequence++;
    recomputeAndReveal();
  }
  // Closing also returns focus to the editor itself (never left stranded on
  // a now-hidden panel control) -- `view` is already the live EditorView
  // this controller owns, so it is simplest and most reliable to do this
  // here rather than have every caller (button click, Escape) repeat it.
  function close(){
    mode="closed";
    matches=[];activeIndex=-1;
    if(isViewUsable(view)){
      dispatchDecorations(view,buildMatchDecorations(view.state.doc,[],-1));
      view.focus();
    }
    notify();
  }

  function next(){
    if(!matches.length)return;
    activeIndex=(activeIndex+1)%matches.length;
    dispatchNavigation();
    notify();
  }
  function previous(){
    if(!matches.length)return;
    activeIndex=(activeIndex-1+matches.length)%matches.length;
    dispatchNavigation();
    notify();
  }

  // Replace current: exactly the active match, via the Stage B single-match
  // helper. The resulting document change flows through handleTransaction
  // like any other edit, which recomputes matches fresh -- since the
  // replaced match is now gone, the SAME numeric activeIndex (clamped by
  // recompute) naturally lands on what was the next remaining match, with no
  // separate "find the next match" bookkeeping needed here.
  function replaceCurrent(){
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
  // change.
  function replaceAll(){
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
    subscribe,getSnapshot:snapshot,
    get view(){return view}
  };
}
