// Find/Replace Stage C: the panel. Owns DOM rendering and DOM events only --
// every actual state change/ProseMirror operation is delegated to the
// controller (find-replace-controller.js) passed in; this module never
// imports ProseMirror at all. First working UI: functional, not visually
// polished (see docs/find-replace-architecture.md) -- exact spacing/icons
// are expected to change after user visual review.
//
// Corrective pass after the first visual review: Find and Replace controls
// now live in ONE compact row together, always both present once the panel
// is open -- there is no more separate expand/collapse arrow or a second
// near-full-width row. Ctrl+F and Ctrl+H both open this same row (see
// find-replace-controller.js's open()); the previous "find" vs "replace"
// layout mode no longer exists.
//
// Marked with `data-dirty-ignore` on its own root: js/dirty-state.js's
// serializeForm() skips any input/select/textarea under that attribute, so
// typing a search/replace term into this panel's own plain <input>s can
// never register as an unsaved scene-form change (see dirty-state.js's own
// comment on that exclusion for why a blanket form-control scan needed it).
//
// The root's visibility (`hidden`) doubles as how js/modal-manager.js's
// Escape handler detects "a find/replace panel is open inside the topmost
// modal" (`.rte-find-replace:not([hidden])`) so Escape closes the panel
// before the parent modal -- see that file's own comment for the exact
// mechanism (mirrors the pre-existing open-combobox-consumes-Escape-first
// pattern already used by js/multi-value-input.js).
//
// Find/Replace Stage D1: adds the "Эта сцена"/"Весь проект" scope toggle
// (as two more direct children of THIS row, alongside Stage C's original
// nine controls -- still one compact flex row, nothing reflowed) and the
// project-results list. The results list is deliberately NOT a child of
// `container` itself: it is inserted as container's own next DOM SIBLING.
// Reason: `container` (`.rte-find-replace`) IS the exact element Stage C's
// own accepted browser test measures via `container > *` bounding-rect tops
// to confirm every control sits on one compact visual row -- a HIDDEN
// (`display:none`) child unconditionally reports `getBoundingClientRect()`
// top 0, which would corrupt that geometry check every time the results list
// is hidden (i.e. whenever scope is "scene", whenever the panel is closed).
// Keeping it a sibling instead means `container`'s own children are still
// exactly "the one compact control row", exactly what that check verifies,
// with zero change to Stage C's accepted behavior/geometry.
//
// Manual-test regression fix (item 4): a fixed, small default height (~6
// result rows -- necessarily approximate since rows are grouped under
// scene/chapter headers of their own, not a uniform list) plus a min/max-
// bounded, user-draggable resize handle (see the resizer wiring below) --
// never the whole modal, and never so large it would visually take over.
//
// Second corrective pass (manual-test regression fix, item 6): default
// lowered from ~6 rows to ~4 (210px -> 140px, the same proportional row
// estimate as before) -- drag/keyboard resize and the existing min/max
// bounds are unchanged, the pane just starts smaller.
const DEFAULT_RESULTS_HEIGHT=140;
const MIN_RESULTS_HEIGHT=90;
const MAX_RESULTS_HEIGHT=420;
// Stage E3.2.6: the practical phone minimum for the manuscript once it
// shares `.rte-manuscript-region`'s bounded height with the project-
// results pane (css/editor.css) -- replaces E3.2.3's rejected 20px
// "technical floor" (results could squeeze the manuscript to a sliver of
// its own line-height). 140px minus `.rte-editor`'s own 12px+12px vertical
// padding leaves ~116px of visible text at this app's manuscript
// line-height (1.55 * 16px font-size ≈ 24.8px/line) -- roughly 4-5 whole
// lines, a genuinely readable/editable amount, not just a sliver. Also
// deliberately the SAME number as DEFAULT_RESULTS_HEIGHT: when both panes
// are contending for the same budget, neither one's "comfortable default"
// size is allowed to crush the other below its own comfortable default.
// Single source of truth for BOTH the CSS `min-height` on `.rte-editor`
// inside `.rte-manuscript-region` (must be kept numerically in sync, see
// that rule's own comment) and the dynamic results-height clamp below.
const MANUSCRIPT_MIN_HEIGHT=140;

