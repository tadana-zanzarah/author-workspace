function sceneById(id){return data.scenes.find(s=>s.id===id)}

function sceneIndexById(id){return data.scenes.findIndex(s=>s.id===id)}

function sceneCharacterIds(scene){
  return data.characters.map(c=>c.id).filter(id=>sceneHasParticipant(scene,id));
}

function sceneCharacters(scene){
  return sceneCharacterIds(scene).map(characterName);
}

function quickEditTitle(sceneId,element){
  const scene=sceneById(sceneId);if(!scene)return;
  const input=document.createElement("input");input.value=scene.title||"";
  input.style.width="100%";element.replaceWith(input);input.focus();input.select();
  const finish=()=>{commitDataChange(next=>{const target=next.scenes.find(s=>s.id===sceneId);if(target)target.title=input.value.trim()},{renderAfter:false});scheduleRender()};
  input.onblur=finish;input.onkeydown=e=>{if(e.key==="Enter")input.blur();if(e.key==="Escape")scheduleRender()};
}

function openQuickField(sceneId,field,title,items,currentValue){
  const scene=sceneById(sceneId);if(!scene)return;
  return requestEditorTransition(()=>openQuickFieldNow(sceneId,field,title,items,currentValue));
}

function openQuickFieldNow(sceneId,field,title,items,currentValue){
  quickFieldState={sceneId,field};
  document.getElementById("quickFieldTitle").textContent=title;
  const select=document.getElementById("quickFieldSelect");
  select.innerHTML=items.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("");
  select.value=currentValue||"";
  showModal("quickFieldModal");
  trackerFor("quickFieldModal").captureInitialState();
  setTimeout(()=>select.focus(),0);
}

function quickEditLocation(sceneId){
  const scene=sceneById(sceneId);if(!scene)return;
  openQuickField(sceneId,"locationId","Изменить локацию",
    [{value:"",label:"Не указана"},...data.locations.map(l=>({value:l.id,label:l.name}))],scene.locationId);
}

function quickEditWriting(sceneId){
  const scene=sceneById(sceneId);if(!scene)return;
  openQuickField(sceneId,"writingStatus","Изменить статус написания",
    WRITING_STATUSES.map(status=>({value:status.id,label:status.label})),scene.writingStatus);
}

function quickEditChapter(sceneId){
  const scene=sceneById(sceneId);if(!scene)return;
  openQuickField(sceneId,"chapterId","Изменить главу",
    data.chapters.map(chapter=>({value:chapter.id,label:chapter.title})),scene.chapterId);
}

function selectScene(sceneId){
  selectedSceneId=sceneId;
  selectedSceneIndex=sceneIndexById(sceneId);
  renderSceneInfo();
  renderStats();
  document.querySelectorAll("[data-scene-id]").forEach(el=>el.classList.toggle("selected-scene",el.dataset.sceneId===sceneId));
}

function insertBar(beforeSceneId,chapterId,label="＋ вставить сцену здесь"){
  return `<div class="insert-row"><div class="insert-content">
    <button data-action="insert-scene" data-before-scene-id="${esc(beforeSceneId||"")}" data-chapter-id="${esc(chapterId)}">${label}</button>
  </div></div>`;
}

function normalizeSceneOrder(){
  const order=new Map(data.chapters.map((c,i)=>[c.id,i]));
  data.scenes=data.scenes.map((scene,i)=>({scene,i})).sort((a,b)=>{
    const ca=order.get(a.scene.chapterId)??9999,cb=order.get(b.scene.chapterId)??9999;
    return ca-cb||a.i-b.i;
  }).map(x=>x.scene);
}

function firstSceneIdAfterChapter(chapterId){
  const wanted=data.chapters.findIndex(c=>c.id===chapterId);
  const next=data.scenes.find(scene=>{
    const current=data.chapters.findIndex(c=>c.id===scene.chapterId);
    return current>wanted;
  });
  return next?.id||null;
}

function openNewSceneInChapter(chapterId){
  const chapterScenes=data.scenes.filter(scene=>scene.chapterId===chapterId);
  const beforeSceneId=chapterScenes.length?firstSceneIdAfterChapter(chapterId):firstSceneIdAfterChapter(chapterId);
  openNewSceneAt(beforeSceneId,chapterId);
}

function openNewSceneAt(beforeSceneId=null,chapterId=""){
  return requestEditorTransition(()=>openNewSceneAtNow(beforeSceneId,chapterId));
}

