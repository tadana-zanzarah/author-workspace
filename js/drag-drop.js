function dragStart(event,sceneId){
  if(hasActiveFilters()){
    event.preventDefault();
    showStorageMessage("Перенос сцен временно недоступен при активных фильтрах или поиске. Сбросьте фильтры, чтобы порядок оставался однозначным.","warning");
    return;
  }
  draggedSceneId=sceneId;
  event.currentTarget.classList.add("dragging");
  event.dataTransfer.effectAllowed="move";
  event.dataTransfer.setData("text/plain",sceneId);
}

function dragOver(event,targetSceneId){
  event.preventDefault();
  const edge=70;
  if(event.clientY<edge)window.scrollBy({top:-18,behavior:"auto"});
  else if(window.innerHeight-event.clientY<edge)window.scrollBy({top:18,behavior:"auto"});
  const row=event.currentTarget;
  const rect=row.getBoundingClientRect();
  const after=event.clientY>rect.top+rect.height/2;
  row.classList.toggle("drop-before",!after);
  row.classList.toggle("drop-after",after);
}

function dragLeave(event){event.currentTarget.classList.remove("drop-before","drop-after")}

function dropScene(event,targetSceneId){
  event.preventDefault();
  const row=event.currentTarget;
  const rect=row.getBoundingClientRect();
  const after=event.clientY>rect.top+rect.height/2;
  row.classList.remove("drop-before","drop-after");
  if(!draggedSceneId||draggedSceneId===targetSceneId)return;
  const movedId=draggedSceneId;
  const result=commitDataChange(next=>{
    const movedIndex=next.scenes.findIndex(s=>s.id===movedId);
    const targetScene=next.scenes.find(s=>s.id===targetSceneId);
    if(movedIndex<0||!targetScene)throw new Error("scene missing");
    const [moved]=next.scenes.splice(movedIndex,1);
    moved.chapterId=targetScene.chapterId;
    let targetIndex=next.scenes.findIndex(s=>s.id===targetSceneId);if(after)targetIndex++;
    if(moved.date)moved.dateReview=true;
    next.scenes.splice(targetIndex,0,moved);
  },{renderAfter:false});
  if(result.ok){draggedSceneId=null;render()}
}

function dragEnd(){
  draggedSceneId=null;
  document.querySelectorAll(".scene-row").forEach(r=>r.classList.remove("dragging","drop-before","drop-after"));
}

function renderSortScenes(){
  const root=document.getElementById("sortScenesList");
  root.innerHTML=data.scenes.map(scene=>{
    const chapter=chapterById(scene.chapterId);
    const location=locationById(scene.locationId);
    return `<div class="sort-scene-row" draggable="true" data-sort-scene-id="${esc(scene.id)}">
      <span class="sort-handle">↕</span>
      <span class="sort-scene-meta">${esc(readableDate(scene)||"без даты")}</span>
      <span class="sort-scene-title">${esc(scene.title||"Без названия")}</span>
      <span class="sort-scene-meta">${esc(chapter?.title||"Без главы")}${location?` · ${esc(location.name)}`:""}</span>
    </div>`;
  }).join("")||'<div class="empty-work">Сцен пока нет.</div>';
}

function openSortScenes(){
  document.getElementById("projectMenu").open=false;
  renderSortScenes();
  showModal("sortScenesModal");
}

function sortDragStart(event){
  const row=event.target.closest("[data-sort-scene-id]");
  if(!row)return;
  sortDraggedSceneId=row.dataset.sortSceneId;
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed="move";
  event.dataTransfer.setData("text/plain",sortDraggedSceneId);
}

function sortDragOver(event){
  const row=event.target.closest("[data-sort-scene-id]");
  if(!row||!sortDraggedSceneId)return;
  event.preventDefault();
  const rect=row.getBoundingClientRect();
  const after=event.clientY>rect.top+rect.height/2;
  row.classList.toggle("drop-before",!after);
  row.classList.toggle("drop-after",after);
  const modal=document.querySelector("#sortScenesModal .modal");
  if(event.clientY<90)modal.scrollTop-=18;
  else if(window.innerHeight-event.clientY<90)modal.scrollTop+=18;
}

function sortDrop(event){
  const row=event.target.closest("[data-sort-scene-id]");
  if(!row||!sortDraggedSceneId)return;
  event.preventDefault();
  const targetId=row.dataset.sortSceneId;
  const rect=row.getBoundingClientRect();
  const after=event.clientY>rect.top+rect.height/2;
  if(targetId!==sortDraggedSceneId){
    const movedId=sortDraggedSceneId;
    const result=commitDataChange(next=>{
      const movedIndex=next.scenes.findIndex(s=>s.id===movedId);
      const targetScene=next.scenes.find(s=>s.id===targetId);
      if(movedIndex<0||!targetScene)throw new Error("scene missing");
      const [moved]=next.scenes.splice(movedIndex,1);moved.chapterId=targetScene.chapterId;
      let targetIndex=next.scenes.findIndex(s=>s.id===targetId);if(after)targetIndex++;
      if(moved.date)moved.dateReview=true;next.scenes.splice(targetIndex,0,moved);
    },{renderAfter:false});
    if(!result.ok)return;
  }
  sortDraggedSceneId=null;
  renderSortScenes();
  render();
}

function sortDragEnd(){
  sortDraggedSceneId=null;
  document.querySelectorAll(".sort-scene-row").forEach(row=>row.classList.remove("dragging","drop-before","drop-after"));
}

Object.assign(globalThis,{dragStart,dragOver,dragLeave,dropScene,dragEnd,renderSortScenes,openSortScenes,sortDragStart,sortDragOver,sortDrop,sortDragEnd});
export {dragStart,dragOver,dragLeave,dropScene,dragEnd,renderSortScenes,openSortScenes,sortDragStart,sortDragOver,sortDrop,sortDragEnd};