// Russian plural-form bucket -- standard mod-10/mod-100 rule, no library
// needed. Module-level (not just an inline closure) and exported so
// tools/find-replace-panel-wording.test.mjs can exercise every mod-10/
// mod-100 edge case (1/2/5/21/22/25...) directly, headlessly, without
// spinning up a browser for what is pure string formatting. Exposed as its
// own small helper (not just buried inside pluralRu below) because
// excludedScenesClause needs the SAME one-vs-not-one decision for VERB
// agreement ("не включена" vs "не включены") that pluralRu already computes
// for the NOUN -- reusing this one bucket function keeps both agreeing by
// construction, never two independent mod-10/mod-100 implementations that
// could drift apart.
export function ruPluralForm(n){
  const mod10=n%10,mod100=n%100;
  if(mod10===1&&mod100!==11)return "one";
  if(mod10>=2&&mod10<=4&&(mod100<12||mod100>14))return "few";
  return "many";
}
export function pluralRu(n,one,few,many){
  const form=ruPluralForm(n);
  return form==="one"?one:form==="few"?few:many;
}

// D1.1 follow-up (manual-review wording fix): "N сцен(а/ы) не включена/
// включены в общий текст" -- the existing user-facing terminology for
// js/scenes.js's own "Включить сцену в общий текст и выгрузку" checkbox,
// phrased as a SUBSET clause of the scene count already reported just
// before it ("29 совпадений · 3 сцены · 1 сцена не включена в общий
// текст" reads as "of those 3 scenes, 1 isn't included" -- never "3 scenes
// plus one more"). Returns "" for zero excluded scenes so the caller can
// simply concatenate with no extra punctuation to strip.
export function excludedScenesClause(excludedSceneCount){
  if(!excludedSceneCount)return "";
  const noun=pluralRu(excludedSceneCount,"сцена","сцены","сцен");
  const verb=ruPluralForm(excludedSceneCount)==="one"?"не включена":"не включены";
  return ` · ${excludedSceneCount} ${noun} ${verb} в общий текст`;
}

