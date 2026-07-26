function chapterById(id){return data.chapters.find(c=>c.id===id)}

function locationById(id){return data.locations.find(l=>l.id===id)}

function tagById(id){return data.tags.find(t=>t.id===id)}

function writingStatusById(id){return WRITING_STATUSES.find(x=>x.id===id)||WRITING_STATUSES[0]}

function openChaptersManager(){renderChaptersManager();showModal("chaptersModal")}

function renderChaptersManager(){
  document.getElementById("chaptersList").innerHTML=data.chapters.map((c,i)=>`
    <div class="manager-row">
      <input class="chapter-name-input" data-id="${esc(c.id)}" value="${esc(c.title)}">
      <button onclick="moveChapter('${jsq(c.id)}',-1)">↑</button><button onclick="moveChapter('${jsq(c.id)}',1)">↓</button>
      <button class="danger" onclick="deleteChapter('${jsq(c.id)}')" ${c.id==="chapter-unassigned"?"disabled":""}>Удалить</button>
    </div>`).join("");
}

function saveChapterNames(){
  document.querySelectorAll(".chapter-name-input").forEach(input=>{
    const c=chapterById(input.dataset.id);if(c&&input.value.trim())c.title=input.value.trim();
  });
}

function moveChapter(chapterId,dir){
  saveChapterNames();
  const index=data.chapters.findIndex(chapter=>chapter.id===chapterId);
  const target=index+dir;
  if(index<0||target<0||target>=data.chapters.length)return;
  [data.chapters[index],data.chapters[target]]=[data.chapters[target],data.chapters[index]];
  normalizeSceneOrder();saveData();renderChaptersManager();render();
}

function deleteChapter(id){
  const c=chapterById(id);if(!c||id==="chapter-unassigned")return;
  if(!confirm(`Удалить главу «${c.title}»? Её сцены перейдут в «Без главы».`))return;
  data.scenes.forEach(s=>{if(s.chapterId===id)s.chapterId="chapter-unassigned"});
  data.chapters=data.chapters.filter(x=>x.id!==id);
  normalizeSceneOrder();saveData();renderChaptersManager();render();
}

function openLocationsManager(){renderLocationsManager();showModal("locationsModal")}

function renderLocationsManager(){
  document.getElementById("locationsList").innerHTML=data.locations.map(l=>`
    <div class="manager-row location-row">
      <input class="location-name-input" data-id="${esc(l.id)}" value="${esc(l.name)}" placeholder="Название">
      <input class="location-desc-input" data-id="${esc(l.id)}" value="${esc(l.description)}" placeholder="Необязательное описание">
      <button class="danger" onclick="deleteLocation('${jsq(l.id)}')">Удалить</button>
    </div>`).join("");
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
  data.scenes.forEach(s=>{if(s.locationId===id)s.locationId=""});
  data.locations=data.locations.filter(x=>x.id!==id);
  saveData();renderLocationsManager();render();
}

function openTagsManager(){renderTagsManager();showModal("tagsModal")}

function renderTagsManager(){
  document.getElementById("tagsList").innerHTML=data.tags.map(t=>`
    <div class="manager-row tag-manager-row"><input class="tag-name-input" data-id="${esc(t.id)}" value="${esc(t.name)}">
    <button class="danger" onclick="deleteTag('${jsq(t.id)}')">Удалить</button></div>`).join("");
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
  data.scenes.forEach(s=>s.tags=s.tags.filter(x=>x!==id));
  data.tags=data.tags.filter(x=>x.id!==id);
  saveData();renderTagsManager();render();
}

function toggleChapter(id){
  const chapter=chapterById(id);
  if(!chapter)return;
  chapter.collapsed=!chapter.collapsed;
  saveData();render();
}

Object.assign(globalThis,{chapterById,locationById,tagById,writingStatusById,openChaptersManager,renderChaptersManager,saveChapterNames,moveChapter,deleteChapter,openLocationsManager,renderLocationsManager,saveLocations,deleteLocation,openTagsManager,renderTagsManager,saveTags,deleteTag,toggleChapter});
export {chapterById,locationById,tagById,writingStatusById,openChaptersManager,renderChaptersManager,saveChapterNames,moveChapter,deleteChapter,openLocationsManager,renderLocationsManager,saveLocations,deleteLocation,openTagsManager,renderTagsManager,saveTags,deleteTag,toggleChapter};
