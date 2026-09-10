// Find/Replace Stage B: the reusable, headless ProseMirror matching/
// replacement engine. No DOM, no EditorView, no EditorState, no Supabase, no
// application-surface (modal/toolbar/panel) dependency -- only `prosemirror-
// transform` and the pure string helpers in ./find-replace-text.js. This is
// deliberately usable two ways later: (1) a live editor's controller can
// replay a returned Transform's `.steps` onto its own `EditorState.tr` in one
// `view.dispatch(...)` call (one prosemirror-history undo step, however many
// individual matches were replaced), or (2) project-wide scanning/replacement
// preparation can call this directly against a doc loaded from persisted data
// via `loadSceneDocument` (no EditorState involved at all) and read the
// resulting `.doc`/`.steps` to build the final scene_text/metadata values a
// later stage sends to `bulk_update_scene_text`. See
// docs/find-replace-architecture.md.
//
// @typedef {Object} FindReplaceMatch
// @property {number} from - ProseMirror doc position immediately before the
//   first matched character (inclusive), valid against the exact doc snapshot
//   `findMatches` was called with (like any ProseMirror position, it is not
//   meaningful against a doc mutated since).
// @property {number} to - ProseMirror doc position immediately after the last
//   matched character (exclusive).
// @property {string} text - The matched text exactly as it appears in the
//   source document -- never normalized or case-folded. This, together with
//   from/to, is the match's public identity; no transient normalized-string
//   index is ever exposed.
// @property {number} paragraphPos - The doc position of the paragraph node
//   this match belongs to (the same convention `Node.descendants`/
//   `nodesBetween` use: the position immediately before the paragraph's own
//   opening token). A stable "which paragraph" reference for later
//   navigation/grouping without re-deriving it from from/to.
import {Transform} from "prosemirror-transform";
import {buildComparisonIndex,findComparisonRanges} from "./find-replace-text.js";

// Walks one paragraph's own children (never recurses -- paragraph content is
// "inline*", so there is nothing beneath a text node to descend into) and
// builds:
//   - sourceText: the concatenation of every TEXT child's string content, in
//     document order -- exactly the prose a human would read in this
//     paragraph, with no separator/placeholder for any non-text child.
//   - runs: one entry per text-node child, {sourceStart,sourceEnd,docStart},
//     recording where that child's characters begin in BOTH sourceText and
//     the real ProseMirror document. A run's docEnd is always
//     `docStart + (sourceEnd-sourceStart)` -- ProseMirror counts document
//     positions in the same units (UTF-16 code units) a JS string uses for
//     its own `.length`, so a text node's characters map to CONSECUTIVE doc
//     positions with no scaling needed.
//
// A non-text inline child (none exist in the current schema -- paragraph
// content is only ever `text` nodes carrying marks -- but the walk is written
// generically rather than assuming that) contributes zero characters to
// sourceText while still advancing the running document position by its own
// `nodeSize`, exactly mirroring how the block-level `sceneBreak` atom is
// already excluded from prose search: a structural node can never become
// searchable/replaceable text just because this function's caller iterates
// over it.
//
// NOTE: this function's boundary lookup (see sourceIndexToDocPos below)
// assumes adjacent text runs are always contiguous in document position too
// (no gap between run[i].sourceEnd and run[i+1].sourceStart's corresponding
// doc positions) -- true today because paragraph content is 100% text nodes.
// If a future schema change ever introduces a non-text INLINE node (e.g. an
// inline footnote reference), a match landing exactly on the boundary
// touching that node would need an explicit "which side of the boundary"
// rule; not needed for the schema that exists today, and not added
// speculatively here.
function collectParagraphRuns(paragraphNode,paragraphContentStart){
  let sourceText="";
  const runs=[];
  let pos=paragraphContentStart;
  paragraphNode.forEach(child=>{
    if(child.isText){
      const sourceStart=sourceText.length;
      sourceText+=child.text;
      runs.push({sourceStart,sourceEnd:sourceText.length,docStart:pos});
    }
    pos+=child.nodeSize;
  });
  return {sourceText,runs};
}

function sourceIndexToDocPos(runs,sourceIndex){
  for(const run of runs){
    if(sourceIndex>=run.sourceStart&&sourceIndex<=run.sourceEnd)return run.docStart+(sourceIndex-run.sourceStart);
  }
  throw new RangeError(`find-replace-model: source index ${sourceIndex} is not covered by any text run`);
}

