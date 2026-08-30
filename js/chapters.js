let chapterDraft=[],chapterBaseline=[];
let locationDraft=[],locationBaseline=[];
let tagDraft=[],tagBaseline=[];

function chapterById(id){return data.chapters.find(c=>c.id===id)}

function locationById(id){return data.locations.find(l=>l.id===id)}

function tagById(id){return data.tags.find(t=>t.id===id)}

function writingStatusById(id){return WRITING_STATUSES.find(x=>x.id===id)||WRITING_STATUSES[0]}

function closeProjectMenu(){const menu=document.getElementById("projectMenu");if(menu){menu.open=false;menu.querySelector("summary")?.focus()}}

const chaptersSaveButton=createSaveButtonController("saveChapters","chaptersModal",{statusId:"chaptersSaveStatus"});
const locationsSaveButton=createSaveButtonController("saveLocations","locationsModal",{statusId:"locationsSaveStatus"});
const tagsSaveButton=createSaveButtonController("saveTags","tagsModal",{statusId:"tagsSaveStatus"});

/* ---------- Chapters ---------- */

function openChaptersManager(){
  closeProjectMenu();
  return requestEditorTransition(()=>{
    chapterBaseline=data.chapters.filter(c=>c.id!=="chapter-unassigned").map(c=>({id:c.id,title:c.title,position:c.position}));
    chapterDraft=chapterBaseline.map(c=>({draftId:c.id,id:c.id,title:c.title}));
    renderChaptersManager();showModal("chaptersModal");trackerFor("chaptersModal").captureInitialState();chaptersSaveButton.refresh();
  });
}

function syncChapterDraftFromDom(){
  chapterDraft.forEach(row=>{
    const input=document.querySelector(`.chapter-name-input[data-draft-id="${cssEscape(row.draftId)}"]`);
    if(input)row.title=input.value;
  });
}

function renderChaptersManager(){
  document.getElementById("chaptersList").innerHTML=chapterDraft.map(c=>`
    <div class="manager-row">
      <input class="chapter-name-input" data-draft-id="${esc(c.draftId)}" value="${esc(c.title)}" placeholder="Название главы" aria-label="Название главы${c.title?` ${esc(c.title)}`:""}">
      <button type="button" aria-label="Переместить главу${c.title?` ${esc(c.title)}`:""} выше" onclick="moveChapterDraft('${jsq(c.draftId)}',-1)">↑</button><button type="button" aria-label="Переместить главу${c.title?` ${esc(c.title)}`:""} ниже" onclick="moveChapterDraft('${jsq(c.draftId)}',1)">↓</button>
      <button type="button" class="danger" aria-label="Удалить главу${c.title?` ${esc(c.title)}`:""}" onclick="deleteChapterDraft('${jsq(c.draftId)}')">Удалить</button>
    </div>`).join("")||'<div class="empty-work">Глав пока нет. Сцены без выбранной главы останутся в системном разделе «Без главы».</div>';
}

function addChapterDraftRow(){
  syncChapterDraftFromDom();
  const draftId=makeId("chapter-draft");
  chapterDraft.push({draftId,id:null,title:""});
  renderChaptersManager();
  syncBeforeUnload();
  document.querySelector(`.chapter-name-input[data-draft-id="${cssEscape(draftId)}"]`)?.focus();
}

function moveChapterDraft(draftId,dir){
  syncChapterDraftFromDom();
  const index=chapterDraft.findIndex(c=>c.draftId===draftId);
  const target=index+dir;
  if(index<0||target<0||target>=chapterDraft.length)return;
  [chapterDraft[index],chapterDraft[target]]=[chapterDraft[target],chapterDraft[index]];
  renderChaptersManager();
  syncBeforeUnload();
  document.querySelector(`.chapter-name-input[data-draft-id="${cssEscape(draftId)}"]`)?.focus();
}

async function deleteChapterDraft(draftId){
  syncChapterDraftFromDom();
  const row=chapterDraft.find(c=>c.draftId===draftId);if(!row)return;
  if(row.id){
    const confirmed=await showConfirmAction({title:"Удалить главу?",description:`Глава «${row.title||"без названия"}» будет удалена при сохранении. Её сцены перейдут в «Без главы».`});
    if(!confirmed)return;
  }
  chapterDraft=chapterDraft.filter(c=>c.draftId!==draftId);
  renderChaptersManager();
  syncBeforeUnload();
}

