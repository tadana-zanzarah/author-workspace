import {normalizeMultiValue} from "./migrations.js";

const multiValueInputs={};

function createMultiValueCombobox({host,suggestions=[],values=[],placeholder="Добавить…",label="Значения",onChange=()=>{}}){
  let current=normalizeMultiValue(values),filtered=[],active=-1,open=false;
  const html=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const listId=`${host.id}-listbox`;
  host.innerHTML=`<div class="multi-value-chips"></div><div class="multi-value-control"><input type="text" role="combobox" aria-label="${label}" aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}" autocomplete="off" placeholder="${placeholder}"><button type="button" class="multi-value-toggle" aria-label="Открыть список: ${label}" tabindex="-1">▾</button></div><div id="${listId}" class="multi-value-list" role="listbox" hidden></div>`;
  const chips=host.querySelector(".multi-value-chips"),input=host.querySelector("input"),toggle=host.querySelector("button"),list=host.querySelector("[role=listbox]");
  const key=value=>value.toLocaleLowerCase("ru");
  const available=()=>suggestions.filter(option=>!current.some(value=>key(value)===key(option))&&key(option).includes(key(input.value.trim())));
  function close(){open=false;active=-1;list.hidden=true;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant")}
  function renderList(){
    const query=input.value.trim(),exact=suggestions.some(x=>key(x)===key(query))||current.some(x=>key(x)===key(query));
    filtered=available().map(value=>({value,label:value,custom:false}));
    if(query&&!exact)filtered.push({value:query,label:`Добавить «${query}»`,custom:true});
    list.innerHTML=filtered.map((item,index)=>`<div id="${listId}-${index}" role="option" aria-selected="${index===active}" data-index="${index}" class="${index===active?"active":""}">${html(item.label)}</div>`).join("");
    list.hidden=!open;input.setAttribute("aria-expanded",String(open));
    if(active>=0)input.setAttribute("aria-activedescendant",`${listId}-${active}`);else input.removeAttribute("aria-activedescendant");
  }
  function renderChips(){chips.innerHTML=current.map((value,index)=>`<span class="multi-value-chip"><span>${html(value)}</span><button type="button" data-remove="${index}" aria-label="Удалить значение «${html(value)}»">×</button></span>`).join("")}
  function show(){open=true;active=Math.min(active,available().length-1);renderList()}
  function changed(){renderChips();renderList();onChange([...current])}
  function add(value){const next=normalizeMultiValue([...current,value]);if(next.length===current.length)return false;current=next;input.value="";active=-1;open=true;changed();return true}
  input.addEventListener("focus",show);input.addEventListener("click",show);input.addEventListener("input",()=>{active=-1;show()});
  input.addEventListener("multi-value-close",close);
  toggle.addEventListener("click",()=>{open?close():show();input.focus()});
  list.addEventListener("mousedown",event=>event.preventDefault());
  list.addEventListener("click",event=>{const option=event.target.closest("[data-index]");if(option)add(filtered[Number(option.dataset.index)]?.value)});
  chips.addEventListener("click",event=>{const button=event.target.closest("[data-remove]");if(!button)return;current.splice(Number(button.dataset.remove),1);changed();input.focus()});
  input.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&open){event.preventDefault();event.stopImmediatePropagation();close();return}
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();if(!open)show();if(!filtered.length)return;
      active=(active+(event.key==="ArrowDown"?1:-1)+filtered.length)%filtered.length;renderList();return;
    }
    if(event.key==="Enter"){
      if(!open){event.preventDefault();show();return}
      const item=filtered[active>=0?active:(input.value.trim()?filtered.findIndex(x=>x.custom):-1)];
      if(item){event.preventDefault();add(item.value)}
    }
  });
  host.addEventListener("focusout",event=>{if(!host.contains(event.relatedTarget))close()});
  renderChips();close();
  return {getValues:()=>[...current],setValues(next){current=normalizeMultiValue(next);input.value="";close();renderChips()},open:show,close,input};
}

const singleValueInputs={};

