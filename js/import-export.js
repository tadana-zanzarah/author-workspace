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
    allScenesEditorGroup=createSceneEditorGroup({toolbarContainer:document.getElementById("allScenesToolbar"),characters:data.characters});
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

Object.assign(globalThis,{includedScenes,openAllScenes,saveAllScenes,destroyAllScenesEditorGroup,exportWholeText});
export {includedScenes,openAllScenes,saveAllScenes,destroyAllScenesEditorGroup,exportWholeText};
