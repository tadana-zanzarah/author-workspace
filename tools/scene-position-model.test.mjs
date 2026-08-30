import assert from "node:assert/strict";
import "../js/scenes.js"; // populates sceneById/firstSceneIdAfterChapter on globalThis
import {
  buildChapterInsertionPositions,
  describeInsertionPosition,
  describeDropPosition,
  isNoOpScenePosition,
  siblingMoveUpTarget,
  siblingMoveDownTarget,
  resolveCreateInsertionTarget
} from "../js/scene-positions.js";

// chapterById lives in chapters.js, which wires save-button controllers against the
// DOM at module load time and can't be imported in plain Node. Stub the same lookup
// scene-positions.js needs from it instead of pulling in the whole module.
globalThis.chapterById=id=>globalThis.data.chapters.find(c=>c.id===id);

function scene(id,chapterId,title=id){return {id,chapterId,title};}

function project(chapters,scenes){globalThis.data={chapters,scenes};}

const CH1={id:"ch1",title:"Глава 1"};
const CH2={id:"ch2",title:"Глава 2"};

// 1) A chapter with zero scenes has exactly one insertion position.
{
  project([CH1],[]);
  const positions=buildChapterInsertionPositions("ch1");
  assert.equal(positions.length,1);
  assert.equal(positions[0].kind,"empty");
  assert.equal(positions[0].beforeSceneId,null);
}

// 2) One scene -> exactly two positions (before it, after it).
{
  project([CH1],[scene("A","ch1")]);
  const positions=buildChapterInsertionPositions("ch1");
  assert.equal(positions.length,2);
  assert.equal(positions[0].kind,"before-first");
  assert.equal(positions[0].beforeSceneId,"A");
  assert.equal(positions[1].kind,"after-last");
  assert.equal(positions[1].beforeSceneId,null);
}

// 3) Three scenes -> exactly four positions: before-first, two betweens, after-last.
{
  project([CH1],[scene("A","ch1"),scene("B","ch1"),scene("C","ch1")]);
  const positions=buildChapterInsertionPositions("ch1");
  assert.equal(positions.length,4);
  assert.deepEqual(positions.map(p=>p.kind),["before-first","between","between","after-last"]);
  assert.deepEqual(positions.map(p=>p.beforeSceneId),["A","B","C",null]);
  // 6) between-scenes: each "between" position names the exact neighbor pair.
  assert.deepEqual(positions[1],{chapterId:"ch1",beforeSceneId:"B",kind:"between",prevSceneId:"A",nextSceneId:"B"});
  assert.deepEqual(positions[2],{chapterId:"ch1",beforeSceneId:"C",kind:"between",prevSceneId:"B",nextSceneId:"C"});
}

// 4) Positions are scoped to the requested chapter only — a scene from another
// chapter never leaks into the list, and N+1 holds per-chapter, not project-wide.
{
  project([CH1,CH2],[scene("A","ch1"),scene("X","ch2"),scene("B","ch1"),scene("Y","ch2")]);
  const ch1Positions=buildChapterInsertionPositions("ch1");
  const ch2Positions=buildChapterInsertionPositions("ch2");
  assert.equal(ch1Positions.length,3); // A,B -> 3 positions
  assert.equal(ch2Positions.length,3); // X,Y -> 3 positions
  assert.ok(ch1Positions.every(p=>p.chapterId==="ch1"));
  assert.ok(ch2Positions.every(p=>p.chapterId==="ch2"));
  // 7) after-last for ch1 must point at the first scene of the NEXT chapter (ch2's X),
  // not some ch1-internal value and not null (ch1 isn't the last chapter).
  assert.equal(ch1Positions[ch1Positions.length-1].beforeSceneId,"X");
  // after-last for the actual last chapter has no "next scene" at all.
  assert.equal(ch2Positions[ch2Positions.length-1].beforeSceneId,null);
}

// 5) before-first names the concrete first scene, regardless of how many chapters precede it.
{
  project([CH1,CH2],[scene("A","ch1"),scene("X","ch2")]);
  const ch2Positions=buildChapterInsertionPositions("ch2");
  assert.equal(ch2Positions[0].kind,"before-first");
  assert.equal(ch2Positions[0].beforeSceneId,"X");
}

