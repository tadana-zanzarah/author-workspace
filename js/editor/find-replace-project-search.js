// Find/Replace Stage D1: the headless, reusable PROJECT-WIDE search layer.
// Depends only on:
//   - canonical project data (a plain `{chapters,scenes}`-shaped object --
//     never imported as a global; always passed in, exactly like Stage B's
//     engine takes a `doc` rather than reaching for one itself);
//   - the Stage B matching engine (find-replace-model.js);
//   - the mounted-scene registry (mounted-scene-registry.js), for the
//     live-vs-persisted resolution policy.
// It must NOT depend on "Весь текст"'s own DOM/state, `import-export.js`'s
// `allScenesEditorGroup`, or any modal. See docs/find-replace-architecture.md
// for why ("Весь текст" is one editing surface among three; project search
// must work with none of them open at all).
//
// "Весь проект" scope = every active (non-deleted) project scene, regardless
// of `scene.included` -- NOT `includedScenes()`/"Весь текст" export
// semantics. `get_project_content` (cloud) already never returns soft-deleted
// scenes to the client, so `projectData.scenes` already *is* "every active
// scene" -- no extra filtering is needed or performed here.
import {sceneDocSchema} from "./scene-doc-schema.js";
import {loadSceneDocument} from "./scene-doc-convert.js";
import {findMatches} from "./find-replace-model.js";
import {getPreferredLiveSceneView} from "./mounted-scene-registry.js";

const SNIPPET_CONTEXT_CHARS=42;

// Canonical project order: chapters in `projectData.chapters`' own stored
// order (this already includes the synthetic "chapter-unassigned" pseudo-
// chapter as a real entry -- see AGENTS.md/docs/find-replace-architecture.md
// -- so no separate "unassigned" special case exists here), then scenes
// within each chapter in `projectData.scenes`' own stored order. This is
// exactly the ordering `js/import-export.js`'s `openAllScenesNow` already
// builds for "Весь текст" -- not a new ordering model, just the same walk
// reused headlessly. `sceneOrder` is a 1-based running index across the
// WHOLE project (every active scene counts towards it, matched or not), so
// it stays meaningful as a stable "which position in the manuscript" number
// regardless of which scenes happen to contain a match for a given query.
export function canonicalProjectScenes(projectData){
  const chapters=projectData?.chapters||[];
  const scenes=projectData?.scenes||[];
  const result=[];
  let sceneOrder=0;
  chapters.forEach(chapter=>{
    scenes.filter(scene=>scene.chapterId===chapter.id).forEach(scene=>{
      sceneOrder++;
      result.push({scene,chapter,sceneOrder});
    });
  });
  return result;
}

// Live-vs-persisted resolution for ONE scene (search-only -- never triggers a
// save, per docs/find-replace-architecture.md's Stage D2 boundary). Returns
// {doc,source,conflict} where source is "live"|"persisted" and `conflict` is
// true when a genuine multi-view divergence forced the safe persisted
// fallback (see mounted-scene-registry.js's getPreferredLiveSceneView for the
// exact deterministic policy this defers to).
function resolveSceneDoc(scene){
  const preferred=getPreferredLiveSceneView(scene.id);
  if(preferred&&preferred.status==="ok"){
    return {doc:preferred.registration.view.state.doc,source:"live",conflict:false};
  }
  const persistedDoc=loadSceneDocument(sceneDocSchema,scene);
  return {doc:persistedDoc,source:"persisted",conflict:preferred?.status==="conflict"};
}

