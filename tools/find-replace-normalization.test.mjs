import assert from "node:assert/strict";
import {segmentGraphemeClusters,buildComparisonIndex,findComparisonRanges} from "../js/editor/find-replace-text.js";

// Find/Replace Stage B: pure Unicode comparison-primitive tests. No
// ProseMirror involved here at all -- see find-replace-model.test.mjs for the
// same concepts exercised against real documents/positions.
//
// Every Unicode-sensitive string below is built from explicit \u escapes,
// never a pasted glyph -- a combining-mark sequence is visually
// indistinguishable from its precomposed counterpart in normal source text,
// so spelling them out numerically is the only way to make what is actually
// being tested auditable (and immune to any tool/editor along the way
// silently normalizing a literal character).
const YO_PRECOMPOSED="ё"; // CYRILLIC SMALL LETTER IO (ё), 1 code unit
const YO_DECOMPOSED="ё"; // CYRILLIC SMALL LETTER IE + COMBINING DIAERESIS, 2 code units
const YE="е"; // CYRILLIC SMALL LETTER IE (е), no diaeresis at all -- a different letter
const E_ACUTE_PRECOMPOSED="é"; // LATIN SMALL LETTER E WITH ACUTE (é), 1 code unit
const E_ACUTE_DECOMPOSED="é"; // e + COMBINING ACUTE ACCENT, 2 code units
const I_DOT="İ"; // LATIN CAPITAL LETTER I WITH DOT ABOVE (İ)

// 1. Ordinary Cyrillic segmentation: one cluster per plain character.
{
  const clusters=segmentGraphemeClusters("Мир"); // "Мир"
  assert.deepEqual(clusters.map(c=>c.text),["М","и","р"]);
  assert.deepEqual(clusters.map(c=>[c.start,c.end]),[[0,1],[1,2],[2,3]]);
}

// 2. Case-sensitive vs case-insensitive comparison form.
{
  const text="Мир"; // "Мир"
  const sensitive=buildComparisonIndex(text,{caseSensitive:true}).comparisonText;
  const insensitive=buildComparisonIndex(text,{caseSensitive:false}).comparisonText;
  assert.equal(sensitive,text);
  assert.equal(insensitive,text.toLowerCase());
}

// 3. ё and е remain distinct after NFC + case-folding -- this module never
// introduces ё/е autofolding.
{
  const yo=buildComparisonIndex(YO_PRECOMPOSED+"ж",{caseSensitive:false}).comparisonText; // "ёж"
  const ye=buildComparisonIndex(YE+"ж",{caseSensitive:false}).comparisonText; // "еж"
  assert.notEqual(yo,ye,"ё and е must never compare equal");
}

// 4. Precomposed vs combining Cyrillic equivalent (ё vs е + U+0308): distinct
// source bytes, but the SAME comparison form -- this is what lets a document
// and a typed query find each other regardless of which representation
// either one happens to use.
{
  assert.notEqual(YO_PRECOMPOSED,YO_DECOMPOSED,"sanity: the two source strings really are different byte sequences");
  const a=buildComparisonIndex(YO_PRECOMPOSED,{caseSensitive:false});
  const b=buildComparisonIndex(YO_DECOMPOSED,{caseSensitive:false});
  assert.equal(a.comparisonText,b.comparisonText,"precomposed and combining ё must normalize to the same comparison form");
  // Provenance still points at each string's OWN original span, not a shared one.
  assert.deepEqual(a.provenance[0],{start:0,end:1},"precomposed source: the ё cluster is 1 original code unit");
  assert.deepEqual(b.provenance[0],{start:0,end:2},"decomposed source: the е+combining-diaeresis cluster is 2 original code units");
}

// 5. Precomposed vs combining Latin accent (é vs e + U+0301): same idea.
{
  const a=buildComparisonIndex(E_ACUTE_PRECOMPOSED,{caseSensitive:false});
  const b=buildComparisonIndex(E_ACUTE_DECOMPOSED,{caseSensitive:false});
  assert.equal(a.comparisonText,b.comparisonText);
  assert.deepEqual(a.provenance[0],{start:0,end:1});
  assert.deepEqual(b.provenance[0],{start:0,end:2});
}

// 6. Unicode default case-fold LENGTH-CHANGE: the locale-independent
// String.prototype.toLowerCase() mapping of İ (U+0130) is "i" + COMBINING DOT
// ABOVE (U+0307) -- TWO UTF-16 units from ONE source code point. This is
// exactly the "toLowerCase() can also change string length" case the
// engine's provenance model must survive: every output unit produced by that
// one cluster must still map back to that SAME single-code-point original
// span.
{
  assert.equal(I_DOT.toLowerCase().length,2,"sanity: this runtime's toLowerCase() really does expand U+0130 to 2 units");
  const source=I_DOT+"stanbul"; // "İstanbul"
  const {comparisonText,provenance}=buildComparisonIndex(source,{caseSensitive:false});
  assert.equal(comparisonText,I_DOT.toLowerCase()+"stanbul");
  assert.deepEqual(provenance[0],{start:0,end:1},"first expanded unit maps back to the single original İ code point");
  assert.deepEqual(provenance[1],{start:0,end:1},"second expanded unit maps back to the SAME single original İ code point, not a phantom second one");
  assert.deepEqual(provenance[2],{start:1,end:2},"the following 's' is unaffected and starts its own span immediately after");
}

// 7. findComparisonRanges: empty query never matches (never "matches at
// every position", which a naive indexOf("") loop would produce).
{
  assert.deepEqual(findComparisonRanges("мир",""),[]); // "мир"
}

// 8. Query longer than the haystack: zero matches.
{
  assert.deepEqual(findComparisonRanges("аб","абвгд"),[]); // "аб" vs "абвгд"
}

// 9. Overlapping candidates: v1 policy is non-overlapping, left-to-right --
// "aa" against "aaa" yields exactly ONE match at [0,2), not two overlapping
// candidates sharing the middle "a". Matches ordinary Replace-All
// expectations in every mainstream editor.
{
  assert.deepEqual(findComparisonRanges("aaa","aa"),[[0,2]]);
}

// 10. Adjacent (non-overlapping, back-to-back) matches are both found.
{
  assert.deepEqual(findComparisonRanges("abab","ab"),[[0,2],[2,4]]);
}

// 11. Multiple non-adjacent matches, still non-overlapping.
{
  assert.deepEqual(findComparisonRanges("aXaXa","a"),[[0,1],[2,3],[4,5]]);
}

console.log("find-replace normalization unit tests: OK");