async function saveChapterDraft(){
  if(chaptersSaveButton.saving)return;
  syncChapterDraftFromDom();
  chaptersSaveButton.beginSaving();
  try{
    if(isCloudWorkspace()){
      const keptExistingIds=chapterDraft.filter(c=>c.id).map(c=>c.id);
      const deletedIds=chapterBaseline.map(c=>c.id).filter(id=>!keptExistingIds.includes(id));
      for(const id of deletedIds){
        const result=await runCloudMutation("deleteChapter",(api,revision)=>api.deleteChapter(cloudProjectSync.projectId,id,revision),{renderAfter:false});
        if(!result.ok){chaptersSaveButton.showStatus(result.message||"Не удалось удалить главу.","error");return}
      }
      for(const row of chapterDraft){
        if(!row.id)continue;
        const original=chapterBaseline.find(c=>c.id===row.id);if(!original)continue;
        const title=row.title.trim();
        if(title&&title!==original.title){
          const result=await runCloudMutation("updateChapter",(api,revision)=>api.updateChapter(cloudProjectSync.projectId,row.id,revision,{title}),{renderAfter:false});
          if(!result.ok){chaptersSaveButton.showStatus(result.message||"Не удалось сохранить главу.","error");return}
        }
      }
      const survivingOrder=keptExistingIds.filter(id=>!deletedIds.includes(id));
      const baselineOrder=chapterBaseline.map(c=>c.id).filter(id=>survivingOrder.includes(id));
      const reordered=survivingOrder.join(",")!==baselineOrder.join(",");
      let appended=survivingOrder.length;
      for(const row of chapterDraft){
        if(row.id)continue;
        const ordinal=chapterDraft.indexOf(row)+1;
        const title=row.title.trim()||`Глава ${ordinal}`;
        appended+=1;
        const position=(reordered?ordinal:appended)*1000;
        const result=await runCloudMutation("createChapter",(api,revision)=>api.createChapter(cloudProjectSync.projectId,revision,{title,position}),{renderAfter:false});
        if(!result.ok){chaptersSaveButton.showStatus(result.message||"Не удалось создать главу.","error");return}
        row.id=result.data?.id||null;
      }
      if(reordered){
        for(let i=0;i<chapterDraft.length;i++){
          const row=chapterDraft[i];if(!row.id)continue;
          const target=(i+1)*1000;
          if(chapterById(row.id)?.position===target)continue;
          const result=await runCloudMutation("reorderChapter",(api,revision)=>api.reorderChapter(cloudProjectSync.projectId,row.id,revision,target),{renderAfter:false});
          if(!result.ok){chaptersSaveButton.showStatus(result.message||"Не удалось изменить порядок глав.","error");return}
        }
      }
    }else{
      const result=commitDataChange(next=>{
        const unassigned=next.chapters.find(c=>c.id==="chapter-unassigned");
        const unassignedWasFirst=next.chapters[0]?.id==="chapter-unassigned";
        const ordered=chapterDraft.map(row=>({id:row.id||makeId("chapter"),title:row.title.trim()||`Глава ${chapterDraft.indexOf(row)+1}`,collapsed:next.chapters.find(c=>c.id===row.id)?.collapsed||false}));
        next.chapters=unassignedWasFirst?[unassigned,...ordered]:[...ordered,unassigned];
        next.scenes.forEach(s=>{if(!next.chapters.some(c=>c.id===s.chapterId))s.chapterId="chapter-unassigned"});
        const order=new Map(next.chapters.map((c,i)=>[c.id,i]));
        next.scenes.sort((a,b)=>(order.get(a.chapterId)??9999)-(order.get(b.chapterId)??9999));
      },{renderAfter:false});
      if(!result.ok){chaptersSaveButton.showStatus(result.userMessage||"Не удалось сохранить главы.","error");return}
    }
    chapterBaseline=data.chapters.filter(c=>c.id!=="chapter-unassigned").map(c=>({id:c.id,title:c.title,position:c.position}));
    chapterDraft=chapterBaseline.map(c=>({draftId:c.id,id:c.id,title:c.title}));
    renderChaptersManager();
    trackerFor("chaptersModal").captureInitialState();
    chaptersSaveButton.showStatus("Главы сохранены.","success");
    render();
  }finally{
    chaptersSaveButton.endSaving();
  }
}

/* ---------- Locations ---------- */

function openLocationsManager(focusLocationId=null){
  closeProjectMenu();
  return requestEditorTransition(()=>{
    locationBaseline=data.locations.map(l=>({id:l.id,name:l.name,description:l.description}));
    locationDraft=locationBaseline.map(l=>({draftId:l.id,id:l.id,name:l.name,description:l.description}));
    renderLocationsManager();
    const initialFocus=focusLocationId?`.location-name-input[data-draft-id="${cssEscape(focusLocationId)}"]`:undefined;
    showModal("locationsModal",{initialFocus});
    if(initialFocus)document.querySelector(initialFocus)?.closest(".manager-row")?.scrollIntoView({block:"center"});
    trackerFor("locationsModal").captureInitialState();locationsSaveButton.refresh();
  });
}

