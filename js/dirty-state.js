const dirtyTrackers=new Map();
const saveButtonControllers=new Set();
let discardResolve=null;

function normalizeSnapshot(value,seen=new WeakSet()){
  if(value===null||value===undefined||typeof value==="string"||typeof value==="number"||typeof value==="boolean")return value;
  if(value instanceof Date)return value.toISOString();
  if(typeof File!=="undefined"&&value instanceof File)return {name:value.name,size:value.size,type:value.type,lastModified:value.lastModified};
  if(typeof value!=="object")return String(value);
  if(seen.has(value))throw new TypeError("Dirty snapshot must not contain cycles");
  seen.add(value);
  if(Array.isArray(value))return value.map(item=>normalizeSnapshot(item,seen));
  const result={};
  Object.keys(value).filter(key=>key!=="__proto__"&&key!=="prototype"&&key!=="constructor").sort().forEach(key=>{result[key]=normalizeSnapshot(value[key],seen)});
  return result;
}

function normalizedEqual(left,right){return JSON.stringify(normalizeSnapshot(left))===JSON.stringify(normalizeSnapshot(right))}

function syncBeforeUnload(){
  if(typeof window==="undefined")return;
  const needed=[...dirtyTrackers.values()].some(tracker=>tracker.active&&tracker.isDirty());
  if(needed&&!window.__dirtyBeforeUnload){window.addEventListener("beforeunload",handleBeforeUnload);window.__dirtyBeforeUnload=true}
  if(!needed&&window.__dirtyBeforeUnload){window.removeEventListener("beforeunload",handleBeforeUnload);window.__dirtyBeforeUnload=false}
  saveButtonControllers.forEach(controller=>controller.refresh());
}

function handleBeforeUnload(event){if(!hasDirtyForms())return;event.preventDefault();event.returnValue=""}

function createDirtyTracker(id,getState){
  let baseline=normalizeSnapshot(getState()),active=false;
  const tracker={
    id,getState,
    captureInitialState(){baseline=normalizeSnapshot(getState());active=true;syncBeforeUnload();return baseline},
    isDirty(){return active&&!normalizedEqual(baseline,getState())},
    resetDirty(){baseline=normalizeSnapshot(getState());active=false;syncBeforeUnload()},
    deactivate(){active=false;syncBeforeUnload()},
    get active(){return active}
  };
  dirtyTrackers.set(id,tracker);return tracker;
}

function trackerFor(modalId){return dirtyTrackers.get(modalId)}
function hasDirtyForms(){return [...dirtyTrackers.values()].some(tracker=>tracker.isDirty())}

function createSaveButtonController(buttonId,modalId,{savingLabel="Сохранение…",statusId=null}={}){
  const button=document.getElementById(buttonId);
  const statusEl=statusId?document.getElementById(statusId):null;
  const idleLabel=button?.textContent||"";
  let saving=false;
  const refresh=(clearStatusIfDirty=true)=>{
    if(!button)return;
    if(saving){button.disabled=true;button.textContent=savingLabel;return}
    button.textContent=idleLabel;
    const dirty=!!trackerFor(modalId)?.isDirty();
    button.disabled=!dirty;
    if(statusEl&&dirty&&clearStatusIfDirty){statusEl.textContent="";statusEl.className="save-status"}
  };
  const controller={
    refresh,get saving(){return saving},
    beginSaving(){saving=true;if(statusEl){statusEl.textContent="";statusEl.className="save-status"}refresh()},
    endSaving(){saving=false;refresh(false)},
    showStatus(message,type="success"){if(statusEl){statusEl.textContent=message;statusEl.className=`save-status ${type}`}}
  };
  saveButtonControllers.add(controller);
  return controller;
}

function forceHideModal(modalId){
  if(globalThis.forceCloseModal){globalThis.forceCloseModal(modalId);return}
  const modal=document.getElementById(modalId);if(modal)modal.style.display="none";
  trackerFor(modalId)?.deactivate();syncBeforeUnload();
}

function showDiscardConfirmation(){
  const modal=document.getElementById("discardChangesModal");
  if(!modal)return Promise.resolve(false);
  if(globalThis.openModal)globalThis.openModal("discardChangesModal",{initialFocus:"#continueEditing"});else modal.style.display="flex";
  return new Promise(resolve=>{discardResolve=resolve});
}

function resolveDiscardConfirmation(discard){
  if(globalThis.forceCloseModal)globalThis.forceCloseModal("discardChangesModal");else document.getElementById("discardChangesModal").style.display="none";
  const resolve=discardResolve;discardResolve=null;if(resolve)resolve(discard);
}

async function confirmDiscardIfDirty(modalId){
  const tracker=trackerFor(modalId);
  if(!tracker?.isDirty())return true;
  return showDiscardConfirmation();
}

async function requestCloseModal(modalId,reason="close"){
  if(globalThis.openModal&&globalThis.requestCloseModal!==requestCloseModal)return globalThis.requestCloseModal(modalId,reason);
  if(!(await confirmDiscardIfDirty(modalId)))return false;
  forceHideModal(modalId);return true;
}

async function requestEditorTransition(openAction){
  const visible=[...dirtyTrackers.values()].find(tracker=>tracker.active&&document.getElementById(tracker.id)?.style.display==="flex");
  if(visible&&!(await requestCloseModal(visible.id,"switch")))return false;
  openAction();return true;
}

function serializeForm(root,extra={}){
  if(typeof root==="string")root=document.getElementById(root);
  const controls=[...(root?.querySelectorAll("input,select,textarea")||[])].filter(el=>el.type!=="file").map((el,index)=>({
    key:el.id||el.name||`${el.className}:${el.dataset.id||el.dataset.draftId||el.dataset.charId||""}:${el.dataset.targetId||""}:${index}`,
    value:el.type==="checkbox"||el.type==="radio"?!!el.checked:el.value,
    explicit:el.dataset.explicit
  }));
  return {controls,extra};
}

if(typeof document!=="undefined"){
  document.addEventListener("input",syncBeforeUnload,true);document.addEventListener("change",syncBeforeUnload,true);
}

Object.assign(globalThis,{dirtyTrackers,createDirtyTracker,trackerFor,hasDirtyForms,forceHideModal,requestCloseModal,requestEditorTransition,confirmDiscardIfDirty,showDiscardConfirmation,resolveDiscardConfirmation,serializeForm,syncBeforeUnload,createSaveButtonController});
export {createDirtyTracker,normalizedEqual,trackerFor,hasDirtyForms,forceHideModal,requestCloseModal,requestEditorTransition,confirmDiscardIfDirty,resolveDiscardConfirmation,serializeForm,syncBeforeUnload,createSaveButtonController};
