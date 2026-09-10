import assert from "node:assert/strict";
import {EditorState} from "prosemirror-state";
import {history,undo} from "prosemirror-history";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {findMatches,replaceOneMatch,replaceAllMatches} from "../js/editor/find-replace-model.js";

// Find/Replace Stage B: the headless matching/replacement engine, exercised
// against the REAL rich-text schema (js/editor/scene-doc-schema.js) and real
// ProseMirror documents/positions -- never a mocked/simplified schema. See
// tools/find-replace-normalization.test.mjs for the pure Unicode-comparison
// primitives this builds on.
//
// Every Unicode-sensitive fixture is built from explicit \u escapes rather
// than a pasted glyph, for the same auditability reason as the normalization
// test file.
const YO_PRECOMPOSED="ё"; // CYRILLIC SMALL LETTER IO
const YO_DECOMPOSED="ё"; // CYRILLIC SMALL LETTER IE + COMBINING DIAERESIS
const E_ACUTE_PRECOMPOSED="é"; // LATIN SMALL LETTER E WITH ACUTE
const E_ACUTE_DECOMPOSED="é"; // e + COMBINING ACUTE ACCENT
const COMBINING_ACUTE="́";
const I_DOT="İ"; // LATIN CAPITAL LETTER I WITH DOT ABOVE

const bold=()=>schema.marks.strong.create();
const t=(text,marks=[])=>schema.text(text,marks);
const para=(...textNodes)=>schema.nodes.paragraph.create(null,textNodes);
const makeDoc=(...blocks)=>schema.nodes.doc.create(null,blocks);
const sceneBreak=()=>schema.nodes.sceneBreak.create();

function assertMatch(doc,match,expectedText){
  assert.equal(match.text,expectedText,"match.text must be the literal, unnormalized source text");
  assert.equal(doc.textBetween(match.from,match.to),expectedText,"match.from/to must resolve to exactly the matched source text");
}

// 1. Ordinary Cyrillic literal search, exact position pinned by hand for the
// simplest possible document (one paragraph, one text node) to establish the
// baseline: paragraph content starts at doc position 1.
{
  const d=makeDoc(para(t("Виктор вошёл в комнату."))); // "Виктор вошёл в комнату."
  const matches=findMatches(d,"Виктор"); // "Виктор"
  assert.equal(matches.length,1);
  assert.deepEqual(matches[0],{from:1,to:7,text:"Виктор",paragraphPos:0});
}

// 2. Ordinary Latin literal search.
{
  const d=makeDoc(para(t("Hello, brave new world.")));
  const matches=findMatches(d,"brave");
  assert.equal(matches.length,1);
  assertMatch(d,matches[0],"brave");
}

// 3. Case-sensitive vs case-insensitive.
{
  const d=makeDoc(para(t("Viktor viktor VIKTOR")));
  assert.equal(findMatches(d,"viktor",{caseSensitive:true}).length,1,"case-sensitive: only the lowercase occurrence matches");
  assert.equal(findMatches(d,"viktor",{caseSensitive:false}).length,3,"case-insensitive: all three case variants match");
}

// 4. ё distinct from е -- case-insensitive search for "Петр" must not match
// "Пётр" (a different word/name).
{
  const d=makeDoc(para(t("Пётр и Петр — разные слова."))); // "Пётр и Петр — разные слова."
  const matches=findMatches(d,"Петр",{caseSensitive:false}); // "Петр"
  assert.equal(matches.length,1,"ё must never fold to е");
  assertMatch(d,matches[0],"Петр");
}

// 5. Precomposed vs combining Cyrillic equivalent: a query typed with a
// combining diaeresis finds a document written with the precomposed letter,
// and vice versa.
{
  const d=makeDoc(para(t("П"+YO_PRECOMPOSED+"тр вош"+YO_PRECOMPOSED+"л."))); // "Пётр вошёл." (precomposed)
  const viaDecomposedQuery=findMatches(d,"П"+YO_DECOMPOSED+"тр"); // query typed with combining diaeresis
  assert.equal(viaDecomposedQuery.length,1);
  assertMatch(d,viaDecomposedQuery[0],"П"+YO_PRECOMPOSED+"тр");

  const d2=makeDoc(para(t("П"+YO_DECOMPOSED+"тр вош"+YO_DECOMPOSED+"л."))); // same text, decomposed source
  const viaPrecomposedQuery=findMatches(d2,"П"+YO_PRECOMPOSED+"тр"); // query typed with precomposed letter
  assert.equal(viaPrecomposedQuery.length,1);
  assertMatch(d2,viaPrecomposedQuery[0],"П"+YO_DECOMPOSED+"тр");
}

