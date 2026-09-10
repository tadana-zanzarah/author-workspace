const modalStack=[];
// Find/Replace Stage C corrective pass: Ctrl+F/Ctrl+H interception moved
// here from separate per-surface bubble-phase listeners (js/app.js,
// js/scenes.js, js/import-export.js) after real-browser manual testing
// found the browser's own native Find/History still won. Root cause: those
// listeners were attached to each MODAL element in the ordinary bubble
// phase, relying on the keydown actually bubbling all the way up from
// whatever has focus -- correct in principle, but strictly WEAKER than the
// mechanism this file already uses (successfully) for Escape: one
// document-level, CAPTURE-phase listener that runs before anything else,
// gated on getTopModal() rather than on DOM position. Centralizing into that
// same already-proven pipeline is the fix, not a different kind of guess --
// see handleKeydown below. This registry is just the small addition needed
// to route it to the right modal's find-replace controller.
const findReplaceShortcuts=new Map(); // modalId -> {openFind,openReplace}
function registerFindReplaceShortcuts(modalId,handlers){findReplaceShortcuts.set(modalId,handlers)}
const focusableSelector='button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

function isVisible(element){
  if(!element||element.hidden||element.closest('[hidden]'))return false;
  const closedDetails=element.closest("details:not([open])");if(closedDetails&&element!==closedDetails.querySelector(":scope > summary"))return false;
  const style=getComputedStyle(element);
  return style.display!=="none"&&style.visibility!=="hidden"&&!!(element.offsetWidth||element.offsetHeight||element.getClientRects().length);
}

function getFocusableElements(modal){return modal?[...modal.querySelectorAll(focusableSelector)].filter(element=>isVisible(element)&&!element.closest('.modal-backdrop[aria-hidden="true"]')):[]}
function getTopModal(){return modalStack.at(-1)?.modal||null}

function focusKey(element){
  if(!element||element===document.body)return null;
  if(element.id)return {id:element.id};
  const scene=element.closest?.('[data-scene-id]');
  if(scene)return {sceneId:scene.dataset.sceneId,text:element.textContent.trim()};
  return null;
}

function resolveFocus(entry){
  if(entry.opener?.isConnected&&isVisible(entry.opener)&&!entry.opener.closest('[inert]'))return entry.opener;
  if(entry.openerKey?.id){const element=document.getElementById(entry.openerKey.id);if(element&&isVisible(element))return element}
  if(entry.openerKey?.sceneId){
    const escaped=CSS.escape(entry.openerKey.sceneId),candidates=[...document.querySelectorAll(`[data-scene-id="${escaped}"] button, [data-scene-id="${escaped}"][tabindex]`)];
    const matching=candidates.find(element=>element.textContent.trim()===entry.openerKey.text)||candidates[0];if(matching&&isVisible(matching))return matching;
  }
  if(entry.fallback?.isConnected&&isVisible(entry.fallback)&&!entry.fallback.closest('[inert]'))return entry.fallback;
  const lastFocus=modalStack.at(-1)?.lastFocus;
  if(lastFocus?.isConnected&&isVisible(lastFocus)&&!lastFocus.closest("[inert]"))return lastFocus;
  return getFocusableElements(getTopModal())[0]||document.getElementById("addFirst")||document.querySelector("summary,button,input,select,textarea");
}

// Modal/motion corrective pass, "wheel scroll leaks past the modal to the page behind it"
// finding: css/base.css's own comment says document scroll is this app's ONE deliberate main-
// content scroll surface (no fixed-height #app wrapper) -- so once .modal-backdrop's accidental
// overflow-y:auto bug was fixed (it could never legitimately be a scroll target; see that fix's
// own comment in css/modals.css), a wheel scroll landing anywhere over a modal that ISN'T its own
// inner scroll region has nowhere valid to consume it and chains straight past the modal to the
// document -- which, being genuinely taller than a short viewport by design, actually scrolls.
// Previously invisible only because the backdrop's OWN bug happened to (wrongly) absorb the event
// every time. `inert` above already makes the page behind non-interactive while a modal is open,
// but does not stop wheel-driven scroll chaining from reaching it -- a real, separate lock is
// needed. Toggled here (not scattered across openModal/forceCloseModal) since this is the one
// shared place that already runs on every stack change and already knows whether `top` exists.
function setBackgroundScrollLocked(locked){
  document.documentElement.style.overflow=locked?"hidden":"";
}

