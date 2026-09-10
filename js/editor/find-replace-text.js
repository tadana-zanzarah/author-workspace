// Find/Replace Stage B: pure, DOM-independent Unicode comparison primitives.
// No ProseMirror dependency here at all -- this module only ever deals in
// plain JS strings, so it is independently testable and reusable by anything
// that needs "compare two strings the way Find/Replace does" without needing
// a document at all.
//
// v1 is literal substring matching only -- no regex, no wildcards, no
// typography/autoformat, no ё/е folding (they are different letters and are
// never unified by anything in this module). Case-insensitive comparison uses
// the Unicode-default `String.prototype.toLowerCase()`, never
// `toLocaleLowerCase()` -- the same project and query must never produce a
// different match set merely because two users' browsers report different
// locales (see docs/find-replace-architecture.md).

const HAS_SEGMENTER=typeof Intl!=="undefined"&&typeof Intl.Segmenter==="function";

// Real UAX#29 grapheme-cluster segmentation. `index` is the ORIGINAL string's
// UTF-16 offset where the cluster starts -- exactly what we need to build a
// provenance table back to source positions.
function segmentGraphemeClustersViaIntl(text){
  const segmenter=new Intl.Segmenter(undefined,{granularity:"grapheme"});
  const clusters=[];
  for(const {segment,index} of segmenter.segment(text))clusters.push({text:segment,start:index,end:index+segment.length});
  return clusters;
}

// Deterministic fallback for a runtime without Intl.Segmenter: group each
// base code point together with any immediately-following Unicode combining
// mark (general category M: Mn/Mc/Me). This is a narrower approximation of
// full UAX#29 (it does not special-case e.g. emoji ZWJ sequences or regional
// indicators), but it preserves exactly the property this module actually
// needs clusters for -- a base character is never separated from ITS OWN
// combining marks, so NFC/case-fold provenance can never straddle two
// logically different characters. Built via `Array.from` (iterates by Unicode
// code point, per the string iterator protocol) specifically so a surrogate
// pair is never split in half by this grouping.
function segmentGraphemeClustersFallback(text){
  const codePoints=Array.from(text);
  const clusters=[];
  let index=0,i=0;
  while(i<codePoints.length){
    let cluster=codePoints[i];
    const start=index;
    index+=codePoints[i].length;
    i++;
    while(i<codePoints.length&&/\p{M}/u.test(codePoints[i])){
      cluster+=codePoints[i];
      index+=codePoints[i].length;
      i++;
    }
    clusters.push({text:cluster,start,end:index});
  }
  return clusters;
}

// Exported for direct testability of the segmentation step in isolation.
export function segmentGraphemeClusters(text){
  return HAS_SEGMENTER?segmentGraphemeClustersViaIntl(text):segmentGraphemeClustersFallback(text);
}

// The core provenance-preserving comparison primitive. Segments `text` into
// grapheme clusters, normalizes EACH cluster independently to NFC (case-folds
// it too when caseSensitive is false, via plain toLowerCase()), and
// concatenates the results into `comparisonText` -- while recording, for
// EVERY UTF-16 code unit that comparisonText ends up with, which original
// [start,end) source span produced it. A cluster's per-cluster transform can
// expand or contract in length (the classic example: the Unicode
// locale-independent lowercasing of "İ" (U+0130) produces "i̇" -- two UTF-16
// units from one input code point) -- every output unit such a cluster
// produces still maps back to that SAME original span, so provenance stays
// correct regardless of how much a cluster's comparison form grows or
// shrinks. `provenance.length === comparisonText.length` always, by
// construction.
//
// Per-cluster (not whole-string) normalization is deliberate: NFC composition
// only ever combines a base character with ITS OWN trailing combining marks,
// never across unrelated base characters, so processing clusters
// independently loses no composition opportunity versus normalizing the
// whole string at once -- while making it possible to map a found match back
// to the exact original source range afterward, which whole-string
// normalization cannot do safely (normalizing first and finding indexes in
// the normalized string, then reusing those indexes as if they were original
// offsets, is exactly the corruption this function exists to avoid).
export function buildComparisonIndex(text,{caseSensitive=false}={}){
  const clusters=segmentGraphemeClusters(text);
  let comparisonText="";
  const provenance=[];
  for(const cluster of clusters){
    let unit=cluster.text.normalize("NFC");
    if(!caseSensitive)unit=unit.toLowerCase();
    comparisonText+=unit;
    for(let k=0;k<unit.length;k++)provenance.push({start:cluster.start,end:cluster.end});
  }
  return {comparisonText,provenance};
}

// Plain, non-overlapping, left-to-right literal substring search over an
// already-built comparison string (see buildComparisonIndex above) -- no
// regex anywhere. Once a match is found, the next search starts strictly
// after it, so two matches can never overlap; this is the v1 policy for
// ambiguous overlapping candidates (e.g. query "aa" against source "aaa"
// yields exactly one match at [0,2), not two overlapping ones), matching
// ordinary Find/Replace-All expectations in every mainstream editor. An empty
// query always yields zero matches (never "match at every position").
export function findComparisonRanges(comparisonText,queryComparisonText){
  if(!queryComparisonText)return [];
  const ranges=[];
  let from=0;
  while(from<=comparisonText.length-queryComparisonText.length){
    const idx=comparisonText.indexOf(queryComparisonText,from);
    if(idx===-1)break;
    ranges.push([idx,idx+queryComparisonText.length]);
    from=idx+queryComparisonText.length;
  }
  return ranges;
}
