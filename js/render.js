function projectReadiness(){
  const weights={idea:0,plan:20,draft:50,edit1:80,edit2:80,final:100};
  if(!data.scenes.length)return 0;
  return Math.round(data.scenes.reduce((sum,s)=>sum+(weights[s.writingStatus]??0),0)/data.scenes.length);
}

function renderDashboard(){
  const totalWords=data.scenes.reduce((n,s)=>n+countWords(s.sceneText),0);
  const readiness=projectReadiness();
  const counts=WRITING_STATUSES.map(status=>[status,data.scenes.filter(s=>s.writingStatus===status.id).length]);
  document.getElementById("projectDashboard").innerHTML=`
    <div class="dashboard-top"><div class="dashboard-title">Проект</div>
      <div class="view-switch">${counts.map(([s,n])=>`<span class="stat-pill writing-chip ${s.id}">${s.label}: <strong>${n}</strong></span>`).join("")}</div>
    </div>
    <div class="dashboard-metrics">
      ${[["Сцен",data.scenes.length],["Глав",data.chapters.filter(c=>c.id!=="chapter-unassigned").length],["Персонажей",data.characters.length],["Локаций",data.locations.length],["Тегов",data.tags.length],["Слов",totalWords]].map(([k,v])=>`<div class="dashboard-metric">${k}<strong>${v}</strong></div>`).join("")}
    </div>
    <div class="progress-wrap">
      <div class="progress-label"><span>Общая готовность</span><strong>${readiness}%</strong></div>
      <div class="progress-track"><div class="progress-bar" style="width:${readiness}%"></div></div>
    </div>`;
}