function syncLayers(){
  const top=getTopModal();
  [...document.body.children].forEach(element=>{
    if(element.classList.contains("modal-backdrop"))return;
    element.inert=!!top;
    if(top)element.setAttribute("aria-hidden","true");else element.removeAttribute("aria-hidden");
  });
  document.querySelectorAll(".modal-backdrop").forEach(modal=>{
    const active=modal===top;
    modal.setAttribute("aria-hidden",active?"false":"true");
    modal.inert=!active;
  });
  setBackgroundScrollLocked(!!top);
}

function initialFocus(modal,requested){
  const explicit=typeof requested==="string"?modal.querySelector(requested):requested;
  const target=explicit||modal.querySelector("[data-initial-focus]")||getFocusableElements(modal).find(element=>!element.classList.contains("danger"))||modal.querySelector(".modal");
  if(target){if(target.matches?.(".modal")&&!target.hasAttribute("tabindex"))target.tabIndex=-1;target.focus({preventScroll:true})}
}

// Modal/motion corrective pass, backdrop-exit "very bad flash... hurts the eyes" finding: the
// PREVIOUS fix here (animateModalReveal, a "luminance-recovery pulse" slapped onto the freshly-
// revealed PARENT the instant a nested child closed) failed real manual review -- it replaced one
// abrupt jump with a worse one: the pulse's own starting frame (synchronously as dark as the
// closing child's own resting tint, THEN easing back down) reads as a dark SNAP followed by a
// fade, i.e. exactly the "dark -> bright -> dark again -> bright" oscillation the task brief
// explicitly rules out, not a smooth continuous change. Deleted entirely, and the PARENT is never
// touched at all any more -- the fix instead makes the CLOSING modal actually fade out (see
// `.modal-backdrop--closing` in css/modals.css), reusing the SAME `transition:opacity 160ms ease,
// display 160ms allow-discrete` pair the base `.modal-backdrop` rule already uses for opening.
// Previously, forceCloseModal wrote `.style.display="none"` with no accompanying opacity change,
// so there was nothing for that transition to actually interpolate -- allow-discrete's own spec
// behavior (hold the old `display` value, fully rendered, until the transition's OTHER properties
// finish) meant the closing modal sat frozen on-screen for the full 160ms, then vanished in a
// single instant frame: a hang-then-pop, not a fade, and (for a nested close) the exact "flash"
// the manual review reported. Adding `--closing` (opacity:0) in the SAME synchronous turn as the
// display write gives that transition an actual value pair to animate, so the closing modal now
// visibly fades 1->0 over 160ms and only leaves the render tree once that finishes -- and for a
// nested close, this is ALSO the entire fix for the revealed parent: the parent's own steady dim
// was never touched, so as the child's compounding tint fades away on top of it, the combined
// scene brightness eases smoothly and monotonically down to "parent's dim only" with no separate
// pulse required. Never touches the synchronous close contract below (modalStack pop, tracker
// deactivate, focus restore all still happen in the same tick, unchanged) -- `--closing` is a
// purely cosmetic class with no logic reading it anywhere.
function openModal(modalId,options={}){
  const modal=document.getElementById(modalId);if(!modal)return null;
  // Defensive: reopening a modal while its own close fade from an earlier visit is still mid-
  // flight must not leave it stuck at opacity:0 -- see the removed animateModalReveal's own
  // comment for why this exact guard shape (clear before the visible-state write, not after).
  modal.classList.remove("modal-backdrop--closing");
  const current=modalStack.find(entry=>entry.modal===modal);
  if(current){modalStack.splice(modalStack.indexOf(current),1);modalStack.push(current)}
  else {const opener=options.opener||document.activeElement;modalStack.push({modal,opener,openerKey:focusKey(opener),fallback:opener?.closest?.("details")?.querySelector("summary")||null,lastFocus:null})}
  modal.style.display="flex";syncLayers();
  queueMicrotask(()=>initialFocus(modal,options.initialFocus));
  return modal;
}

function forceCloseModal(modalId,{restore=true}={}){
  const index=modalStack.findIndex(entry=>entry.modal.id===modalId),modal=document.getElementById(modalId);
  const entry=index>=0?modalStack[index]:null;
  if(index>=0)modalStack.splice(index,1);
  if(modal){modal.classList.add("modal-backdrop--closing");modal.style.display="none"}
  globalThis.trackerFor?.(modalId)?.deactivate();globalThis.syncBeforeUnload?.();syncLayers();
  if(restore&&entry)resolveFocus(entry)?.focus({preventScroll:true});
}

async function requestCloseModal(modalId=getTopModal()?.id,reason="close"){
  if(!modalId)return false;
  const modal=document.getElementById(modalId);if(modal?.dataset.closeBlocked==="true")return false;
  const tracker=globalThis.trackerFor?.(modalId);
  if(tracker?.isDirty()&&!await globalThis.showDiscardConfirmation?.())return false;
  forceCloseModal(modalId);return true;
}

