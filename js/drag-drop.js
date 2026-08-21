function dragStart(event,sceneId){
  if(hasActiveFilters()){
    event.preventDefault();
    showStorageMessage("Перенос сцен временно недоступен при активных фильтрах или поиске. Сбросьте фильтры, чтобы порядок оставался однозначным.","warning");
    return;
  }
  draggedSceneId=sceneId;
  const row=event.currentTarget.closest(".scene-row");
  row?.classList.add("dragging");
  event.dataTransfer.effectAllowed="move";
  event.dataTransfer.setData("text/plain",sceneId);
}

function dragOver(event,targetSceneId){
  event.preventDefault();
  autoscrollSceneViewport(event.clientY);
  const row=event.currentTarget;
  const rect=row.getBoundingClientRect();
  const after=event.clientY>rect.top+rect.height/2;
  row.classList.toggle("drop-before",!after);
  row.classList.toggle("drop-after",after);
}

function autoscrollSceneViewport(clientY){
  const viewport=document.querySelector(".workspace-viewport");
  if(!viewport||!draggedSceneId)return 0;
  const rect=viewport.getBoundingClientRect();
  if(clientY<rect.top||clientY>rect.bottom)return 0;
  const edge=Math.min(90,rect.height/3);
  let delta=0;
  if(clientY<rect.top+edge)delta=-Math.ceil(4+24*(1-(clientY-rect.top)/edge));
  else if(clientY>rect.bottom-edge)delta=Math.ceil(4+24*(1-(rect.bottom-clientY)/edge));
  if(delta)viewport.scrollTop+=delta;
  return delta;
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
    moved.dateReview=true;
    next.scenes.splice(targetIndex,0,moved);
  },{renderAfter:false});
  if(result.ok){draggedSceneId=null;render()}
}

function dragEnd(){
  draggedSceneId=null;
  document.querySelectorAll(".scene-row").forEach(r=>r.classList.remove("dragging","drop-before","drop-after"));
}

function compactDragStart(event,sceneId){
  if(hasActiveFilters()){
    event.preventDefault();
    showStorageMessage("Чтобы менять порядок сцен, сбросьте фильтры.","warning");
    return;
  }
  draggedSceneId=sceneId;
  event.currentTarget.closest(".compact-scene-row")?.classList.add("dragging");
  event.dataTransfer.effectAllowed="move";
  event.dataTransfer.setData("text/plain",sceneId);
}

function compactDragOver(event){
  if(!draggedSceneId||hasActiveFilters())return;
  event.preventDefault();
  autoscrollSceneViewport(event.clientY);
  document.querySelectorAll(".compact-drop-position.active").forEach(node=>node.classList.remove("active"));
  event.currentTarget.classList.add("active");
  event.dataTransfer.dropEffect="move";
}

function compactDragLeave(event){
  if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove("active");
}

function compactMoveScene(sceneId,{chapterId,beforeSceneId=null}){
  const current=data.scenes.find(scene=>scene.id===sceneId);
  if(!current||!data.chapters.some(chapter=>chapter.id===chapterId))return {ok:false,userMessage:"Сцена или глава больше не найдена."};
  if(beforeSceneId===sceneId)return {ok:true,unchanged:true,data};
  const nextOrder=data.scenes.filter(scene=>scene.id!==sceneId);
  let insertIndex;
  if(beforeSceneId){
    const target=nextOrder.find(scene=>scene.id===beforeSceneId);
    if(!target||target.chapterId!==chapterId)return {ok:false,userMessage:"Позиция переноса больше не найдена."};
    insertIndex=nextOrder.findIndex(scene=>scene.id===beforeSceneId);
  }else{
    insertIndex=nextOrder.length;
    for(let index=nextOrder.length-1;index>=0;index--)if(nextOrder[index].chapterId===chapterId){insertIndex=index+1;break}
    if(!nextOrder.some(scene=>scene.chapterId===chapterId)){
      const chapterOrder=new Map(data.chapters.map((chapter,index)=>[chapter.id,index])),wanted=chapterOrder.get(chapterId);
      const following=nextOrder.findIndex(scene=>(chapterOrder.get(scene.chapterId)??Infinity)>wanted);
      insertIndex=following<0?nextOrder.length:following;
    }
  }
  const currentIds=data.scenes.map(scene=>scene.id),proposedIds=[...nextOrder];
  proposedIds.splice(insertIndex,0,current);
  if(current.chapterId===chapterId&&proposedIds.every((scene,index)=>scene.id===currentIds[index]))return {ok:true,unchanged:true,data};
  return commitDataChange(next=>{
    const movedIndex=next.scenes.findIndex(scene=>scene.id===sceneId);
    const [moved]=next.scenes.splice(movedIndex,1);
    let targetIndex;
    if(beforeSceneId)targetIndex=next.scenes.findIndex(scene=>scene.id===beforeSceneId);
    else{
      targetIndex=next.scenes.length;
      for(let index=next.scenes.length-1;index>=0;index--)if(next.scenes[index].chapterId===chapterId){targetIndex=index+1;break}
      if(!next.scenes.some(scene=>scene.chapterId===chapterId)){
        const order=new Map(next.chapters.map((chapter,index)=>[chapter.id,index])),wanted=order.get(chapterId);
        const following=next.scenes.findIndex(scene=>(order.get(scene.chapterId)??Infinity)>wanted);
        targetIndex=following<0?next.scenes.length:following;
      }
    }
    moved.chapterId=chapterId;
    moved.dateReview=true;
    next.scenes.splice(targetIndex,0,moved);
  },{renderAfter:false});
}

function compactDropScene(event,position,sceneId=draggedSceneId){
  event.preventDefault();
  event.currentTarget?.classList.remove("active");
  if(!sceneId||hasActiveFilters())return {ok:false};
  const result=compactMoveScene(sceneId,position);
  if(result.ok){draggedSceneId=null;if(!result.unchanged)render()}
  return result;
}

function compactDragEnd(){
  draggedSceneId=null;
  document.querySelectorAll(".compact-scene-row.dragging,.compact-drop-position.active").forEach(node=>node.classList.remove("dragging","active"));
}

document.addEventListener("dragstart",event=>{
  if(event.target.closest?.(".scene-row")&&!event.target.closest(".drag-handle"))event.preventDefault();
});

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
  const menu=document.getElementById("projectMenu");menu.open=false;menu.querySelector("summary")?.focus();
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
      moved.dateReview=true;next.scenes.splice(targetIndex,0,moved);
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

Object.assign(globalThis,{dragStart,dragOver,dragLeave,dropScene,dragEnd,autoscrollSceneViewport,compactDragStart,compactDragOver,compactDragLeave,compactMoveScene,compactDropScene,compactDragEnd,renderSortScenes,openSortScenes,sortDragStart,sortDragOver,sortDrop,sortDragEnd});
export {dragStart,dragOver,dragLeave,dropScene,dragEnd,autoscrollSceneViewport,compactDragStart,compactDragOver,compactDragLeave,compactMoveScene,compactDropScene,compactDragEnd,renderSortScenes,openSortScenes,sortDragStart,sortDragOver,sortDrop,sortDragEnd};
