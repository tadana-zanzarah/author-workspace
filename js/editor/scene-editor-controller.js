import {sceneDocSchema} from "./scene-doc-schema.js";
import {loadSceneDocument,serializeSceneDocument} from "./scene-doc-convert.js";
import {createSceneEditor} from "./scene-editor-view.js";
import {createSceneEditorToolbar} from "./scene-editor-toolbar.js";
import {createFindReplaceController} from "./find-replace-controller.js";
import {createFindReplacePanel} from "./find-replace-panel.js";
import {registerMountedScene,unregisterMountedScene,markMountedSceneActive} from "./mounted-scene-registry.js";
import {navigateToSceneMatch} from "./find-replace-navigation.js";

// Find/Replace Stage D1: the one place a controller's optional project-scope
// dependencies (see find-replace-controller.js's own factory doc comment)
// get wired to their real implementations -- `openSceneForEditing` is
// pre-bound here so find-replace-controller.js itself never needs to know
// about it per-call. Decoration management (all project-scope highlighting)
// is entirely find-replace-controller.js's own job -- see its
// applyProjectDecorations -- so navigation only needs wiring for movement.
function projectSearchDeps({getProjectData,openSceneForEditing}){
  if(!getProjectData)return {};
  return {
    getProjectData,
    navigateToSceneMatch:(sceneId,matchRange,options)=>navigateToSceneMatch(sceneId,matchRange,{...options,openSceneForEditing})
  };
}