let confirmActionResolve=null;
function showConfirmAction({title,description,confirmLabel="Удалить",cancelLabel="Отмена"}){
  const modal=document.getElementById("confirmActionModal");
  if(!modal)return Promise.resolve(false);
  document.getElementById("confirmActionTitle").textContent=title;
  document.getElementById("confirmActionDescription").textContent=description||"";
  const confirmBtn=document.getElementById("confirmActionConfirm");confirmBtn.textContent=confirmLabel;
  document.getElementById("confirmActionCancel").textContent=cancelLabel;
  openModal("confirmActionModal",{initialFocus:"#confirmActionCancel"});
  return new Promise(resolve=>{confirmActionResolve=resolve});
}
function resolveConfirmAction(confirmed){
  forceCloseModal("confirmActionModal");
  const resolve=confirmActionResolve;confirmActionResolve=null;if(resolve)resolve(confirmed);
}

function handleKeydown(event){
  const modal=getTopModal();if(!modal||event.defaultPrevented)return;
  // Find/Replace Stage C: intercept Ctrl+F/Ctrl+H (Cmd on Mac) as early as
  // this same document-capture-phase pipeline already reliably intercepts
  // Escape, for whichever modal is topmost AND has registered find/replace
  // handlers (registerFindReplaceShortcuts below) -- i.e. only while a
  // rich-text editing surface is genuinely the active/topmost context.
  // event.code (physical key position, "KeyF"/"KeyH") is checked instead of
  // event.key so this still works regardless of Cyrillic/other non-Latin
  // keyboard layouts, where event.key for the F/H position would not be "f"/
  // "h" at all. A modal with no registered handlers (every non-rich-text
  // modal) falls straight through untouched, and with no modal open at all
  // getTopModal() is null and this whole branch never runs -- so the browser
  // native Find/History/etc. are only ever pre-empted in the relevant
  // context, never elsewhere in the app.
  if((event.ctrlKey||event.metaKey)&&(event.code==="KeyF"||event.code==="KeyH")){
    const handlers=findReplaceShortcuts.get(modal.id);
    if(handlers){
      event.preventDefault();event.stopImmediatePropagation();
      if(event.code==="KeyF")handlers.openFind?.();else handlers.openReplace?.();
    }
    return;
  }
  if(event.key==="Escape"){
    if(event.target instanceof HTMLSelectElement)return;
    const expanded=modal.querySelector('[role="combobox"][aria-expanded="true"]');
    if(expanded){event.preventDefault();event.stopImmediatePropagation();expanded.dispatchEvent(new CustomEvent("multi-value-close"));return}
    // Find/Replace Stage C: same "something nested inside this modal wants
    // Escape for itself first" idiom as the open-combobox case just above --
    // an open Find/Replace panel (js/editor/find-replace-panel.js) consumes
    // this Escape to close ITSELF, leaving the parent modal open; a SECOND
    // Escape press (panel now hidden, so this query no longer matches) then
    // falls through to the normal modal-close branch below.
    const findReplaceOpen=modal.querySelector(".rte-find-replace:not([hidden])");
    if(findReplaceOpen){event.preventDefault();event.stopImmediatePropagation();findReplaceOpen.dispatchEvent(new CustomEvent("find-replace-escape"));return}
    event.preventDefault();event.stopImmediatePropagation();
    if(modal.id==="discardChangesModal")globalThis.resolveDiscardConfirmation?.(false);
    else if(modal.id==="confirmActionModal")resolveConfirmAction(false);
    else requestCloseModal(modal.id,"escape");
    return;
  }
  if(event.key!=="Tab")return;
  const focusable=getFocusableElements(modal);
  if(!focusable.length){event.preventDefault();modal.querySelector(".modal")?.focus();return}
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){event.preventDefault();first.focus()}
}

function rememberFocus(event){const entry=modalStack.at(-1);if(entry&&entry.modal.contains(event.target))entry.lastFocus=event.target}

if(typeof document!=="undefined"){
  document.querySelectorAll(".modal-backdrop").forEach(modal=>modal.setAttribute("aria-hidden","true"));
  document.addEventListener("keydown",handleKeydown,true);document.addEventListener("focusin",rememberFocus,true);
}

Object.assign(globalThis,{modalStack,openModal,showModal:openModal,requestCloseModal,forceCloseModal,getTopModal,getFocusableElements,showConfirmAction,resolveConfirmAction,registerFindReplaceShortcuts});
export {openModal,requestCloseModal,forceCloseModal,getTopModal,getFocusableElements,showConfirmAction,resolveConfirmAction,registerFindReplaceShortcuts};
