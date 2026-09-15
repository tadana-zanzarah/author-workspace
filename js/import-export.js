import {sceneDocSchema} from "./editor/scene-doc-schema.js";
import {docToJSON,loadSceneDocument} from "./editor/scene-doc-convert.js";
import {createSceneEditorGroup} from "./editor/scene-editor-controller.js";
import {normalizedEqual,normalizeSnapshot} from "./dirty-state.js";
import {pluralRu} from "./editor/find-replace-panel.js";

function includedScenes(){
  return data.scenes
    .map((scene,index)=>({scene,index}))
    .filter(item=>item.scene.included!==false);
}

function openAllScenes(){return requestEditorTransition(()=>openAllScenesNow())}

// Defensive destroy-before-create: every close path (Save, Cancel, Escape,
// backdrop) ends up back here on the next open, so any stray ProseMirror
// instances from a non-Save close are always cleaned up before a fresh group
// is mounted -- same pattern as scenes.js's destroySceneTextEditor/
// destroySceneModalTextEditor.
function destroyAllScenesEditorGroup(){
  if(allScenesEditorGroup){allScenesEditorGroup.destroyAll();allScenesEditorGroup=null}
}

function openAllScenesNow(){
  const root=document.getElementById("allScenesList");
  let html="",order=0;
  const items=[];
  data.chapters.forEach(chapter=>{
    const chapterItems=includedScenes().filter(x=>x.scene.chapterId===chapter.id);
    if(!chapterItems.length)return;
    html+=`<h2 class="all-scene-chapter-title">${esc(chapter.title)}</h2>`;
    chapterItems.forEach(({scene,index})=>{
      order++;
      items.push(scene);
      html+=`<section class="all-scene-block ${scene.status==="fixed"?"fixed":"floating"}">
        <div class="all-scene-header">
          <div class="all-scene-title"><span class="all-scene-number">${order}.</span> ${esc(scene.title||"Без названия")}</div>
          <div class="all-scene-meta">
            ${esc(readableDate(scene)||"дата не указана")} · ${esc(locationById(scene.locationId)?.name||"локация не указана")} · ${esc(writingStatusById(scene.writingStatus).label)}
          </div>
        </div>
        <div class="rte-editor" id="allSceneEditor-${esc(scene.id)}" data-scene-id="${esc(scene.id)}" aria-label="Текст сцены: ${esc(scene.title||"Без названия")}"></div>
      </section>`;
    });
  });
  root.innerHTML=html||'<div class="empty-work">Нет сцен, включённых в общий текст.</div>';
  destroyAllScenesEditorGroup();
  if(items.length){
    // Find/Replace Stage D1: surfaceId/revealSurface register every mounted
    // scene in the shared mounted-scene registry (js/editor/mounted-scene-
    // registry.js) so project-wide search/navigation can find and reveal
    // them -- see js/editor/scene-editor-controller.js's own comment on
    // createSceneEditorGroup for what each per-scene registration's
    // activate() actually does (retarget the shared toolbar, scroll the
    // right block into view, focus it) versus this group-level revealSurface
    // (just brings the whole "Весь текст" modal to front).
    // revealSurface only calls showModal when the modal isn't already open --
    // see js/scenes.js's mountSceneModalTextEditor for why an unconditional
    // call would steal focus back from a just-selected project-search match
    // (openModal() always re-schedules its own default-initial-focus
    // microtask, even when reopening an already-open modal).
    allScenesEditorGroup=createSceneEditorGroup({toolbarContainer:document.getElementById("allScenesToolbar"),findReplaceContainer:document.getElementById("allScenesFindReplace"),characters:data.characters,surfaceId:"allScenesModal",revealSurface:()=>{if(document.getElementById("allScenesModal").style.display!=="flex")showModal("allScenesModal")},getProjectData:()=>data,openSceneForEditing:(sceneId,extra)=>openSceneText(sceneId,extra),commitProjectReplaceAll:commitProjectReplaceAllScenes,rebaseSceneDirtyBaseline:rebaseSceneTextDirtyBaseline,confirmProjectReplaceAll:confirmProjectReplaceAllScenes});
    items.forEach(scene=>allScenesEditorGroup.mountScene(scene.id,{editorContainer:document.getElementById(`allSceneEditor-${scene.id}`),scene}));
  }
  showModal("allScenesModal");
  trackerFor("allScenesModal").captureInitialState();
}