// The one entry point app.js/scenes.js touch -- everything ProseMirror-specific
// (schema, conversion, commands, view, toolbar) stays inside js/editor/. T2 can
// reuse this same function per Scene on the "Весь текст" screen without any of
// those internals leaking into the surrounding app code.
//
// Find/Replace Stage C: findReplaceContainer is optional (defaults to no
// panel at all, matching every pre-Stage-C caller/test unchanged) -- when
// supplied, this owns creating one controller + one panel for this single
// editor, exactly the same way it already owns creating the toolbar. Callers
// never talk to find-replace-controller.js/find-replace-panel.js directly;
// they only ever see the thin openFind()/openReplace() surface below (used
// to wire Ctrl+F/Ctrl+H and the discard/reopen lifecycle).
// Find/Replace Stage D1: `surfaceId`/`revealSurface` are optional (every
// pre-D1 caller/test that omits them behaves exactly as before -- no
// registration happens without a real scene id to key on). When a saved
// scene is mounted, this registers ONE mounted-scene-registry entry so
// project-wide search/navigation can find this live editor -- see
// mounted-scene-registry.js and find-replace-project-search.js.
// `revealSurface`, if given, is a caller-supplied closure that brings this
// surface's modal/container to the front (e.g. `()=>showModal("textModal")`)
// -- this module has no modal/route knowledge itself; the registration's own
// `activate()` just calls it, then focuses this editor.
export function mountSceneEditor({editorContainer,toolbarContainer,scene,characters=[],findReplaceContainer=null,surfaceId=null,revealSurface=null,getProjectData=null,openSceneForEditing=null}){
  editorContainer.innerHTML="";
  const doc=loadSceneDocument(sceneDocSchema,scene);
  const findReplace=findReplaceContainer?createFindReplaceController(projectSearchDeps({getProjectData,openSceneForEditing})):null;
  const findReplacePanel=findReplace?createFindReplacePanel(findReplaceContainer,findReplace):null;
  const toolbar=createSceneEditorToolbar(toolbarContainer,{characters,onFindReplace:findReplace?()=>findReplace.open("find"):undefined});
  const editor=createSceneEditor({
    mount:editorContainer,
    schema:sceneDocSchema,
    doc,
    onUpdate:(state,transaction)=>{toolbar.update(state);findReplace?.handleTransaction(state,transaction)}
  });
  toolbar.bind(editor.view);
  toolbar.update(editor.view.state);
  // Final D1 hardening pass: passes scene?.id through so the controller can
  // identify "which scene is this view showing" by id, never by comparing
  // document content (see find-replace-controller.js's own attachedSceneId
  // comment) -- null for a brand-new, not-yet-saved scene, exactly like the
  // registry registration below already treats that case.
  findReplace?.attachView(editor.view,scene?.id??null);
  const registrationId=scene?.id?registerMountedScene(scene.id,{
    view:editor.view,surfaceId,
    activate(){revealSurface?.();editor.focus();if(scene?.id)markMountedSceneActive(scene.id,registrationId)}
  }):null;
  const markActiveOnFocus=()=>{if(scene?.id&&registrationId)markMountedSceneActive(scene.id,registrationId)};
  editorContainer.addEventListener("focusin",markActiveOnFocus);
  return {
    view:editor.view,
    focus(){editor.focus()},
    getDocJSON(){return editor.getDocJSON()},
    serialize(){return serializeSceneDocument(editor.getDoc())},
    openFind(){findReplace?.open("find")},
    openReplace(){findReplace?.open("replace")},
    destroy(){
      editorContainer.removeEventListener("focusin",markActiveOnFocus);
      if(scene?.id&&registrationId)unregisterMountedScene(scene.id,registrationId);
      findReplace?.detachView(editor.view);
      findReplacePanel?.destroy();
      editor.destroy();
      toolbarContainer.innerHTML="";
      if(findReplaceContainer)findReplaceContainer.innerHTML="";
    }
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
//
// Find/Replace Stage C: exactly ONE shared controller + panel (analogous to
// the one shared toolbar above), created once, that always targets whichever
// Scene is currently active. activate(sceneId) is the single place that
// retargets BOTH the toolbar and the find-replace controller together --
// findReplace.attachView() (see find-replace-controller.js) is what clears
// stale highlights off the previously-active Scene and recomputes matches
// against the newly-active one. Query/replace text/case-sensitive state
// intentionally survive a retarget (the controller only resets its match
// list/active index, never the panel's own inputs) so switching which Scene
// has focus while Find is open keeps showing the same search applied to
// whichever Scene the author is now in. Never one Find panel per Scene.
// Find/Replace Stage D1: `surfaceId`/`revealSurface` mirror mountSceneEditor
// above -- optional, and every pre-D1 caller/test that omits them keeps
// working unchanged. `revealSurface` here brings the WHOLE group's modal
// (e.g. "Весь текст") to the front; each individual scene's registration
// additionally retargets the shared toolbar/find-replace controller to that
// scene and scrolls its own block into view -- see mountScene below.
export function createSceneEditorGroup({toolbarContainer,characters=[],findReplaceContainer=null,surfaceId=null,revealSurface=null,getProjectData=null,openSceneForEditing=null}){
  const findReplace=findReplaceContainer?createFindReplaceController(projectSearchDeps({getProjectData,openSceneForEditing})):null;
  const findReplacePanel=findReplace?createFindReplacePanel(findReplaceContainer,findReplace):null;
  const toolbar=createSceneEditorToolbar(toolbarContainer,{characters,onFindReplace:findReplace?()=>findReplace.open("find"):undefined});
  const instances=new Map();
  let activeId=null;

  function activate(sceneId){
    const inst=instances.get(sceneId);
    if(!inst)return;
    if(inst.registrationId)markMountedSceneActive(sceneId,inst.registrationId);
    if(activeId===sceneId)return;
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
    // Final D1 hardening pass: `sceneId` is already this function's own
    // parameter -- see mountSceneEditor's identical comment above.
    findReplace?.attachView(inst.editor.view,sceneId);
  }

  function mountScene(sceneId,{editorContainer,scene}){
    editorContainer.innerHTML="";
    const doc=loadSceneDocument(sceneDocSchema,scene);
    const editor=createSceneEditor({
      mount:editorContainer,schema:sceneDocSchema,doc,
      onUpdate:(state,transaction)=>{if(activeId===sceneId){toolbar.update(state);findReplace?.handleTransaction(state,transaction)}}
    });
    editor.view.dom.tabIndex=-1;
    const onFocusIn=()=>activate(sceneId);
    editorContainer.addEventListener("focusin",onFocusIn);
    const registrationId=registerMountedScene(sceneId,{
      view:editor.view,surfaceId,
      activate(){
        revealSurface?.();
        activate(sceneId);
        editorContainer.scrollIntoView({block:"center"});
        editor.focus();
      }
    });
    instances.set(sceneId,{editor,editorContainer,onFocusIn,registrationId});
    if(activeId===null)activate(sceneId);
  }

  function destroyScene(sceneId){
    const inst=instances.get(sceneId);
    if(!inst)return;
    inst.editorContainer.removeEventListener("focusin",inst.onFocusIn);
    unregisterMountedScene(sceneId,inst.registrationId);
    if(findReplace&&activeId===sceneId)findReplace.detachView(inst.editor.view);
    inst.editor.destroy();
    instances.delete(sceneId);
    if(activeId===sceneId)activeId=null;
  }

  function destroyAll(){
    [...instances.keys()].forEach(destroyScene);
    toolbarContainer.innerHTML="";
    findReplacePanel?.destroy();
    if(findReplaceContainer)findReplaceContainer.innerHTML="";
  }

  function getDocJSON(sceneId){return instances.get(sceneId)?.editor.getDocJSON()??null}
  function serializeScene(sceneId){const inst=instances.get(sceneId);return inst?serializeSceneDocument(inst.editor.getDoc()):null}
  function sceneIds(){return [...instances.keys()]}

  return {
    mountScene,destroyScene,destroyAll,getDocJSON,serializeScene,sceneIds,getActiveSceneId(){return activeId},
    openFind(){findReplace?.open("find")},
    openReplace(){findReplace?.open("replace")}
  };
}
