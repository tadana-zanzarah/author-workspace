function chapterById(id){return data.chapters.find(c=>c.id===id)}

function locationById(id){return data.locations.find(l=>l.id===id)}

function tagById(id){return data.tags.find(t=>t.id===id)}

function writingStatusById(id){return WRITING_STATUSES.find(x=>x.id===id)||WRITING_STATUSES[0]}

function openChaptersManager(){return requestEditorTransition(()=>{renderChaptersManager();showModal("chaptersModal");trackerFor("chaptersModal").captureInitialState()})}

function renderChaptersManager(){
  const userChapters=data.chapters.filter(c=>c.id!=="chapter-unassigned");
  document.getElementById("chaptersList").innerHTML=userChapters.map((c,i)=>`
    <div class="manager-row">
      <input class="chapter-name-input" data-id="${esc(c.id)}" value="${esc(c.title)}" aria-label="Название главы ${esc(c.title)}">
      <button aria-label="Переместить главу ${esc(c.title)} выше" onclick="moveChapter('${jsq(c.id)}',-1)">↑</button><button aria-label="Переместить главу ${esc(c.title)} ниже" onclick="moveChapter('${jsq(c.id)}',1)">↓</button>
      <button class="danger" onclick="deleteChapter('${jsq(c.id)}')" ${c.id==="chapter-unassigned"?"disabled":""}>Удалить</button>
    </div>`).join("")||'<div class="empty-work">Глав пока нет. Сцены без выбранной главы останутся в системном разделе «Без главы».</div>';
}

function saveChapterNames(){
  document.querySelectorAll(".chapter-name-input").forEach(input=>{
    const c=chapterById(input.dataset.id);if(c&&input.value.trim())c.title=input.value.trim();
  });
}

function moveChapter(chapterId,dir){
  const index=data.chapters.findIndex(chapter=>chapter.id===chapterId);
  const target=index+dir;
  if(index<0||target<0||target>=data.chapters.length||data.chapters[target]?.id==="chapter-unassigned")return;
  const names=new Map([...document.querySelectorAll(".chapter-name-input")].map(input=>[input.dataset.id,input.value.trim()]));
  const result=commitDataChange(next=>{
    next.chapters.forEach(c=>{if(names.get(c.id))c.title=names.get(c.id)});
    [next.chapters[index],next.chapters[target]]=[next.chapters[target],next.chapters[index]];
    const order=new Map(next.chapters.map((c,i)=>[c.id,i]));
    next.scenes.sort((a,b)=>(order.get(a.chapterId)??9999)-(order.get(b.chapterId)??9999));
  },{renderAfter:false});
  if(result.ok){renderChaptersManager();trackerFor("chaptersModal").captureInitialState();render()}
}

function deleteChapter(id){
  const c=chapterById(id);if(!c||id==="chapter-unassigned")return;
  if(!confirm(`Удалить главу «${c.title}»? Её сцены перейдут в «Без главы».`))return;
  const names=new Map([...document.querySelectorAll(".chapter-name-input")].map(input=>[input.dataset.id,input.value.trim()]));
  const result=commitDataChange(next=>{
    next.chapters.forEach(chapter=>{if(names.get(chapter.id))chapter.title=names.get(chapter.id)});
    next.scenes.forEach(s=>{if(s.chapterId===id)s.chapterId="chapter-unassigned"});
    next.chapters=next.chapters.filter(x=>x.id!==id);
  },{renderAfter:false});
  if(result.ok){renderChaptersManager();trackerFor("chaptersModal").captureInitialState();render()}
}

function openLocationsManager(){return requestEditorTransition(()=>{renderLocationsManager();showModal("locationsModal");trackerFor("locationsModal").captureInitialState()})}

function renderLocationsManager(){
  document.getElementById("locationsList").innerHTML=data.locations.map(l=>`
    <div class="manager-row location-row">
      <input class="location-name-input" data-id="${esc(l.id)}" value="${esc(l.name)}" aria-label="Название локации" placeholder="Название">
      <input class="location-desc-input" data-id="${esc(l.id)}" value="${esc(l.description)}" aria-label="Описание локации ${esc(l.name)}" placeholder="Необязательное описание">
      <button class="danger" onclick="deleteLocation('${jsq(l.id)}')">Удалить</button>
    </div>`).join("")||'<div class="empty-work">Локаций пока нет.</div>';
}