function openNewSceneAtNow(beforeSceneId=null,chapterId=""){
  editingSceneId=null;
  insertBeforeSceneId=beforeSceneId||null;
  const before=beforeSceneId?sceneById(beforeSceneId):null;
  insertChapterId=chapterId||before?.chapterId||filters.chapter||data.chapters[0]?.id||"chapter-unassigned";
  document.getElementById("sceneModalTitle").textContent="Новая сцена";
  document.getElementById("sceneDate").value="";
  document.getElementById("sceneTime").value="";
  document.getElementById("sceneTitle").value="";
  document.getElementById("sceneText").value="";
  document.getElementById("sceneStatus").value="floating";
  document.getElementById("sceneIncluded").checked=true;
  populateSceneSelectors();
  document.getElementById("sceneChapter").value=insertChapterId;
  document.getElementById("sceneLocation").value="";
  document.getElementById("sceneWritingStatus").value="idea";
  sceneTagDraft=[];
  sceneNewTagDraft={};
  renderSceneTagDraft();
  const insertionIndex=insertBeforeSceneId?sceneIndexById(insertBeforeSceneId):data.scenes.length;
  buildPeopleForm({},insertionIndex<0?data.scenes.length:insertionIndex);
  showModal("sceneModal");
  resetSceneModalScroll();
  trackerFor("sceneModal").captureInitialState();
}

function resetSceneModalScroll(){
  const scrollBox=document.querySelector("#sceneModal .modal");
  if(scrollBox)scrollBox.scrollTop=0;
}

function editScene(sceneId){
  return requestEditorTransition(()=>editSceneNow(sceneId));
}

function editSceneNow(sceneId){
  editingSceneId=sceneId;
  insertBeforeSceneId=null;
  insertChapterId=null;
  const s=sceneById(sceneId);
  if(!s)return;
  const index=sceneIndexById(sceneId);
  document.getElementById("sceneModalTitle").textContent="Изменить сцену";
  document.getElementById("sceneDate").value=s.date||"";
  document.getElementById("sceneTime").value=s.time||"";
  document.getElementById("sceneTitle").value=s.title||"";
  document.getElementById("sceneText").value=s.sceneText||"";
  document.getElementById("sceneStatus").value=s.status||"floating";
  document.getElementById("sceneIncluded").checked=s.included!==false;
  populateSceneSelectors();
  document.getElementById("sceneChapter").value=s.chapterId||"chapter-unassigned";
  document.getElementById("sceneLocation").value=s.locationId||"";
  document.getElementById("sceneWritingStatus").value=s.writingStatus||"idea";
  sceneTagDraft=[...(s.tags||[])];
  sceneNewTagDraft={};
  renderSceneTagDraft();
  buildPeopleForm(s.people||{},index);
  showModal("sceneModal");
  resetSceneModalScroll();
  trackerFor("sceneModal").captureInitialState();
}

function populateSceneSelectors(){
  document.getElementById("sceneChapter").innerHTML=data.chapters.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("");
  document.getElementById("sceneLocation").innerHTML='<option value="">Локация не указана</option>'+
    data.locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  document.getElementById("sceneWritingStatus").innerHTML=WRITING_STATUSES.map(s=>`<option value="${s.id}">${s.label}</option>`).join("");
  document.getElementById("tagOptions").innerHTML=data.tags.map(t=>`<option value="${esc(t.name)}"></option>`).join("");
}

function ensureTag(name){
  const clean=canonicalTagName(name);
  if(!clean)return null;
  const existing=data.tags.find(t=>t.name.toLocaleLowerCase("ru")===clean.toLocaleLowerCase("ru"));
  if(existing)return existing.id;
  const draftEntry=Object.entries(sceneNewTagDraft).find(([,value])=>value.toLocaleLowerCase("ru")===clean.toLocaleLowerCase("ru"));
  if(draftEntry)return draftEntry[0];
  const id=makeId("tag");sceneNewTagDraft[id]=clean;return id;
}

function addTagToDraft(){
  const input=document.getElementById("sceneTagInput");
  const parts=input.value.split(/[,;]+/).map(x=>x.trim()).filter(Boolean);
  parts.forEach(name=>{
    const id=ensureTag(name);
    if(id&&!sceneTagDraft.includes(id))sceneTagDraft.push(id);
  });
  input.value="";
  renderSceneTagDraft();
  syncBeforeUnload();
}

