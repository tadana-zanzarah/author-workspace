import assert from "node:assert/strict";
import {nextCharacterSortOrder,computeInsertSortOrder} from "../js/characters.js";

// A. nextCharacterSortOrder places a new character after the current end of the list,
// regardless of legacy zero/duplicate sort_order values already present.
globalThis.data={characters:[{id:"a",sortOrder:0},{id:"b",sortOrder:0}]};
assert.equal(nextCharacterSortOrder(),1000,"first meaningful sortOrder is 1000 above the max (even when legacy rows are all 0)");
globalThis.data={characters:[{id:"a",sortOrder:1000},{id:"b",sortOrder:2500}]};
assert.equal(nextCharacterSortOrder(),3500,"next sortOrder is 1000 above the current max");
globalThis.data={characters:[]};
assert.equal(nextCharacterSortOrder(),1000,"empty project starts at 1000");

// computeInsertSortOrder: boundary and midpoint cases used by drag reorder.
assert.equal(computeInsertSortOrder([],0),1000,"single-item list with no neighbors");
assert.equal(computeInsertSortOrder([{sortOrder:1000}],0),0,"insert before the only item goes below it");
assert.equal(computeInsertSortOrder([{sortOrder:1000}],1),2000,"insert after the only item goes above it");
assert.equal(computeInsertSortOrder([{sortOrder:1000},{sortOrder:2000}],1),1500,"insert between two neighbors takes the midpoint");
assert.equal(computeInsertSortOrder([{sortOrder:Number.MAX_SAFE_INTEGER-1},{sortOrder:Number.MAX_SAFE_INTEGER}],1),null,"exhausted precision between neighbors signals renormalization");

// B/C/H (drag reorder mutating the live array, reload persistence, and duplicate-name
// safety) are covered end-to-end in tools/character-order-browser.test.mjs, because
// reorderCharacterTo() also drives renderProfiles()/render(), which need a real DOM.

console.log("character order unit tests passed");
