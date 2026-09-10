import assert from "node:assert/strict";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {plainTextToDoc} from "../js/editor/scene-doc-convert.js";
import {canonicalProjectScenes,searchProject,flattenProjectMatches,reresolveMatch,buildMatchSnippet} from "../js/editor/find-replace-project-search.js";
import {registerMountedScene,unregisterMountedScene,_resetMountedSceneRegistryForTests} from "../js/editor/mounted-scene-registry.js";

// Find/Replace Stage D1: the headless project-wide search layer, exercised
// against the REAL rich-text schema/matching engine (never a mock), and the
// REAL mounted-scene registry for the live-vs-persisted resolution policy.
function scene(id,title,chapterId,sceneText,{included=true}={}){
  return {id,title,chapterId,sceneText,included};
}

const project={
  chapters:[
    {id:"chapter-1",title:"Глава 1"},
    {id:"chapter-unassigned",title:"Без главы"},
    {id:"chapter-2",title:"Глава 2"}
  ],
  scenes:[
    scene("scene-1","Приём","chapter-1","Кот сидел на окне."),
    // Deliberately included:false -- project scope must NOT filter by
    // scene.included the way includedScenes()/"Весь текст" export does.
    scene("scene-2","После бала","chapter-unassigned","Здесь тоже был кот.",{included:false}),
    scene("scene-3","Возвращение","chapter-2","Кот пришёл домой. Кот поел.")
  ]
};

// 1. Canonical order: chapters in their OWN stored array order (including
// the synthetic chapter-unassigned wherever it happens to sit in that
// array), then scenes within a chapter in `scenes`' own stored order.
// sceneOrder is 1-based and counts every active scene, not just matched
// ones.
{
  const ordered=canonicalProjectScenes(project);
  assert.deepEqual(ordered.map(x=>x.scene.id),["scene-1","scene-2","scene-3"]);
  assert.deepEqual(ordered.map(x=>x.sceneOrder),[1,2,3]);
  assert.equal(ordered[1].chapter.id,"chapter-unassigned");
}

// 2. Project search finds matches in ALL active scenes regardless of
// `included`, with correct total/affected counts, canonical ordering, and
// chapter/scene identity on each result.
{
  const result=searchProject(project,"кот",{caseSensitive:false});
  assert.equal(result.totalMatches,4,"scene-1:1 + scene-2:1 + scene-3:2");
  assert.equal(result.affectedSceneCount,3);
  assert.deepEqual(result.scenes.map(s=>s.sceneId),["scene-1","scene-2","scene-3"]);
  const excludedSceneResult=result.scenes.find(s=>s.sceneId==="scene-2");
  assert.ok(excludedSceneResult,"scene.included===false must still be searched and reported");
  assert.equal(excludedSceneResult.chapterTitle,"Без главы");
  assert.equal(excludedSceneResult.sceneOrder,2);
  const scene3Result=result.scenes.find(s=>s.sceneId==="scene-3");
  assert.equal(scene3Result.matches.length,2);
  assert.deepEqual(scene3Result.matches.map(m=>m.occurrenceIndex),[0,1]);
}

// 3. An empty query yields an empty, well-formed result (never a crash, never
// "everything matches").
{
  const result=searchProject(project,"",{caseSensitive:false});
  assert.equal(result.totalMatches,0);
  assert.equal(result.affectedSceneCount,0);
  assert.deepEqual(result.scenes,[]);
}

// 4. Case-sensitive toggle.
{
  const mixed={chapters:project.chapters,scenes:[scene("scene-4","Смешанный регистр","chapter-1","Кот, кот, КОТ.")]};
  assert.equal(searchProject(mixed,"кот",{caseSensitive:true}).totalMatches,1);
  assert.equal(searchProject(mixed,"кот",{caseSensitive:false}).totalMatches,3);
}

// 5. ё/е remain distinct in project search, exactly like Stage B's engine
// (find-replace-project-search.js never reimplements comparison logic -- it
// delegates to findMatches -- but this is worth pinning at this layer too).
{
  const yo={chapters:project.chapters,scenes:[scene("scene-5","Пётр","chapter-1","Пётр и Петр — разные слова.")]};
  const result=searchProject(yo,"Петр",{caseSensitive:false});
  assert.equal(result.totalMatches,1,"ё must never fold to е in project search");
}

// 6. Snippets are built from the ORIGINAL source text (never the normalized
// comparison string), correctly split into before/match/after, and long
// paragraphs are trimmed rather than producing huge rows.
{
  const longText="Абзац "+"слово ".repeat(30)+"КЛЮЧ"+" ещё ".repeat(30)+"текст.";
  const longScene=scene("scene-6","Длинная сцена","chapter-1",longText);
  const result=searchProject({chapters:project.chapters,scenes:[longScene]},"ключ",{caseSensitive:false});
  assert.equal(result.totalMatches,1);
  const {before,match,after}=result.scenes[0].matches[0].snippet;
  assert.equal(match,"КЛЮЧ","the highlighted segment must be the literal matched source text");
  assert.ok(before.length<longText.length,"snippet must trim a long paragraph's leading context");
  assert.ok(after.length<longText.length,"snippet must trim a long paragraph's trailing context");
  assert.ok(before.startsWith("…"),"a truncated leading context must be marked with an ellipsis");
  assert.ok(after.endsWith("…"),"a truncated trailing context must be marked with an ellipsis");
}