function renderSceneTagDraft(){
  document.getElementById("sceneTagDraftList").innerHTML=sceneTagDraft.map(id=>{
    const tag=tagById(id),name=tag?.name||sceneNewTagDraft[id];return name?`<button type="button" onclick="removeSceneTag('${jsq(id)}')">#${esc(name)} ×</button>`:"";
  }).join("");
}

function removeSceneTag(id){sceneTagDraft=sceneTagDraft.filter(x=>x!==id);renderSceneTagDraft();syncBeforeUnload()}

function buildPeopleForm(people,sceneIndex){
  sceneBuildIndex=sceneIndex;
  sceneParticipantDraft=Object.fromEntries(Object.entries(people||{}).map(([id,p])=>[id,{action:p.action||"",legacyState:p.legacyState||"",relationChanges:{...(p.relationChanges||{})},visibleRelations:[...(p.visibleRelations||[])]}]));
  renderPeopleBlocks();
}

function syncPeopleDraftFromDom(){
  for(const charId of Object.keys(sceneParticipantDraft)){
    const actionEl=document.querySelector(`.p-action[data-char-id="${cssEscape(charId)}"]`);
    if(!actionEl)continue;
    const legacyEl=document.querySelector(`.p-legacy[data-char-id="${cssEscape(charId)}"]`);
    const relationChanges={};
    document.querySelectorAll(`.rel-value[data-char-id="${cssEscape(charId)}"]`).forEach(input=>{
      if(input.dataset.explicit==="true")relationChanges[input.dataset.targetId]=input.value;
    });
    const visibleRelations=[];
    document.querySelectorAll(`.rel-visible[data-char-id="${cssEscape(charId)}"]:checked`).forEach(cb=>{
      const target=cb.dataset.targetId;
      const input=document.querySelector(`.rel-value[data-char-id="${cssEscape(charId)}"][data-target-id="${cssEscape(target)}"]`);
      if(input&&input.value.trim())visibleRelations.push(target);
    });
    sceneParticipantDraft[charId]={action:actionEl.value,legacyState:legacyEl?legacyEl.value:(sceneParticipantDraft[charId].legacyState||""),relationChanges,visibleRelations};
  }
}

function renderPeopleBlocks(){
  const inherited=relationshipsBefore(sceneBuildIndex);
  const participantIds=data.characters.map(c=>c.id).filter(id=>Object.prototype.hasOwnProperty.call(sceneParticipantDraft,id));
  document.getElementById("scenePersons").innerHTML=participantIds.map(charId=>{
    const character=characterById(charId);
    const p=sceneParticipantDraft[charId]||{};
    const rows=data.characters.filter(target=>target.id!==charId).map(target=>{
      const targetId=target.id;
      const inheritedValue=inherited[charId]?.[targetId]||"";
      const hasChange=Object.prototype.hasOwnProperty.call(p.relationChanges||{},targetId);
      const displayedValue=hasChange?(p.relationChanges[targetId]||""):inheritedValue;
      const checked=(p.visibleRelations||[]).includes(targetId);
      return `<div class="relation-row ${hasChange?"explicit":""}" data-relation-row>
        <div class="relation-name">
          ${esc(target.name)}
          <span class="changed-note relation-explicit-note" style="${hasChange?"":"display:none"}">задано здесь</span>
        </div>
        <input class="rel-value"
          data-char-id="${esc(charId)}"
          data-target-id="${esc(targetId)}"
          data-inherited="${esc(inheritedValue)}"
          data-explicit="${hasChange?"true":"false"}"
          value="${esc(displayedValue)}"
          placeholder="Отношение не задано"
          oninput="relationEdited(this)">
        <label class="show-box">
          <input type="checkbox" class="rel-visible"
            data-char-id="${esc(charId)}"
            data-target-id="${esc(targetId)}"
            ${checked?"checked":""}>
          показывать
        </label>
        <button type="button" class="inherit-btn" onclick="resetToInherited(this)">Наследовать</button>
      </div>`;
    }).join("");

    return `<div class="person-block" data-participant-id="${esc(charId)}">
      <div class="person-block-header">
        <h3>${esc(character?.name||"Неизвестный персонаж")}</h3>
        <button type="button" class="danger" onclick="removeSceneParticipant('${jsq(charId)}')">Убрать из сцены</button>
      </div>
      <label>
        <span class="field-caption">События сцены</span>
        <textarea class="p-action action-input" data-char-id="${esc(charId)}" placeholder="Что делает персонаж">${esc(p.action||"")}</textarea>
      </label>
      ${(p.legacyState||"").trim()?`
        <div class="legacy-note">
          <span class="field-caption">Старая заметка из предыдущей версии</span>
          <textarea class="p-legacy" data-char-id="${esc(charId)}">${esc(p.legacyState)}</textarea>
        </div>`:""}
      <div class="relations-editor">
        <div class="relations-editor-title">
          <strong>Отношение к другим персонажам</strong>
          <span>Введённое вручную значение закрепляется за этой сценой и не меняется при переносе</span>
        </div>
        ${rows}
      </div>
    </div>`;
  }).join("")||'<p class="profile-note">В сцене пока нет персонажей. Выберите персонажа выше и нажмите «Добавить персонажа».</p>';
  renderSceneParticipantSelector();
}