function renderSceneInfo(){
  const root=document.getElementById("sceneInfoContent");
  const scene=selectedSceneIndex!==null?data.scenes[selectedSceneIndex]:null;
  if(!scene){root.innerHTML='<p class="profile-note">Выберите сцену в любом режиме просмотра.</p>';return}
  const chapter=chapterById(scene.chapterId),loc=locationById(scene.locationId),ws=writingStatusById(scene.writingStatus);
  const charIds=sceneCharacterIds(scene),chars=charIds.map(characterName),tags=scene.tags.map(id=>tagById(id)).filter(Boolean);
  const prev=selectedSceneIndex>0?data.scenes[selectedSceneIndex-1]:null;
  const next=selectedSceneIndex<data.scenes.length-1?data.scenes[selectedSceneIndex+1]:null;
  root.innerHTML=`
    <div class="info-section" style="border-top:0;margin-top:8px;padding-top:0">
      <div class="info-row"><strong>Название</strong><br>${esc(scene.title||"Без названия")}</div>
      <div class="info-row"><strong>Дата</strong><br>${esc(readableDate(scene)||"Не указана")}</div>
      <div class="info-row"><strong>Глава</strong><br><button class="entity-link" onclick="setFilter('chapter','${jsq(chapter?.id||"")}')">${esc(chapter?.title||"Без главы")}</button></div>
      <div class="info-row"><strong>Локация</strong><br>${loc?`<button class="entity-link" onclick="setFilter('location','${jsq(loc.id)}')">${esc(loc.name)}</button>`:"Не указана"}</div>
      <div class="info-row"><strong>Статус</strong><br>${esc(ws.label)} · ${scene.status==="fixed"?"на своём месте":"нужно разместить"}</div>
      <div class="info-row"><strong>Слов</strong><br>${countWords(scene.sceneText)}</div>
    </div>
    <div class="info-section"><strong style="font-size:12px;color:var(--muted)">Персонажи</strong><div class="scene-meta" style="margin-top:6px">${charIds.map(id=>`<button class="meta-chip entity-link" onclick="setFilter('character','${jsq(id)}')">${esc(characterName(id))}</button>`).join("")||"—"}</div></div>
    <div class="info-section"><strong style="font-size:12px;color:var(--muted)">Теги</strong><div class="scene-meta" style="margin-top:6px">${tags.map(t=>`<button class="tag-chip entity-link" onclick="setFilter('tag','${jsq(t.id)}')">#${esc(t.name)}</button>`).join("")||"—"}</div></div>
    <div class="info-nav">
      <button ${prev?"":"disabled"} onclick="${prev?`selectScene('${jsq(prev?.id||'')}')`:""}">← ${prev?esc(prev.title||"Предыдущая"):"Нет"}</button>
      <button ${next?"":"disabled"} onclick="${next?`selectScene('${jsq(next?.id||'')}')`:""}">${next?esc(next.title||"Следующая"):"Нет"} →</button>
    </div>
    <div class="row-actions" style="margin-top:10px"><button onclick="openSceneText('${jsq(scene.id)}')">Текст</button><button onclick="editScene('${jsq(scene.id)}')">Редактировать</button></div>`;
}

function refreshControls(){
  const preserve=(id)=>document.getElementById(id)?.value||"";
  const opts=(items,value,label)=>`<option value="">Все</option>`+items.map(x=>`<option value="${esc(value(x))}">${esc(label(x))}</option>`).join("");
  document.getElementById("filterChapter").innerHTML=opts(data.chapters,x=>x.id,x=>x.title);
  document.getElementById("filterCharacter").innerHTML=opts(data.characters,x=>x.id,x=>x.name);
  document.getElementById("filterLocation").innerHTML=opts(data.locations,x=>x.id,x=>x.name);
  document.getElementById("filterTag").innerHTML=opts(data.tags,x=>x.id,x=>"#"+x.name);
  document.getElementById("filterWriting").innerHTML=opts(WRITING_STATUSES,x=>x.id,x=>x.label);
  document.getElementById("filterChapter").value=filters.chapter;
  document.getElementById("filterCharacter").value=filters.character;
  document.getElementById("filterLocation").value=filters.location;
  document.getElementById("filterTag").value=filters.tag;
  document.getElementById("filterWriting").value=filters.writing;
  document.getElementById("filterPlacement").value=filters.placement;
  document.getElementById("projectSearch").value=filters.search;
}

function renderSidebar(){
  const countBy=predicate=>data.scenes.filter(predicate).length;
  const userChapters=data.chapters.filter(c=>c.id!=="chapter-unassigned");
  document.getElementById("sideChapters").innerHTML=userChapters.map(c=>`<button class="sidebar-item ${filters.chapter===c.id?"active":""}" onclick="setFilter('chapter','${jsq(c.id)}')">${esc(c.title)}<span class="sidebar-count">${countBy(s=>s.chapterId===c.id)}</span></button>`).join("")||'<div class="profile-note">Глав пока нет</div>';
  document.getElementById("sideCharacters").innerHTML=data.characters.map(c=>`<button class="sidebar-item ${filters.character===c.id?"active":""}" onclick="setFilter('character','${jsq(c.id)}')">${esc(c.name)}<span class="sidebar-count">${countBy(s=>sceneHasParticipant(s,c.id))}</span></button>`).join("")||'<div class="profile-note">Персонажей пока нет</div>';
  document.getElementById("sideLocations").innerHTML=data.locations.map(l=>`<button class="sidebar-item ${filters.location===l.id?"active":""}" onclick="setFilter('location','${jsq(l.id)}')">${esc(l.name)}<span class="sidebar-count">${countBy(s=>s.locationId===l.id)}</span></button>`).join("")||'<div class="profile-note">Локаций пока нет</div>';
  document.getElementById("sideTags").innerHTML=data.tags.slice(0,80).map(t=>`<button class="sidebar-item ${filters.tag===t.id?"active":""}" onclick="setFilter('tag','${jsq(t.id)}')">#${esc(t.name)}<span class="sidebar-count">${countBy(s=>s.tags.includes(t.id))}</span></button>`).join("")||'<div class="profile-note">Тегов пока нет</div>';
}

