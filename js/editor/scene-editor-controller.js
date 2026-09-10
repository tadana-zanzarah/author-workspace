import {sceneDocSchema} from "./scene-doc-schema.js";
import {loadSceneDocument,serializeSceneDocument} from "./scene-doc-convert.js";
import {createSceneEditor} from "./scene-editor-view.js";
import {createSceneEditorToolbar} from "./scene-editor-toolbar.js";

// The one entry point app.js/scenes.js touch -- everything ProseMirror-specific
// (schema, conversion, commands, view, toolbar) stays inside js/editor/. T2 can
// reuse this same function per Scene on the "Весь текст" screen without any of
// those internals leaking into the surrounding app code.
export function mountSceneEditor({editorContainer,toolbarContainer,scene,characters=[]}){
  editorContainer.innerHTML="";
  const doc=loadSceneDocument(sceneDocSchema,scene);
  const toolbar=createSceneEditorToolbar(toolbarContainer,{characters});
  const editor=createSceneEditor({
    mount:editorContainer,
    schema:sceneDocSchema,
    doc,
    onUpdate:state=>toolbar.update(state)
  });
  toolbar.bind(editor.view);
  toolbar.update(editor.view.state);
  return {
    view:editor.view,
    focus(){editor.focus()},
    getDocJSON(){return editor.getDocJSON()},
    serialize(){return serializeSceneDocument(editor.getDoc())},
    destroy(){editor.destroy();toolbarContainer.innerHTML=""}
  };
}

// T2: "Весь текст" needs N independent Scene documents but exactly ONE shared
// toolbar that always targets whichever Scene editor last had focus. Built
// entirely from the same pieces mountSceneEditor already uses -- no changes
// to any of them, no second editor implementation. Each mounted Scene keeps
// its own fully independent EditorView/EditorState/history, so a formatting
// command can never leak into a different Scene: toolbar.bind(view) (already
// existing, unmodified) is what actually re-targets every command/keyboard-
// shortcut closure, and it is only ever called with the ACTIVE scene's view.
//
// "Active" is tracked via the DOM `focusin` event only (bubbles, unlike plain
// `focus`) -- deliberately never `focusout`/`blur`. Clicking a toolbar button
// blurs the currently-focused editor before its own onclick fires; if that
// blur cleared the active id, the click's own run(view.state,...) would have
// nothing valid to target. Keeping activation monotonic (only advances on a
// NEW focusin) means the toolbar always still points at the editor the user
// was just in, and that editor's own bind()-installed handler already calls
// view.focus() at the end, which simply re-fires focusin as a no-op.
export function createSceneEditorGroup({toolbarContainer,characters=[]}){
  const toolbar=createSceneEditorToolbar(toolbarContainer,{characters});
  const instances=new Map();
  let activeId=null;

  function activate(sceneId){
    const inst=instances.get(sceneId);
    if(!inst||activeId===sceneId)return;
    // Roving tabindex: only the active editor is a Tab-stop. Besides keeping
    // the app's own focus-trap selector scan (js/modal-manager.js) bounded
    // regardless of how many Scenes are mounted, this is what actually makes
    // a Scene editor reachable by keyboard at all inside this modal -- none
    // of them carry an explicit tabindex otherwise, and the trap's selector
    // requires one.
    if(activeId)instances.get(activeId).editor.view.dom.tabIndex=-1;
    activeId=sceneId;
    inst.editor.view.dom.tabIndex=0;
    toolbar.bind(inst.editor.view);
    toolbar.update(inst.editor.view.state);
  }

  function mountScene(sceneId,{editorContainer,scene}){
    editorContainer.innerHTML="";
    const doc=loadSceneDocument(sceneDocSchema,scene);
    const editor=createSceneEditor({
      mount:editorContainer,schema:sceneDocSchema,doc,
      onUpdate:state=>{if(activeId===sceneId)toolbar.update(state)}
    });
    editor.view.dom.tabIndex=-1;
    const onFocusIn=()=>activate(sceneId);
    editorContainer.addEventListener("focusin",onFocusIn);
    instances.set(sceneId,{editor,editorContainer,onFocusIn});
    if(activeId===null)activate(sceneId);
  }

  function destroyScene(sceneId){
    const inst=instances.get(sceneId);
    if(!inst)return;
    inst.editorContainer.removeEventListener("focusin",inst.onFocusIn);
    inst.editor.destroy();
    instances.delete(sceneId);
    if(activeId===sceneId)activeId=null;
  }

  function destroyAll(){
    [...instances.keys()].forEach(destroyScene);
    toolbarContainer.innerHTML="";
  }

  function getDocJSON(sceneId){return instances.get(sceneId)?.editor.getDocJSON()??null}
  function serializeScene(sceneId){const inst=instances.get(sceneId);return inst?serializeSceneDocument(inst.editor.getDoc()):null}
  function sceneIds(){return [...instances.keys()]}

  return {mountScene,destroyScene,destroyAll,getDocJSON,serializeScene,sceneIds,getActiveSceneId(){return activeId}};
}