// 6. Precomposed vs combining Latin accent, same idea.
{
  const d=makeDoc(para(t("Caf"+E_ACUTE_PRECOMPOSED+" du Nord")));
  const matches=findMatches(d,"caf"+E_ACUTE_DECOMPOSED,{caseSensitive:false});
  assert.equal(matches.length,1);
  assertMatch(d,matches[0],"Caf"+E_ACUTE_PRECOMPOSED);
}

// 7. Unicode case-fold length-change (İ -> i+combining-dot-above): provenance
// must remain correct even though the case-folded comparison form is LONGER
// than the single original code point that produced it. Note, and pin, a
// real consequence of this: because String.prototype.toLowerCase() folds İ
// to TWO code units (i + U+0307 COMBINING DOT ABOVE), a query typed with a
// plain undotted "i" does NOT find "İstanbul" -- there is no combining mark
// in that query to match the one the fold introduced. This is the correct,
// deterministic, locale-INDEPENDENT behavior mandated for v1 (never
// toLocaleLowerCase()), not a bug -- see docs/find-replace-architecture.md.
{
  const d=makeDoc(para(t(I_DOT+"stanbul is a city."))); // "İstanbul is a city."
  const foldedQuery=I_DOT.toLowerCase()+"stanbul"; // "i" + combining dot above + "stanbul"
  const matches=findMatches(d,foldedQuery,{caseSensitive:false});
  assert.equal(matches.length,1);
  assertMatch(d,matches[0],I_DOT+"stanbul");
  assert.equal(matches[0].to-matches[0].from,8,"8 original characters (İ + stanbul) recovered, never 9");

  assert.deepEqual(
    findMatches(d,"istanbul",{caseSensitive:false}),[],
    "a plain undotted \"i\" query must not match -- toLowerCase() introduced a combining mark this query does not have"
  );
}

// 8. Match adjacent to a mark boundary, entirely inside the bold run: bold is
// preserved on replace.
{
  const d=makeDoc(para(t("Привет, "),t("мир",[bold()])));
  const matches=findMatches(d,"мир");
  assert.equal(matches.length,1);
  const result=replaceOneMatch(d,matches[0],"вселенная").doc;
  assert.deepEqual(result.toJSON().content[0].content,[
    {type:"text",text:"Привет, "},
    {type:"text",marks:[{type:"strong"}],text:"вселенная"}
  ]);
}

// 9. Match SPANNING a mark boundary: pin the ACTUAL observed ProseMirror
// behavior (empirically confirmed, see docs/find-replace-architecture.md) --
// this schema declares no mark as `inclusive:false`, so
// ResolvedPos.marksAcross resolves to the marks of the run at the match's
// OWN start (`from`), i.e. "leading-edge" marks, not an intersection across
// the whole match and not "any mark present anywhere in the range wins".
{
  // Leading run bold -> replacement is bold.
  const dBoldFirst=makeDoc(para(t("При",[bold()]),t("вет")));
  const mBoldFirst=findMatches(dBoldFirst,"Привет");
  assert.equal(mBoldFirst.length,1);
  const resultBoldFirst=replaceOneMatch(dBoldFirst,mBoldFirst[0],"Здравствуй").doc;
  assert.deepEqual(resultBoldFirst.toJSON().content[0].content,[{type:"text",marks:[{type:"strong"}],text:"Здравствуй"}]);

  // Leading run plain, trailing run bold -> replacement is PLAIN (proves this
  // is leading-edge, not "bold wins if present anywhere in the match").
  const dPlainFirst=makeDoc(para(t("При"),t("вет",[bold()])));
  const mPlainFirst=findMatches(dPlainFirst,"Привет");
  assert.equal(mPlainFirst.length,1);
  const resultPlainFirst=replaceOneMatch(dPlainFirst,mPlainFirst[0],"Здравствуй").doc;
  assert.deepEqual(resultPlainFirst.toJSON().content[0].content,[{type:"text",text:"Здравствуй"}]);
}