// "Only write scenes that actually changed" (critical requirement, T2): the
// baseline for "unchanged" is recomputed here, on demand, as the exact same
// pure conversion each mounted editor actually started from
// (docToJSON(loadSceneDocument(...))) rather than stored once at mount time --
// data.scenes cannot legitimately change out from under an open "Весь текст"
// modal (no realtime/polling in this app), so this stays correct and avoids a
// separate baseline map. A formatting-only change (same prose, different
// marks/alignment) counts as a real change here because the comparison is on
// the full doc JSON, not the plain-text projection.
async function saveAllScenes(){
  if(!allScenesEditorGroup)return {ok:true};
  const changed=[];
  for(const sceneId of allScenesEditorGroup.sceneIds()){
    const scene=data.scenes.find(s=>s.id===sceneId);
    if(!scene)continue;
    const baseline=docToJSON(loadSceneDocument(sceneDocSchema,scene));
    const current=allScenesEditorGroup.getDocJSON(sceneId);
    if(!normalizedEqual(baseline,current))changed.push({scene,...allScenesEditorGroup.serializeScene(sceneId)});
  }
  if(!changed.length)return {ok:true};
  if(isCloudWorkspace()){
    for(const {scene,sceneText,sceneTextDoc} of changed){
      // This surface only ever touches text+metadata now, never chapter/
      // location/tags/etc, so the narrow updateSceneText RPC alone is correct
      // (replaces the old two-RPC-per-scene updateScene+stale-clear pattern).
      // On the first failure, stop and return immediately WITHOUT touching the
      // modal's dirty baseline or destroying any editor -- scenes saved before
      // the failure are already persisted server-side (a harmless redundant
      // resend on retry, since the RPC itself no-ops when nothing changed),
      // and every editor (including in-progress edits in untouched scenes)
      // stays mounted so nothing unsaved is ever silently lost.
      const result=await runCloudMutation("updateSceneText",(api,revision)=>api.updateSceneText(cloudProjectSync.projectId,scene.id,revision,{sceneText,metadata:{richText:sceneTextDoc}}),{renderAfter:false});
      if(!result.ok)return result;
    }
    data=cloudProjectSync.confirmedProject;render();return {ok:true};
  }
  return commitDataChange(next=>changed.forEach(({scene,sceneText,sceneTextDoc})=>{
    const target=next.scenes.find(s=>s.id===scene.id);
    target.sceneText=sceneText;target.sceneTextDoc=sceneTextDoc;
  }),{renderAfter:false});
}

// Find/Replace Stage D2.2.2: the explicit safety confirmation project-wide
// Replace All shows before ITS commit -- wired as find-replace-controller.js's
// `confirmProjectReplaceAll` (via scene-editor-controller.js's
// projectSearchDeps) on every mountSceneEditor/createSceneEditorGroup call
// site, the same three as commitProjectReplaceAllScenes below. `plan` is a
// FRESH find-replace-project-replace-all.js planProjectReplaceAll() result
// with `changed:true` -- find-replace-controller.js's replaceProjectAll owns
// rebuilding it fresh both before this call and again immediately after the
// user answers (this function has no persistence/freshness responsibility
// at all, purely a yes/no prompt over the numbers it's handed).
//
// Reuses js/modal-manager.js's existing generic showConfirmAction/
// confirmActionModal (already used for delete-scene/-chapter/-tag/-location
// confirmations) rather than a new dialog -- proper dialog semantics
// (role="alertdialog", aria-labelledby/describedby), keyboard operability,
// initial focus on the SAFE action (#confirmActionCancel, that element's own
// existing default), and opener-based focus restoration on close all come
// for free, unchanged. `description` uses `\n\n` between its four points --
// css/modals.css gives `#confirmActionDescription` `white-space:pre-line`
// specifically so this (and any future multi-point confirmation) renders as
// distinct lines/paragraphs rather than one run-on sentence; every existing
// single-line caller is unaffected since none of them contain a newline.
// Counts use pluralRu (find-replace-panel.js, already the app's one Russian
// count-pluralization helper -- D1.1) exactly like the project-results
// summary's own "N совпадений · M сцен" wording, never a second
// pluralization implementation.
async function confirmProjectReplaceAllScenes(plan){
  const description=[
    `Будет выполнено ${plan.totalMatchCount} ${pluralRu(plan.totalMatchCount,"замена","замены","замен")} `+
      `(${plan.affectedSceneCount} ${pluralRu(plan.affectedSceneCount,"сцена","сцены","сцен")}).`,
    "Изменения будут сохранены сразу и их нельзя будет отменить через Ctrl+Z.",
    "Если в открытых сценах есть несохранённые изменения, они тоже будут сохранены вместе с заменой.",
    "Замена выполняется по всему проекту, включая сцены, исключённые из общего текста."
  ].join("\n\n");
  return showConfirmAction({title:"Заменить во всём проекте?",description,confirmLabel:"Заменить и сохранить",cancelLabel:"Отмена"});
}

