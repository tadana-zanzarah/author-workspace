import {mountSceneEditor} from "./editor/scene-editor-controller.js";

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

// Quiet-by-default N+1 insertion control: a thin divider that expands into a
// clickable "+" on hover/focus, and swaps to a "move here" affordance while a
// scene drag is in progress (see body.scene-drag-active in css/timeline.css).
// The accessible name always names the concrete neighbor scene(s), even though
// the visible label stays a plain "+".
function insertBar(position){
  const label=describeInsertionPosition(position);
  const dropLabel=describeDropPosition(position);
  return `<div class="insert-row scene-position-row" data-position-kind="${esc(position.kind)}">
    <div class="insert-content">
      <button type="button" class="scene-position-btn position-insert-btn" data-action="insert-scene" data-before-scene-id="${esc(position.beforeSceneId||"")}" data-chapter-id="${esc(position.chapterId)}" aria-label="${esc(label)}">
        <span class="position-plus" aria-hidden="true">＋</span>
        <span class="position-drop-label" aria-hidden="true">↓ ${esc(dropLabel)}</span>
      </button>
    </div>
  </div>`;
}

// Accessible alternative to drag-and-drop reorder: move one step within the
// scene's own chapter. Present in every view (table, compact list, cards) so
// reorder never depends on drag support or a pointer device.
function sceneReorderButtonsHtml(scene){
  const disabled=hasActiveFilters();
  const canUp=!disabled&&!!siblingMoveUpTarget(scene.id);
  const canDown=!disabled&&!!siblingMoveDownTarget(scene.id);
  const title=disabled?"Чтобы менять порядок сцен, сбросьте фильтры.":"";
  const sceneTitle=scene.title||"Без названия";
  return `<span class="scene-reorder-buttons">
    <button type="button" class="scene-reorder-btn" ${canUp?"":"disabled"} title="${esc(title)}" aria-label="Переместить сцену «${esc(sceneTitle)}» выше" onclick="event.stopPropagation();moveSceneUp('${jsq(scene.id)}')">↑</button>
    <button type="button" class="scene-reorder-btn" ${canDown?"":"disabled"} title="${esc(title)}" aria-label="Переместить сцену «${esc(sceneTitle)}» ниже" onclick="event.stopPropagation();moveSceneDown('${jsq(scene.id)}')">↓</button>
  </span>`;
}

