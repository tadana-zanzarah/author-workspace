// Custom accessible listbox/popover filter controls for the filter bar.
//
// Native <select> was replaced here for two independent reasons (see the local
// review notes this module answers):
//  1. Every <option> used to repeat its own filter category in its label
//     ("Персонаж: Зейн") because a native <select>'s closed box can only ever
//     show the selected OPTION's own text — there is no separate place to put
//     a "this is the Персонаж filter" hint. A custom trigger can show a plain
//     category label when empty and the bare value when selected instead.
//  2. The open <option> list is painted by the OS/browser, including its
//     selection highlight — that highlight cannot be reliably recolored away
//     from system blue across browsers, which was clashing with the app's
//     warm palette. A custom popover paints its own options and never hits
//     that limitation.
// Character/tag also need real multi-select (AND semantics, several chips at
// once), which a native <select multiple> cannot present compactly either.

const FILTER_FIELDS=[
  {key:"chapter",suffix:"Chapter",label:"Глава",multi:false,items:()=>data.chapters.map(c=>({value:c.id,label:c.title}))},
  {key:"character",suffix:"Character",label:"Персонаж",multi:true,items:()=>data.characters.map(c=>({value:c.id,label:c.name}))},
  {key:"location",suffix:"Location",label:"Локация",multi:false,items:()=>data.locations.map(l=>({value:l.id,label:l.name}))},
  {key:"tag",suffix:"Tag",label:"Тег",multi:true,items:()=>data.tags.map(t=>({value:t.id,label:"#"+t.name}))},
  {key:"writing",suffix:"Writing",label:"Написание",multi:false,items:()=>WRITING_STATUSES.map(s=>({value:s.id,label:s.label}))},
  {key:"placement",suffix:"Placement",label:"Расположение",multi:false,items:()=>[{value:"fixed",label:"На своём месте"},{value:"floating",label:"Нужно разместить"}]}
];
const MAX_INLINE_CHIPS=2;

let openFilterKey=null;
let outsideClickHandler=null;

function fieldConfig(key){return FILTER_FIELDS.find(f=>f.key===key)}
function fieldEls(field){
  return {
    control:document.getElementById("filter"+field.suffix),
    popover:document.getElementById("filter"+field.suffix+"Popover"),
    list:document.getElementById("filter"+field.suffix+"List")
  };
}

function itemLabel(field,value){
  return field.items().find(i=>i.value===value)?.label||"";
}

// ---- Closed (trigger) state ------------------------------------------------

function renderTrigger(field){
  const {control}=fieldEls(field);
  if(!control)return;
  const selected=filterValues(field.key);
  const hasValue=selected.length>0;
  control.closest(".filter-field")?.classList.toggle("filter-active",hasValue);
  if(!field.multi){
    control.textContent="";
    const text=document.createElement("span");
    text.className="filter-trigger-text";
    text.textContent=hasValue?itemLabel(field,selected[0]):field.label;
    const caret=document.createElement("span");
    caret.className="filter-trigger-caret";caret.setAttribute("aria-hidden","true");caret.textContent="▾";
    control.append(text,caret);
    control.setAttribute("aria-expanded",String(openFilterKey===field.key));
    control.setAttribute("aria-label",hasValue?`${field.label}: ${itemLabel(field,selected[0])}`:field.label);
    control.setAttribute("aria-controls","filter"+field.suffix+"List");
    return;
  }
  // Multi-value: real removable chips + a small trigger to open/add.
  control.innerHTML="";
  const shown=selected.slice(0,MAX_INLINE_CHIPS);
  const restCount=selected.length-shown.length;
  shown.forEach(value=>{
    const chip=document.createElement("span");
    chip.className="filter-trigger-chip";
    const label=document.createElement("span");
    label.textContent=itemLabel(field,value);
    const remove=document.createElement("button");
    remove.type="button";remove.className="filter-trigger-chip-remove";
    remove.setAttribute("aria-label",`Убрать «${itemLabel(field,value)}» из фильтра «${field.label}»`);
    remove.textContent="×";
    remove.dataset.filterKey=field.key;remove.dataset.value=value;
    chip.append(label,remove);
    control.appendChild(chip);
  });
  if(restCount>0){
    const more=document.createElement("button");
    more.type="button";more.className="filter-trigger-more";
    more.textContent=`+${restCount}`;
    more.setAttribute("aria-label",`Показать все выбранные значения фильтра «${field.label}» (ещё ${restCount})`);
    more.dataset.filterKey=field.key;more.dataset.action="open";
    control.appendChild(more);
  }
  const trigger=document.createElement("button");
  trigger.type="button";trigger.className="filter-multi-trigger";
  trigger.setAttribute("aria-haspopup","listbox");
  trigger.setAttribute("aria-expanded",String(openFilterKey===field.key));
  trigger.setAttribute("aria-controls","filter"+field.suffix+"List");
  trigger.setAttribute("aria-label",hasValue?`Изменить фильтр «${field.label}»`:field.label);
  trigger.dataset.filterKey=field.key;trigger.dataset.action="open";
  if(!hasValue){
    const text=document.createElement("span");
    text.className="filter-trigger-text";text.textContent=field.label;
    trigger.appendChild(text);
  }else{
    const caret=document.createElement("span");
    caret.className="filter-trigger-caret";caret.setAttribute("aria-hidden","true");caret.textContent="▾";
    trigger.appendChild(caret);
  }
  control.appendChild(trigger);
}