function syncLocationDraftFromDom(){
  locationDraft.forEach(row=>{
    const nameInput=document.querySelector(`.location-name-input[data-draft-id="${cssEscape(row.draftId)}"]`);
    const descInput=document.querySelector(`.location-desc-input[data-draft-id="${cssEscape(row.draftId)}"]`);
    if(nameInput)row.name=nameInput.value;
    if(descInput)row.description=descInput.value;
  });
}

function renderLocationsManager(){
  document.getElementById("locationsList").innerHTML=locationDraft.map(l=>`
    <div class="manager-row location-row">
      <input class="location-name-input" data-draft-id="${esc(l.draftId)}" value="${esc(l.name)}" aria-label="Название локации" placeholder="Название локации">
      <input class="location-desc-input" data-draft-id="${esc(l.draftId)}" value="${esc(l.description)}" aria-label="Описание локации${l.name?` ${esc(l.name)}`:""}" placeholder="Необязательное описание">
      <button type="button" class="danger" aria-label="Удалить локацию${l.name?` ${esc(l.name)}`:""}" onclick="deleteLocationDraft('${jsq(l.draftId)}')">Удалить</button>
    </div>`).join("")||'<div class="empty-work">Локаций пока нет.</div>';
}

function addLocationDraftRow(){
  syncLocationDraftFromDom();
  const draftId=makeId("location-draft");
  locationDraft.push({draftId,id:null,name:"",description:""});
  renderLocationsManager();
  syncBeforeUnload();
  document.querySelector(`.location-name-input[data-draft-id="${cssEscape(draftId)}"]`)?.focus();
}

async function deleteLocationDraft(draftId){
  syncLocationDraftFromDom();
  const row=locationDraft.find(l=>l.draftId===draftId);if(!row)return;
  if(row.id){
    const confirmed=await showConfirmAction({title:"Удалить локацию?",description:`Локация «${row.name||"без названия"}» будет удалена при сохранении. В сценах она станет не указанной.`});
    if(!confirmed)return;
  }
  locationDraft=locationDraft.filter(l=>l.draftId!==draftId);
  renderLocationsManager();
  syncBeforeUnload();
}

async function saveLocationDraft(){
  if(locationsSaveButton.saving)return;
  syncLocationDraftFromDom();
  const invalid=locationDraft.find(l=>l.id&&!l.name.trim());
  if(invalid){locationsSaveButton.showStatus("Название локации не может быть пустым.","error");return}
  locationsSaveButton.beginSaving();
  try{
    if(isCloudWorkspace()){
      const keptIds=locationDraft.filter(l=>l.id).map(l=>l.id);
      const deletedIds=locationBaseline.map(l=>l.id).filter(id=>!keptIds.includes(id));
      for(const id of deletedIds){
        const result=await runCloudMutation("deleteLocation",(api,revision)=>api.deleteLocation(cloudProjectSync.projectId,id,revision),{renderAfter:false});
        if(!result.ok){locationsSaveButton.showStatus(result.message||"Не удалось удалить локацию.","error");return}
      }
      for(const row of locationDraft){
        if(!row.id)continue;
        const original=locationBaseline.find(l=>l.id===row.id);if(!original)continue;
        const name=row.name.trim(),description=row.description.trim();
        if(name&&(name!==original.name||description!==original.description)){
          const result=await runCloudMutation("updateLocation",(api,revision)=>api.updateLocation(cloudProjectSync.projectId,row.id,revision,{name,description}),{renderAfter:false});
          if(!result.ok){locationsSaveButton.showStatus(result.message||"Не удалось сохранить локацию.","error");return}
        }
      }
      for(const row of locationDraft){
        if(row.id)continue;
        const name=row.name.trim();if(!name)continue;
        const description=row.description.trim();
        const result=await runCloudMutation("createLocation",(api,revision)=>api.createLocation(cloudProjectSync.projectId,revision,{name,description}),{renderAfter:false});
        if(!result.ok){locationsSaveButton.showStatus(result.message||"Не удалось создать локацию.","error");return}
        row.id=result.data?.id||null;
      }
    }else{
      const keptRows=locationDraft.filter(row=>row.id||row.name.trim());
      const result=commitDataChange(next=>{
        next.locations=keptRows.map(row=>({id:row.id||makeId("location"),name:row.name.trim(),description:row.description.trim()}));
        const keptLocationIds=new Set(next.locations.map(l=>l.id));
        next.scenes.forEach(s=>{if(s.locationId&&!keptLocationIds.has(s.locationId))s.locationId=""});
      },{renderAfter:false});
      if(!result.ok){locationsSaveButton.showStatus(result.userMessage||"Не удалось сохранить локации.","error");return}
    }
    locationBaseline=data.locations.map(l=>({id:l.id,name:l.name,description:l.description}));
    locationDraft=locationBaseline.map(l=>({draftId:l.id,id:l.id,name:l.name,description:l.description}));
    renderLocationsManager();
    trackerFor("locationsModal").captureInitialState();
    locationsSaveButton.showStatus("Локации сохранены.","success");
    render();
  }finally{
    locationsSaveButton.endSaving();
  }
}

