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
export function createFindReplacePanel(container,controller){
  container.innerHTML="";
  container.classList.add("rte-find-replace");
  container.hidden=true;
  container.setAttribute("data-dirty-ignore","true");
  container.setAttribute("aria-label","Найти и заменить");

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

  container.append(findInput,countEl,prevButton,nextButton,replaceInput,replaceOneButton,replaceAllButton,caseButton,closeButton);

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

  // Dispatched by js/modal-manager.js's Escape handler, never fired by
  // anything inside this panel itself.
  container.addEventListener("find-replace-escape",()=>controller.close());

  let lastOpenSequence=-1;
  const unsubscribe=controller.subscribe(snapshot=>{
    container.hidden=!snapshot.open;
    if(!snapshot.open)return;

    if(findInput.value!==snapshot.query)findInput.value=snapshot.query;
    if(replaceInput.value!==snapshot.replaceText)replaceInput.value=snapshot.replaceText;
    caseButton.setAttribute("aria-pressed",String(snapshot.caseSensitive));

    countEl.textContent=snapshot.matchCount?`${snapshot.activeIndex+1} из ${snapshot.matchCount}`:"0 из 0";

    const hasMatches=snapshot.matchCount>0;
    prevButton.disabled=!hasMatches;
    nextButton.disabled=!hasMatches;
    replaceOneButton.disabled=snapshot.activeIndex<0;
    replaceAllButton.disabled=!hasMatches;

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
    }
  };
}
