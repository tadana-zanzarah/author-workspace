import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {history} from "prosemirror-history";
import {keymap} from "prosemirror-keymap";
import {baseKeymap} from "prosemirror-commands";
import {toggleBold,toggleItalic,undo,redo} from "./scene-editor-commands.js";
import {docToJSON} from "./scene-doc-convert.js";

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
export function createSceneEditor({mount,schema,doc,onUpdate}){
  const state=EditorState.create({schema,doc,plugins:[history(),buildKeymap()]});
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
    destroy(){view.destroy()}
  };
}
