const modalStack=[];
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
}

function initialFocus(modal,requested){
  const explicit=typeof requested==="string"?modal.querySelector(requested):requested;
  const target=explicit||modal.querySelector("[data-initial-focus]")||getFocusableElements(modal).find(element=>!element.classList.contains("danger"))||modal.querySelector(".modal");
  if(target){if(target.matches?.(".modal")&&!target.hasAttribute("tabindex"))target.tabIndex=-1;target.focus({preventScroll:true})}
}

function openModal(modalId,options={}){
  const modal=document.getElementById(modalId);if(!modal)return null;
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
  if(modal)modal.style.display="none";
  globalThis.trackerFor?.(modalId)?.deactivate();globalThis.syncBeforeUnload?.();syncLayers();
  const topEntry=modalStack.at(-1);
  if(topEntry){topEntry.modal.inert=false;topEntry.modal.setAttribute("aria-hidden","false")}
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
  if(event.key==="Escape"){
    if(event.target instanceof HTMLSelectElement)return;
    const expanded=modal.querySelector('[role="combobox"][aria-expanded="true"]');
    if(expanded){event.preventDefault();event.stopImmediatePropagation();expanded.dispatchEvent(new CustomEvent("multi-value-close"));return}
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

Object.assign(globalThis,{modalStack,openModal,showModal:openModal,requestCloseModal,forceCloseModal,getTopModal,getFocusableElements,showConfirmAction,resolveConfirmAction});
export {openModal,requestCloseModal,forceCloseModal,getTopModal,getFocusableElements,showConfirmAction,resolveConfirmAction};
