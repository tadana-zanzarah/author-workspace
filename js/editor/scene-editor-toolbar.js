import {sceneDocSchema as schema} from "./scene-doc-schema.js";
import {toggleBold,toggleItalic,toggleStrike,setAlign,alignActive,insertSceneBreak,insertPovText,undo,redo} from "./scene-editor-commands.js";

function markActive(state,markType){
  const {from,to,empty,$from}=state.selection;
  if(empty)return !!markType.isInSet(state.storedMarks||$from.marks());
  return state.doc.rangeHasMark(from,to,markType);
}

function escapeHtml(s=""){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function characterDisplayName(character){
  return [character?.name,character?.surname].filter(Boolean).join(" ").trim();
}

// One flat command list -- toolbar buttons and keyboard shortcuts both end up
// calling the same functions from scene-editor-commands.js, never separate logic.
const BUTTONS=[
  {cmd:"bold",label:"Ж",className:"rte-btn-bold",title:"Полужирный (Ctrl+B)",run:toggleBold,active:state=>markActive(state,schema.marks.strong)},
  {cmd:"italic",label:"К",className:"rte-btn-italic",title:"Курсив (Ctrl+I)",run:toggleItalic,active:state=>markActive(state,schema.marks.em)},
  {cmd:"strike",label:"З",className:"rte-btn-strike",title:"Зачёркнутый",run:toggleStrike,active:state=>markActive(state,schema.marks.strike)},
  {sep:true},
  {cmd:"align-left",label:"Слева",title:"Выравнивание по левому краю",run:setAlign("left"),active:state=>alignActive(state,"left")},
  {cmd:"align-center",label:"Центр",title:"Выравнивание по центру",run:setAlign("center"),active:state=>alignActive(state,"center")},
  {cmd:"align-right",label:"Справа",title:"Выравнивание по правому краю",run:setAlign("right"),active:state=>alignActive(state,"right")},
  {sep:true},
  {cmd:"undo",label:"↶ Отменить",title:"Отменить (Ctrl+Z)",run:undo,checkEnabled:true},
  {cmd:"redo",label:"↷ Повторить",title:"Повторить (Ctrl+Shift+Z)",run:redo,checkEnabled:true},
  {sep:true},
  {cmd:"scene-break",label:"* * *",title:"Вставить разделитель сцены",run:insertSceneBreak}
];

export function createSceneEditorToolbar(container,{characters=[]}={}){
  container.innerHTML="";
  container.classList.add("rte-toolbar");
  container.setAttribute("role","toolbar");
  container.setAttribute("aria-label","Форматирование текста сцены");
  const entries=[];
  BUTTONS.forEach(spec=>{
    if(spec.sep){
      const sep=document.createElement("span");
      sep.className="rte-toolbar-sep";sep.setAttribute("aria-hidden","true");
      container.appendChild(sep);return;
    }
    const button=document.createElement("button");
    button.type="button";
    button.dataset.cmd=spec.cmd;
    if(spec.className)button.className=spec.className;
    button.textContent=spec.label;
    button.title=spec.title;
    button.setAttribute("aria-label",spec.title);
    if(spec.active)button.setAttribute("aria-pressed","false");
    container.appendChild(button);
    entries.push({...spec,button});
  });
  const povSelect=document.createElement("select");
  povSelect.className="rte-pov-select";
  povSelect.dataset.cmd="pov";
  povSelect.setAttribute("aria-label","Вставить POV персонажа");
  povSelect.innerHTML=`<option value="">POV…</option>`+
    characters.map(c=>`<option value="${escapeHtml(characterDisplayName(c))}">${escapeHtml(characterDisplayName(c)||"Без имени")}</option>`).join("");
  container.appendChild(povSelect);

  function bind(view){
    entries.forEach(({run,button})=>{
      button.onclick=()=>{run(view.state,view.dispatch,view);view.focus()};
    });
    povSelect.onchange=()=>{
      const name=povSelect.value;povSelect.value="";
      if(!name)return;
      insertPovText(name)(view.state,view.dispatch,view);
      view.focus();
    };
    update(view.state);
  }
  function update(state){
    entries.forEach(({run,button,active,checkEnabled})=>{
      if(active)button.setAttribute("aria-pressed",String(active(state)));
      if(checkEnabled)button.disabled=!run(state);
    });
  }
  return {bind,update};
}