function renderStats(){
  const totalWords=data.scenes.reduce((n,s)=>n+countWords(s.sceneText),0);
  const selected=selectedSceneIndex!==null&&data.scenes[selectedSceneIndex]?countWords(data.scenes[selectedSceneIndex].sceneText):0;
  const finals=data.scenes.filter(s=>s.writingStatus==="final").length;
  const readiness=projectReadiness();
  document.getElementById("statsStrip").innerHTML=[
    ["Глав",data.chapters.filter(c=>c.id!=="chapter-unassigned").length],["Сцен",data.scenes.length],
    ["Персонажей",data.characters.length],["Локаций",data.locations.length],["Тегов",data.tags.length],
    ["Слов",totalWords],["В выбранной сцене",selected],["Финал",finals],["Готовность",readiness+"%"]
  ].map(([k,v])=>`<span class="stat-pill">${k}: <strong>${v}</strong></span>`).join("");
}

function renderFilterSummary(){
  const el=document.getElementById("filterSummary");
  if(!el)return;
  if(!hasActiveFilters()){el.hidden=true;el.textContent="";el.classList.remove("no-results");return}
  const total=data.scenes.length;
  const visible=getVisibleSceneEntries().length;
  el.hidden=false;
  el.classList.toggle("no-results",visible===0);
  el.innerHTML=visible
    ?`<span>Найдено сцен: <strong>${visible}</strong> из ${total}</span><span>Порядок сцен временно не редактируется, пока активен поиск или фильтр.</span>`
    :`<span>По текущему поиску и фильтрам ничего не найдено.</span>`;
}

function render(){
  if(selectedSceneId){
    const resolved=data.scenes.findIndex(s=>s.id===selectedSceneId);
    selectedSceneIndex=resolved>=0?resolved:null;
  }
  refreshControls();
  renderFilterSummary();
  renderSidebar();
  renderDashboard();
  renderStats();
  renderSceneInfo();
  renderViewSwitch();
  const board=document.getElementById("board");
  board.className="board view-"+currentView+(hasActiveFilters()?" drag-disabled":"")+(data.characters.length?"":" no-characters");
  const userChapters=data.chapters.filter(c=>c.id!=="chapter-unassigned");
  if(!hasActiveFilters()&&!data.scenes.length&&!data.characters.length&&!userChapters.length&&!data.locations.length&&!data.tags.length){
    board.style.removeProperty("--cols");
    board.innerHTML=`<section class="workspace-empty-state">
      <h2>Начните работу над проектом</h2>
      <p>Создайте персонажей и первую сцену, чтобы начать строить историю. Сцену можно создать и без персонажей.</p>
      <div class="empty-state-actions">
        <button class="primary" onclick="renderProfiles();showModal('charsModal')">Создать персонажа</button>
        <button onclick="openNewSceneAt(null,'chapter-unassigned')">Создать сцену</button>
        <button onclick="openChaptersManager()">Создать главу</button>
      </div>
    </section>`;
    return;
  }
  if(currentView==="cards")renderCardsView(board);
  else if(currentView==="list")renderListView(board);
  else renderTableView(board);
}

function scheduleRender(){
  if(renderQueued)return;
  renderQueued=true;
  requestAnimationFrame(()=>{renderQueued=false;render()});
}

function renderViewSwitch(){
  document.querySelectorAll("#viewSwitch button").forEach(btn=>btn.classList.toggle("active",btn.dataset.view===currentView));
}