// Find/Replace Stage D2.2.1: the ONE atomic multi-scene write project-wide
// Replace All commits through -- wired as find-replace-controller.js's
// `commitProjectReplaceAll` (via scene-editor-controller.js's
// projectSearchDeps) on every mountSceneEditor/createSceneEditorGroup call
// site (js/scenes.js's mountSceneModalTextEditor/openSceneTextNow, and
// openAllScenesNow above). `plan` is exactly one find-replace-project-
// replace-all.js planProjectReplaceAll() result with `changed:true` --
// `plan.scenes` already carries every affected scene's final, already-
// serialized `{sceneId,sceneText,sceneTextDoc}` row; this function's only
// job is committing all of them together as ONE logical mutation, never a
// per-scene loop (contrast saveAllScenes's own cloud branch above, an
// accepted PRE-EXISTING per-scene loop for ordinary multi-scene Save --
// deliberately NOT reused here, since D2.2.1 requires true atomicity a loop
// of updateSceneText calls cannot provide).
//
// Local: one commitDataChange mutator touching every affected scene's
// sceneText/sceneTextDoc -- storage.js's own commitProjectChange already
// makes that one transactional copy/validate/write/swap, so this is the
// local half of "one logical Project Replace All = one atomic commit"
// (product rule 5) for free, no new local-atomicity mechanism needed.
//
// Cloud: one bulkUpdateSceneText RPC call, through the existing
// runCloudMutation/cloudProjectSync serialized mutation queue -- which
// already resolves `expected_revision` from the current confirmed revision
// (getRevision()) and fails the whole call (REVISION_CONFLICT, surfaced via
// `.ok:false`, never retried automatically) exactly like every other cloud
// content mutation. metadata:{richText:sceneTextDoc} mirrors update_scene_text/
// bulk_update_scene_text's own set-not-merge contract (see
// supabase/migrations/20260910120000_scene_text_bulk_update.sql) -- the same
// mapping saveAllScenes's own cloud branch already uses per scene.
async function commitProjectReplaceAllScenes(plan){
  if(isCloudWorkspace()){
    const result=await runCloudMutation("bulkUpdateSceneText",(api,revision)=>api.bulkUpdateSceneText(
      cloudProjectSync.projectId,revision,
      plan.scenes.map(({sceneId,sceneText,sceneTextDoc})=>({sceneId,sceneText,metadata:{richText:sceneTextDoc}}))
    ),{renderAfter:false});
    if(!result.ok)return result;
    data=cloudProjectSync.confirmedProject;render();return result;
  }
  return commitDataChange(next=>plan.scenes.forEach(({sceneId,sceneText,sceneTextDoc})=>{
    const target=next.scenes.find(s=>s.id===sceneId);
    if(target){target.sceneText=sceneText;target.sceneTextDoc=sceneTextDoc}
  }));
}