// Builds a readable snippet around one match FROM THE ORIGINAL SOURCE TEXT of
// its own paragraph -- never from the normalized comparison string
// (find-replace-text.js's buildComparisonIndex output is comparison-only and
// is never surfaced to a user). Paragraph content in this schema is always
// pure text nodes (see find-replace-model.js's own collectParagraphRuns
// comment), so `paragraph.textContent` IS the exact original prose with no
// loss. Returns plain strings only ({before,match,after}) -- rendering code
// is responsible for using them as text content, never as HTML, so manuscript
// text can never be interpreted as markup (see docs/find-replace-
// architecture.md and this stage's own product brief, section 7).
function buildMatchSnippet(doc,match){
  const paragraph=doc.nodeAt(match.paragraphPos);
  if(!paragraph)return {before:"",match:match.text,after:""};
  const paragraphText=paragraph.textContent;
  const paragraphContentStart=match.paragraphPos+1;
  const localFrom=match.from-paragraphContentStart;
  const localTo=match.to-paragraphContentStart;
  const rawBefore=paragraphText.slice(0,localFrom);
  const rawAfter=paragraphText.slice(localTo);
  const truncatedBefore=rawBefore.length>SNIPPET_CONTEXT_CHARS;
  const truncatedAfter=rawAfter.length>SNIPPET_CONTEXT_CHARS;
  const before=(truncatedBefore?"…":"")+rawBefore.slice(-SNIPPET_CONTEXT_CHARS).trimStart();
  const after=rawAfter.slice(0,SNIPPET_CONTEXT_CHARS).trimEnd()+(truncatedAfter?"…":"");
  return {before,match:paragraphText.slice(localFrom,localTo),after};
}

// One project-wide search. Never mutates anything, never saves, never reads
// from network -- pure computation over whatever doc snapshots
// resolveSceneDoc hands it at the moment of the call. Result shape:
//
// {
//   query, caseSensitive,
//   totalMatches, affectedSceneCount,
//   scenes: [{
//     sceneId, sceneTitle, chapterId, chapterTitle, sceneOrder, source,
//     doc,           // the exact ProseMirror doc snapshot searched -- kept
//                     // for stale-navigation revalidation (see
//                     // reresolveMatch below); never serialized/compared by
//                     // reference elsewhere, only via Node#eq or re-search.
//     matches: [{matchId,from,to,text,occurrenceIndex,snippet}]
//   }],
//   conflictedSceneIds: [sceneId, ...] // scenes whose live views disagreed
//                                       // with no safe preference -- see
//                                       // resolveSceneDoc/mounted-scene-
//                                       // registry.js. Search still ran
//                                       // (against the persisted doc), this
//                                       // is only a surfaced advisory.
// }
//
// Only scenes with at least one match are included in `scenes` (keeps the
// result compact for the UI -- see product brief section 6) -- sceneOrder
// still reflects true project position since it is assigned during the full
// canonical walk, not re-numbered after filtering.
export function searchProject(projectData,query,{caseSensitive=false}={}){
  const ordered=canonicalProjectScenes(projectData);
  const scenes=[];
  const conflictedSceneIds=[];
  let totalMatches=0;
  if(query){
    for(const {scene,chapter,sceneOrder} of ordered){
      const {doc,source,conflict}=resolveSceneDoc(scene);
      if(conflict)conflictedSceneIds.push(scene.id);
      const rawMatches=findMatches(doc,query,{caseSensitive});
      if(!rawMatches.length)continue;
      const matches=rawMatches.map((match,occurrenceIndex)=>({
        matchId:`${scene.id}#${match.from}-${match.to}#${occurrenceIndex}`,
        from:match.from,to:match.to,text:match.text,
        occurrenceIndex,
        snippet:buildMatchSnippet(doc,match)
      }));
      totalMatches+=matches.length;
      scenes.push({
        sceneId:scene.id,sceneTitle:scene.title||"Без названия",
        chapterId:chapter.id,chapterTitle:chapter.title||"",
        // D1.1 fix: the canonical "Включить сцену в общий текст и выгрузку"
        // flag (js/scenes.js's own `s.included!==false` check, same
        // convention `includedScenes()` in js/import-export.js uses to
        // decide which scenes "Весь текст" mounts) -- carried through here so
        // the summary's "N сцен не включены в общий текст" count (see
        // excludedSceneCount below) is read from this ONE canonical property,
        // never a second, independently-derived interpretation of it.
        included:scene.included!==false,
        sceneOrder,source,doc,matches
      });
    }
  }
  // D1.1 fix: a SUBSET of affectedSceneCount (scenes.length), never a
  // separate/additive count -- "how many of the scenes already counted in
  // affectedSceneCount are configured as not included in the combined/
  // general text". Computed once here, from the canonical `included` flag
  // just carried through above, so every consumer (the controller's
  // snapshot, the panel's summary) reads the exact same number rather than
  // re-deriving it (e.g. from a navigation-domain count, which measures a
  // different thing entirely -- reachable MATCHES, not excluded SCENES).
  const excludedSceneCount=scenes.filter(sceneResult=>!sceneResult.included).length;
  return {query,caseSensitive,totalMatches,affectedSceneCount:scenes.length,excludedSceneCount,scenes,conflictedSceneIds};
}