function renderSceneParticipantSelector(){
  const select=document.getElementById("sceneParticipantSelect");
  if(!select)return;
  const available=data.characters.filter(c=>!Object.prototype.hasOwnProperty.call(sceneParticipantDraft,c.id));
  select.innerHTML=data.characters.map(c=>{
    const added=Object.prototype.hasOwnProperty.call(sceneParticipantDraft,c.id);
    return `<option value="${esc(c.id)}" ${added?"disabled":""}>${esc(c.name)}${added?" (уже в сцене)":""}</option>`;
  }).join("")||'<option value="" disabled>Персонажей в проекте нет</option>';
  const defaultSelection=available[0]?.id||"";
  select.value=defaultSelection;
  document.getElementById("addSceneParticipant").disabled=!defaultSelection;
}

function addSceneParticipant(){
  syncPeopleDraftFromDom();
  const select=document.getElementById("sceneParticipantSelect");
  const charId=select.value;
  if(!charId||Object.prototype.hasOwnProperty.call(sceneParticipantDraft,charId))return;
  sceneParticipantDraft[charId]={action:"",legacyState:"",relationChanges:{},visibleRelations:[]};
  renderPeopleBlocks();
  syncBeforeUnload();
}

async function removeSceneParticipant(charId){
  syncPeopleDraftFromDom();
  const hasContent=personHasContent(sceneParticipantDraft[charId]);
  if(hasContent){
    const confirmed=await showConfirmAction({
      title:"Убрать персонажа из сцены?",
      description:`«${characterName(charId)}» будет убран из этой сцены. Введённые для него данные в этой сцене будут потеряны при сохранении.`,
      confirmLabel:"Убрать",cancelLabel:"Отмена"
    });
    if(!confirmed)return;
  }
  delete sceneParticipantDraft[charId];
  renderPeopleBlocks();
  syncBeforeUnload();
}

function markRelationExplicit(input,isExplicit){
  input.dataset.explicit=isExplicit?"true":"false";
  const row=input.closest("[data-relation-row]");
  if(row){
    row.classList.toggle("explicit",isExplicit);
    const note=row.querySelector(".relation-explicit-note");
    if(note)note.style.display=isExplicit?"inline-block":"none";
  }
}

function relationEdited(input){
  // Любое ручное редактирование становится явным решением этой сцены.
  // Даже если текст случайно совпадает с текущим наследуемым значением,
  // он не исчезнет после перемещения сцены.
  markRelationExplicit(input,true);
  const charId=input.dataset.charId;
  const targetId=input.dataset.targetId;
  const checkbox=document.querySelector(`.rel-visible[data-char-id="${cssEscape(charId)}"][data-target-id="${cssEscape(targetId)}"]`);
  if(checkbox)checkbox.checked=true;
}

function resetToInherited(button){
  const row=button.closest("[data-relation-row]");
  if(!row)return;
  const input=row.querySelector(".rel-value");
  const checkbox=row.querySelector(".rel-visible");
  input.value=input.dataset.inherited||"";
  markRelationExplicit(input,false);
  // Наследуемое отношение можно всё равно показывать вручную,
  // поэтому галочку не снимаем.
  if(checkbox&&input.value.trim()==="")checkbox.checked=false;
}

function openSceneText(sceneId){
  return requestEditorTransition(()=>openSceneTextNow(sceneId));
}

function openSceneTextNow(sceneId){
  textEditingSceneId=sceneId;
  const scene=sceneById(sceneId);
  if(!scene)return;
  document.getElementById("textModalTitle").textContent=scene.title||"Текст сцены";
  const parts=[];
  if(scene.date)parts.push(scene.date.split("-").reverse().join("."));
  if(scene.time)parts.push(scene.time);
  parts.push(scene.status==="fixed"?"сцена на своём месте":"сцену ещё нужно разместить");
  document.getElementById("textModalMeta").textContent=parts.join(" · ");
  document.getElementById("fullSceneText").value=scene.sceneText||"";
  showModal("textModal");
  trackerFor("textModal").captureInitialState();
  setTimeout(()=>document.getElementById("fullSceneText").focus(),0);
}