/* ---------- Tags ---------- */

function openTagsManager(){
  closeProjectMenu();
  return requestEditorTransition(()=>{
    tagBaseline=data.tags.map(t=>({id:t.id,name:t.name}));
    tagDraft=tagBaseline.map(t=>({draftId:t.id,id:t.id,name:t.name}));
    renderTagsManager();showModal("tagsModal");trackerFor("tagsModal").captureInitialState();tagsSaveButton.refresh();
  });
}

function syncTagDraftFromDom(){
  tagDraft.forEach(row=>{
    const input=document.querySelector(`.tag-name-input[data-draft-id="${cssEscape(row.draftId)}"]`);
    if(input)row.name=input.value;
  });
}

function renderTagsManager(){
  document.getElementById("tagsList").innerHTML=tagDraft.map(t=>`
    <div class="manager-row tag-manager-row"><input class="tag-name-input" data-draft-id="${esc(t.draftId)}" value="${esc(t.name)}" placeholder="Название тега" aria-label="Название тега${t.name?` ${esc(t.name)}`:""}">
    <button type="button" class="danger" aria-label="Удалить тег${t.name?` ${esc(t.name)}`:""}" onclick="deleteTagDraft('${jsq(t.draftId)}')">Удалить</button></div>`).join("")||'<div class="empty-work">Тегов пока нет.</div>';
}

function addTagDraftRow(){
  syncTagDraftFromDom();
  const draftId=makeId("tag-draft");
  tagDraft.push({draftId,id:null,name:""});
  renderTagsManager();
  syncBeforeUnload();
  document.querySelector(`.tag-name-input[data-draft-id="${cssEscape(draftId)}"]`)?.focus();
}

async function deleteTagDraft(draftId){
  syncTagDraftFromDom();
  const row=tagDraft.find(t=>t.draftId===draftId);if(!row)return;
  if(row.id){
    const confirmed=await showConfirmAction({title:"Удалить тег?",description:`Тег #${row.name||"без названия"} будет удалён из всех сцен при сохранении.`});
    if(!confirmed)return;
  }
  tagDraft=tagDraft.filter(t=>t.draftId!==draftId);
  renderTagsManager();
  syncBeforeUnload();
}