function saveLocations(){
  document.querySelectorAll(".location-name-input").forEach(input=>{
    const l=locationById(input.dataset.id);if(l&&input.value.trim())l.name=input.value.trim();
  });
  document.querySelectorAll(".location-desc-input").forEach(input=>{
    const l=locationById(input.dataset.id);if(l)l.description=input.value.trim();
  });
}

function deleteLocation(id){
  const l=locationById(id);if(!l)return;
  if(!confirm(`Удалить локацию «${l.name}»? В сценах она станет не указанной.`))return;
  const values=[...document.querySelectorAll(".location-name-input")].map(input=>({id:input.dataset.id,name:input.value.trim(),description:document.querySelector(`.location-desc-input[data-id="${cssEscape(input.dataset.id)}"]`)?.value.trim()||""}));
  const result=commitDataChange(next=>{
    values.forEach(value=>{const item=next.locations.find(location=>location.id===value.id);if(item&&value.name)Object.assign(item,value)});
    next.scenes.forEach(s=>{if(s.locationId===id)s.locationId=""});
    next.locations=next.locations.filter(x=>x.id!==id);
  },{renderAfter:false});
  if(result.ok){renderLocationsManager();trackerFor("locationsModal").captureInitialState();render()}
}

function openTagsManager(){return requestEditorTransition(()=>{renderTagsManager();showModal("tagsModal");trackerFor("tagsModal").captureInitialState()})}

function renderTagsManager(){
  document.getElementById("tagsList").innerHTML=data.tags.map(t=>`
    <div class="manager-row tag-manager-row"><input class="tag-name-input" data-id="${esc(t.id)}" value="${esc(t.name)}" aria-label="Название тега">
    <button class="danger" onclick="deleteTag('${jsq(t.id)}')">Удалить</button></div>`).join("")||'<div class="empty-work">Тегов пока нет.</div>';
}

function saveTags(){
  const used=new Set();
  document.querySelectorAll(".tag-name-input").forEach(input=>{
    const t=tagById(input.dataset.id);if(!t)return;
    let name=canonicalTagName(input.value)||t.name;
    const key=name.toLocaleLowerCase("ru");
    if(used.has(key))return;
    used.add(key);t.name=name;
  });
}

function deleteTag(id){
  const t=tagById(id);if(!t)return;
  if(!confirm(`Удалить тег #${t.name} из всех сцен?`))return;
  const values=new Map([...document.querySelectorAll(".tag-name-input")].map(input=>[input.dataset.id,canonicalTagName(input.value)]));
  const result=commitDataChange(next=>{
    const used=new Set();next.tags.forEach(tag=>{const name=values.get(tag.id)||tag.name,key=name.toLocaleLowerCase("ru");if(!used.has(key)){tag.name=name;used.add(key)}});
    next.scenes.forEach(s=>s.tags=s.tags.filter(x=>x!==id));
    next.tags=next.tags.filter(x=>x.id!==id);
  },{renderAfter:false});
  if(result.ok){renderTagsManager();trackerFor("tagsModal").captureInitialState();render()}
}

function toggleChapter(id){
  if(!chapterById(id))return;
  commitDataChange(next=>{const chapter=next.chapters.find(c=>c.id===id);chapter.collapsed=!chapter.collapsed});
}

Object.assign(globalThis,{chapterById,locationById,tagById,writingStatusById,openChaptersManager,renderChaptersManager,saveChapterNames,moveChapter,deleteChapter,openLocationsManager,renderLocationsManager,saveLocations,deleteLocation,openTagsManager,renderTagsManager,saveTags,deleteTag,toggleChapter});
export {chapterById,locationById,tagById,writingStatusById,openChaptersManager,renderChaptersManager,saveChapterNames,moveChapter,deleteChapter,openLocationsManager,renderLocationsManager,saveLocations,deleteLocation,openTagsManager,renderTagsManager,saveTags,deleteTag,toggleChapter};
