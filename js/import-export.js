function includedScenes(){
  return data.scenes
    .map((scene,index)=>({scene,index}))
    .filter(item=>item.scene.included!==false);
}

function openAllScenes(){
  const root=document.getElementById("allScenesList");
  let html="",order=0;
  data.chapters.forEach(chapter=>{
    const items=includedScenes().filter(x=>x.scene.chapterId===chapter.id);
    if(!items.length)return;
    html+=`<h2 style="margin:18px 0 8px">${esc(chapter.title)}</h2>`;
    items.forEach(({scene,index})=>{
      order++;
      html+=`<section class="all-scene-block ${scene.status==="fixed"?"fixed":"floating"}">
        <div class="all-scene-header">
          <div>
            <div class="all-scene-title">${esc(scene.title||"Без названия")}</div>
            <div class="scene-text-meta" style="margin:4px 0 0">
              ${esc(readableDate(scene)||"дата не указана")} · ${esc(locationById(scene.locationId)?.name||"локация не указана")} · ${esc(writingStatusById(scene.writingStatus).label)}
            </div>
          </div>
          <div class="all-scene-number">Сцена ${order}</div>
        </div>
        <textarea class="all-scene-text" data-scene-id="${esc(scene.id)}" placeholder="Текст сцены">${esc(scene.sceneText||"")}</textarea>
      </section>`;
    });
  });
  root.innerHTML=html||'<div class="empty-work">Нет сцен, включённых в общий текст.</div>';
  showModal("allScenesModal");
}

function saveAllScenes(){
  document.querySelectorAll(".all-scene-text").forEach(area=>{
    const scene=sceneById(area.dataset.sceneId);
    if(scene)scene.sceneText=area.value;
  });
  saveData();
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

Object.assign(globalThis,{includedScenes,openAllScenes,saveAllScenes,exportWholeText});
export {includedScenes,openAllScenes,saveAllScenes,exportWholeText};