// 7. Match identity is never a normalized-string index -- from/to are real
// document positions, and matchId is stable/derivable, never exposing any
// normalized-comparison offset.
{
  const result=searchProject(project,"кот",{caseSensitive:false});
  const first=result.scenes[0].matches[0];
  assert.equal(typeof first.from,"number");
  assert.equal(typeof first.to,"number");
  assert.ok(first.to>first.from);
  assert.equal(first.matchId,`scene-1#${first.from}-${first.to}#0`);
}

// 8. flattenProjectMatches preserves canonical scene order and each scene's
// own internal match order.
{
  const result=searchProject(project,"кот",{caseSensitive:false});
  const flat=flattenProjectMatches(result);
  assert.equal(flat.length,4);
  assert.deepEqual(flat.map(m=>m.sceneId),["scene-1","scene-2","scene-3","scene-3"]);
}

// 9. Live-vs-persisted resolution: a mounted live EditorView's doc overrides
// the persisted scene document for search purposes -- search-only, no save
// involved (searchProject never touches scene.sceneText/sceneTextDoc).
{
  _resetMountedSceneRegistryForTests();
  const liveDoc=plainTextToDoc(schema,"Кот сидел на окне. Кот встал и ушёл.");
  const liveView={isDestroyed:false,state:{doc:liveDoc}};
  const registrationId=registerMountedScene("scene-1",{view:liveView,surfaceId:"textModal",activate(){}});
  const result=searchProject(project,"кот",{caseSensitive:false});
  const scene1Result=result.scenes.find(s=>s.sceneId==="scene-1");
  assert.equal(scene1Result.source,"live");
  assert.equal(scene1Result.matches.length,2,"must reflect the LIVE doc's content, not the persisted scene.sceneText");
  const scene3Result=result.scenes.find(s=>s.sceneId==="scene-3");
  assert.equal(scene3Result.source,"persisted","an unmounted scene must still resolve from persisted data");
  unregisterMountedScene("scene-1",registrationId);
  _resetMountedSceneRegistryForTests();
}

// 10. Stale-result revalidation (reresolveMatch): the common case (nothing
// relevant changed) returns the exact same range/text; a shifted-but-still-
// present occurrence resolves via occurrenceIndex; a genuinely vanished
// match returns null rather than ever pointing at unrelated text.
{
  const originalDoc=plainTextToDoc(schema,"Кот сидел на окне.");
  const originalMatches=searchProject({chapters:project.chapters,scenes:[scene("s","S","chapter-1","Кот сидел на окне.")]},"кот",{caseSensitive:false}).scenes[0].matches;
  const target=originalMatches[0];

  // 10a. Nothing changed -- exact from/to/text still present.
  {
    const resolved=reresolveMatch(originalDoc,"кот",{caseSensitive:false},target);
    assert.ok(resolved);
    assert.equal(resolved.from,target.from);
    assert.equal(resolved.to,target.to);
  }

  // 10b. An edit BEFORE the match shifts its position but the occurrence
  // (same relative index) still exists -- falls back to occurrenceIndex.
  {
    const shiftedDoc=plainTextToDoc(schema,"Ранее здесь кот сидел на окне.");
    const resolved=reresolveMatch(shiftedDoc,"кот",{caseSensitive:false},target);
    assert.ok(resolved,"a shifted-but-present occurrence must still resolve via occurrenceIndex");
    assert.notEqual(resolved.from,target.from,"the resolved position must reflect the NEW doc, not the stale one");
    assert.equal(shiftedDoc.textBetween(resolved.from,resolved.to).toLowerCase(),"кот");
  }

  // 10c. The match is genuinely gone (query no longer present anywhere) --
  // must return null, never fall back to the stale from/to.
  {
    const goneDoc=plainTextToDoc(schema,"Собака сидела на окне.");
    const resolved=reresolveMatch(goneDoc,"кот",{caseSensitive:false},target);
    assert.equal(resolved,null,"a vanished match must never resolve to unrelated text");
  }
}

// 11. buildMatchSnippet is exported and independently usable/testable.
{
  const doc=plainTextToDoc(schema,"Слово раз, слово два.");
  const matches=searchProject({chapters:project.chapters,scenes:[scene("s","S","chapter-1","Слово раз, слово два.")]},"два",{caseSensitive:false}).scenes[0].matches;
  assert.equal(matches[0].snippet.match,"два");
  void doc;
}

console.log("find-replace-project-search.test.mjs: all assertions passed");