// Flat, navigation-order list of every {sceneId,sceneTitle,chapterTitle,
// sceneOrder,...match} across every scene, in the same canonical order the
// result itself already carries. The panel's Next/Previous-in-project-
// results navigation is just "advance an index into this array" -- no
// separate ordering logic anywhere else.
export function flattenProjectMatches(result){
  const flat=[];
  for(const sceneResult of result.scenes){
    for(const match of sceneResult.matches){
      flat.push({
        sceneId:sceneResult.sceneId,sceneTitle:sceneResult.sceneTitle,
        chapterId:sceneResult.chapterId,chapterTitle:sceneResult.chapterTitle,
        sceneOrder:sceneResult.sceneOrder,source:sceneResult.source,
        // Find/Replace Stage D2.1.4: carried through so pickPostReplaceActiveIndex
        // below can prefer an author-visible (included) scene as the automatic
        // post-Replace fallback -- see that function's own doc comment.
        included:sceneResult.included,
        doc:sceneResult.doc,...match
      });
    }
  }
  return flat;
}

// Stale-result safety (product brief section 9): a project result's
// from/to/text is only valid against the EXACT doc snapshot it was found
// against. Before navigating, this re-derives the intended occurrence
// against whatever doc is CURRENT right now:
//   1. If a match with the identical from/to/text still exists in a fresh
//      search of `currentDoc`, use it verbatim -- the common case where
//      nothing relevant changed.
//   2. Otherwise fall back to the same positional `occurrenceIndex` in the
//      fresh match list, if one still exists at that index -- "the Nth
//      occurrence of this query is still roughly the same edit target" is a
//      reasonable, deterministic, testable policy when exact position/text
//      no longer matches (e.g. an edit earlier in the doc shifted positions
//      without touching the match itself).
//   3. If neither holds, return null -- callers must NOT fall back to the
//      stale from/to on a doc that has actually diverged; selecting
//      unrelated text after an edit is exactly what this function exists to
//      prevent.
// Never mutates `currentDoc`; never reads from network; pure and synchronous.
export function reresolveMatch(currentDoc,query,{caseSensitive=false}={},{from,to,text,occurrenceIndex}){
  const freshMatches=findMatches(currentDoc,query,{caseSensitive});
  const exact=freshMatches.find(match=>match.from===from&&match.to===to&&match.text===text);
  if(exact)return exact;
  if(Number.isInteger(occurrenceIndex)&&freshMatches[occurrenceIndex])return freshMatches[occurrenceIndex];
  return null;
}

// Find/Replace Stage D2.1.1: the project-wide-flat-list counterpart of
// reresolveMatch above -- same stale-safety policy (exact match, then
// positional occurrenceIndex within the SAME scene, else give up), applied
// to a `flattenProjectMatches` result instead of a single doc's own fresh
// matches. Used when a project-wide Find/Replace session is handed off to a
// brand-new controller instance (project-result navigation that mounts a
// scene nowhere previously open -- see find-replace-navigation.js/
// find-replace-controller.js's adoptProjectSession) and that controller's
// own FIRST project search needs to land its active match back on the exact
// result the user actually clicked/navigated to, never on whatever a plain
// caret-relative guess would pick (the destination view has just been
// freshly mounted, so its "caret" carries no meaningful signal here).
// Returns -1 (never throws, never guesses further) when `target` can no
// longer be resolved at all -- callers fall back to their own existing
// "nothing to compare against" default.
export function reresolveFlatMatchIndex(flat,{sceneId,from,to,text,occurrenceIndex}){
  const exactIndex=flat.findIndex(match=>match.sceneId===sceneId&&match.from===from&&match.to===to&&match.text===text);
  if(exactIndex>=0)return exactIndex;
  if(Number.isInteger(occurrenceIndex)){
    const sceneMatches=flat.filter(match=>match.sceneId===sceneId);
    const byOccurrence=sceneMatches[occurrenceIndex];
    if(byOccurrence)return flat.indexOf(byOccurrence);
  }
  return -1;
}