async function saveTagDraft(){
  if(tagsSaveButton.saving)return;
  syncTagDraftFromDom();
  const invalid=tagDraft.find(t=>t.id&&!canonicalTagName(t.name));
  if(invalid){tagsSaveButton.showStatus("Название тега не может быть пустым.","error");return}
  tagsSaveButton.beginSaving();
  try{
    if(isCloudWorkspace()){
      const keptIds=tagDraft.filter(t=>t.id).map(t=>t.id);
      const deletedIds=tagBaseline.map(t=>t.id).filter(id=>!keptIds.includes(id));
      for(const id of deletedIds){
        const result=await runCloudMutation("deleteTag",(api,revision)=>api.deleteTag(cloudProjectSync.projectId,id,revision),{renderAfter:false});
        if(!result.ok){tagsSaveButton.showStatus(result.message||"Не удалось удалить тег.","error");return}
      }
      for(const row of tagDraft){
        if(!row.id)continue;
        const original=tagBaseline.find(t=>t.id===row.id);if(!original)continue;
        const name=canonicalTagName(row.name);
        if(name&&name!==original.name){
          const result=await runCloudMutation("updateTag",(api,revision)=>api.updateTag(cloudProjectSync.projectId,row.id,revision,{name}),{renderAfter:false});
          if(!result.ok){tagsSaveButton.showStatus(result.message||"Не удалось сохранить тег.","error");return}
        }
      }
      const usedNames=new Set(data.tags.map(t=>t.name.toLocaleLowerCase("ru")));
      for(const row of tagDraft){
        if(row.id)continue;
        const name=canonicalTagName(row.name);if(!name)continue;
        const key=name.toLocaleLowerCase("ru");
        if(usedNames.has(key))continue;
        const result=await runCloudMutation("createTag",(api,revision)=>api.createTag(cloudProjectSync.projectId,revision,{name}),{renderAfter:false});
        if(!result.ok){
          if(result.code==="DUPLICATE"){usedNames.add(key);continue}
          tagsSaveButton.showStatus(result.message||"Не удалось создать тег.","error");return;
        }
        row.id=result.data?.id||null;usedNames.add(key);
      }
    }else{
      const result=commitDataChange(next=>{
        const used=new Set();
        const keptIds=new Set(tagDraft.filter(t=>t.id).map(t=>t.id));
        next.tags=next.tags.filter(t=>keptIds.has(t.id));
        next.tags.forEach(t=>{
          const row=tagDraft.find(r=>r.id===t.id);
          const requested=canonicalTagName(row?.name)||t.name;
          const key=requested.toLocaleLowerCase("ru");
          if(!used.has(key)){used.add(key);t.name=requested}else used.add(t.name.toLocaleLowerCase("ru"));
        });
        tagDraft.filter(row=>!row.id).forEach(row=>{
          const name=canonicalTagName(row.name);if(!name)return;
          const key=name.toLocaleLowerCase("ru");
          if(used.has(key))return;
          used.add(key);next.tags.push({id:makeId("tag"),name});
        });
        const finalTagIds=new Set(next.tags.map(t=>t.id));
        next.scenes.forEach(s=>{s.tags=s.tags.filter(id=>finalTagIds.has(id))});
      },{renderAfter:false});
      if(!result.ok){tagsSaveButton.showStatus(result.userMessage||"Не удалось сохранить теги.","error");return}
    }
    tagBaseline=data.tags.map(t=>({id:t.id,name:t.name}));
    tagDraft=tagBaseline.map(t=>({draftId:t.id,id:t.id,name:t.name}));
    renderTagsManager();
    trackerFor("tagsModal").captureInitialState();
    tagsSaveButton.showStatus("Теги сохранены.","success");
    render();
  }finally{
    tagsSaveButton.endSaving();
  }
}

function toggleChapter(id){
  if(!chapterById(id))return;
  commitDataChange(next=>{const chapter=next.chapters.find(c=>c.id===id);chapter.collapsed=!chapter.collapsed});
}

// Sidebar chapter navigation: the sidebar is entity access, not a filter control —
// clicking a chapter scrolls the current chapter-grouped view (table/cards/list all
// group by chapter, each carrying a stable [data-chapter-id] anchor) to that section
// instead of narrowing scenes down to it. scrollIntoView reaches into whichever
// ancestor actually scrolls, so this works regardless of viewport/scroll-container
// changes elsewhere in this phase.
function navigateToChapter(chapterId){
  const target=document.querySelector(`[data-chapter-id="${cssEscape(chapterId)}"]`);
  if(!target)return false;
  const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"start"});
  target.classList.add("chapter-nav-highlight");
  setTimeout(()=>target.classList.remove("chapter-nav-highlight"),1600);
  if(!target.hasAttribute("tabindex"))target.setAttribute("tabindex","-1");
  target.focus({preventScroll:true});
  return true;
}

// Sidebar location navigation: there is no standalone Location Profile surface yet
// (deferred — see workspace-density-navigation report), so the "most concrete existing
// context" is the Locations manager scrolled/focused to that specific row, instead of
// silently reusing the location click as a scene filter.
function openLocationEntity(locationId){
  return openLocationsManager(locationId);
}

Object.assign(globalThis,{chapterById,locationById,tagById,writingStatusById,openChaptersManager,renderChaptersManager,addChapterDraftRow,moveChapterDraft,deleteChapterDraft,saveChapterDraft,openLocationsManager,renderLocationsManager,addLocationDraftRow,deleteLocationDraft,saveLocationDraft,openTagsManager,renderTagsManager,addTagDraftRow,deleteTagDraft,saveTagDraft,toggleChapter,navigateToChapter,openLocationEntity});
export {chapterById,locationById,tagById,writingStatusById,openChaptersManager,renderChaptersManager,addChapterDraftRow,moveChapterDraft,deleteChapterDraft,saveChapterDraft,openLocationsManager,renderLocationsManager,addLocationDraftRow,deleteLocationDraft,saveLocationDraft,openTagsManager,renderTagsManager,addTagDraftRow,deleteTagDraft,saveTagDraft,toggleChapter,navigateToChapter,openLocationEntity};
