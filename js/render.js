function projectReadiness(){
  const weights={idea:0,plan:20,draft:50,edit1:80,edit2:80,final:100};
  if(!data.scenes.length)return 0;
  return Math.round(data.scenes.reduce((sum,s)=>sum+(weights[s.writingStatus]??0),0)/data.scenes.length);
}

function renderDashboard(){
  const readiness=projectReadiness();
  const counts=WRITING_STATUSES.map(status=>[status,data.scenes.filter(s=>s.writingStatus===status.id).length]);
  document.getElementById("projectDashboard").innerHTML=`
    <div class="dashboard-top">
      <div class="pipeline-strip">${counts.map(([s,n])=>`<span class="pipeline-stage ${s.id} ${n?"has-scenes":""}">${s.label} <span class="pipeline-stage-count">${n}</span></span>`).join("")}</div>
      <div class="readiness-compact" role="status" aria-label="Общая готовность проекта: ${readiness}%">
        <span class="readiness-compact-label">Готовность</span>
        <div class="progress-track"><div class="progress-bar" style="width:${readiness}%"></div></div>
        <strong class="readiness-compact-value">${readiness}%</strong>
      </div>
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

// Native <select> can only ever show its *selected option's own text* in the closed
// box — there is no separate "placeholder vs value" rendering to hook into without
// replacing the control. Encoding the category into every option's label ("Глава: X")
// gets a self-explaining closed box in both states (empty selection reads "Глава",
// an active one reads "Глава: X") without introducing a custom dropdown widget.
function refreshControls(){
  const opts=(categoryLabel,items,value,label)=>`<option value="">${esc(categoryLabel)}</option>`+
    items.map(x=>`<option value="${esc(value(x))}">${esc(categoryLabel)}: ${esc(label(x))}</option>`).join("");
  document.getElementById("filterChapter").innerHTML=opts("Глава",data.chapters,x=>x.id,x=>x.title);
  document.getElementById("filterCharacter").innerHTML=opts("Персонаж",data.characters,x=>x.id,x=>x.name);
  document.getElementById("filterLocation").innerHTML=opts("Локация",data.locations,x=>x.id,x=>x.name);
  document.getElementById("filterTag").innerHTML=opts("Тег",data.tags,x=>x.id,x=>"#"+x.name);
  document.getElementById("filterWriting").innerHTML=opts("Написание",WRITING_STATUSES,x=>x.id,x=>x.label);
  document.getElementById("filterPlacement").innerHTML=opts("Расположение",
    [{id:"fixed",label:"На своём месте"},{id:"floating",label:"Нужно разместить"}],x=>x.id,x=>x.label);
  document.getElementById("filterChapter").value=filters.chapter;
  document.getElementById("filterCharacter").value=filters.character;
  document.getElementById("filterLocation").value=filters.location;
  document.getElementById("filterTag").value=filters.tag;
  document.getElementById("filterWriting").value=filters.writing;
  document.getElementById("filterPlacement").value=filters.placement;
  document.getElementById("projectSearch").value=filters.search;
  ["filterChapter","filterCharacter","filterLocation","filterTag","filterWriting","filterPlacement"].forEach(id=>{
    const select=document.getElementById(id);
    select?.closest(".filter-field")?.classList.toggle("filter-active",!!select.value);
  });
}

// The sidebar is entity NAVIGATION (jump to a chapter, open a character/location),
// not a second filter control — filtering lives in the filter bar. Long lists default
// to a handful of items with a "show more" control instead of a nested per-section
// scrollbar, and Tags has no entry here at all: it is classification/search metadata
// already covered by the filter bar and Tags manager, not an entity with its own view.
const SIDEBAR_VISIBLE_COUNT=5;

function sidebarSectionHtml(key,itemsHtml,emptyMessage){
  if(!itemsHtml.length)return `<div class="profile-note">${emptyMessage}</div>`;
  const expanded=!!sidebarExpanded[key];
  const visible=expanded?itemsHtml:itemsHtml.slice(0,SIDEBAR_VISIBLE_COUNT);
  const remaining=itemsHtml.length-visible.length;
  let html=visible.join("");
  if(remaining>0)html+=`<button type="button" class="sidebar-show-more" onclick="toggleSidebarExpanded('${key}')">Показать ещё (${remaining})</button>`;
  else if(expanded&&itemsHtml.length>SIDEBAR_VISIBLE_COUNT)html+=`<button type="button" class="sidebar-show-more" onclick="toggleSidebarExpanded('${key}')">Свернуть</button>`;
  return html;
}

function toggleSidebarExpanded(key){
  sidebarExpanded={...sidebarExpanded,[key]:!sidebarExpanded[key]};
  render();
}

function renderSidebar(){
  const countBy=predicate=>data.scenes.filter(predicate).length;
  const userChapters=data.chapters.filter(c=>c.id!=="chapter-unassigned");
  document.getElementById("sideChapters").innerHTML=sidebarSectionHtml("chapters",
    userChapters.map(c=>`<button type="button" class="sidebar-item" onclick="navigateToChapter('${jsq(c.id)}')" aria-label="Перейти к главе «${esc(c.title)}»">${esc(c.title)}<span class="sidebar-count">${countBy(s=>s.chapterId===c.id)}</span></button>`),
    "Глав пока нет");
  document.getElementById("sideCharacters").innerHTML=sidebarSectionHtml("characters",
    data.characters.map(c=>`<button type="button" class="sidebar-item" onclick="editProfile('${jsq(c.id)}')" aria-label="Открыть анкету персонажа «${esc(c.name)}»">${esc(c.name)}<span class="sidebar-count">${countBy(s=>sceneHasParticipant(s,c.id))}</span></button>`),
    "Персонажей пока нет");
  document.getElementById("sideLocations").innerHTML=sidebarSectionHtml("locations",
    data.locations.map(l=>`<button type="button" class="sidebar-item" onclick="openLocationEntity('${jsq(l.id)}')" aria-label="Открыть локацию «${esc(l.name)}»">${esc(l.name)}<span class="sidebar-count">${countBy(s=>s.locationId===l.id)}</span></button>`),
    "Локаций пока нет");
}

// Project-global counts only. Readiness% and the "final" count already live in the
// pipeline/progress bar (renderDashboard); scene-context word count belongs to whatever
// scene is actually open (inspector modal), not this always-on aggregate line — showing
// either here too would be the exact "same stat in two places" duplication this consolidates.
function renderStats(){
  const totalWords=data.scenes.reduce((n,s)=>n+countWords(s.sceneText),0);
  document.getElementById("statsStrip").innerHTML=[
    ["Глав",data.chapters.filter(c=>c.id!=="chapter-unassigned").length],["Сцен",data.scenes.length],
    ["Персонажей",data.characters.length],["Локаций",data.locations.length],["Тегов",data.tags.length],
    ["Слов",totalWords]
  ].map(([k,v])=>`<span class="stat-pill">${k} <strong>${v}</strong></span>`).join("");
}

function clearSingleFilter(key){filters[key]="";scheduleRender()}

function setMatrixContentMode(layer,checked){
  const other=layer==="actions"?"relations":"actions";
  if(!checked&&!matrixContentMode[other]){
    syncMatrixContentControls();
    return;
  }
  matrixContentMode={...matrixContentMode,[layer]:checked};
  saveUiState();
  syncMatrixContentControls();
  render();
}

function syncMatrixContentControls(){
  const actionsEl=document.getElementById("matrixShowActions");
  const relationsEl=document.getElementById("matrixShowRelations");
  if(actionsEl)actionsEl.checked=!!matrixContentMode.actions;
  if(relationsEl)relationsEl.checked=!!matrixContentMode.relations;
}

function renderActiveFilterChips(){
  const el=document.getElementById("activeFilterChips");
  const clearBtn=document.getElementById("clearFilters");
  if(clearBtn)clearBtn.hidden=!hasActiveFilters();
  if(!el)return;
  const chips=[];
  if(filters.search.trim())chips.push(["search","Поиск",`«${filters.search.trim()}»`]);
  if(filters.chapter)chips.push(["chapter","Глава",chapterById(filters.chapter)?.title||""]);
  if(filters.character)chips.push(["character","Персонаж",characterName(filters.character)]);
  if(filters.location)chips.push(["location","Локация",locationById(filters.location)?.name||""]);
  if(filters.tag)chips.push(["tag","Тег","#"+(tagById(filters.tag)?.name||"")]);
  if(filters.writing)chips.push(["writing","Статус",writingStatusById(filters.writing)?.label||""]);
  if(filters.placement)chips.push(["placement","Хронология",filters.placement==="fixed"?"На своём месте":"Нужно разместить"]);
  el.innerHTML=chips.map(([key,label,value])=>`<span class="active-filter-chip">${esc(label)}: ${esc(value)}<button type="button" aria-label="Убрать фильтр «${esc(label)}»" onclick="clearSingleFilter('${jsq(key)}')">×</button></span>`).join("");
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
  renderActiveFilterChips();
  renderFilterSummary();
  renderSidebar();
  renderDashboard();
  renderStats();
  renderSceneInfo();
  renderViewSwitch();
  const matrixToolbar=document.getElementById("matrixToolbar");
  if(matrixToolbar)matrixToolbar.hidden=currentView!=="table";
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

function characterInitials(name){
  const parts=String(name||"").trim().split(/\s+/).filter(Boolean);
  const initials=(parts[0]?.[0]||"")+(parts[1]?.[0]||"");
  return (initials||"?").toUpperCase();
}

function characterAvatarHtml(character){
  const profile=normalizeProfile(data.profiles?.[character.id],character);
  const primary=profile.photos.find(photo=>photo.id===profile.primaryPhotoId)||profile.photos[0];
  if(primary)return `<span class="matrix-avatar"><img src="${esc(primary.source.value)}" alt="" style="${cropImageStyle(primary.crop)}"></span>`;
  return `<span class="matrix-avatar matrix-avatar-fallback" aria-hidden="true">${esc(characterInitials(character.name))}</span>`;
}

function renderTableView(board){
  board.style.setProperty("--cols",data.characters.length);
  let html=`<div class="board-grid board-head">
    <div class="head-cell sticky-cell">Сцена</div>
    ${data.characters.map(c=>`<div class="head-cell matrix-head-cell"><button class="entity-link matrix-head-link" onclick="setFilter('character','${jsq(c.id)}')">${characterAvatarHtml(c)}<span class="matrix-head-name">${esc(c.name)}</span></button></div>`).join("")}
  </div>`;
  let shown=0;
  const filtered=hasActiveFilters();
  data.chapters.forEach(chapter=>{
    const chapterScenes=data.scenes.map((scene,index)=>({scene,index})).filter(x=>x.scene.chapterId===chapter.id&&sceneMatches(x.scene));
    const allCount=data.scenes.filter(s=>s.chapterId===chapter.id).length;
    if(!chapterScenes.length&&filtered)return;
    html+=renderChapterDivider(chapter,allCount,filtered?chapterScenes.length:null);
    if(chapter.collapsed)return;
    if(!chapterScenes.length){
      const emptyPosition=buildChapterInsertionPositions(chapter.id)[0];
      html+=`<div class="insert-row"><div class="chapter-empty">В этой главе пока нет сцен<br><button data-action="insert-scene" data-before-scene-id="${esc(emptyPosition.beforeSceneId||"")}" data-chapter-id="${esc(chapter.id)}" aria-label="${esc(describeInsertionPosition(emptyPosition))}">＋ Добавить сцену</button></div></div>`;
      return;
    }
    const positions=filtered?null:buildChapterInsertionPositions(chapter.id);
    chapterScenes.forEach(({scene,index})=>{
      shown++;
      if(positions)html+=insertBar(positions.find(p=>p.beforeSceneId===scene.id)||positions[0]);
      html+=renderTableScene(scene,index,chapter);
    });
    if(positions)html+=insertBar(positions[positions.length-1]);
  });
  if(!shown&&hasActiveFilters())html+=emptySearchMessage();
  board.innerHTML=html;
}

function renderChapterDivider(chapter,count,matchedCount=null){
  const summary=matchedCount===null||matchedCount===count?`${count} сцен`:`${matchedCount} из ${count} сцен`;
  return `<div class="insert-row" data-chapter-id="${esc(chapter.id)}"><div class="chapter-divider">
    <button aria-label="${chapter.collapsed?"Развернуть":"Свернуть"} главу ${esc(chapter.title)}" onclick="toggleChapter('${jsq(chapter.id)}')">${chapter.collapsed?"▸":"▾"}</button>
    <button class="entity-link" onclick="setFilter('chapter','${jsq(chapter.id)}')"><strong>${esc(chapter.title)}</strong></button>
    <span class="chapter-summary">${summary}</span>
    <div class="chapter-actions">
      <button onclick="openNewSceneInChapter('${jsq(chapter.id)}')">＋ сцена</button>
      <button onclick="openChaptersManager()">Настроить</button>
    </div>
  </div></div>`;
}

// Deliberately no chapter chip here: the chapter is already the group header this
// row lives under, so repeating it in every row would be pure duplication. Tags are
// summarised as a single count chip (full names on hover/focus via title/aria-label)
// instead of listed out, so a heavily-tagged scene can't push the row taller — the
// full list stays reachable via scene edit.
function sceneMetadataHtml(scene,loc,ws){
  const tags=scene.tags.map(id=>tagById(id)).filter(Boolean);
  return `<div class="scene-meta">
    ${loc?`<button class="meta-chip entity-link" ondblclick="event.stopPropagation();quickEditLocation('${jsq(scene.id)}')" onclick="event.stopPropagation();setFilter('location','${jsq(loc.id)}')">📍 ${esc(loc.name)}</button>`:`<button class="meta-chip entity-link" ondblclick="event.stopPropagation();quickEditLocation('${jsq(scene.id)}')">📍 не указана</button>`}
    <button class="meta-chip writing-chip ${ws.id} entity-link" ondblclick="event.stopPropagation();quickEditWriting('${jsq(scene.id)}')">📝 ${esc(ws.label)}</button>
    ${tags.length?`<button type="button" class="meta-chip tag-count-chip" title="${esc(tags.map(t=>"#"+t.name).join(", "))}" aria-label="Теги сцены: ${esc(tags.map(t=>t.name).join(", "))}" onclick="event.stopPropagation();editScene('${jsq(scene.id)}')">🏷 ${tags.length}</button>`:""}
  </div>`;
}

function renderMatrixCell(scene,character,relationState){
  const charId=character.id;
  const sceneTitle=scene.title||"Без названия";
  const p=scene.people?.[charId];
  if(!sceneHasParticipant(scene,charId)){
    return `<div class="cell matrix-cell matrix-cell-empty" aria-label="${esc(character.name)} не участвует в сцене «${esc(sceneTitle)}»"></div>`;
  }
  if(!personHasContent(p)){
    return `<div class="cell matrix-cell matrix-cell-noncontent" aria-label="${esc(character.name)} участвует в сцене «${esc(sceneTitle)}», без описания"><span class="matrix-placeholder">Без описания</span></div>`;
  }
  const action=(p.action||"").trim();
  const legacyState=(p.legacyState||"").trim();
  const visible=(p.visibleRelations||[]).filter(t=>relationState[charId]?.[t]);
  const changed=new Set(Object.keys(p.relationChanges||{}));
  let body="";
  if(matrixContentMode.actions&&(action||legacyState)){
    body+=`<div class="matrix-actions">`;
    if(action)body+=`<div class="matrix-action-text">${esc(action)}</div>`;
    if(legacyState)body+=`<div class="matrix-legacy-note"><strong>Старая заметка:</strong><br>${esc(legacyState)}</div>`;
    body+=`</div>`;
  }
  if(matrixContentMode.relations&&visible.length){
    body+=`<div class="matrix-relations">
      <div class="matrix-relations-label">Отношения</div>
      ${visible.map(target=>`<div class="matrix-relation-entry ${changed.has(target)?"is-changed":""}">
        <div class="matrix-relation-target">${esc(characterName(target))}</div>
        <div class="matrix-relation-value">${esc(relationState[charId][target])}</div>
      </div>`).join("")}
    </div>`;
  }
  if(!body)body=`<span class="matrix-placeholder">Не показано в этом режиме</span>`;
  return `<div class="cell matrix-cell matrix-cell-content">${body}</div>`;
}

// First column: VIEW state only — a compact, readable summary (title, chronology,
// location/status/tags). Chapter and participants are deliberately NOT repeated here:
// the chapter is already the group header above every row, and participation is
// already visible as the character columns to the right of this cell — restating
// either in text form was the main reason a scene row used to need several times its
// current height. Placement (fixed/floating) is carried by the row's left-edge accent
// (.scene-row.fixed/.floating, in timeline.css) rather than a permanent text badge; a
// visually-hidden label keeps that state available to screen readers. Raw date/time
// inputs, the include checkbox and other form controls live in the scene modal (EDIT
// state, reached via the always-visible edit action) instead of sitting in the row.
function renderTableScene(scene,i,chapter){
  const relationState=relationshipsAt(i);
  const hasDate=!!readableDate(scene);
  const needsDateReview=hasDate&&!!scene.dateReview;
  const hasDateConflict=chronologicalWarning(i);
  const loc=locationById(scene.locationId);
  const ws=writingStatusById(scene.writingStatus);
  const sceneTitle=scene.title||"Без названия";
  const placementLabel=scene.status==="fixed"?"Сцена на своём месте":"Сцену нужно разместить в хронологии";
  let html=`<div class="scene-row ${scene.status==="fixed"?"fixed":"floating"} ${scene.included===false?"excluded":""} ${selectedSceneIndex===i?"selected-scene":""}" data-scene-id="${esc(scene.id)}"
    onclick="selectScene('${jsq(scene.id)}')" ondragover="dragOver(event,'${jsq(scene.id)}')"
    ondragleave="dragLeave(event)" ondrop="dropScene(event,'${jsq(scene.id)}')" ondragend="dragEnd(event)">`;
  html+=`<div class="cell time-cell sticky-cell">
    <span class="visually-hidden">${esc(placementLabel)}</span>
    <div class="scene-row-head">
      <div class="drag-handle" draggable="true" aria-label="Перетащить сцену ${esc(sceneTitle)}" title="${hasActiveFilters()?"Чтобы менять порядок сцен, сбросьте фильтры.":"Перетащить сцену"}" ondragstart="dragStart(event,'${jsq(scene.id)}')">↕</div>
      <div class="scene-title quick-editable" ondblclick="event.stopPropagation();quickEditTitle('${jsq(scene.id)}',this)">${esc(sceneTitle)}</div>
    </div>
    <div class="scene-meta">
      <span class="meta-chip scene-chronology-chip ${hasDateConflict?"conflict":needsDateReview?"review":""}">🕒 ${esc(readableDate(scene)||"без даты")}</span>
      ${hasDate?(needsDateReview
        ?`<button type="button" class="date-review-toggle needs-review" title="Дата не проверена" aria-label="Дата сцены «${esc(sceneTitle)}» не проверена. Подтвердить дату." onclick="event.stopPropagation();confirmSceneDate('${jsq(scene.id)}')">!</button>`
        :`<span class="date-review-toggle reviewed" title="Дата проверена" aria-label="Дата проверена">✓</span>`):""}
      ${scene.included===false?'<span class="meta-chip excluded-badge">Исключена из текста</span>':""}
    </div>
    ${sceneMetadataHtml(scene,loc,ws)}
    ${hasDateConflict?'<div class="date-status-note conflict">Дата конфликтует с хронологией соседних сцен</div>':""}
    <div class="row-actions">
      ${sceneReorderButtonsHtml(scene)}
      <button class="row-action-icon" aria-label="Редактировать текст сцены «${esc(sceneTitle)}»" title="Текст сцены" onclick="event.stopPropagation();openSceneText('${jsq(scene.id)}')">T</button>
      <button class="row-action-icon" aria-label="Изменить сцену «${esc(sceneTitle)}»" title="Изменить сцену" onclick="event.stopPropagation();editScene('${jsq(scene.id)}')">✎</button>
      <button class="row-action-quiet danger-quiet" aria-label="Удалить сцену «${esc(sceneTitle)}»" title="Удалить сцену" onclick="event.stopPropagation();deleteScene('${jsq(scene.id)}')">🗑</button>
    </div>
  </div>`;
  data.characters.forEach(character=>{
    html+=renderMatrixCell(scene,character,relationState);
  });
  return html+`</div>`;
}

// Cards grid: exactly one grid item per scene (dense, predictable, no phantom
// insertion-sized slots). N+1 insertion positions are quiet edge affordances
// attached to each card's own slot (top edge of the first card = before-first,
// bottom edge of every card = between/after-last), not separate grid cells — see
// cardEdgeInsert. Cards now also support real drag-and-drop via the same shared
// {chapterId,beforeSceneId} position model / compactMoveScene used by table+list.
function renderCardsView(board){
  board.style.removeProperty("--cols");
  const filtered=hasActiveFilters();
  const sections=data.chapters.map(chapter=>{
    const chapterEntries=data.scenes.map((scene,index)=>({scene,index})).filter(x=>x.scene.chapterId===chapter.id&&sceneMatches(x.scene));
    const allCount=data.scenes.filter(s=>s.chapterId===chapter.id).length;
    if(!chapterEntries.length&&filtered)return "";
    let cards;
    if(!chapterEntries.length){
      const emptyPosition=buildChapterInsertionPositions(chapter.id)[0];
      cards=`<div class="card-position-empty"><span>Сцен пока нет</span><button type="button" class="card-position-insert" data-action="insert-scene" data-before-scene-id="${esc(emptyPosition.beforeSceneId||"")}" data-chapter-id="${esc(chapter.id)}" aria-label="${esc(describeInsertionPosition(emptyPosition))}">＋ Добавить сцену</button></div>`;
    }else{
      const positions=filtered?null:buildChapterInsertionPositions(chapter.id);
      cards=chapterEntries.map(({scene,index},i)=>{
        const before=i===0&&positions?cardEdgeInsert(positions[0],"before"):"";
        const after=positions?cardEdgeInsert(positions[i+1],"after"):"";
        return `<div class="card-slot" data-scene-id="${esc(scene.id)}">${before}${renderCompactCard(scene,index)}${after}</div>`;
      }).join("");
    }
    const countNote=filtered&&allCount!==chapterEntries.length?` <span class="compact-chapter-count">(${chapterEntries.length} из ${allCount})</span>`:"";
    return `<section class="card-chapter-group" data-chapter-id="${esc(chapter.id)}">
      <h3 class="compact-chapter-title">${esc(chapter.title)}${countNote}</h3>
      <div class="scene-cards-grid">${cards}</div>
    </section>`;
  }).join("");
  board.innerHTML=sections||emptySceneMessage();
}

// Quiet-by-default edge affordance living inside a card's own grid cell (not a
// sibling grid item), so it never claims a card-sized slot of its own. Doubles as
// a drop target for card drag-and-drop, reusing the compact view's generic
// dragover/dragleave/drop handlers (they operate on {chapterId,beforeSceneId},
// nothing compact-specific).
function cardEdgeInsert(position,edge){
  const label=describeInsertionPosition(position);
  const dropLabel=describeDropPosition(position);
  const beforeAttr=position.beforeSceneId?`'${jsq(position.beforeSceneId)}'`:"null";
  return `<button type="button" class="card-position-insert card-insert-edge card-insert-${edge}" data-action="insert-scene" data-before-scene-id="${esc(position.beforeSceneId||"")}" data-chapter-id="${esc(position.chapterId)}" aria-label="${esc(label)}"
    ondragover="compactDragOver(event)" ondragleave="compactDragLeave(event)" ondrop="compactDropScene(event,{chapterId:'${jsq(position.chapterId)}',beforeSceneId:${beforeAttr}})">
    <span class="position-plus" aria-hidden="true">＋</span>
    <span class="position-drop-label" aria-hidden="true">↓ ${esc(dropLabel)}</span>
  </button>`;
}

// Chapter name is deliberately not repeated here: the card already sits inside its
// chapter's group heading. Placement (fixed/floating) is a left-edge accent instead of
// a permanent "На месте" text badge (paired with a visually-hidden label, since a card
// grid — unlike the table's left accent column — has no dedicated sticky metadata
// strip to attach the color-plus-text pairing to). Tags are capped so a heavily-tagged
// scene can't stretch the card indefinitely; the rest stay reachable via scene edit.
function renderCompactCard(scene,index){
  const loc=locationById(scene.locationId),ws=writingStatusById(scene.writingStatus);
  const charIds=sceneCharacterIds(scene),chars=charIds.map(characterName);
  const tags=scene.tags.map(id=>tagById(id)).filter(Boolean);
  const visibleTags=tags.slice(0,2),extraTags=tags.slice(2);
  const description=chars.map(c=>scene.people?.[c]?.action||"").filter(Boolean).join(" ");
  const disabled=hasActiveFilters();
  const sceneTitle=scene.title||"Без названия";
  const placementLabel=scene.status==="fixed"?"Сцена на своём месте":"Сцену нужно разместить в хронологии";
  return `<article class="compact-scene-card ${scene.status} ${selectedSceneIndex===index?"selected-scene":""}" data-scene-id="${esc(scene.id)}"
    draggable="${disabled?"false":"true"}" title="${disabled?"Чтобы менять порядок сцен, сбросьте фильтры.":""}"
    ondragstart="cardDragStart(event,'${jsq(scene.id)}')" ondragend="cardDragEnd()"
    onclick="selectScene('${jsq(scene.id)}')" ondblclick="editScene('${jsq(scene.id)}')">
    <span class="visually-hidden">${esc(placementLabel)}</span>
    <div class="compact-card-title quick-editable" ondblclick="event.stopPropagation();quickEditTitle('${jsq(scene.id)}',this)">${esc(sceneTitle)}</div>
    <div class="scene-meta">
      <span class="meta-chip">🕒 ${esc(readableDate(scene)||"без даты")}</span>
      ${loc?`<button class="meta-chip entity-link" onclick="event.stopPropagation();setFilter('location','${jsq(loc.id)}')">📍 ${esc(loc.name)}</button>`:""}
      <span class="meta-chip writing-chip ${ws.id}">📝 ${esc(ws.label)}</span>
    </div>
    ${charIds.length?`<div class="scene-meta">${charIds.map(id=>`<button class="meta-chip entity-link" onclick="event.stopPropagation();setFilter('character','${jsq(id)}')">👤 ${esc(characterName(id))}</button>`).join("")}</div>`:""}
    ${tags.length?`<div class="scene-meta">${visibleTags.map(t=>`<button class="tag-chip entity-link" onclick="event.stopPropagation();setFilter('tag','${jsq(t.id)}')">#${esc(t.name)}</button>`).join("")}${extraTags.length?`<span class="tag-chip tag-chip-more" title="${esc(extraTags.map(t=>"#"+t.name).join(", "))}" aria-label="Ещё ${extraTags.length} тегов: ${esc(extraTags.map(t=>t.name).join(", "))}">+${extraTags.length}</span>`:""}</div>`:""}
    ${description?`<div class="compact-card-description">${esc(description)}</div>`:""}
    <div class="card-actions">${cardReorderButtonsHtml(scene)}</div>
  </article>`;
}

function renderListView(board){
  board.style.removeProperty("--cols");
  const disabled=hasActiveFilters();
  const row=(scene,index)=>{
    const loc=locationById(scene.locationId),ws=writingStatusById(scene.writingStatus);
    return `<tr data-scene-id="${esc(scene.id)}" class="compact-scene-row ${selectedSceneIndex===index?"selected-scene":""}" onclick="selectScene('${jsq(scene.id)}')" ondblclick="editScene('${jsq(scene.id)}')">
      <td class="compact-handle-cell"><button type="button" class="compact-drag-handle" draggable="${disabled?"false":"true"}" ${disabled?"disabled":""} aria-label="Перетащить сцену ${esc(scene.title||"Без названия")}" title="${disabled?"Чтобы менять порядок сцен, сбросьте фильтры.":"Перетащить сцену"}" ondragstart="compactDragStart(event,'${jsq(scene.id)}')" ondragend="compactDragEnd()">↕</button>${sceneReorderButtonsHtml(scene)}</td>
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
    const positions=entries.map(({scene,index})=>`${compactDropPosition(chapter.id,scene.id,false,disabled)}${row(scene,index)}`).join("");
    const tailRow=entries.length?compactDropPosition(chapter.id,null,false,disabled):allCount?compactFilteredEmptyRow(chapter.id,allCount):compactDropPosition(chapter.id,null,true,disabled);
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

// Same {chapterId,beforeSceneId} destination doubles as a click-to-create position
// (rendered as a quiet "+") and a drag-and-drop target (highlighted via .active by
// compactDragOver, unchanged) — one row, two ways to land a scene at that spot.
function compactDropPosition(chapterId,beforeSceneId=null,empty=false,disabled=false){
  const positions=buildChapterInsertionPositions(chapterId);
  const position=positions.find(p=>p.beforeSceneId===(beforeSceneId||null)&&(p.kind==="empty")===empty)||positions[positions.length-1];
  const insertLabel=describeInsertionPosition(position);
  const dropLabel=describeDropPosition(position);
  const insertButton=disabled?"":`<button type="button" class="compact-position-insert ${empty?"compact-position-insert-empty":""}" data-action="insert-scene" data-before-scene-id="${esc(beforeSceneId||"")}" data-chapter-id="${esc(chapterId)}" aria-label="${esc(insertLabel)}" onclick="event.stopPropagation()">＋${empty?" Добавить сцену":""}</button>`;
  return `<tr class="compact-drop-position ${empty?"compact-empty-drop":""}" data-compact-drop-chapter-id="${esc(chapterId)}" data-before-scene-id="${esc(beforeSceneId||"")}" ondragover="compactDragOver(event)" ondragleave="compactDragLeave(event)" ondrop="compactDropScene(event,{chapterId:'${jsq(chapterId)}',beforeSceneId:${beforeSceneId?`'${jsq(beforeSceneId)}'`:"null"}})"><td colspan="6">${empty?'<span class="compact-empty-note">Сцен пока нет</span>':""}${insertButton}<span class="compact-position-drop-label" aria-hidden="true">↓ ${esc(dropLabel)}</span></td></tr>`;
}

function compactFilteredEmptyRow(chapterId,totalCount){
  return `<tr class="compact-drop-position compact-filtered-empty" data-compact-drop-chapter-id="${esc(chapterId)}"><td colspan="6"><span>В главе есть сцены (${totalCount}), но они скрыты текущим поиском или фильтром</span></td></tr>`;
}

function emptySearchMessage(){return `<div style="padding:44px;text-align:center;color:var(--muted);min-width:700px">Ничего не найдено по выбранным условиям.</div>`}
function emptySceneMessage(){return hasActiveFilters()?emptySearchMessage():`<div class="section-empty-state"><strong>Сцен пока нет</strong><p>Создайте первую сцену, когда будете готовы.</p><button class="primary" onclick="openNewSceneAt(null,'chapter-unassigned')">Создать сцену</button></div>`}

Object.assign(globalThis,{projectReadiness,renderDashboard,clearSingleFilter,setMatrixContentMode,syncMatrixContentControls,renderActiveFilterChips,renderFilterSummary,renderSceneInfo,refreshControls,sidebarSectionHtml,toggleSidebarExpanded,renderSidebar,renderStats,render,scheduleRender,renderViewSwitch,characterInitials,characterAvatarHtml,renderTableView,renderChapterDivider,sceneMetadataHtml,renderMatrixCell,renderTableScene,renderCardsView,cardEdgeInsert,renderCompactCard,renderListView,compactDropPosition,compactFilteredEmptyRow,emptySearchMessage,emptySceneMessage});
export {projectReadiness,renderDashboard,clearSingleFilter,setMatrixContentMode,syncMatrixContentControls,renderActiveFilterChips,renderFilterSummary,renderSceneInfo,refreshControls,sidebarSectionHtml,toggleSidebarExpanded,renderSidebar,renderStats,render,scheduleRender,renderViewSwitch,characterInitials,characterAvatarHtml,renderTableView,renderChapterDivider,sceneMetadataHtml,renderMatrixCell,renderTableScene,renderCardsView,cardEdgeInsert,renderCompactCard,renderListView,compactDropPosition,compactFilteredEmptyRow,emptySearchMessage,emptySceneMessage};
