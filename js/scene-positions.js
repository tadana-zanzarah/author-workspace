// Shared "scene position" domain model.
//
// Between/around every chapter's scenes there are N+1 places a scene can land:
// before the first scene, between each adjacent pair, after the last scene, or
// (for an empty chapter) the single slot the chapter has. Scene creation via the
// modal (openNewSceneAt), drag-and-drop (compactMoveScene / moveScene RPC) and
// keyboard reorder all describe a destination the same way: {chapterId,
// beforeSceneId}. This module builds that list once and gives it a shared
// accessible-label vocabulary, instead of every view re-deriving its own index
// math. Nothing here computes a numeric position — chapter grouping plus
// "insert before this scene id" is the whole contract; the historical chronology
// regression came from treating a flat numeric position as chapter-comparable,
// so this module deliberately never does that.

function chapterScenesInOrder(chapterId){
  return data.scenes.filter(scene=>scene.chapterId===chapterId);
}

function buildChapterInsertionPositions(chapterId){
  const scenes=chapterScenesInOrder(chapterId);
  const tailBeforeSceneId=firstSceneIdAfterChapter(chapterId);
  if(!scenes.length){
    return [{chapterId,beforeSceneId:tailBeforeSceneId,kind:"empty",prevSceneId:null,nextSceneId:null}];
  }
  const positions=[{chapterId,beforeSceneId:scenes[0].id,kind:"before-first",prevSceneId:null,nextSceneId:scenes[0].id}];
  for(let i=0;i<scenes.length-1;i++){
    positions.push({chapterId,beforeSceneId:scenes[i+1].id,kind:"between",prevSceneId:scenes[i].id,nextSceneId:scenes[i+1].id});
  }
  positions.push({chapterId,beforeSceneId:tailBeforeSceneId,kind:"after-last",prevSceneId:scenes[scenes.length-1].id,nextSceneId:null});
  return positions;
}

function positionSceneTitle(sceneId){
  const scene=sceneId?sceneById(sceneId):null;
  return scene?(scene.title||"Без названия"):"";
}

function describeInsertionPosition(position){
  const chapterTitle=chapterById(position.chapterId)?.title||"";
  if(position.kind==="empty")return `Вставить первую сцену главы «${chapterTitle}»`;
  if(position.kind==="before-first")return `Вставить сцену перед «${positionSceneTitle(position.nextSceneId)}»`;
  if(position.kind==="after-last")return `Вставить сцену в конец главы «${chapterTitle}»`;
  return `Вставить сцену между «${positionSceneTitle(position.prevSceneId)}» и «${positionSceneTitle(position.nextSceneId)}»`;
}

function describeDropPosition(position){
  const chapterTitle=chapterById(position.chapterId)?.title||"";
  if(position.kind==="empty")return `Переместить в пустую главу «${chapterTitle}»`;
  if(position.kind==="before-first")return `Переместить перед «${positionSceneTitle(position.nextSceneId)}»`;
  if(position.kind==="after-last")return `Переместить в конец главы «${chapterTitle}»`;
  return `Переместить между «${positionSceneTitle(position.prevSceneId)}» и «${positionSceneTitle(position.nextSceneId)}»`;
}

// True when moving `sceneId` to {chapterId,beforeSceneId} would leave the canonical
// chapter-grouped order exactly as it is — the shared no-op predicate for insertion
// UI, drop-target styling and tests. compactMoveScene already refuses to mutate/save
// in this situation independently; this is the same semantic check, expressed as a
// pure, directly testable function.
function isNoOpScenePosition(sceneId,chapterId,beforeSceneId){
  const scene=sceneById(sceneId);
  if(!scene||scene.chapterId!==chapterId)return false;
  if(beforeSceneId===sceneId)return true;
  const siblings=chapterScenesInOrder(chapterId);
  const idx=siblings.findIndex(s=>s.id===sceneId);
  if(idx<0)return false;
  const currentNext=idx===siblings.length-1?firstSceneIdAfterChapter(chapterId):siblings[idx+1].id;
  return currentNext===(beforeSceneId||null);
}

// Keyboard reorder alternative to drag-and-drop: move one step within the scene's
// own chapter. Deliberately same-chapter only — full cross-chapter reordering stays
// a drag operation; the accessible alternative moves one step at a time instead of
// requiring every N+1 position in Tab order.
function siblingMoveUpTarget(sceneId){
  const scene=sceneById(sceneId);
  if(!scene)return null;
  const siblings=chapterScenesInOrder(scene.chapterId);
  const idx=siblings.findIndex(s=>s.id===sceneId);
  if(idx<=0)return null;
  return {chapterId:scene.chapterId,beforeSceneId:siblings[idx-1].id};
}

function siblingMoveDownTarget(sceneId){
  const scene=sceneById(sceneId);
  if(!scene)return null;
  const siblings=chapterScenesInOrder(scene.chapterId);
  const idx=siblings.findIndex(s=>s.id===sceneId);
  if(idx<0||idx>=siblings.length-1)return null;
  const beforeSceneId=idx+2<siblings.length?siblings[idx+2].id:firstSceneIdAfterChapter(scene.chapterId);
  return {chapterId:scene.chapterId,beforeSceneId};
}

async function moveSceneUp(sceneId){
  if(hasActiveFilters())return {ok:false};
  const target=siblingMoveUpTarget(sceneId);
  if(!target)return {ok:false};
  const result=await compactMoveScene(sceneId,target);
  if(result.ok&&!result.unchanged)render();
  return result;
}

async function moveSceneDown(sceneId){
  if(hasActiveFilters())return {ok:false};
  const target=siblingMoveDownTarget(sceneId);
  if(!target)return {ok:false};
  const result=await compactMoveScene(sceneId,target);
  if(result.ok&&!result.unchanged)render();
  return result;
}

// The create-scene modal opens with an explicit {openedChapterId,openedBeforeSceneId}
// positional intent (or none, for the global "+ Новая сцена" append flow). If the user
// then changes the chapter dropdown, `openedBeforeSceneId` refers to a scene in a
// DIFFERENT chapter and must never be reused — that would save a real chapter with a
// position derived from another chapter's neighbors. The safe, existing policy for
// "no specific position in this chapter" is append-to-end, so a chapter change resets
// to that rather than attempting a cross-chapter remap.
function resolveCreateInsertionTarget(openedChapterId,openedBeforeSceneId,selectedChapterId){
  if(!openedBeforeSceneId)return {chapterId:selectedChapterId,beforeSceneId:null};
  if(selectedChapterId===openedChapterId)return {chapterId:selectedChapterId,beforeSceneId:openedBeforeSceneId};
  return {chapterId:selectedChapterId,beforeSceneId:null};
}

Object.assign(globalThis,{chapterScenesInOrder,buildChapterInsertionPositions,describeInsertionPosition,describeDropPosition,isNoOpScenePosition,siblingMoveUpTarget,siblingMoveDownTarget,moveSceneUp,moveSceneDown,resolveCreateInsertionTarget});
export {chapterScenesInOrder,buildChapterInsertionPositions,describeInsertionPosition,describeDropPosition,isNoOpScenePosition,siblingMoveUpTarget,siblingMoveDownTarget,moveSceneUp,moveSceneDown,resolveCreateInsertionTarget};