function renderTableView(board){
  board.style.setProperty("--cols",data.characters.length);
  let html=`<div class="board-grid board-head">
    <div class="head-cell sticky-cell">Сцена</div>
    ${data.characters.map(c=>`<div class="head-cell"><button class="entity-link" onclick="setFilter('character','${jsq(c.id)}')">${esc(c.name)}</button></div>`).join("")}
  </div>`;
  let shown=0;
  data.chapters.forEach(chapter=>{
    const chapterScenes=data.scenes.map((scene,index)=>({scene,index})).filter(x=>x.scene.chapterId===chapter.id&&sceneMatches(x.scene));
    const allCount=data.scenes.filter(s=>s.chapterId===chapter.id).length;
    if(!chapterScenes.length&&hasActiveFilters())return;
    html+=renderChapterDivider(chapter,allCount,hasActiveFilters()?chapterScenes.length:null);
    if(chapter.collapsed)return;
    if(!chapterScenes.length){
      html+=`<div class="insert-row"><div class="chapter-empty">В этой главе пока нет сцен<br><button data-action="insert-scene" data-before-scene-id="${esc(firstSceneIdAfterChapter(chapter.id)||"")}" data-chapter-id="${esc(chapter.id)}">＋ Добавить сцену</button></div></div>`;
      return;
    }
    chapterScenes.forEach(({scene,index})=>{shown++;html+=renderTableScene(scene,index,chapter)});
    html+=insertBar(firstSceneIdAfterChapter(chapter.id),chapter.id,"＋ добавить в конец главы");
  });
  if(!shown&&hasActiveFilters())html+=emptySearchMessage();
  board.innerHTML=html;
}

function renderChapterDivider(chapter,count,matchedCount=null){
  const summary=matchedCount===null||matchedCount===count?`${count} сцен`:`${matchedCount} из ${count} сцен`;
  return `<div class="insert-row"><div class="chapter-divider">
    <button aria-label="${chapter.collapsed?"Развернуть":"Свернуть"} главу ${esc(chapter.title)}" onclick="toggleChapter('${jsq(chapter.id)}')">${chapter.collapsed?"▸":"▾"}</button>
    <button class="entity-link" onclick="setFilter('chapter','${jsq(chapter.id)}')"><strong>${esc(chapter.title)}</strong></button>
    <span class="chapter-summary">${summary}</span>
    <div class="chapter-actions">
      <button onclick="openNewSceneInChapter('${jsq(chapter.id)}')">＋ сцена</button>
      <button onclick="openChaptersManager()">Настроить</button>
    </div>
  </div></div>`;
}

function sceneMetadataHtml(scene,chapter,loc,ws){
  const tags=scene.tags.map(id=>tagById(id)).filter(Boolean);
  return `<div class="scene-meta">
    <button class="meta-chip entity-link" ondblclick="event.stopPropagation();quickEditChapter('${jsq(scene.id)}')" onclick="event.stopPropagation();setFilter('chapter','${jsq(chapter.id)}')">📚 ${esc(chapter.title)}</button>
    ${loc?`<button class="meta-chip entity-link" ondblclick="event.stopPropagation();quickEditLocation('${jsq(scene.id)}')" onclick="event.stopPropagation();setFilter('location','${jsq(loc.id)}')">📍 ${esc(loc.name)}</button>`:`<button class="meta-chip entity-link" ondblclick="event.stopPropagation();quickEditLocation('${jsq(scene.id)}')">📍 не указана</button>`}
    <button class="meta-chip writing-chip ${ws.id} entity-link" ondblclick="event.stopPropagation();quickEditWriting('${jsq(scene.id)}')">📝 ${esc(ws.label)}</button>
    <span class="scene-kind ${scene.status==="fixed"?"fixed":"floating"}">${scene.status==="fixed"?"На месте":"Разместить"}</span>
  </div>
  ${tags.length?`<div class="scene-meta">${tags.map(t=>`<button class="tag-chip entity-link" onclick="event.stopPropagation();setFilter('tag','${jsq(t.id)}')">🏷 #${esc(t.name)}</button>`).join("")}</div>`:""}`;
}