function renderAllFilterTriggers(){FILTER_FIELDS.forEach(renderTrigger)}

// ---- Popover / listbox ------------------------------------------------

function buildOptionRow(field,item){
  const li=document.createElement("li");
  li.setAttribute("role","option");
  li.dataset.value=item.value;
  li.tabIndex=-1;
  li.className="filter-option";
  const selected=filterValues(field.key).includes(item.value);
  li.setAttribute("aria-selected",String(selected));
  if(field.multi){
    const box=document.createElement("input");
    box.type="checkbox";box.className="filter-option-check";box.checked=selected;
    box.tabIndex=-1;box.setAttribute("aria-hidden","true");
    li.appendChild(box);
  }else{
    const mark=document.createElement("span");
    mark.className="filter-option-mark";mark.setAttribute("aria-hidden","true");mark.textContent=selected?"✓":"";
    li.appendChild(mark);
  }
  const label=document.createElement("span");
  label.className="filter-option-label";label.textContent=item.label;
  li.appendChild(label);
  return li;
}

function syncClearHeader(field){
  const clearBtn=document.querySelector(`.filter-popover-clear[data-clear-filter-key="${field.key}"]`);
  if(clearBtn)clearBtn.disabled=filterValues(field.key).length===0;
}

function buildListContent(field,list){
  list.innerHTML="";
  if(!field.multi){
    const allLi=document.createElement("li");
    allLi.setAttribute("role","option");allLi.dataset.value="";allLi.tabIndex=-1;
    allLi.className="filter-option filter-option-all";
    allLi.setAttribute("aria-selected",String(!filters[field.key]));
    allLi.textContent="Все";
    list.appendChild(allLi);
  }else{
    syncClearHeader(field);
  }
  field.items().forEach(item=>list.appendChild(buildOptionRow(field,item)));
}

// Sync selected/checked state on already-built rows without recreating them,
// so a popover open during a re-render (e.g. after toggling a value) keeps its
// DOM nodes and keyboard focus intact instead of losing both on every click.
function syncListSelection(field,list){
  if(field.multi)syncClearHeader(field);
  const selected=filterValues(field.key);
  list.querySelectorAll('[role="option"]').forEach(li=>{
    const value=li.dataset.value;
    const isSelected=field.multi?selected.includes(value):(value===""?!filters[field.key]:filters[field.key]===value);
    li.setAttribute("aria-selected",String(isSelected));
    const box=li.querySelector(".filter-option-check");
    if(box)box.checked=isSelected;
    const mark=li.querySelector(".filter-option-mark");
    if(mark)mark.textContent=isSelected?"✓":"";
  });
}

function setActiveOption(list,li){
  list.querySelectorAll('[role="option"]').forEach(el=>el.tabIndex=-1);
  if(!li)return;
  li.tabIndex=0;
  li.focus();
  li.scrollIntoView({block:"nearest"});
}

function activateOption(field,li){
  const value=li.dataset.value;
  if(field.multi){
    toggleFilterValue(field.key,value);
    syncListSelection(field,fieldEls(field).list);
    renderTrigger(field);
  }else{
    filters[field.key]=value===""?"":(filters[field.key]===value?"":value);
    scheduleRender();
    closeFilterPopover();
  }
}

function moveActiveOption(list,delta){
  const options=[...list.querySelectorAll('[role="option"]')];
  if(!options.length)return;
  const currentIndex=options.findIndex(o=>o.tabIndex===0);
  let next=currentIndex+delta;
  if(next<0)next=options.length-1;
  if(next>=options.length)next=0;
  setActiveOption(list,options[next]);
}

function listKeyHandler(field){
  return event=>{
    const {list}=fieldEls(field);
    if(event.key==="ArrowDown"){event.preventDefault();moveActiveOption(list,1);return}
    if(event.key==="ArrowUp"){event.preventDefault();moveActiveOption(list,-1);return}
    if(event.key==="Home"){event.preventDefault();setActiveOption(list,list.querySelector('[role="option"]'));return}
    if(event.key==="End"){event.preventDefault();const opts=list.querySelectorAll('[role="option"]');setActiveOption(list,opts[opts.length-1]);return}
    if(event.key==="Enter"||event.key===" "){
      event.preventDefault();
      const active=list.querySelector('[role="option"][tabindex="0"]');
      if(active)activateOption(field,active);
      return;
    }
    if(event.key==="Escape"){event.preventDefault();closeFilterPopover();return}
    if(event.key==="Tab"){closeFilterPopover({restoreFocus:false})}
  };
}