// Search the STRUCTURED document -- never docToPlainText()'s flattened
// projection. Paragraph-scoped by construction: each paragraph's comparison
// string is built and searched independently (see collectParagraphRuns
// above), so a match can never span a paragraph boundary, and any block that
// is not a paragraph (currently only the `sceneBreak` atom) is never visited
// as a search target at all -- `doc.descendants` is only asked to look inside
// paragraph nodes, and paragraphs are the only block type with searchable
// text content in this schema.
//
// query and every paragraph's source text go through the identical
// `buildComparisonIndex` transform (grapheme-cluster segmentation -> NFC ->
// optional toLowerCase()), so two different Unicode representations of "the
// same" text always compare equal, while every match found is mapped back
// through that transform's provenance table to the real original source
// range before being converted to ProseMirror positions -- never the
// normalized string's own indices.
export function findMatches(doc,query,{caseSensitive=false}={}){
  const {comparisonText:queryComparison}=buildComparisonIndex(query||"",{caseSensitive});
  if(!queryComparison)return [];
  const matches=[];
  doc.descendants((node,pos)=>{
    if(node.type.name!=="paragraph")return false;
    const {sourceText,runs}=collectParagraphRuns(node,pos+1);
    if(!sourceText)return false;
    const {comparisonText,provenance}=buildComparisonIndex(sourceText,{caseSensitive});
    for(const [cFrom,cTo] of findComparisonRanges(comparisonText,queryComparison)){
      const origFrom=provenance[cFrom].start;
      const origTo=provenance[cTo-1].end;
      matches.push({
        from:sourceIndexToDocPos(runs,origFrom),
        to:sourceIndexToDocPos(runs,origTo),
        text:sourceText.slice(origFrom,origTo),
        paragraphPos:pos
      });
    }
    return false;
  });
  return matches;
}

// Marks for one replacement range, using ProseMirror's OWN native mark-
// resolution primitive (`ResolvedPos.marksAcross` / `.marks()`) rather than
// any hand-built formatting heuristic -- see the module doc comment above and
// docs/find-replace-architecture.md for what this primitive actually does
// (empirically pinned by tests, not assumed): for this schema (no mark is
// declared `inclusive:false`), it resolves to the marks of the text run
// immediately AT the match's start -- "leading-edge" marks, not an
// intersection across the whole matched range. A replacement whose matched
// text is uniformly one run's marks therefore keeps them; a replacement
// spanning a mark change takes whatever the FIRST character's run carries.
//
// Deliberately NOT `tr.insertText(...)` (the `Transaction`-only convenience
// method): that method prefers `this.storedMarks` when set, which reflects
// transient editor-toolbar UI state (e.g. immediately after toggling Bold
// with an empty cursor selection) that has nothing to do with any of N
// unrelated matches scattered across a document during Replace All. Calling
// the same underlying primitive directly, unconditionally, keeps every
// match's marks a pure function of the document content at that position --
// deterministic regardless of what state a live editor happened to be in.
function marksForRange(doc,from,to){
  if(from===to)return doc.resolve(from).marks();
  return doc.resolve(from).marksAcross(doc.resolve(to))||[];
}

// Shared implementation for both "replace one match" and "replace all
// matches": builds a plain `Transform` (no EditorState/Transaction needed) by
// applying every given match's replacement against `doc`, one match at a
// time, in REVERSE document order (rightmost match first). Because matches
// never overlap (see findComparisonRanges) and processing goes strictly
// right-to-left, every not-yet-processed match's `from`/`to` -- computed once
// against the ORIGINAL `doc` before any replacement happened -- remains a
// valid, unshifted position against the transform's evolving `.doc` at the
// moment it is finally processed: nothing to the LEFT of an unprocessed match
// is ever touched before that match's own turn. No position-mapping bookkeeping
// is needed as a result, and this guarantees, by construction:
//   - the whole operation is exactly one `Transform` (one set of steps, so
//     replaying them onto a real `Transaction` in one `dispatch()` call later
//     is exactly one prosemirror-history undo step, no matter how many
//     matches were replaced);
//   - replacement text is never re-searched/re-replaced mid-operation --
//     `matches` is a fixed, precomputed list, never recomputed against the
//     mutating doc, so a replacement can never cascade into "matching" its
//     own or another replacement's inserted text.
// An empty `replacementText` deletes the matched range instead of inserting
// an empty text node (mirrors `Transaction.insertText`'s own empty-text
// branch). Replacement text is used completely verbatim -- never normalized,
// case-folded, or otherwise transformed on the way into the document.
function buildReplacementTransform(doc,matches,replacementText){
  const tr=new Transform(doc);
  const ordered=[...matches].sort((a,b)=>b.from-a.from);
  for(const {from,to} of ordered){
    if(!replacementText){
      tr.deleteRange(from,to);
      continue;
    }
    const marks=marksForRange(tr.doc,from,to);
    tr.replaceRangeWith(from,to,tr.doc.type.schema.text(replacementText,marks));
  }
  return tr;
}

// Replace exactly one match. Returns a `Transform` (`.doc` is the resulting
// document; `.steps` can be replayed onto a live `Transaction`).
export function replaceOneMatch(doc,match,replacementText){
  return buildReplacementTransform(doc,[match],replacementText);
}

// Replace every given match (typically the full result of one `findMatches`
// call) as a single `Transform` -- see buildReplacementTransform above for
// the ordering/atomicity/no-cascade guarantees this provides.
export function replaceAllMatches(doc,matches,replacementText){
  return buildReplacementTransform(doc,matches,replacementText);
}

export {collectParagraphRuns,sourceIndexToDocPos};