function renderTableScene(scene,i,chapter){
  const relationState=relationshipsAt(i);
  const needsDateReview=!!scene.dateReview;
  const hasDateConflict=chronologicalWarning(i);
  const loc=locationById(scene.locationId);
  const ws=writingStatusById(scene.writingStatus);
  let html=insertBar(scene.id,chapter.id);
  html+=`<div class="scene-row ${scene.status==="fixed"?"fixed":"floating"} ${scene.included===false?"excluded":""} ${selectedSceneIndex===i?"selected-scene":""}" data-scene-id="${esc(scene.id)}"
    onclick="selectScene('${jsq(scene.id)}')" ondragover="dragOver(event,'${jsq(scene.id)}')"
    ondragleave="dragLeave(event)" ondrop="dropScene(event,'${jsq(scene.id)}')" ondragend="dragEnd(event)">`;
  html+=`<div class="cell time-cell sticky-cell">
    <div class="drag-handle" draggable="true" aria-label="Перетащить сцену ${esc(scene.title||"Без названия")}" title="${hasActiveFilters()?"Чтобы менять порядок сцен, сбросьте фильтры.":"Перетащить сцену"}" ondragstart="dragStart(event,'${jsq(scene.id)}')">↕ Перетащить сцену</div>
    <div class="scene-title quick-editable" ondblclick="event.stopPropagation();quickEditTitle('${jsq(scene.id)}',this)">${esc(scene.title||"Без названия")}</div>
    ${sceneMetadataHtml(scene,chapter,loc,ws)}
    <div class="scene-meta"><span class="meta-chip">👥 ${sceneCharacters(scene).map(esc).join(", ")||"нет участников"}</span></div>
    <div class="date-time">
      <input class="${hasDateConflict?"date-conflict":needsDateReview?"date-review":""}" type="date" value="${esc(scene.date||"")}" onchange="quickUpdate('${jsq(scene.id)}','date',this.value)">
      <input class="${hasDateConflict?"date-conflict":needsDateReview?"date-review":""}" type="time" value="${esc(scene.time||"")}" onchange="quickUpdate('${jsq(scene.id)}','time',this.value)">
    </div>
    ${needsDateReview?`<div class="date-status-note review">Дата ещё не проверена <button class="date-confirm-btn" onclick="event.stopPropagation();confirmSceneDate('${jsq(scene.id)}')">✓ Дата проверена</button></div>`:""}
    ${hasDateConflict?'<div class="date-status-note conflict">Дата конфликтует с хронологией соседних сцен</div>':""}
    <label class="include-toggle"><input type="checkbox" ${scene.included!==false?"checked":""} onchange="toggleIncluded('${jsq(scene.id)}',this.checked)"> включить в работу</label>
    <div class="row-actions">
      <button onclick="event.stopPropagation();openSceneText('${jsq(scene.id)}')">Текст</button>
      <button onclick="event.stopPropagation();editScene('${jsq(scene.id)}')">Изменить</button>
      <button class="danger" onclick="event.stopPropagation();deleteScene('${jsq(scene.id)}')">Удалить</button>
    </div>
  </div>`;
  data.characters.forEach(character=>{
    const charId=character.id;
    const p=scene.people?.[charId];
    html+=`<div class="cell">`;
    if(personHasContent(p)){
      const visible=(p.visibleRelations||[]).filter(t=>relationState[charId]?.[t]);
      const changed=new Set(Object.keys(p.relationChanges||{}));
      html+=`<div class="card">`;
      if((p.action||"").trim())html+=`<div class="card-action">${esc(p.action)}</div>`;
      if((p.legacyState||"").trim())html+=`<div class="legacy-note"><strong>Старая заметка:</strong><br>${esc(p.legacyState)}</div>`;
      if(visible.length){
        html+=`<div class="relations-title">Отношения</div>`;
        visible.forEach(target=>html+=`<div class="relation-chip ${changed.has(target)?"changed":""}"><span class="relation-target">${esc(characterName(target))}:</span> ${esc(relationState[charId][target])}</div>`);
      }
      if(!(p.action||"").trim()&&!(p.legacyState||"").trim()&&!visible.length)html+=`<div class="empty" style="padding-top:38px">отношения скрыты</div>`;
      html+=`</div>`;
    }else if(sceneHasParticipant(scene,charId))html+=`<div class="empty">участвует, без описания</div>`;
    else html+=`<div class="empty">не участвует</div>`;
    html+=`</div>`;
  });
  return html+`</div>`;
}

