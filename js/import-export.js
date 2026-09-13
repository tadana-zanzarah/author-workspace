import {sceneDocSchema} from "./editor/scene-doc-schema.js";
import {docToJSON,loadSceneDocument} from "./editor/scene-doc-convert.js";
import {createSceneEditorGroup} from "./editor/scene-editor-controller.js";
import {normalizedEqual} from "./dirty-state.js";

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
    allScenesEditorGroup=createSceneEditorGroup({toolbarContainer:document.getElementById("allScenesToolbar"),findReplaceContainer:document.getElementById("allScenesFindReplace"),characters:data.characters,surfaceId:"allScenesModal",revealSurface:()=>{if(document.getElementById("allScenesModal").style.display!=="flex")showModal("allScenesModal")},getProjectData:()=>data,openSceneForEditing:(sceneId,extra)=>openSceneText(sceneId,extra),saveSceneText:saveSceneTextCanonical,rebaseSceneDirtyBaseline:rebaseSceneTextDirtyBaseline});
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

// Find/Replace Stage D2.1: the ONE canonical single-scene text+doc write
// project-wide Replace uses -- both for its own pre-commit synchronization
// save (see js/editor/find-replace-project-replace.js's
// resolveMountedSceneAgreement/replaceProjectMatch) and for committing the
// replacement itself. Exactly the same two branches saveAllScenes()'s own
// per-scene loop above already uses (the narrow updateSceneText RPC /
// commitDataChange) -- never a parallel write mechanism, never
// bulkUpdateSceneText (Replace All is explicitly out of scope for this
// stage) -- just addressed at one explicit sceneId instead of iterated from
// whichever scenes happen to be mounted in "Весь текст". Injected into
// find-replace-controller.js as `saveSceneText` (see
// js/editor/scene-editor-controller.js's projectSearchDeps) rather than
// imported directly there, keeping js/editor/* ignorant of cloud/local
// persistence specifics.
async function saveSceneTextCanonical(sceneId,{sceneText,sceneTextDoc}){
  const scene=data.scenes.find(s=>s.id===sceneId);
  if(!scene)return {ok:false,code:"NOT_FOUND",message:"Сцена не найдена"};
  if(isCloudWorkspace()){
    return runCloudMutation("updateSceneText",(api,revision)=>api.updateSceneText(cloudProjectSync.projectId,sceneId,revision,{sceneText,metadata:{richText:sceneTextDoc}}));
  }
  return commitDataChange(next=>{
    const target=next.scenes.find(s=>s.id===sceneId);
    target.sceneText=sceneText;target.sceneTextDoc=sceneTextDoc;
  });
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

Object.assign(globalThis,{includedScenes,openAllScenes,saveAllScenes,saveSceneTextCanonical,destroyAllScenesEditorGroup,exportWholeText});
export {includedScenes,openAllScenes,saveAllScenes,saveSceneTextCanonical,destroyAllScenesEditorGroup,exportWholeText};