// Stage E3.2.6: `manuscriptRegion`, when passed (currently only by
// mountSceneEditor for #sceneModal -- see that file's own comment), is the
// phone-only bounded flex wrapper (`.rte-manuscript-region`, css/
// editor.css) around the manuscript. When present, the project-results
// pane/resizer are inserted as ITS first child (ahead of the manuscript)
// instead of as `container`'s plain sibling, and the results-height clamp
// becomes geometry-aware so results growth is paid for by the manuscript
// shrinking within that SAME bounded region -- never by the outer modal.
// `null` everywhere else preserves the exact pre-existing behavior.
export function createFindReplacePanel(container,controller,manuscriptRegion=null){
  container.innerHTML="";
  container.classList.add("rte-find-replace");
  container.hidden=true;
  container.setAttribute("data-dirty-ignore","true");
  container.setAttribute("aria-label","Найти и заменить");

  // Find/Replace Stage D1: scope toggle. Two plain buttons (not native radio
  // inputs -- serializeForm()'s dirty-tracking scan only looks at
  // input/select/textarea, so buttons need no extra data-dirty-ignore
  // handling) inside a role="radiogroup" wrapper for the accessible
  // semantics AGENTS.md requires of new controls.
  const scopeGroup=document.createElement("div");
  scopeGroup.className="rte-scope-toggle";
  scopeGroup.setAttribute("role","radiogroup");
  scopeGroup.setAttribute("aria-label","Область поиска");

  const sceneScopeButton=document.createElement("button");
  sceneScopeButton.type="button";
  sceneScopeButton.className="rte-scope-btn rte-scope-scene";
  sceneScopeButton.setAttribute("role","radio");
  sceneScopeButton.textContent="Эта сцена";

  const projectScopeButton=document.createElement("button");
  projectScopeButton.type="button";
  projectScopeButton.className="rte-scope-btn rte-scope-project";
  projectScopeButton.setAttribute("role","radio");
  projectScopeButton.textContent="Весь проект";

  scopeGroup.append(sceneScopeButton,projectScopeButton);

  const findInput=document.createElement("input");
  findInput.type="text";
  findInput.className="rte-find-input";
  findInput.placeholder="Найти…";
  findInput.setAttribute("aria-label","Найти");

  const countEl=document.createElement("span");
  countEl.className="rte-find-count";
  countEl.setAttribute("aria-live","polite");

  const prevButton=document.createElement("button");
  prevButton.type="button";
  prevButton.className="rte-find-prev";
  prevButton.title="Предыдущее совпадение (Shift+Enter)";
  prevButton.setAttribute("aria-label","Предыдущее совпадение");
  prevButton.textContent="↑";

  const nextButton=document.createElement("button");
  nextButton.type="button";
  nextButton.className="rte-find-next";
  nextButton.title="Следующее совпадение (Enter)";
  nextButton.setAttribute("aria-label","Следующее совпадение");
  nextButton.textContent="↓";

  const replaceInput=document.createElement("input");
  replaceInput.type="text";
  replaceInput.className="rte-replace-input";
  replaceInput.placeholder="Заменить…";
  replaceInput.setAttribute("aria-label","Заменить на");

  const replaceOneButton=document.createElement("button");
  replaceOneButton.type="button";
  replaceOneButton.className="rte-replace-one";
  replaceOneButton.title="Заменить текущее совпадение";
  replaceOneButton.textContent="Заменить";

  const replaceAllButton=document.createElement("button");
  replaceAllButton.type="button";
  replaceAllButton.className="rte-replace-all";
  replaceAllButton.title="Заменить все совпадения в этой сцене";
  // Corrective pass (2nd visual review): the compact "Все" label failed
  // review because its meaning wasn't obvious on its own -- restored to the
  // full "Заменить все" text. No separate aria-label needed any more since
  // the visible text itself is now fully descriptive.
  replaceAllButton.textContent="Заменить все";

  const caseButton=document.createElement("button");
  caseButton.type="button";
  caseButton.className="rte-find-case";
  caseButton.title="Учитывать регистр";
  caseButton.setAttribute("aria-label","Учитывать регистр");
  caseButton.setAttribute("aria-pressed","false");
  caseButton.textContent="Aa";

  const closeButton=document.createElement("button");
  closeButton.type="button";
  closeButton.className="rte-find-close";
  closeButton.title="Закрыть (Esc)";
  closeButton.setAttribute("aria-label","Закрыть");
  closeButton.textContent="✕";

  container.append(scopeGroup,findInput,countEl,prevButton,nextButton,replaceInput,replaceOneButton,replaceAllButton,caseButton,closeButton);

  // Find/Replace Stage D1: the project-results list -- see the module doc
  // comment above for why this is a SIBLING of `container`, not a child.
  // Hidden by default; shown only while open AND scope is "project" (see the
  // subscribe callback below).
  // Corrective pass (manual-test regression fix, item 4/5): the scrollable
  // content (resultsRoot) and its drag handle (resizer) are wrapped in one
  // `resultsWrapper` that is what actually gets inserted into the surface --
  // two reasons this needs its own wrapper rather than putting the resizer
  // directly inside resultsRoot: (1) renderProjectResults() below rebuilds
  // resultsRoot's content from scratch on every snapshot (resultsRoot.
  // innerHTML=""), which would silently delete the resizer along with it;
  // (2) `#textModal .modal` is a FIXED-height flex column whose only
  // intended growing/shrinking child is `.rte-editor` (flex:1) -- Stage D1
  // originally inserted the results list there with no explicit `flex`
  // value, so it competed with the editor for the column's remaining space
  // under the browser's default flex-shrink behavior, silently squeezing the
  // manuscript's own visible area and breaking the "toolbar/search stays a
  // small fixed strip, the editor keeps everything else via its OWN internal
  // scroll" model the standalone surface has always relied on (this is what
  // manual testing described as "sticky behavior disappeared"). Giving the
  // wrapper `flex:none` (css/editor.css) fixes that -- it now takes exactly
  // its own explicit/resized height, never more, leaving the editor free to
  // claim the rest; the same rule is a harmless no-op for sceneModal/
  // allScenesModal, which don't use a flex-column modal at all.
  const resultsWrapper=document.createElement("div");
  resultsWrapper.className="rte-project-results-wrapper";
  resultsWrapper.hidden=true;

  // Find/Replace Stage D2.1: the smallest possible feedback surface for a
  // controlled Replace failure in project scope (conflict/stale/persist
  // failure -- see find-replace-controller.js's replaceProjectCurrent). A
  // plain, factual status line, not a new conflict-resolution UI -- no
  // retry affordance, no diff, no modal. Lives inside `resultsWrapper`
  // (never a child of `container` itself) so it can never disturb Stage C's
  // own "one compact control row" geometry check, and is automatically
  // hidden/cleared whenever project results next re-render (a fresh
  // successful action, a new query, leaving project scope) -- see
  // renderProjectResults below.
  const replaceStatusEl=document.createElement("div");
  replaceStatusEl.className="rte-project-replace-status";
  replaceStatusEl.setAttribute("role","status");
  replaceStatusEl.setAttribute("aria-live","polite");
  replaceStatusEl.hidden=true;

  const resultsRoot=document.createElement("div");
  resultsRoot.className="rte-project-results";
  resultsRoot.setAttribute("data-dirty-ignore","true");
  resultsRoot.setAttribute("aria-label","Результаты поиска по проекту");

  // A small, local, user-draggable vertical resizer -- no layout framework,
  // just a thin handle that adjusts resultsRoot's own explicit height on
  // pointer drag, clamped to a sensible range. Keyboard-operable too (arrow
  // keys nudge the height) since it's the kind of control a screen-reader
  // user could otherwise never operate.
  const resizer=document.createElement("div");
  resizer.className="rte-project-results-resizer";
  resizer.setAttribute("role","separator");
  resizer.setAttribute("aria-orientation","horizontal");
  resizer.setAttribute("aria-label","Изменить высоту результатов поиска");
  resizer.setAttribute("aria-valuemin",String(MIN_RESULTS_HEIGHT));
  resizer.setAttribute("aria-valuemax",String(MAX_RESULTS_HEIGHT));
  resizer.tabIndex=0;

  resultsWrapper.append(replaceStatusEl,resultsRoot,resizer);

  // Final D1 hardening pass (item 1): "Весь текст" wraps its toolbar+find/
  // replace panel in one shared .rte-sticky-controls element that stays
  // pinned to the top of the scrolling scene list (css/editor.css) -- manual
  // testing found the results pane scrolling away separately from that
  // sticky region felt broken ("the complete search UI should behave as one
  // sticky search region"). The FIRST corrective pass deliberately kept the
  // results wrapper OUTSIDE .rte-sticky-controls specifically because, at
  // the time, the results list had no bounded height at all (an unbounded
  // max-height:260px overflow risk) -- putting that inside the sticky region
  // could have grown it tall enough to cover the manuscript. That concern no
  // longer applies: the results pane now always has an explicit, JS-managed,
  // hard-capped height (DEFAULT/MIN/MAX_RESULTS_HEIGHT above), so it is safe
  // to make it part of the SAME sticky region as the toolbar/find-replace
  // row -- appending it as `.rte-sticky-controls`'s own last child means the
  // whole block (toolbar + controls + results + resizer) sticks and scrolls
  // as one unit, entirely through ordinary CSS layout (no extra JS): the
  // sticky element's own rendered height already includes this new child,
  // so find-replace-controller.js's existing stickyTopObstruction() (which
  // measures whatever height a `position:sticky` child currently has)
  // automatically accounts for it with no changes needed there, and
  // resizing the pane just changes that same height the same way.
  // textModal/sceneModal have no .rte-sticky-controls wrapper at all, so
  // they keep the EXISTING sibling-insertion behavior unchanged -- this is a
  // "Весь текст"-only layout change, never a general modal redesign.
  const stickyWrapper=container.closest(".rte-sticky-controls");
  if(stickyWrapper){
    stickyWrapper.appendChild(resultsWrapper);
  } else if(manuscriptRegion){
    // Stage E3.2.6: results/resizer become the manuscript's own sibling
    // INSIDE the bounded region, ahead of it -- `.rte-manuscript-region`'s
    // flex layout (css/editor.css) then does 100% of the "results grows,
    // manuscript shrinks by the same amount" work with zero further JS
    // needed here; this insertion point is the only thing that has to be
    // correct for that to happen.
    manuscriptRegion.insertBefore(resultsWrapper,manuscriptRegion.firstElementChild);
  } else if(container.parentElement){
    // Defensive fallback for a container not yet attached anywhere (never
    // true for the app's own real modals, which are always static HTML
    // already in the document) -- insertAdjacentElement requires a parent to
    // insert next to.
    container.insertAdjacentElement("afterend",resultsWrapper);
  } else {
    container.appendChild(resultsWrapper);
  }

  // Stage E3.2.6: on a bounded manuscript region (#sceneModal, and #textModal
  // as of E3.2.7), `.rte-manuscript-region` fixes the TOTAL results+
  // splitter+manuscript height -- so the results pane can never be dragged
  // taller than "region height minus the manuscript's own practical
  // minimum," or the manuscript would be forced below that floor (flexbox
  // never violates `min-height`; something would have to overflow instead).
  // `chromeOverhead` reads the resizer/replaceStatusEl/margin space
  // `resultsWrapper` uses beyond `resultsRoot` itself, straight from the
  // live layout, rather than hardcoding a second copy of those numbers here.
  // Falls back to the flat MAX_RESULTS_HEIGHT whenever there is no
  // manuscriptRegion (every other surface, unchanged) or at desktop widths
  // (desktop keeps its own existing, unrelated geometry).
  //
  // Stage E3.2.7 fix: `getBoundingClientRect()` never includes an element's
  // own MARGIN -- `resultsWrapper`'s `margin:0 -18px 10px` (10px bottom)
  // still consumes real space in the flex column (margins affect flex
  // layout even though they're outside the border box), but the previous
  // `chromeOverhead` calculation silently dropped it, letting results grow
  // 10px taller than the region could actually hold. The visible symptom:
  // at max results height, the manuscript's own bottom border/rounded
  // corners were clipped off by `.rte-manuscript-region{overflow:hidden}`
  // (E3.2.8 removed that clip entirely, and the results wrapper now also
  // yields via flex-shrink -- see css/editor.css's `.rte-manuscript-region`),
  // since editor+resultsWrapper's true combined footprint exceeded the
  // region by exactly that missing 10px. Reading the margin explicitly via
  // `getComputedStyle` (rather than hardcoding "10px" a second time) keeps
  // this correct if that margin value ever changes.
  function effectiveMaxResultsHeight(){
    if(!manuscriptRegion)return MAX_RESULTS_HEIGHT;
    if(typeof matchMedia!=="function"||!matchMedia("(max-width:760px)").matches)return MAX_RESULTS_HEIGHT;
    const regionHeight=manuscriptRegion.getBoundingClientRect().height;
    if(!regionHeight)return MAX_RESULTS_HEIGHT;
    const editorEl=manuscriptRegion.querySelector(".rte-editor");
    const editorMinHeight=editorEl?parseFloat(getComputedStyle(editorEl).minHeight)||MANUSCRIPT_MIN_HEIGHT:MANUSCRIPT_MIN_HEIGHT;
    const wrapperStyle=getComputedStyle(resultsWrapper);
    const wrapperMargin=parseFloat(wrapperStyle.marginTop)+parseFloat(wrapperStyle.marginBottom);
    const chromeOverhead=resultsWrapper.getBoundingClientRect().height+wrapperMargin-resultsRoot.getBoundingClientRect().height;
    const available=regionHeight-editorMinHeight-chromeOverhead;
    return Math.max(MIN_RESULTS_HEIGHT,Math.min(MAX_RESULTS_HEIGHT,available));
  }
  function clampResultsHeight(height){
    return Math.min(effectiveMaxResultsHeight(),Math.max(MIN_RESULTS_HEIGHT,height));
  }
  function setResultsHeight(height){
    const clamped=clampResultsHeight(height);
    resultsRoot.style.height=`${clamped}px`;
    resizer.setAttribute("aria-valuenow",String(Math.round(clamped)));
  }
  setResultsHeight(DEFAULT_RESULTS_HEIGHT);

  let resizePointerId=null,resizeStartY=0,resizeStartHeight=0;
  resizer.addEventListener("pointerdown",event=>{
    resizePointerId=event.pointerId;
    resizeStartY=event.clientY;
    resizeStartHeight=resultsRoot.getBoundingClientRect().height;
    resizer.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  resizer.addEventListener("pointermove",event=>{
    if(resizePointerId!==event.pointerId)return;
    setResultsHeight(resizeStartHeight+(event.clientY-resizeStartY));
  });
  function endResize(event){
    if(resizePointerId!==event.pointerId)return;
    resizePointerId=null;
  }
  resizer.addEventListener("pointerup",endResize);
  resizer.addEventListener("pointercancel",endResize);
  // Keyboard equivalent for the same drag gesture -- a pointer-only resizer
  // would be unusable via keyboard/screen reader (AGENTS.md's own
  // accessibility requirements for new controls).
  resizer.addEventListener("keydown",event=>{
    const step=24;
    if(event.key==="ArrowUp"){setResultsHeight(resultsRoot.getBoundingClientRect().height-step);event.preventDefault()}
    else if(event.key==="ArrowDown"){setResultsHeight(resultsRoot.getBoundingClientRect().height+step);event.preventDefault()}
  });

  findInput.addEventListener("input",()=>controller.setQuery(findInput.value));
  findInput.addEventListener("keydown",event=>{
    if(event.key!=="Enter")return;
    event.preventDefault();
    if(event.shiftKey)controller.previous();else controller.next();
  });
  replaceInput.addEventListener("input",()=>controller.setReplaceText(replaceInput.value));
  replaceInput.addEventListener("keydown",event=>{
    if(event.key!=="Enter")return;
    event.preventDefault();
    triggerReplaceOne();
  });
  prevButton.addEventListener("click",()=>controller.previous());
  nextButton.addEventListener("click",()=>controller.next());
  caseButton.addEventListener("click",()=>controller.setCaseSensitive(caseButton.getAttribute("aria-pressed")!=="true"));
  closeButton.addEventListener("click",()=>controller.close());
  // Find/Replace Stage D2.1: "Заменить" now does one of two genuinely
  // different things depending on scope -- scene-scope replaceCurrent()
  // (Stage C, unchanged) or project-scope replaceProjectCurrent() (this
  // stage, safe single Replace of the active GLOBAL match only). Both
  // controller functions already refuse to run under the wrong scope on
  // their own (belt-and-braces, never relied on alone) -- this dispatch is
  // just which one a click/Enter should even attempt.
  // Find/Replace Stage D2.2.1: "Заменить все" now ALSO does one of two
  // genuinely different things depending on scope -- scene-scope
  // replaceAll() (Stage C, unchanged) or project-scope replaceProjectAll()
  // (this stage -- the real, atomic, multi-scene commit). Both controller
  // functions already refuse to run under the wrong scope on their own, same
  // belt-and-braces discipline as replaceCurrent/replaceProjectCurrent
  // above.
  function triggerReplaceOne(){
    if(controller.getSnapshot().scope==="project")return handleProjectReplaceOne();
    controller.replaceCurrent();
  }
  function triggerReplaceAll(){
    if(controller.getSnapshot().scope==="project")return handleProjectReplaceAll();
    controller.replaceAll();
  }
  // A controlled failure (the active editor's target scene isn't actually
  // mounted here right now, or the match is stale) surfaces as the smallest
  // possible factual status line -- see replaceStatusEl's own doc comment
  // above. A success (changed or a no-op) shows nothing extra: the results
  // list/active match/summary already reflect it via the controller's own
  // fresh notify(), which is the existing, sufficient feedback mechanism.
  const REPLACE_FAILURE_MESSAGES={
    "no-active-editor":"Эта сцена сейчас не открыта для редактирования — замена отменена.",
    stale:"Совпадение больше не найдено в текущем тексте — замена отменена.",
    // Find/Replace Stage D2.2.1: Replace All's own failure reasons -- see
    // find-replace-controller.js's replaceProjectAll and find-replace-
    // project-replace-all.js's planProjectReplaceAll for exactly when each
    // one is returned. Never a fabricated replaced count on any of these --
    // the results list/summary simply keep showing whatever the last
    // successful search actually found.
    conflict:"У одной из сцен проекта найдено несколько открытых версий с разным текстом — замена по всему проекту отменена. Сохраните или закройте лишние открытые копии этой сцены и повторите поиск.",
    "persist-failed":"Не удалось сохранить замену по всему проекту. Изменения не применены.",
    // Find/Replace Stage D2.2.2: MAX_PROJECT_REPLACE_CONFIRM_ROUNDS
    // (find-replace-controller.js) exhausted -- the project kept changing
    // on every reconfirmation round. Never a real error, just an honest
    // "try again" -- zero writes happened.
    unstable:"Проект слишком часто менялся во время подтверждения замены — попробуйте ещё раз."
  };
  function handleProjectReplaceOne(){
    replaceStatusEl.hidden=true;replaceStatusEl.textContent="";
    const result=controller.replaceProjectCurrent();
    if(result.ok)return;
    replaceStatusEl.textContent=REPLACE_FAILURE_MESSAGES[result.reason]||"Замена не выполнена.";
    replaceStatusEl.hidden=false;
  }
  // Find/Replace Stage D2.2.1: async (the underlying commit may be a real
  // cloud round-trip) -- controller.getSnapshot() already reflects
  // projectReplaceAllInFlight the instant the awaited call starts (it calls
  // notify() synchronously before its own first `await`), so the button's
  // disabled state updates immediately via the existing subscribe() below,
  // with no separate busy-flag needed in this file.
  async function handleProjectReplaceAll(){
    replaceStatusEl.hidden=true;replaceStatusEl.textContent="";
    const result=await controller.replaceProjectAll();
    if(result.ok)return;
    if(result.reason==="in-flight")return; // a second click while already committing -- ignore, nothing new to report
    const message=result.reason==="persist-failed"&&result.error?.message
      ?result.error.message
      :REPLACE_FAILURE_MESSAGES[result.reason];
    replaceStatusEl.textContent=message||"Замена по всему проекту не выполнена.";
    replaceStatusEl.hidden=false;
  }
  replaceOneButton.addEventListener("click",triggerReplaceOne);
  replaceAllButton.addEventListener("click",triggerReplaceAll);
  sceneScopeButton.addEventListener("click",()=>controller.setScope("scene"));
  projectScopeButton.addEventListener("click",()=>controller.setScope("project"));

  // Dispatched by js/modal-manager.js's Escape handler, never fired by
  // anything inside this panel itself.
  container.addEventListener("find-replace-escape",()=>controller.close());

  // Rebuilds the project-results list from scratch on every relevant
  // snapshot -- simplest correct approach for a "practical first version"
  // (see docs/find-replace-architecture.md's own Stage D1 product brief,
  // section 6). Every piece of manuscript-derived text (scene/chapter
  // titles, snippet fragments) is set via `textContent`/`createElement`
  // only, NEVER `innerHTML` -- manuscript content can never be interpreted
  // as markup (product brief section 7).
  function renderProjectResults(snapshot){
    // Find/Replace Stage D2.1: any fresh render implies state has moved on
    // from whatever moment a Replace failure status (see replaceStatusEl
    // above) was showing -- clear it unconditionally here rather than
    // tracking every individual action that should dismiss it.
    replaceStatusEl.hidden=true;replaceStatusEl.textContent="";
    resultsRoot.innerHTML="";
    if(!snapshot.open||snapshot.scope!=="project"){resultsWrapper.hidden=true;return}
    resultsWrapper.hidden=false;
    // Stage E3.2.8: everything inside the results scrollport lives in ONE
    // shared scroll-content canvas (css/editor.css, `.rte-project-results-
    // canvas`): at least as wide as the visible scrollport, growing to fit
    // the widest row, with every row spanning the canvas -- so a short row's
    // border/background covers the whole horizontally-scrollable width, not
    // just its own text.
    const canvas=document.createElement("div");
    canvas.className="rte-project-results-canvas";
    resultsRoot.appendChild(canvas);
    if(!snapshot.query){
      const hint=document.createElement("div");
      hint.className="rte-project-results-hint";
      hint.textContent="Введите запрос, чтобы найти совпадения по всему проекту.";
      canvas.appendChild(hint);
      return;
    }
    const result=snapshot.projectResult;
    if(!result||!result.totalMatches){
      const hint=document.createElement("div");
      hint.className="rte-project-results-hint";
      hint.textContent="Совпадений не найдено.";
      canvas.appendChild(hint);
      return;
    }
    const summary=document.createElement("div");
    summary.className="rte-project-results-summary";
    // D1.1 follow-up: this summary is the GLOBAL project-search result --
    // total matches, TOTAL affected scenes, and (as a SUBSET clause of that
    // same affected-scene count, never an additive one) how many of them are
    // configured as not included in the general text. Identical on all three
    // surfaces (result.excludedSceneCount is surface-independent -- see
    // find-replace-project-search.js), unlike the arrow counter above, which
    // stays deliberately surface-relative.
    summary.textContent=
      `${result.totalMatches} ${pluralRu(result.totalMatches,"совпадение","совпадения","совпадений")} · `+
      `${result.affectedSceneCount} ${pluralRu(result.affectedSceneCount,"сцена","сцены","сцен")}`+
      excludedScenesClause(result.excludedSceneCount);
    canvas.appendChild(summary);

    result.scenes.forEach(sceneResult=>{
      const group=document.createElement("div");
      group.className="rte-project-result-group";
      const header=document.createElement("div");
      header.className="rte-project-result-scene-header";
      header.textContent=`${sceneResult.chapterTitle} · Сцена: ${sceneResult.sceneTitle}`;
      group.appendChild(header);
      sceneResult.matches.forEach(match=>{
        const row=document.createElement("button");
        row.type="button";
        row.className="rte-project-result-row";
        if(match.matchId===snapshot.activeProjectMatchId)row.classList.add("active");
        row.dataset.matchId=match.matchId;
        const before=document.createElement("span");
        before.className="rte-project-result-context";
        before.textContent=match.snippet.before;
        const highlight=document.createElement("mark");
        highlight.className="rte-project-result-match";
        highlight.textContent=match.snippet.match;
        const after=document.createElement("span");
        after.className="rte-project-result-context";
        after.textContent=match.snippet.after;
        row.append(before,highlight,after);
        row.addEventListener("click",()=>controller.activateProjectMatch(match.matchId));
        group.appendChild(row);
      });
      canvas.appendChild(group);
    });
  }

  let lastOpenSequence=-1;
  const unsubscribe=controller.subscribe(snapshot=>{
    container.hidden=!snapshot.open;
    renderProjectResults(snapshot);
    if(!snapshot.open)return;

    if(findInput.value!==snapshot.query)findInput.value=snapshot.query;
    if(replaceInput.value!==snapshot.replaceText)replaceInput.value=snapshot.replaceText;
    caseButton.setAttribute("aria-pressed",String(snapshot.caseSensitive));

    const isProjectScope=snapshot.scope==="project";
    sceneScopeButton.setAttribute("aria-checked",String(!isProjectScope));
    projectScopeButton.setAttribute("aria-checked",String(isProjectScope));
    sceneScopeButton.classList.toggle("active",!isProjectScope);
    projectScopeButton.classList.toggle("active",isProjectScope);

    if(isProjectScope){
      // D1.1 fix: the arrow counter's denominator is the CURRENT SURFACE's
      // own navigation domain (snapshot.navigableMatchCount -- exactly the
      // same domain Next/Previous already restrict themselves to, see
      // find-replace-controller.js's own snapshot()/navigableProjectMatches),
      // never the raw project-wide total -- the arrows were already scoped
      // to this domain (final D1 fix); this just makes the counter stop
      // claiming a reachability it never actually had.
      const domainTotal=snapshot.navigableMatchCount;
      countEl.textContent=domainTotal?`${snapshot.activeNavigableMatchIndex+1} из ${domainTotal}`:"0 из 0";
      const hasMatches=domainTotal>0;
      prevButton.disabled=!hasMatches;
      nextButton.disabled=!hasMatches;
      // Find/Replace Stage D2.1: "Заменить" now works in project scope --
      // it targets exactly the currently ACTIVE GLOBAL match (never
      // navigation-domain-restricted the way the arrows are -- an explicit
      // result-row click, like Next/Previous, can set the active match to
      // ANY project result, including an off-domain/excluded scene, and a
      // click on this button must be able to replace THAT one).
      //
      // Find/Replace Stage D2.1.4 (Finding 1): "an active global result
      // exists" is NOT enough to enable this button -- manual acceptance
      // found that exhausting the current scene's matches can leave the
      // active global result pointing at a scene nothing has navigated to,
      // and clicking Replace then only produced a silent, confusing refusal
      // (REPLACE_FAILURE_MESSAGES["no-active-editor"] below). The button
      // must already be disabled in that case; the user has to explicitly
      // navigate/open that result first (arrow, or a result-row click) --
      // see controller.js's resolveProjectReplaceTarget/
      // canReplaceProjectCurrent, the single source of truth this reads.
      replaceOneButton.disabled=!snapshot.projectReplaceEligible;
      replaceOneButton.title=snapshot.activeProjectMatchId!=null&&!snapshot.projectReplaceEligible
        ?REPLACE_FAILURE_MESSAGES["no-active-editor"]
        :"Заменить текущее совпадение по всему проекту";
      // Find/Replace Stage D2.2.1: "Заменить все" now works in project scope
      // too -- enabled whenever the current project search has at least one
      // match AND the environment actually has Replace All's atomic commit
      // wired (snapshot.projectReplaceAllEligible, the single source of
      // truth -- see find-replace-controller.js's own snapshot()), disabled
      // (with a distinct label/title) while a commit is already in flight so
      // a second click can never start an overlapping one.
      replaceAllButton.disabled=!snapshot.projectReplaceAllEligible;
      replaceAllButton.textContent=snapshot.projectReplaceAllInFlight?"Замена…":"Заменить все";
      replaceAllButton.title=snapshot.projectReplaceAllInFlight
        ?"Выполняется замена по всему проекту…"
        :"Заменить все совпадения по всему проекту";
    } else {
      countEl.textContent=snapshot.matchCount?`${snapshot.activeIndex+1} из ${snapshot.matchCount}`:"0 из 0";
      const hasMatches=snapshot.matchCount>0;
      prevButton.disabled=!hasMatches;
      nextButton.disabled=!hasMatches;
      replaceOneButton.disabled=snapshot.activeIndex<0;
      replaceAllButton.disabled=!hasMatches;
      // Restores the default label in case a project-scope Replace All
      // commit was still in flight (see the "Замена…" label above) at the
      // moment scope switched away from "Весь проект" -- that commit keeps
      // running in the background regardless of which scope the panel shows
      // now, but this button's own label must not stay stuck on it.
      replaceAllButton.textContent="Заменить все";
      replaceOneButton.title="Заменить текущее совпадение";
      replaceAllButton.title="Заменить все совпадения в этой сцене";
    }

    // Per-open() focus request, not a closed->open transition check -- see
    // find-replace-controller.js's own comment on why openSequence exists
    // (so pressing Ctrl+F/Ctrl+H again while already open still refocuses/
    // reselects the relevant input, matching ordinary browser/Word Find
    // behavior). Ctrl+F and Ctrl+H open the exact same panel/row now, but
    // still differ in which input gets focused -- snapshot.focusTarget is
    // the only thing left for them to usefully disagree on once both inputs
    // are always visible together.
    if(snapshot.openSequence!==lastOpenSequence){
      lastOpenSequence=snapshot.openSequence;
      const target=snapshot.focusTarget==="replace"?replaceInput:findInput;
      target.focus();
      target.select();
    }
  });

  return {
    destroy(){
      unsubscribe();
      container.innerHTML="";
      container.hidden=true;
      resultsWrapper.remove();
    }
  };
}