// 10. Normalization-affecting grapheme sitting EXACTLY at a mark boundary:
// the base character "e" (bold) is its own text node, and the combining
// acute accent + rest of the word ("clair") is a separate, plain text node --
// i.e. the decomposed é's two code points come from two DIFFERENT marked
// runs. A precomposed-é query must still find it (grapheme clustering runs
// on the paragraph's full concatenated source text, not per-run), and the
// leading-edge mark policy still applies (bold, from the "e" run).
{
  const d=makeDoc(para(t("e",[bold()]),t(COMBINING_ACUTE+"clair")));
  const matches=findMatches(d,E_ACUTE_PRECOMPOSED+"clair"); // query: precomposed "éclair"
  assert.equal(matches.length,1);
  assertMatch(d,matches[0],"e"+COMBINING_ACUTE+"clair"); // the ORIGINAL (decomposed) source text, unnormalized
  const result=replaceOneMatch(d,matches[0],"napoleon").doc;
  assert.deepEqual(result.toJSON().content[0].content,[{type:"text",marks:[{type:"strong"}],text:"napoleon"}]);
}

// 11. Surrounding combining sequence remains untouched: replacing only ONE of
// two decomposed occurrences must leave the OTHER occurrence's exact original
// (decomposed) bytes completely unchanged -- the engine never normalizes
// content it isn't replacing.
{
  const word="caf"+E_ACUTE_DECOMPOSED; // decomposed "café"
  const d=makeDoc(para(t(word+" de Paris, "+word+" du Nord")));
  const matches=findMatches(d,"caf"+E_ACUTE_PRECOMPOSED,{caseSensitive:false});
  assert.equal(matches.length,2);
  const result=replaceOneMatch(d,matches[0],"bar").doc; // replace only the FIRST occurrence
  const resultText=result.textBetween(0,result.content.size,"\n");
  assert.equal(resultText,"bar de Paris, "+word+" du Nord","the untouched second occurrence must still be byte-for-byte decomposed");
}

// 12. No match across paragraph boundaries -- concatenated boundary text
// would spell the query, but real paragraph structure prevents it.
{
  const d=makeDoc(para(t("...end of the car")),para(t("pet under the table...")));
  assert.deepEqual(findMatches(d,"carpet"),[]);
  // sanity: the same query would (wrongly) match if the two paragraphs' text
  // were naively flattened and concatenated with no boundary.
  assert.ok(("...end of the car"+"pet under the table...").includes("carpet"));
}

// 13. sceneBreak is structurally excluded: never visited as search text at
// all, and never breaks iteration into paragraphs on either side of it.
{
  const d=makeDoc(para(t("Текст до.")),sceneBreak(),para(t("Текст после.")));
  assert.deepEqual(findMatches(d,"*"),[],"the sceneBreak's rendered \"* * *\" label is presentation-only, never real searchable text");
  const matches=findMatches(d,"Текст");
  assert.equal(matches.length,2,"both paragraphs on either side of the scene break are still found");
  assert.notEqual(matches[0].paragraphPos,matches[1].paragraphPos);
}

// 14. Multiple text nodes (3+ runs, mixed marks) inside one paragraph: a
// match may span any number of adjacent runs.
{
  const d=makeDoc(para(t("Привет, "),t("бренный ",[bold()]),t("мир!")));
  const matches=findMatches(d,"бренный мир");
  assert.equal(matches.length,1);
  assertMatch(d,matches[0],"бренный мир");
}

// 15. Empty query => zero matches.
{
  const d=makeDoc(para(t("Что угодно.")));
  assert.deepEqual(findMatches(d,""),[]);
}

// 16. Query longer than the paragraph => zero matches.
{
  const d=makeDoc(para(t("Коротко.")));
  assert.deepEqual(findMatches(d,"Коротко. И ещё длиннее."),[]);
}

// 17. Adjacent matches (no gap) and overlapping candidates (v1 policy:
// non-overlapping, left-to-right).
{
  const d=makeDoc(para(t("abab")));
  assert.equal(findMatches(d,"ab").length,2,"adjacent, non-overlapping matches are both found");
  const d2=makeDoc(para(t("aaa")));
  const overlapMatches=findMatches(d2,"aa");
  assert.equal(overlapMatches.length,1,"overlapping candidates resolve to exactly one left-to-right match");
  assertMatch(d2,overlapMatches[0],"aa");
}

