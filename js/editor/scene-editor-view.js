import {EditorState} from "prosemirror-state";
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
    replaceDocJSON(json){
      const newDoc=docFromJSON(schema,json);
      const tr=view.state.tr.replaceWith(0,view.state.doc.content.size,newDoc.content).setMeta("addToHistory",false);
      view.dispatch(tr);
    }
  };
}