// Cards flow left-to-right and wrap, so a literal ↑/↓ ("move up/down") misreads as
// vertical movement that doesn't match the grid's actual reading order. Same
// moveSceneUp/moveSceneDown destination and same one-step-within-chapter semantics as
// the table's reorder buttons — only the icon and accessible label change to the
// chapter-order-relative "earlier/later" a grid can actually communicate.
function cardReorderButtonsHtml(scene){
  const disabled=hasActiveFilters();
  const canEarlier=!disabled&&!!siblingMoveUpTarget(scene.id);
  const canLater=!disabled&&!!siblingMoveDownTarget(scene.id);
  const title=disabled?"Чтобы менять порядок сцен, сбросьте фильтры.":"";
  const sceneTitle=scene.title||"Без названия";
  return `<span class="scene-reorder-buttons">
    <button type="button" class="scene-reorder-btn" ${canEarlier?"":"disabled"} title="${esc(title)}" aria-label="Переместить сцену «${esc(sceneTitle)}» раньше" onclick="event.stopPropagation();moveSceneUp('${jsq(scene.id)}')">‹</button>
    <button type="button" class="scene-reorder-btn" ${canLater?"":"disabled"} title="${esc(title)}" aria-label="Переместить сцену «${esc(sceneTitle)}» позже" onclick="event.stopPropagation();moveSceneDown('${jsq(scene.id)}')">›</button>
  </span>`;
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
  // Positional context is "known" only when the caller explicitly named a chapter
  // or a neighboring scene — i.e. this open was triggered by a positional "+"
  // (Matrix/Cards/Compact) or a per-chapter "+ сцена" button, which already know
  // exactly where the new scene belongs. The header "+ Новая сцена" and the
  // empty-project "Создать сцену" button call this with neither, and must NOT
  // inherit the active filter's chapter or silently default to the first
  // chapter/"already placed" — the scene is genuinely "in the air" until the
  // user places it. See "chapter-unassigned" -> NULL chapter_id in AGENTS.md.
  const positional=Boolean(chapterId||before);
  insertChapterId=chapterId||before?.chapterId||"chapter-unassigned";
  document.getElementById("sceneModalTitle").textContent="Новая сцена";
  document.getElementById("sceneDate").value="";
  document.getElementById("sceneTime").value="";
  document.getElementById("sceneTitle").value="";
  mountSceneModalTextEditor(null);
  document.getElementById("sceneStatus").value=positional?"fixed":"floating";
  document.getElementById("sceneIncluded").checked=true;
  populateSceneSelectors();
  document.getElementById("sceneChapter").value=insertChapterId;
  document.getElementById("sceneLocation").value="";
  document.getElementById("sceneWritingStatus").value="draft";
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

// Find/Replace Stage D2.1.2 (Goal H/I): `extra` (optional) carries
// `{projectSession}` -- forwarded to mountSceneModalTextEditor exactly like
// openSceneText's own `extra` param -- either from a project-result
// navigation whose ORIGIN surface was itself the full Scene modal (Goal H:
// surface-preserving navigation), or from the explicit full<->text-only
// switch action (Goal I). Every other existing caller omits it and mounts
// exactly as before.
function editScene(sceneId,extra){
  return requestEditorTransition(()=>editSceneNow(sceneId,extra));
}

function editSceneNow(sceneId,extra){
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
  mountSceneModalTextEditor(s,extra);
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
  // Editor-handoff Stage D2.1.7: a normal Scene Editor open keeps its
  // existing default autofocus (modal-manager.js's initialFocus() falls
  // back to the first focusable form control -- the title field -- exactly
  // as before). Only the Text Scene -> Scene Editor surface-switch handoff,
  // and ONLY when the source's own text editor was the thing that actually
  // held keyboard focus there (see scene-editor-controller.js's own
  // `hasEditorFocus` capture -- not merely "a handoff happened", e.g. the
  // author's focus could have been in the Find input instead), asks
  // showModal to focus the JUST-MOUNTED text editor's own DOM instead. This
  // reuses the existing initialFocus mechanism (queued on a microtask,
  // AFTER this synchronous function finishes -- including the
  // applyHandoff() call below that installs the restored selection/
  // viewport), never a second focus-management system; initialFocus's own
  // `.focus({preventScroll:true})` call is what keeps D2.1.6's centered
  // viewport from being disturbed by the focus itself.
  showModal("sceneModal",extra?.handoff?.focusTarget==="editor"?{initialFocus:sceneModalTextEditor.view.dom}:undefined);
  resetSceneModalScroll();
  trackerFor("sceneModal").captureInitialState();
  // Editor-handoff Stage D2.1.4 (Finding 2) / D2.1.5 (position handoff):
  // `extra.handoff`, when given, is the unsaved live doc (plus captured
  // selection/viewport/Find-target position) handed off from the SAME
  // scene's Text Scene surface (see switchToSceneEditorSeamless below) --
  // applied AFTER captureInitialState() above so the tracker's baseline
  // stays the scene's own PERSISTED text (matching what was just mounted/
  // captured), while the live editor itself now shows the handed-off
  // unsaved content at the restored position: exactly the "destination is
  // dirty relative to the last persisted state" contract, plus D2.1.5's own
  // "preserve the author's working location" requirement.
  if(extra?.handoff)sceneModalTextEditor.applyHandoff(extra.handoff);
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
          <span class="changed-note relation-explicit-note" style="visibility:${hasChange?"visible":"hidden"}">задано здесь</span>
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
        <h3>${character?characterAvatarHtml(character):""}<span>${esc(character?.name||"Неизвестный персонаж")}</span></h3>
        <button type="button" class="danger" onclick="removeSceneParticipant('${jsq(charId)}')">Убрать из сцены</button>
      </div>
      <label>
        <textarea class="p-action action-input" data-char-id="${esc(charId)}" aria-label="Что произошло с персонажем в сцене" placeholder="Что произошло с персонажем в сцене">${esc(p.action||"")}</textarea>
      </label>
      ${(p.legacyState||"").trim()?`
        <div class="legacy-note">
          <span class="field-caption">Старая заметка из предыдущей версии</span>
          <textarea class="p-legacy" data-char-id="${esc(charId)}">${esc(p.legacyState)}</textarea>
        </div>`:""}
      <div class="relations-editor">
        <div class="relations-editor-title">
          <strong>Отношение к другим персонажам</strong>
          <span class="info-tooltip">
            <button type="button" class="info-tooltip-btn" aria-label="Как работает наследование отношений" aria-describedby="relInheritHelp-${esc(charId)}">?</button>
            <span class="info-tooltip-panel" role="tooltip" id="relInheritHelp-${esc(charId)}">По умолчанию отношение переносится из предыдущей сцены с этими персонажами. Если изменить его вручную, значение закрепится за этой сценой. «Наследовать» вернёт автоматическое значение.</span>
          </span>
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
    if(note)note.style.visibility=isExplicit?"visible":"hidden";
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

// Find/Replace Stage D2.1.1 (Goal A): `extra` is optional and, when given by
// find-replace-navigation.js's case-B navigation, carries
// `{projectSession}` -- the current project-wide Find/Replace session to
// hand to the freshly-mounted destination controller (see
// scene-editor-controller.js's mountSceneEditor). Every other existing
// caller (plain "open this scene's text" from a scene card, etc.) omits it
// entirely, so `openSceneTextNow` sees `undefined` and mounts exactly as
// before. requestEditorTransition's own dirty-guard runs FIRST, unchanged --
// `extra`/`projectSession` only ever reaches the destination mount if the
// transition actually proceeds (openAction only runs after a clean/
// confirmed-discard check), so cancelling the guard neither adopts a session
// anywhere nor touches the originating one.
function openSceneText(sceneId,extra){
  return requestEditorTransition(()=>openSceneTextNow(sceneId,extra));
}

// Defensive destroy-before-create: every close path (Save, Cancel, Escape,
// backdrop) ends up back here on the next open, so a stray ProseMirror instance
// from a non-Save close is always cleaned up before a new one is mounted -- no
// need to hook every individual close handler.
function destroySceneTextEditor(){
  if(sceneTextEditor){sceneTextEditor.destroy();sceneTextEditor=null}
}

// Same defensive destroy-before-create pattern as destroySceneTextEditor,
// applied to the Scene modal's own rich-text field (T2). `scene` may be null
// (the "new scene" open path) -- mountSceneEditor/loadSceneDocument already
// handle a missing scene safely, producing one empty paragraph.
function destroySceneModalTextEditor(){
  if(sceneModalTextEditor){sceneModalTextEditor.destroy();sceneModalTextEditor=null}
}

// Editor-handoff Stage D2.1.4 (Finding 2): Scene Editor -> Text Scene is
// seamless (no Save prompt, no persistence) ONLY while the Scene modal's own
// dirty state -- if any -- is entirely accounted for by the scene's own text
// (extra.doc). Text Scene has no title/tags/metadata fields to carry a
// NON-text change to, so a real non-text edit still goes through the
// existing Save-or-discard guard (openSceneText -> requestEditorTransition),
// completely unchanged. `isDirtyIgnoringExtraKeys(["doc"])` (js/dirty-
// state.js) reuses the sceneModal tracker's own existing baseline/getState --
// never a second dirty system -- to tell the two cases apart.
// Editor-handoff Stage D2.1.5: `handoff` is the single object scene-editor-
// controller.js's own onSwitchSurface wiring captures at click time --
// `{session,liveDoc,selection,viewportAnchor}` -- forwarded straight through
// to openSceneTextNow, which applies it (doc + restored position + re-
// resolved Find target, all in one step) via mountSceneEditor's own
// applyHandoff. See that method's own doc comment for the full restore-order
// reasoning.
function switchToTextSceneSeamless(sceneId,handoff){
  if(trackerFor("sceneModal").isDirtyIgnoringExtraKeys(["doc"])){
    openSceneText(sceneId,{projectSession:handoff?.session});
    return;
  }
  destroySceneModalTextEditor();
  forceHideModal("sceneModal");
  openSceneTextNow(sceneId,{projectSession:handoff?.session,handoff});
}

// Editor-handoff Stage D2.1.4 (Finding 2): Text Scene -> Scene Editor is
// ALWAYS seamless -- Text Scene has no non-text dirty state at all (no other
// form field exists on that surface; see docs/find-replace-architecture.md).
// Bypasses requestEditorTransition's generic "ask to Save first" guard
// entirely (it would otherwise prompt to Save a scene the user isn't
// actually leaving) and hands the live unsaved doc straight to the
// freshly-mounted Scene Editor instead. `liveDocJSON` was already captured
// (by mountSceneEditor's own toolbar wiring, at the moment of the click --
// see scene-editor-controller.js) BEFORE this runs, so destroying the source
// view below never risks losing it.
// Editor-handoff Stage D2.1.5: see switchToTextSceneSeamless's identical
// comment above -- `handoff` is forwarded straight through to editSceneNow.
function switchToSceneEditorSeamless(sceneId,handoff){
  destroySceneTextEditor();
  forceHideModal("textModal");
  editSceneNow(sceneId,{projectSession:handoff?.session,handoff});
}

// Find/Replace Stage D2.1.2 (Goal H/I): `extra` (optional) is
// `{projectSession}` -- forwarded straight into mountSceneEditor, which
// hands it to the new controller via adoptProjectSession before attaching
// the view. Supplied either by a project-result navigation whose ORIGIN was
// itself the full Scene modal (Goal H: surface-preserving navigation stays
// on the SAME surface type), or by the explicit full<->text-only switch
// action (Goal I).
function mountSceneModalTextEditor(scene,extra){
  destroySceneModalTextEditor();
  sceneModalTextEditor=mountSceneEditor({
    editorContainer:document.getElementById("sceneTextEditor"),
    toolbarContainer:document.getElementById("sceneTextToolbar"),
    findReplaceContainer:document.getElementById("sceneTextFindReplace"),
    scene,
    characters:data.characters,
    // Find/Replace Stage D1: registers this mounted editor in the shared
    // mounted-scene registry (see js/editor/mounted-scene-registry.js) so
    // project-wide search/navigation can find and reveal it. Mounting always
    // happens before showModal("sceneModal") itself in editScene/openNewScene
    // -- revealSurface's own showModal call is what actually brings the
    // modal to front when this registration's activate() runs later (openModal
    // is safe to call again on an already-open modal, see modal-manager.js).
    surfaceId:"sceneModal",
    // openModal() unconditionally schedules its own default-initial-focus
    // microtask on EVERY call, even when the modal is already open/topmost --
    // harmless for a genuine open, but calling it again purely to "reveal an
    // already-open modal" would steal focus back from the exact match this
    // registration's activate() is about to select, one microtask later. Only
    // call it when the modal isn't already showing.
    revealSurface:()=>{if(document.getElementById("sceneModal").style.display!=="flex")showModal("sceneModal")},
    getProjectData:()=>data,
    // Find/Replace Stage D2.1.2 (Goal H): a project result opened from a
    // surface that is itself the FULL scene editor stays on the full editor
    // for the destination too -- case B (scene mounted nowhere) now opens
    // via editScene, never openSceneText, when navigation originates HERE.
    // `extra` (projectSession/pendingTarget) is forwarded unchanged, exactly
    // like openSceneText's own case-B fallback already does.
    openSceneForEditing:(sceneId,nextExtra)=>editScene(sceneId,nextExtra),
    // Find/Replace Stage D2.1.2 (Goal I) / Editor-handoff Stage D2.1.4
    // (Finding 2): switches THIS SAME scene to its text-only representation,
    // carrying the current project session (if any) AND the live unsaved doc
    // across -- see switchToTextSceneSeamless above for exactly when this
    // bypasses the generic Save-or-discard guard vs. still uses it.
    onSwitchSurface:handoff=>switchToTextSceneSeamless(scene.id,handoff),
    switchSurfaceLabel:"Текст сцены",
    projectSession:extra?.projectSession
  });
}

// Find/Replace Stage D2.1.1/D2.1.2: `extra` (optional) is `{projectSession}`
// when this open is the destination of a project-result navigation (see
// mountSceneModalTextEditor's own comment) or of the explicit full<->text-
// only switch action (Goal I) -- threaded straight into mountSceneEditor,
// which is the one place that actually hands it to the new controller (via
// adoptProjectSession) before attaching the view.
function openSceneTextNow(sceneId,extra){
  textEditingSceneId=sceneId;
  const scene=sceneById(sceneId);
  if(!scene)return;
  document.getElementById("textModalTitle").textContent=scene.title||"Текст сцены";
  destroySceneTextEditor();
  sceneTextEditor=mountSceneEditor({
    editorContainer:document.getElementById("fullSceneTextEditor"),
    toolbarContainer:document.getElementById("fullSceneTextToolbar"),
    findReplaceContainer:document.getElementById("fullSceneTextFindReplace"),
    scene,
    characters:data.characters,
    // Find/Replace Stage D1: see mountSceneModalTextEditor's own comment
    // above -- same registry registration, this surface's own modal.
    surfaceId:"textModal",
    // See mountSceneModalTextEditor's own comment above on why this must not
    // call showModal unconditionally.
    revealSurface:()=>{if(document.getElementById("textModal").style.display!=="flex")showModal("textModal",{initialFocus:sceneTextEditor?.view.dom})},
    getProjectData:()=>data,
    // Find/Replace Stage D2.1.2 (Goal H): a project result opened from the
    // TEXT-ONLY surface stays text-only for the destination too.
    openSceneForEditing:(sceneIdToOpen,nextExtra)=>openSceneText(sceneIdToOpen,nextExtra),
    // Find/Replace Stage D2.1.2 (Goal I) / Editor-handoff Stage D2.1.4
    // (Finding 2): switches THIS SAME scene to its full-editor
    // representation, carrying the current project session (if any) AND the
    // live unsaved doc across -- see switchToSceneEditorSeamless above.
    onSwitchSurface:handoff=>switchToSceneEditorSeamless(sceneId,handoff),
    switchSurfaceLabel:"Редактор сцены",
    // Find/Replace Stage D2.1.1 (Goal A): hands the project-wide session
    // (if any) straight to the new controller mountSceneEditor is about to
    // create -- see that function's own doc comment.
    projectSession:extra?.projectSession
  });
  showModal("textModal",{initialFocus:sceneTextEditor.view.dom});
  trackerFor("textModal").captureInitialState();
  // Editor-handoff Stage D2.1.4 (Finding 2) / D2.1.5: see editSceneNow's
  // identical comment above -- `extra.handoff` (from the Scene Editor, see
  // switchToTextSceneSeamless below) is applied AFTER captureInitialState()
  // so the baseline stays the scene's own persisted text.
  if(extra?.handoff)sceneTextEditor.applyHandoff(extra.handoff);
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
  const confirmed=await showConfirmAction({
    title:"Удалить сцену?",
    description:`Сцена «${scene.title||"Без названия"}» будет удалена без возможности отмены.`,
    confirmLabel:"Удалить",cancelLabel:"Отмена"
  });
  if(!confirmed)return;
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

Object.assign(globalThis,{sceneById,sceneIndexById,sceneCharacterIds,sceneCharacters,quickEditTitle,openQuickField,quickEditLocation,quickEditWriting,quickEditChapter,selectScene,insertBar,sceneReorderButtonsHtml,cardReorderButtonsHtml,normalizeSceneOrder,firstSceneIdAfterChapter,openNewSceneInChapter,openNewSceneAt,editScene,populateSceneSelectors,ensureTag,addTagToDraft,renderSceneTagDraft,removeSceneTag,buildPeopleForm,syncPeopleDraftFromDom,renderPeopleBlocks,renderSceneParticipantSelector,addSceneParticipant,removeSceneParticipant,resetSceneModalScroll,markRelationExplicit,relationEdited,resetToInherited,openSceneText,destroySceneTextEditor,destroySceneModalTextEditor,mountSceneModalTextEditor,toggleIncluded,confirmSceneDate,quickUpdate,deleteScene});
export {sceneById,sceneIndexById,sceneCharacterIds,sceneCharacters,quickEditTitle,openQuickField,quickEditLocation,quickEditWriting,quickEditChapter,selectScene,insertBar,sceneReorderButtonsHtml,cardReorderButtonsHtml,normalizeSceneOrder,firstSceneIdAfterChapter,openNewSceneInChapter,openNewSceneAt,editScene,populateSceneSelectors,ensureTag,addTagToDraft,renderSceneTagDraft,removeSceneTag,buildPeopleForm,syncPeopleDraftFromDom,renderPeopleBlocks,renderSceneParticipantSelector,addSceneParticipant,removeSceneParticipant,resetSceneModalScroll,markRelationExplicit,relationEdited,resetToInherited,openSceneText,destroySceneTextEditor,destroySceneModalTextEditor,mountSceneModalTextEditor,toggleIncluded,confirmSceneDate,quickUpdate,deleteScene};