function renderCardsView(board){
  const entries=getVisibleSceneEntries();
  board.style.removeProperty("--cols");
  board.innerHTML=entries.length?`<div class="scene-cards-grid">${entries.map(({scene,index})=>renderCompactCard(scene,index)).join("")}</div>`:emptySceneMessage();
}

function renderCompactCard(scene,index){
  const chapter=chapterById(scene.chapterId),loc=locationById(scene.locationId),ws=writingStatusById(scene.writingStatus);
  const charIds=sceneCharacterIds(scene),chars=charIds.map(characterName),tags=scene.tags.map(id=>tagById(id)).filter(Boolean);
  const description=chars.map(c=>scene.people?.[c]?.action||"").filter(Boolean).join(" ");
  return `<article class="compact-scene-card ${scene.status} ${selectedSceneIndex===index?"selected-scene":""}" data-scene-id="${esc(scene.id)}" onclick="selectScene('${jsq(scene.id)}')" ondblclick="editScene('${jsq(scene.id)}')">
    <div class="compact-card-title quick-editable" ondblclick="event.stopPropagation();quickEditTitle('${jsq(scene.id)}',this)">${esc(scene.title||"Без названия")}</div>
    <div class="scene-meta">
      <button class="meta-chip entity-link" onclick="event.stopPropagation();setFilter('chapter','${jsq(chapter?.id||"")}')">📚 ${esc(chapter?.title||"Без главы")}</button>
      <span class="meta-chip">🕒 ${esc(readableDate(scene)||"без даты")}</span>
      ${loc?`<button class="meta-chip entity-link" onclick="event.stopPropagation();setFilter('location','${jsq(loc.id)}')">📍 ${esc(loc.name)}</button>`:""}
      <span class="meta-chip writing-chip ${ws.id}">📝 ${esc(ws.label)}</span>
    </div>
    <div class="scene-meta">${charIds.map(id=>`<button class="meta-chip entity-link" onclick="event.stopPropagation();setFilter('character','${jsq(id)}')">👤 ${esc(characterName(id))}</button>`).join("")}</div>
    ${tags.length?`<div class="scene-meta">${tags.map(t=>`<button class="tag-chip entity-link" onclick="event.stopPropagation();setFilter('tag','${jsq(t.id)}')">#${esc(t.name)}</button>`).join("")}</div>`:""}
    ${description?`<div class="compact-card-description">${esc(description)}</div>`:""}
  </article>`;
}

function renderListView(board){
  board.style.removeProperty("--cols");
  const disabled=hasActiveFilters();
  const row=(scene,index)=>{
    const loc=locationById(scene.locationId),ws=writingStatusById(scene.writingStatus);
    return `<tr data-scene-id="${esc(scene.id)}" class="compact-scene-row ${selectedSceneIndex===index?"selected-scene":""}" onclick="selectScene('${jsq(scene.id)}')" ondblclick="editScene('${jsq(scene.id)}')">
      <td class="compact-handle-cell"><button type="button" class="compact-drag-handle" draggable="${disabled?"false":"true"}" ${disabled?"disabled":""} aria-label="Перетащить сцену ${esc(scene.title||"Без названия")}" title="${disabled?"Чтобы менять порядок сцен, сбросьте фильтры.":"Перетащить сцену"}" ondragstart="compactDragStart(event,'${jsq(scene.id)}')" ondragend="compactDragEnd()">↕</button></td>
      <td>${esc(readableDate(scene)||"—")}</td>
      <td class="title-cell quick-editable" ondblclick="event.stopPropagation();quickEditTitle('${jsq(scene.id)}',this)">${esc(scene.title||"Без названия")}</td>
      <td>${sceneCharacterIds(scene).map(id=>`<button class="entity-link" onclick="event.stopPropagation();setFilter('character','${jsq(id)}')">${esc(characterName(id))}</button>`).join(", ")||"—"}</td>
      <td>${loc?`<button class="entity-link" onclick="event.stopPropagation();setFilter('location','${jsq(loc.id)}')">${esc(loc.name)}</button>`:"—"}</td>
      <td><span class="meta-chip writing-chip ${ws.id}">${esc(ws.label)}</span></td>
    </tr>`;
  };
  const groups=data.chapters.map(chapter=>{
    const entries=data.scenes.map((scene,index)=>({scene,index})).filter(({scene})=>scene.chapterId===chapter.id&&sceneMatches(scene));
    const allCount=data.scenes.filter(s=>s.chapterId===chapter.id).length;
    const positions=entries.map(({scene,index})=>`${compactDropPosition(chapter.id,scene.id)}${row(scene,index)}`).join("");
    const tailRow=entries.length?compactDropPosition(chapter.id,null,false):allCount?compactFilteredEmptyRow(chapter.id,allCount):compactDropPosition(chapter.id,null,true);
    const countNote=disabled&&allCount!==entries.length?` <span class="compact-chapter-count">(${entries.length} из ${allCount})</span>`:"";
    return `<section class="compact-chapter-group" data-chapter-id="${esc(chapter.id)}">
      <h3 class="compact-chapter-title">${esc(chapter.title)}${countNote}</h3>
      <div class="compact-chapter-drop-area">
        <table class="compact-list"><thead><tr><th aria-label="Перетаскивание"></th><th>Дата</th><th>Название</th><th>Персонажи</th><th>Локация</th><th>Статус</th></tr></thead><tbody>
          ${positions}${tailRow}
        </tbody></table>
      </div>
    </section>`;
  }).join("");
  const notice=disabled?'<p class="compact-dnd-notice">Чтобы менять порядок сцен, сбросьте фильтры.</p>':"";
  board.innerHTML=`${notice}<div class="compact-list-wrap">${groups}</div>`;
}