async function toggleIncluded(sceneId,checked){
  if(!sceneById(sceneId))return;
  if(isCloudWorkspace()){const scene={...sceneById(sceneId),included:checked};return runCloudMutation("updateScene",(api,revision)=>api.updateScene(cloudProjectSync.projectId,sceneId,revision,sceneToCloud(scene)))}
  commitDataChange(next=>{next.scenes.find(s=>s.id===sceneId).included=checked},{renderAfter:false});
  scheduleRender();
}

async function confirmSceneDate(sceneId){
  if(!sceneById(sceneId))return;
  if(isCloudWorkspace()){const scene={...sceneById(sceneId),dateReview:false};return runCloudMutation("updateScene",(api,revision)=>api.updateScene(cloudProjectSync.projectId,sceneId,revision,sceneToCloud(scene)))}
  const result=commitDataChange(next=>{next.scenes.find(s=>s.id===sceneId).dateReview=false},{renderAfter:false});
  if(result.ok)scheduleRender();
}

async function quickUpdate(sceneId,key,value){
  const current=sceneById(sceneId);if(!current||current[key]===value)return;
  if(isCloudWorkspace()){const scene={...current,[key]:value};if(key==="date"||key==="time")scene.dateReview=true;return runCloudMutation("updateScene",(api,revision)=>api.updateScene(cloudProjectSync.projectId,sceneId,revision,sceneToCloud(scene)))}
  const result=commitDataChange(next=>{const scene=next.scenes.find(s=>s.id===sceneId);scene[key]=value;if(key==="date"||key==="time")scene.dateReview=true},{renderAfter:false});
  if(result.ok)scheduleRender();else scheduleRender();
}

async function deleteScene(sceneId){
  const scene=sceneById(sceneId);
  if(!scene)return;
  if(confirm(`Удалить сцену «${scene.title||"Без названия"}»?`)){
    if(isCloudWorkspace()){
      const result=await runCloudMutation("deleteScene",(api,revision)=>api.deleteScene(cloudProjectSync.projectId,sceneId,revision));
      if(result.ok&&sceneId===selectedSceneId){selectedSceneId=null;selectedSceneIndex=null;render()}return result;
    }
    const result=commitDataChange(next=>{
      const index=next.scenes.findIndex(item=>item.id===sceneId);
      if(index>=0)next.scenes.splice(index,1);
    },{renderAfter:false});
    if(!result.ok)return;
    if(sceneId===selectedSceneId){selectedSceneId=null;selectedSceneIndex=null}
    render();
  }
}

Object.assign(globalThis,{sceneById,sceneIndexById,sceneCharacterIds,sceneCharacters,quickEditTitle,openQuickField,quickEditLocation,quickEditWriting,quickEditChapter,selectScene,insertBar,normalizeSceneOrder,firstSceneIdAfterChapter,openNewSceneInChapter,openNewSceneAt,editScene,populateSceneSelectors,ensureTag,addTagToDraft,renderSceneTagDraft,removeSceneTag,buildPeopleForm,syncPeopleDraftFromDom,renderPeopleBlocks,renderSceneParticipantSelector,addSceneParticipant,removeSceneParticipant,resetSceneModalScroll,markRelationExplicit,relationEdited,resetToInherited,openSceneText,toggleIncluded,confirmSceneDate,quickUpdate,deleteScene});
export {sceneById,sceneIndexById,sceneCharacterIds,sceneCharacters,quickEditTitle,openQuickField,quickEditLocation,quickEditWriting,quickEditChapter,selectScene,insertBar,normalizeSceneOrder,firstSceneIdAfterChapter,openNewSceneInChapter,openNewSceneAt,editScene,populateSceneSelectors,ensureTag,addTagToDraft,renderSceneTagDraft,removeSceneTag,buildPeopleForm,syncPeopleDraftFromDom,renderPeopleBlocks,renderSceneParticipantSelector,addSceneParticipant,removeSceneParticipant,resetSceneModalScroll,markRelationExplicit,relationEdited,resetToInherited,openSceneText,toggleIncluded,confirmSceneDate,quickUpdate,deleteScene};