function openFilterPopover(key){
  const field=fieldConfig(key);
  if(!field)return;
  if(openFilterKey===key)return;
  if(openFilterKey)closeFilterPopover({restoreFocus:false});
  const {popover,list}=fieldEls(field);
  if(!popover||!list)return;
  buildListContent(field,list);
  popover.hidden=false;
  openFilterKey=key;
  renderTrigger(field);
  const options=[...list.querySelectorAll('[role="option"]')];
  const selected=filterValues(field.key);
  const preferred=field.multi
    ?options.find(o=>selected.includes(o.dataset.value))
    :options.find(o=>(o.dataset.value||"")===(filters[key]||""));
  setActiveOption(list,preferred||options[0]);
  if(!outsideClickHandler){
    outsideClickHandler=event=>{
      if(!openFilterKey)return;
      const openField=fieldConfig(openFilterKey);
      const container=document.getElementById("filter"+openField.suffix)?.closest(".filter-dropdown");
      if(container&&!container.contains(event.target))closeFilterPopover();
    };
    document.addEventListener("pointerdown",outsideClickHandler,true);
  }
}

function closeFilterPopover({restoreFocus=true}={}){
  if(!openFilterKey)return;
  const field=fieldConfig(openFilterKey);
  const {control,popover}=fieldEls(field);
  if(popover)popover.hidden=true;
  openFilterKey=null;
  renderTrigger(field);
  if(restoreFocus){
    const focusTarget=field.multi?control?.querySelector(".filter-multi-trigger"):control;
    focusTarget?.focus();
  }
}

function toggleFilterPopover(key){
  if(openFilterKey===key)closeFilterPopover();
  else openFilterPopover(key);
}

// ---- Wiring & full-render sync ------------------------------------------------

function refreshFilterControls(){
  FILTER_FIELDS.forEach(field=>{
    const wasFocusInside=fieldEls(field).control?.contains(document.activeElement);
    renderTrigger(field);
    if(wasFocusInside&&document.activeElement===document.body){
      const {control}=fieldEls(field);
      (field.multi?control?.querySelector(".filter-multi-trigger"):control)?.focus();
    }
    if(openFilterKey===field.key){
      const {list}=fieldEls(field);
      if(list)syncListSelection(field,list);
    }
  });
}

function initFilterControls(){
  FILTER_FIELDS.forEach(field=>{
    const {control}=fieldEls(field);
    if(!control)return;
    if(field.multi){
      // Any click on the control that isn't a chip's own × removes-this-value
      // button opens/adds — including empty space in the row and the chip's own
      // label text, not just the trailing trigger — so the whole control reads as
      // one "click here to change this filter" surface.
      control.addEventListener("click",event=>{
        const removeBtn=event.target.closest(".filter-trigger-chip-remove");
        if(removeBtn){
          event.stopPropagation();
          toggleFilterValue(field.key,removeBtn.dataset.value);
          renderTrigger(field);
          if(openFilterKey===field.key)syncListSelection(field,fieldEls(field).list);
          return;
        }
        toggleFilterPopover(field.key);
      });
    }else{
      control.addEventListener("click",()=>toggleFilterPopover(field.key));
      control.addEventListener("keydown",event=>{
        if((event.key==="ArrowDown"||event.key==="Enter"||event.key===" ")&&openFilterKey!==field.key){
          event.preventDefault();openFilterPopover(field.key);
        }
      });
    }
    // Wired once here (not inside openFilterPopover, which runs on every open) —
    // the <ul> element itself persists across opens/closes, so re-attaching on
    // every open would stack duplicate listeners and fire each click/keypress
    // once per stacked listener (a multi-select toggle firing twice per click is
    // a silent no-op: add then immediately remove the same value).
    const {list}=fieldEls(field);
    if(list){
      list.addEventListener("keydown",listKeyHandler(field));
      list.addEventListener("click",event=>{
        const li=event.target.closest('[role="option"]');
        if(li)activateOption(field,li);
      });
    }
  });
  document.querySelectorAll(".filter-popover-clear").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const key=btn.dataset.clearFilterKey;
      clearFilterKey(key);
      const field=fieldConfig(key);
      renderTrigger(field);
      if(openFilterKey===key)syncListSelection(field,fieldEls(field).list);
    });
  });
}

Object.assign(globalThis,{initFilterControls,refreshFilterControls,openFilterPopover,closeFilterPopover});
export {initFilterControls,refreshFilterControls,openFilterPopover,closeFilterPopover};