// Find/Replace Stage D2.1.2 (Goal J): deterministic, LOCALITY-preferring
// active-result policy for the fresh project search that follows a
// successful Single Replace -- the previous "keep the same numeric flat
// index, clamped into range" default (still correct for every OTHER kind of
// doc change, e.g. an unrelated edit elsewhere) is not good enough here:
// removing the one remaining match in a scene could shift that same numeric
// slot onto a completely unrelated scene's own first match, which reads as
// "Replace randomly jumped to another scene" even though nothing about the
// user's own editing context actually moved.
//
// `sceneId`/`position` identify the scene and (pre-replacement) document
// position the just-replaced match occupied; `sceneOrder` is that scene's
// own canonical project position (already carried by every flat entry --
// see flattenProjectMatches), used only as the last-resort fallback below.
//
// Policy, in order:
//   1. The next remaining match in the SAME scene at/after `position` (the
//      match that was "after" the one just replaced, now shifted into its
//      place).
//   2. Otherwise the nearest remaining match in the SAME scene BEFORE
//      `position` (the last one, since `flat` preserves in-scene document
//      order).
//   3. Only when the scene has NO remaining matches at all: prefer an
//      author-visible scene (`included!==false`) as the automatic fallback --
//      Find/Replace Stage D2.1.4 (Finding "automatic fallback prefers
//      included scenes"), manual acceptance found the OLD policy here (plain
//      canonical order, ignoring `included`) could silently land the active
//      result on a hidden/excluded scene purely because it happened to sit
//      earlier in canonical order than a still-matching included one. This
//      changes ONLY which scene an exhausted-current-scene Replace
//      automatically advances to -- it never removes `included:false` scenes
//      from search/results/explicit navigation/explicit Replace (see
//      docs/find-replace-architecture.md): they stay fully present and
//      directly clickable, this is purely an unattended-fallback preference.
//        3a. The NEXT canonical included scene with matches (searching
//            forward from this scene's own former position, matching the
//            pre-existing "next" directionality).
//        3b. If none after it, the NEAREST PREVIOUS canonical included scene
//            with matches.
//        3c. Only when no included scene has matches anywhere does an
//            included:false scene become the fallback -- the OLD plain
//            canonical-order policy, wrapping to the very first overall
//            result if this was the last scene with matches. Never an
//            arbitrary jump to index 0 as a mere byproduct of index shifting.
// Returns -1 only when `flat` itself is empty (no matches remain anywhere).
export function pickPostReplaceActiveIndex(flat,{sceneId,position,sceneOrder}){
  if(!flat.length)return -1;
  const sceneIndices=[];
  flat.forEach((match,index)=>{if(match.sceneId===sceneId)sceneIndices.push(index)});
  if(sceneIndices.length){
    const after=sceneIndices.find(index=>flat[index].from>=position);
    if(after!==undefined)return after;
    return sceneIndices[sceneIndices.length-1];
  }
  const forwardIncluded=flat.findIndex(match=>match.sceneOrder>=sceneOrder&&match.included!==false);
  if(forwardIncluded>=0)return forwardIncluded;
  for(let index=flat.length-1;index>=0;index--){
    if(flat[index].sceneOrder<sceneOrder&&flat[index].included!==false)return index;
  }
  const nextScene=flat.findIndex(match=>match.sceneOrder>=sceneOrder);
  return nextScene>=0?nextScene:0;
}

export {buildMatchSnippet};
