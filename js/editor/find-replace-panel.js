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
export function createFindReplacePanel(container,controller){
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
  const resultsRoot=document.createElement("div");
  resultsRoot.className="rte-project-results";
  resultsRoot.hidden=true;
  resultsRoot.setAttribute("data-dirty-ignore","true");
  resultsRoot.setAttribute("aria-label","Результаты поиска по проекту");
  // "Весь текст" wraps its toolbar+find/replace panel in one shared
  // .rte-sticky-controls element that stays pinned to the top of the
  // scrolling scene list (css/editor.css) -- inserting the results list as
  // container's own sibling would make IT part of that sticky-pinned area
  // too, growing it tall enough to visually cover (and intercept pointer
  // events on) the manuscript underneath. Insert after the WHOLE sticky
  // wrapper instead, when one exists, so the results list sits in normal
  // (non-sticky) document flow right below the pinned controls. textModal/
  // sceneModal have no such wrapper, so this falls back to container's own
  // sibling position exactly as before for them.
  const stickyWrapper=container.closest(".rte-sticky-controls");
  const insertAfterElement=stickyWrapper||container;
  // Defensive fallback for a container not yet attached anywhere (never true
  // for the app's own real modals, which are always static HTML already in
  // the document) -- insertAdjacentElement requires a parent to insert next
  // to.
  if(insertAfterElement.parentElement)insertAfterElement.insertAdjacentElement("afterend",resultsRoot);
  else container.appendChild(resultsRoot);

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
    controller.replaceCurrent();
  });
  prevButton.addEventListener("click",()=>controller.previous());
  nextButton.addEventListener("click",()=>controller.next());
  caseButton.addEventListener("click",()=>controller.setCaseSensitive(caseButton.getAttribute("aria-pressed")!=="true"));
  closeButton.addEventListener("click",()=>controller.close());
  replaceOneButton.addEventListener("click",()=>controller.replaceCurrent());
  replaceAllButton.addEventListener("click",()=>controller.replaceAll());
  sceneScopeButton.addEventListener("click",()=>controller.setScope("scene"));
  projectScopeButton.addEventListener("click",()=>controller.setScope("project"));

  // Dispatched by js/modal-manager.js's Escape handler, never fired by
  // anything inside this panel itself.
  container.addEventListener("find-replace-escape",()=>controller.close());

  // Russian plural forms (совпадение/совпадения/совпадений,
  // сцена/сцены/сцен) -- standard mod-10/mod-100 rule, no library needed.
  function pluralRu(n,one,few,many){
    const mod10=n%10,mod100=n%100;
    if(mod10===1&&mod100!==11)return one;
    if(mod10>=2&&mod10<=4&&(mod100<12||mod100>14))return few;
    return many;
  }

  const PROJECT_SCOPE_REPLACE_TITLE="Замена по всему проекту будет доступна после подтверждения изменений";

  // Rebuilds the project-results list from scratch on every relevant
  // snapshot -- simplest correct approach for a "practical first version"
  // (see docs/find-replace-architecture.md's own Stage D1 product brief,
  // section 6). Every piece of manuscript-derived text (scene/chapter
  // titles, snippet fragments) is set via `textContent`/`createElement`
  // only, NEVER `innerHTML` -- manuscript content can never be interpreted
  // as markup (product brief section 7).
  function renderProjectResults(snapshot){
    resultsRoot.innerHTML="";
    if(!snapshot.open||snapshot.scope!=="project"){resultsRoot.hidden=true;return}
    resultsRoot.hidden=false;
    if(!snapshot.query){
      const hint=document.createElement("div");
      hint.className="rte-project-results-hint";
      hint.textContent="Введите запрос, чтобы найти совпадения по всему проекту.";
      resultsRoot.appendChild(hint);
      return;
    }
    const result=snapshot.projectResult;
    if(!result||!result.totalMatches){
      const hint=document.createElement("div");
      hint.className="rte-project-results-hint";
      hint.textContent="Совпадений не найдено.";
      resultsRoot.appendChild(hint);
      return;
    }
    const summary=document.createElement("div");
    summary.className="rte-project-results-summary";
    summary.textContent=`${result.totalMatches} ${pluralRu(result.totalMatches,"совпадение","совпадения","совпадений")} · `+
      `${result.affectedSceneCount} ${pluralRu(result.affectedSceneCount,"сцена","сцены","сцен")}`;
    resultsRoot.appendChild(summary);

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
      resultsRoot.appendChild(group);
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
      const total=snapshot.projectResult?.totalMatches||0;
      countEl.textContent=total?`${snapshot.activeProjectMatchIndex+1} из ${total}`:"0 из 0";
      const hasMatches=total>0;
      prevButton.disabled=!hasMatches;
      nextButton.disabled=!hasMatches;
      // Product brief section 1/14: project-scope replacement is not part of
      // D1 -- the Replace field stays visible and usable to type into, but
      // executing a replacement is unavailable, with an explanation rather
      // than a silently dead button.
      replaceOneButton.disabled=true;
      replaceAllButton.disabled=true;
      replaceOneButton.title=PROJECT_SCOPE_REPLACE_TITLE;
      replaceAllButton.title=PROJECT_SCOPE_REPLACE_TITLE;
    } else {
      countEl.textContent=snapshot.matchCount?`${snapshot.activeIndex+1} из ${snapshot.matchCount}`:"0 из 0";
      const hasMatches=snapshot.matchCount>0;
      prevButton.disabled=!hasMatches;
      nextButton.disabled=!hasMatches;
      replaceOneButton.disabled=snapshot.activeIndex<0;
      replaceAllButton.disabled=!hasMatches;
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
      resultsRoot.remove();
    }
  };
}
