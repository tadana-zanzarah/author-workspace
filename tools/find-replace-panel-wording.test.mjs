import assert from "node:assert/strict";
import {ruPluralForm,pluralRu,excludedScenesClause} from "../js/editor/find-replace-panel.js";

// Find/Replace D1.1 wording follow-up: pure Russian-pluralization tests for
// the project-results summary's "N сцена/сцены/сцен не включена/не включены
// в общий текст" clause. No DOM/ProseMirror involved -- these are plain
// string-formatting functions exported from find-replace-panel.js purely so
// every mod-10/mod-100 edge case (including the classic "teens are always
// 'many'" exception at 11-14) can be exercised exhaustively and headlessly,
// without needing a browser for what is pure formatting logic. Browser-level
// integration (the clause actually appearing correctly in the rendered
// summary on all three surfaces) is covered separately in
// tools/find-replace-project-search-browser.test.mjs.

{
  assert.equal(ruPluralForm(1),"one");
  assert.equal(ruPluralForm(21),"one");
  assert.equal(ruPluralForm(31),"one");
  assert.equal(ruPluralForm(11),"many"); // the classic mod-10/mod-100 exception
  assert.equal(ruPluralForm(2),"few");
  assert.equal(ruPluralForm(3),"few");
  assert.equal(ruPluralForm(4),"few");
  assert.equal(ruPluralForm(22),"few");
  assert.equal(ruPluralForm(24),"few");
  assert.equal(ruPluralForm(5),"many");
  assert.equal(ruPluralForm(0),"many");
  assert.equal(ruPluralForm(12),"many");
  assert.equal(ruPluralForm(14),"many");
  assert.equal(ruPluralForm(25),"many");
  assert.equal(ruPluralForm(100),"many");
}

{
  assert.equal(pluralRu(1,"сцена","сцены","сцен"),"сцена");
  assert.equal(pluralRu(2,"сцена","сцены","сцен"),"сцены");
  assert.equal(pluralRu(5,"сцена","сцены","сцен"),"сцен");
  assert.equal(pluralRu(21,"сцена","сцены","сцен"),"сцена");
  assert.equal(pluralRu(22,"сцена","сцены","сцен"),"сцены");
  assert.equal(pluralRu(25,"сцена","сцены","сцен"),"сцен");
  assert.equal(pluralRu(11,"сцена","сцены","сцен"),"сцен");
}

// The excluded-scenes clause itself: noun AND verb agreement together, plus
// the "zero -> empty string, safe to concatenate with no extra punctuation"
// contract the summary renderer relies on.
{
  assert.equal(excludedScenesClause(0),"");
  assert.equal(excludedScenesClause(1)," · 1 сцена не включена в общий текст");
  assert.equal(excludedScenesClause(2)," · 2 сцены не включены в общий текст");
  assert.equal(excludedScenesClause(5)," · 5 сцен не включены в общий текст");
  assert.equal(excludedScenesClause(21)," · 21 сцена не включена в общий текст");
  assert.equal(excludedScenesClause(22)," · 22 сцены не включены в общий текст");
  assert.equal(excludedScenesClause(25)," · 25 сцен не включены в общий текст");
  assert.equal(excludedScenesClause(11)," · 11 сцен не включены в общий текст");
}

console.log("find-replace panel wording unit tests: OK");