// Single-choice-with-optional-custom-text control (race, build, profession…):
// an app-styled popover replacing the browser-native <datalist> suggestion UI,
// which on this app's fields wouldn't reliably reopen once a value was already
// picked. Deliberately thin compared to createMultiValueCombobox above: there
// are no chips, so the underlying <input>'s own value IS the field's value —
// callers keep reading/writing it exactly as a plain text input (el.value),
// this only adds the popover open/filter/keyboard layer on top.
function createSingleValueCombobox({host,input,toggle,list,suggestions=[],allowCustom=true}){
  let filtered=[],active=-1,open=false,typedQuery=null;
  const html=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const key=value=>value.toLocaleLowerCase("ru");
  function computeFiltered(){
    const query=(typedQuery==null?"":typedQuery).trim();
    const options=suggestions.filter(option=>!query||key(option).includes(key(query))).map(value=>({value,label:value,custom:false}));
    const exact=suggestions.some(option=>key(option)===key(query));
    if(allowCustom&&query&&!exact)options.push({value:query,label:`Добавить «${query}»`,custom:true});
    return options;
  }
  function close(){open=false;active=-1;list.hidden=true;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant")}
  function render(){
    filtered=computeFiltered();
    list.innerHTML=filtered.length?filtered.map((item,index)=>`<div id="${list.id}-${index}" role="option" aria-selected="${item.value===input.value}" data-index="${index}" class="${index===active?"active":""}">${html(item.label)}</div>`).join(""):`<div class="combobox-empty">Нет совпадений</div>`;
    list.hidden=!open;input.setAttribute("aria-expanded",String(open));
    if(active>=0&&filtered[active])input.setAttribute("aria-activedescendant",`${list.id}-${active}`);else input.removeAttribute("aria-activedescendant");
  }
  function show(){open=true;typedQuery=null;active=-1;render()}
  // Dispatch "change", not "input": this input's own "input" listener below
  // treats every input event as fresh typing and reopens the popover to
  // refilter — firing that here would immediately undo the close() above.
  // Dirty-state tracking listens for both event types, so "change" alone
  // still marks the form dirty.
  function select(value){input.value=value;close();input.dispatchEvent(new Event("change",{bubbles:true}));input.focus()}
  input.addEventListener("focus",show);
  input.addEventListener("click",show);
  input.addEventListener("input",()=>{typedQuery=input.value;active=-1;open=true;render()});
  // Modal manager's own Escape handling intercepts before this element's
  // keydown ever fires (it looks for any [role=combobox][aria-expanded=true]
  // inside the top modal and dispatches this event instead of letting Escape
  // bubble/close the modal) — see handleKeydown in modal-manager.js. The
  // multi-value combobox above relies on the same contract.
  input.addEventListener("multi-value-close",close);
  toggle?.addEventListener("click",()=>{open?close():show();input.focus()});
  list.addEventListener("mousedown",event=>event.preventDefault());
  list.addEventListener("click",event=>{const option=event.target.closest("[data-index]");if(option)select(filtered[Number(option.dataset.index)]?.value)});
  input.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&open){event.preventDefault();event.stopImmediatePropagation();close();return}
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      event.preventDefault();if(!open)show();if(!filtered.length)return;
      active=(active+(event.key==="ArrowDown"?1:-1)+filtered.length)%filtered.length;render();return;
    }
    if(event.key==="Enter"){
      if(!open){event.preventDefault();show();return}
      const item=active>=0?filtered[active]:(input.value.trim()?filtered.find(x=>x.custom):undefined);
      if(item){event.preventDefault();select(item.value)}
    }
  });
  host.addEventListener("focusout",event=>{if(!host.contains(event.relatedTarget))close()});
  close();
  return {refresh(){if(open)render()}};
}

Object.assign(globalThis,{multiValueInputs,createMultiValueCombobox,singleValueInputs,createSingleValueCombobox});
export {multiValueInputs,createMultiValueCombobox,singleValueInputs,createSingleValueCombobox};