// Accessible labels always name the concrete neighbor(s), never a bare "insert here" —
// needed once a project has more than a handful of positions on screen at once.
{
  project([CH1],[scene("Airport","ch1","Аэропорт"),scene("Talk","ch1","Разговор")]);
  const positions=buildChapterInsertionPositions("ch1");
  assert.match(describeInsertionPosition(positions[0]),/перед.*Аэропорт/);
  assert.match(describeInsertionPosition(positions[1]),/между.*Аэропорт.*Разговор/);
  assert.match(describeInsertionPosition(positions[2]),/конец главы.*Глава 1/);
  assert.match(describeDropPosition(positions[1]),/Переместить между.*Аэропорт.*Разговор/);
  project([CH1],[]);
  assert.match(describeInsertionPosition(buildChapterInsertionPositions("ch1")[0]),/Вставить первую сцену главы.*Глава 1/);
}

// 8/12) No-op detection: a scene already immediately before its own drop target,
// or dropped on itself, must be recognized as a no-op — the shared predicate every
// DnD/keyboard-move surface checks before mutating/saving.
{
  project([CH1],[scene("A","ch1"),scene("B","ch1"),scene("C","ch1")]);
  assert.equal(isNoOpScenePosition("A","ch1","B"),true,"A is already immediately before B");
  assert.equal(isNoOpScenePosition("A","ch1","A"),true,"dropping onto itself is always a no-op");
  assert.equal(isNoOpScenePosition("C","ch1",null),true,"C is already last in ch1 (before-next-chapter marker)");
  assert.equal(isNoOpScenePosition("A","ch1","C"),false,"moving A to before C is a real reorder");
  assert.equal(isNoOpScenePosition("A","ch2","B"),false,"a real cross-chapter move is never a no-op");
  assert.equal(isNoOpScenePosition("missing","ch1","B"),false);
}

// 11) DnD/keyboard reorder targets are built from the exact same canonical
// {chapterId,beforeSceneId} shape as buildChapterInsertionPositions — moving a scene
// up/down always lands it on a real position from that same list.
{
  project([CH1],[scene("A","ch1"),scene("B","ch1"),scene("C","ch1")]);
  const positions=buildChapterInsertionPositions("ch1").map(p=>p.beforeSceneId);
  assert.equal(siblingMoveUpTarget("A"),null,"first scene has no 'up' target");
  assert.deepEqual(siblingMoveUpTarget("B"),{chapterId:"ch1",beforeSceneId:"A"});
  assert.ok(positions.includes(siblingMoveUpTarget("C").beforeSceneId));
  assert.equal(siblingMoveDownTarget("C"),null,"last scene has no 'down' target");
  assert.deepEqual(siblingMoveDownTarget("A"),{chapterId:"ch1",beforeSceneId:"C"});
  assert.deepEqual(siblingMoveDownTarget("B"),{chapterId:"ch1",beforeSceneId:null});
  assert.ok(positions.includes(null));
  assert.equal(siblingMoveUpTarget("missing"),null);
  assert.equal(siblingMoveDownTarget("missing"),null);
}

// 10) Changing the create-modal's chapter select must never reuse a beforeSceneId
// computed for a different chapter — the historical bug this model closes.
{
  const target=resolveCreateInsertionTarget("ch1","B","ch2");
  assert.deepEqual(target,{chapterId:"ch2",beforeSceneId:null},"switching chapters resets to the safe append policy for the newly selected chapter");
}
{
  const target=resolveCreateInsertionTarget("ch1","B","ch1");
  assert.deepEqual(target,{chapterId:"ch1",beforeSceneId:"B"},"keeping the same chapter preserves the exact clicked position");
}
{
  // The global "+ Новая сцена" flow (no positional intent) must keep working
  // unchanged regardless of which chapter ends up selected in the modal.
  const target=resolveCreateInsertionTarget("ch1",null,"ch2");
  assert.deepEqual(target,{chapterId:"ch2",beforeSceneId:null});
}

// 9) buildChapterInsertionPositions always reads data.scenes directly — there is no
// "filtered scenes" parameter it could be handed, so a caller literally cannot ask it
// for a position derived from a filtered subset. Any filtering must happen at the
// call site (hiding the controls), never inside the canonical position model.
{
  project([CH1],[scene("A","ch1"),scene("B","ch1"),scene("C","ch1")]);
  const full=buildChapterInsertionPositions("ch1");
  assert.equal(buildChapterInsertionPositions.length,1,"the model takes only a chapterId — no filtered-list parameter to misuse");
  assert.equal(full.length,4);
}

console.log("scene position model unit tests: OK");
