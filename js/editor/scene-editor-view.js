import {EditorState,TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {history} from "prosemirror-history";
import {keymap} from "prosemirror-keymap";
import {baseKeymap} from "prosemirror-commands";
import {toggleBold,toggleItalic,undo,redo} from "./scene-editor-commands.js";
import {docToJSON,docFromJSON} from "./scene-doc-convert.js";
import {createFindReplaceDecorationPlugin} from "./find-replace-decorations.js";

function buildKeymap(){
  return keymap({
    ...baseKeymap,
    "Mod-b":toggleBold,"Mod-B":toggleBold,
    "Mod-i":toggleItalic,"Mod-I":toggleItalic,
    "Mod-z":undo,"Mod-y":redo,"Shift-Mod-z":redo
  });
}

// Thin wrapper around a single ProseMirror EditorView + genuinely multi-step
// history (prosemirror-history's own undo/redo stack). One instance == one
// editable Scene; nothing here is shared across instances, so undo/redo can never
// bleed across Scenes once multiple instances exist (T2).
// Find/Replace Stage C: the decoration plugin is included unconditionally,
// for every editor instance, whether or not a find-replace controller ever
// attaches to this view. It renders nothing (DecorationSet.empty) until a
// controller actively dispatches decorations into it, so this is purely
// additive -- no change to any existing editor behavior when find/replace
// isn't in use. See find-replace-decorations.js for why this must be a
// plugin present at state-creation time rather than bolted on afterward.
export function createSceneEditor({mount,schema,doc,onUpdate}){
  const state=EditorState.create({schema,doc,plugins:[history(),buildKeymap(),createFindReplaceDecorationPlugin()]});
  let view=new EditorView(mount,{
    state,
    dispatchTransaction(transaction){
      const newState=view.state.apply(transaction);
      view.updateState(newState);
      onUpdate?.(newState,transaction);
    }
  });
  return {
    view,
    getDoc(){return view.state.doc},
    getDocJSON(){return docToJSON(view.state.doc)},
    focus(){view.focus()},
    destroy(){view.destroy()},
    // Editor-handoff Stage D2.1.4: replaces the WHOLE document content with
    // `json` (the exact sceneTextDoc/ProseMirror-JSON model, never a plain-
    // text round-trip -- see scene-doc-convert.js's docFromJSON/docToJSON) --
    // used by the Scene Editor <-> Text Scene live-doc handoff to seed a
    // freshly-mounted destination editor with the SOURCE surface's unsaved
    // content, after that destination was already mounted from (and its own
    // dirty-tracker baseline already captured against) the scene's canonical
    // persisted doc. A REAL transaction (never `view.updateState` directly),
    // so it flows through the normal dispatchTransaction/onUpdate pipeline
    // exactly like any other edit -- the toolbar, the Save button's dirty
    // refresh, and Find/Replace's own recompute (so a fresh search runs
    // against the HANDED-OFF content, not the stale persisted one) all react
    // to it for free, with no separate wiring. `addToHistory:false`
    // deliberately keeps this swap out of the undo stack: the canonical doc
    // it replaces was only ever mounted internally to capture the baseline
    // and was never actually shown to the user (this runs synchronously,
    // before any repaint), so it must never become something Undo can revert
    // back to.
    //
    // Editor-handoff Stage D2.1.5 (jump-to-end root cause): a full-document
    // `replaceWith(0,size,...)` with no explicit `setSelection` left the
    // transaction's own selection to ProseMirror's DEFAULT position-mapping
    // of whatever selection was live before the swap (the canonical mount's
    // own initial selection, near the very start) through a step that
    // replaces the ENTIRE document. Mapping a position that sits inside a
    // wholesale-replaced range resolves it against the mapping's bias
    // (Mapping's own default rounds towards the LATER side of the replaced
    // content) -- for a full-doc replace that is, in effect, the very end of
    // the newly inserted content. That is the actual mechanism behind
    // "destination jumps to the end of the document", not focus() or
    // scrollIntoView() (neither is called here) and not EditorState's own
    // default selection (a fresh EditorState.create with no selection
    // defaults to the START, never the end -- this method never rebuilds
    // state that way in the first place). The fix is to never depend on
    // default mapping: `selection` (optional `{anchor,head}`, ProseMirror
    // position numbers valid against `json`'s own structure -- the caller is
    // responsible for resolving WHICH position that should be: an active
    // Find/Replace target's range, a captured caret/selection, or a
    // viewport-anchor fallback, in that priority order) is always resolved
    // to a deliberate, explicit selection on the SAME transaction that
    // installs the new doc -- one transaction, one selection decision, never
    // a separate follow-up dispatch competing with this one.
    replaceDocJSON(json,{selection}={}){
      const newDoc=docFromJSON(schema,json);
      let tr=view.state.tr.replaceWith(0,view.state.doc.content.size,newDoc.content);
      const size=tr.doc.content.size;
      const clamp=pos=>Math.max(0,Math.min(pos,size));
      const anchor=selection?clamp(selection.anchor):0;
      const head=selection?clamp(selection.head??selection.anchor):anchor;
      tr=tr.setSelection(TextSelection.create(tr.doc,anchor,head)).setMeta("addToHistory",false);
      view.dispatch(tr);
    }
  };
}