function compactDropPosition(chapterId,beforeSceneId=null,empty=false){
  return `<tr class="compact-drop-position ${empty?"compact-empty-drop":""}" data-compact-drop-chapter-id="${esc(chapterId)}" data-before-scene-id="${esc(beforeSceneId||"")}" ondragover="compactDragOver(event)" ondragleave="compactDragLeave(event)" ondrop="compactDropScene(event,{chapterId:'${jsq(chapterId)}',beforeSceneId:${beforeSceneId?`'${jsq(beforeSceneId)}'`:"null"}})"><td colspan="6"><span>${empty?"Сцен пока нет · Вставить сюда":"Вставить сюда"}</span></td></tr>`;
}

function compactFilteredEmptyRow(chapterId,totalCount){
  return `<tr class="compact-drop-position compact-filtered-empty" data-compact-drop-chapter-id="${esc(chapterId)}"><td colspan="6"><span>В главе есть сцены (${totalCount}), но они скрыты текущим поиском или фильтром</span></td></tr>`;
}

function emptySearchMessage(){return `<div style="padding:44px;text-align:center;color:var(--muted);min-width:700px">Ничего не найдено по выбранным условиям.</div>`}
function emptySceneMessage(){return hasActiveFilters()?emptySearchMessage():`<div class="section-empty-state"><strong>Сцен пока нет</strong><p>Создайте первую сцену, когда будете готовы.</p><button class="primary" onclick="openNewSceneAt(null,'chapter-unassigned')">Создать сцену</button></div>`}

Object.assign(globalThis,{projectReadiness,renderDashboard,renderFilterSummary,renderSceneInfo,refreshControls,renderSidebar,renderStats,render,scheduleRender,renderViewSwitch,renderTableView,renderChapterDivider,sceneMetadataHtml,renderTableScene,renderCardsView,renderCompactCard,renderListView,compactDropPosition,compactFilteredEmptyRow,emptySearchMessage,emptySceneMessage});
export {projectReadiness,renderDashboard,renderFilterSummary,renderSceneInfo,refreshControls,renderSidebar,renderStats,render,scheduleRender,renderViewSwitch,renderTableView,renderChapterDivider,sceneMetadataHtml,renderTableScene,renderCardsView,renderCompactCard,renderListView,compactDropPosition,compactFilteredEmptyRow,emptySearchMessage,emptySceneMessage};