// 18. Replacement with an empty string deletes the match (never inserts an
// empty text node).
{
  const d=makeDoc(para(t("Привет, мир!")));
  const matches=findMatches(d,"мир");
  const result=replaceOneMatch(d,matches[0],"").doc;
  assert.equal(result.textBetween(0,result.content.size),"Привет, !");
}

// 19. Replacement longer than the match, and shorter than the match.
{
  const d=makeDoc(para(t("Привет, мир!")));
  const longer=replaceOneMatch(d,findMatches(d,"мир")[0],"необъятная вселенная").doc;
  assert.equal(longer.textBetween(0,longer.content.size),"Привет, необъятная вселенная!");
  const shorter=replaceOneMatch(d,findMatches(d,"Привет")[0],"Хай").doc;
  assert.equal(shorter.textBetween(0,shorter.content.size),"Хай, мир!");
}

// 20. Match at paragraph start and match at paragraph end.
{
  const d=makeDoc(para(t("Начало и конец")));
  const atStart=findMatches(d,"Начало");
  assert.equal(atStart.length,1);
  assert.equal(atStart[0].from,1,"match at the very start of paragraph content");
  const atEnd=findMatches(d,"конец");
  assert.equal(atEnd.length,1);
  assert.equal(atEnd[0].to,d.content.firstChild.nodeSize-1,"match ending at the very end of paragraph content");
}

// 21. Multiple matches in one paragraph, and the same query across several
// paragraphs (with correct, distinct paragraphPos per match).
{
  const d=makeDoc(para(t("кот сидел, кот смотрел, кот молчал")));
  assert.equal(findMatches(d,"кот").length,3);

  const d2=makeDoc(para(t("кот на окне")),para(t("кот на столе")),para(t("кот в коробке")));
  const matches=findMatches(d2,"кот");
  assert.equal(matches.length,3);
  assert.deepEqual(new Set(matches.map(m=>m.paragraphPos)).size,3,"each match belongs to a distinct paragraph");
}

// 22. Non-overlapping Replace All, one Transform, one editor-history
// operation: dispatching the whole Transform's steps as a single transaction
// and then calling Undo ONCE must restore the ORIGINAL document exactly,
// via the real prosemirror-history plugin (not a hand-rolled snapshot).
{
  const originalDoc=makeDoc(para(t("ababab")));
  const matches=findMatches(originalDoc,"ab");
  assert.equal(matches.length,3);

  const transform=replaceAllMatches(originalDoc,matches,"X");
  assert.equal(transform.doc.textBetween(0,transform.doc.content.size),"XXX","all three non-overlapping matches replaced, no cascading");

  let state=EditorState.create({schema,doc:originalDoc,plugins:[history()]});
  let tr=state.tr;
  transform.steps.forEach(step=>tr.step(step));
  state=state.apply(tr); // ONE dispatched transaction, however many matches it replaced
  assert.equal(state.doc.textBetween(0,state.doc.content.size),"XXX");

  const undone=undo(state,appliedTr=>{state=state.apply(appliedTr)});
  assert.equal(undone,true,"a single Undo must be available");
  assert.ok(state.doc.eq(originalDoc),"a single Undo must restore the ENTIRE Replace All in one step, not partially");
}

// 23. Replacement text is never normalized/case-converted by the engine:
// inserting an intentionally decomposed replacement string must land in the
// document byte-for-byte as supplied, never recomposed to NFC.
{
  const d=makeDoc(para(t("placeholder")));
  const decomposedReplacement="caf"+E_ACUTE_DECOMPOSED; // e + combining acute, NOT precomposed
  const result=replaceOneMatch(d,findMatches(d,"placeholder")[0],decomposedReplacement).doc;
  const insertedText=result.content.firstChild.textContent;
  assert.equal(insertedText,decomposedReplacement);
  assert.equal(insertedText.length,4,"still 2 code units for the e+combining-acute pair -- never recomposed to a single precomposed é");
}

console.log("find-replace model unit tests: OK");
