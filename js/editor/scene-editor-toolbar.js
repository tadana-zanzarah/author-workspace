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

// Small local SVG icons -- no icon library, just plain horizontal-line glyphs
// for alignment (the universal convention every text editor uses) so they
// read as "align left/center/right/justify" at a glance rather than as
// cryptic custom letters. currentColor so the existing aria-pressed active-
// state color rule (css/editor.css) colors the icon too, with no extra CSS.
// Find/Replace Stage C: one recognizable magnifying-glass glyph for the
// toolbar entry point, same currentColor/no-icon-library convention as
// alignIcon below -- deliberately not a text button ("Найти"), per the
// product brief's preference for one recognizable search control.
function findIcon(){
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4.3"/><line x1="9.6" y1="9.6" x2="14" y2="14"/></g></svg>`;
}

function alignIcon(kind){
  const lines={
    left:[[1,3,15,3],[1,6.3,10,6.3],[1,9.7,15,9.7],[1,13,10,13]],
    center:[[1,3,15,3],[3.5,6.3,12.5,6.3],[1,9.7,15,9.7],[3.5,13,12.5,13]],
    right:[[1,3,15,3],[6,6.3,15,6.3],[1,9.7,15,9.7],[6,13,15,13]],
    justify:[[1,3,15,3],[1,6.3,15,6.3],[1,9.7,15,9.7],[1,13,15,13]]
  }[kind];
  const segs=lines.map(([x1,y1,x2,y2])=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join("");
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${segs}</g></svg>`;
}

// One flat command list -- toolbar buttons and keyboard shortcuts both end up
// calling the same functions from scene-editor-commands.js, never separate
// logic. Grouped (via {sep:true} dividers) as: text formatting | alignment |
// undo/redo | insertions.
const BUTTONS=[
  {cmd:"bold",label:"Ж",className:"rte-btn-bold",title:"Полужирный (Ctrl+B)",run:toggleBold,active:state=>markActive(state,schema.marks.strong)},
  {cmd:"italic",label:"К",className:"rte-btn-italic",title:"Курсив (Ctrl+I)",run:toggleItalic,active:state=>markActive(state,schema.marks.em)},
  {cmd:"strike",label:"З",className:"rte-btn-strike",title:"Зачёркнутый",run:toggleStrike,active:state=>markActive(state,schema.marks.strike)},
  {sep:true},
  {cmd:"align-left",icon:alignIcon("left"),title:"Выравнивание по левому краю",run:setAlign("left"),active:state=>alignActive(state,"left")},
  {cmd:"align-center",icon:alignIcon("center"),title:"Выравнивание по центру",run:setAlign("center"),active:state=>alignActive(state,"center")},
  {cmd:"align-right",icon:alignIcon("right"),title:"Выравнивание по правому краю",run:setAlign("right"),active:state=>alignActive(state,"right")},
  {cmd:"align-justify",icon:alignIcon("justify"),title:"По ширине",run:setAlign("justify"),active:state=>alignActive(state,"justify")},
  {sep:true},
  {cmd:"undo",label:"↶",className:"rte-btn-icon-text",title:"Отменить (Ctrl+Z)",run:undo,checkEnabled:true},
  {cmd:"redo",label:"↷",className:"rte-btn-icon-text",title:"Повторить (Ctrl+Shift+Z)",run:redo,checkEnabled:true},
  {sep:true},
  {cmd:"scene-break",label:"* * *",title:"Вставить разделитель сцены",run:insertSceneBreak}
];

export function createSceneEditorToolbar(container,{characters=[],onFindReplace}={}){
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
    button.className=spec.className?`${spec.className}`:"";
    if(spec.icon){button.classList.add("rte-btn-icon");button.innerHTML=spec.icon}
    else button.textContent=spec.label;
    button.title=spec.title;
    button.setAttribute("aria-label",spec.title);
    if(spec.active)button.setAttribute("aria-pressed","false");
    container.appendChild(button);
    entries.push({...spec,button});
  });
  const povSelect=document.createElement("select");
  povSelect.className="rte-pov-select";
  povSelect.dataset.cmd="pov";
  povSelect.setAttribute("aria-label","Вставить POV или текстовую вставку в текущую позицию");
  povSelect.innerHTML=`<option value="">Вставить POV / текст…</option>`+
    characters.map(c=>`<option value="${escapeHtml(characterDisplayName(c))}">${escapeHtml(characterDisplayName(c)||"Без имени")}</option>`).join("");
  container.appendChild(povSelect);

  // Find/Replace Stage C: a toolbar entry point for users who don't use
  // Ctrl+F/Ctrl+H. Deliberately NOT one of the command-style BUTTONS entries
  // above -- opening a panel isn't a ProseMirror command (no state/dispatch
  // run() call, no active/checkEnabled toggle state), so it gets its own
  // small, separate wiring rather than forcing that shared descriptor shape
  // to accommodate a fundamentally different kind of button. Only rendered
  // when the caller actually wants find/replace on this toolbar instance.
  if(onFindReplace){
    const findButton=document.createElement("button");
    findButton.type="button";
    findButton.className="rte-btn-icon rte-btn-find";
    findButton.title="Найти и заменить (Ctrl+F)";
    findButton.setAttribute("aria-label","Найти и заменить");
    findButton.innerHTML=findIcon();
    findButton.onclick=()=>onFindReplace();
    container.appendChild(findButton);
  }

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