// Find/Replace Stage D2.2.1: rebases exactly the persisted-doc portion of
// whichever currently-open tracked form happens to be showing this sceneId,
// after commitProjectReplaceAllScenes above has already committed it AND
// find-replace-controller.js's replaceProjectAll has already synchronized
// that form's own live EditorView to the committed doc (see
// find-replace-project-replace-all.js's syncMountedScenesAfterReplaceAll) --
// the same two-step "commit, then rebase the baseline to match" shape the
// (now-superseded) D2.1 design established, reusing dirty-state.js's own
// generic rebaseExtra rather than a full captureInitialState() (which would
// also silently accept any OTHER unrelated pending dirty state already
// sitting in that same form -- e.g. an in-progress title edit in the Scene
// modal). A pure no-op wherever this sceneId doesn't match whatever that
// tracker is currently showing, or the tracker isn't active at all --
// rebaseExtra itself already guards on `active`.
//
// `editingSceneId`/`textEditingSceneId`/`allScenesEditorGroup` are the exact
// same module-level app state js/scenes.js's own mountSceneModalTextEditor/
// openSceneTextNow already set (see state.js) -- never a second "which scene
// is open where" tracking mechanism.
function rebaseSceneTextDirtyBaseline(sceneId,sceneTextDocJSON){
  if(editingSceneId===sceneId)trackerFor("sceneModal")?.rebaseExtra(extra=>({...extra,doc:normalizeSnapshot(sceneTextDocJSON)}));
  if(textEditingSceneId===sceneId)trackerFor("textModal")?.rebaseExtra(extra=>({...extra,doc:normalizeSnapshot(sceneTextDocJSON)}));
  if(allScenesEditorGroup?.sceneIds().includes(sceneId))trackerFor("allScenesModal")?.rebaseExtra(extra=>({...extra,docs:{...extra.docs,[sceneId]:normalizeSnapshot(sceneTextDocJSON)}}));
}

function exportWholeText(){
  const items=includedScenes();
  if(!items.length){alert("Нет сцен, включённых в общий текст.");return}
  let sections="";
  data.chapters.forEach((chapter,chapterIndex)=>{
    const chapterItems=items.filter(x=>x.scene.chapterId===chapter.id);
    if(!chapterItems.length)return;
    sections+=`${sections?'<div class="page-break"></div>':""}<h1 class="chapter">${wordEscape(chapter.title)}</h1>`;
    chapterItems.forEach(({scene},sceneIndex)=>{
      const meta=[readableDate(scene),locationById(scene.locationId)?.name].filter(Boolean).join(" · ");
      const paragraphs=wordEscape(scene.sceneText||"").split(/\n/).map(line=>line.trim()?`<p>${line}</p>`:"<p>&nbsp;</p>").join("");
      sections+=`<section class="scene">
        <h2>${wordEscape(scene.title||"Без названия")}</h2>
        ${meta?`<p class="meta">${wordEscape(meta)}</p>`:""}
        ${paragraphs}
      </section>`;
    });
  });
  const documentHtml=`<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Текст романа</title><style>
    @page{margin:2cm}body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.5}
    h1.chapter{font-size:20pt;text-align:center;margin:0 0 28pt}
    h2{font-size:15pt;text-align:center;margin:24pt 0 6pt}.meta{text-align:center;color:#666;margin:0 0 18pt}
    p{margin:0 0 8pt;text-indent:1.25cm}.page-break{page-break-before:always}
  </style></head><body>${sections}</body></html>`;
  const blob=new Blob(["\ufeff",documentHtml],{type:"application/msword"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="текст_романа.doc";a.click();URL.revokeObjectURL(a.href);
}

// Find/Replace Stage C: same centralized registration as #textModal/
// #sceneModal (js/app.js, js/modal-manager.js) -- targets whichever scene the
// shared group currently considers active via its own openFind()/
// openReplace(), which are no-ops if "Весь текст" isn't open (no group
// mounted yet).
registerFindReplaceShortcuts("allScenesModal",{openFind:()=>allScenesEditorGroup?.openFind(),openReplace:()=>allScenesEditorGroup?.openReplace()});

Object.assign(globalThis,{includedScenes,openAllScenes,saveAllScenes,destroyAllScenesEditorGroup,exportWholeText,commitProjectReplaceAllScenes,rebaseSceneTextDirtyBaseline,confirmProjectReplaceAllScenes});
export {includedScenes,openAllScenes,saveAllScenes,destroyAllScenesEditorGroup,exportWholeText,commitProjectReplaceAllScenes,rebaseSceneTextDirtyBaseline,confirmProjectReplaceAllScenes};
