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

Object.assign(globalThis,{multiValueInputs,createMultiValueCombobox});
export {multiValueInputs,createMultiValueCombobox};
