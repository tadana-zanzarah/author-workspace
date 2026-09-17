import {sceneDocSchema} from "./scene-doc-schema.js";
import {loadSceneDocument,serializeSceneDocument} from "./scene-doc-convert.js";
import {createSceneEditor} from "./scene-editor-view.js";
import {createSceneEditorToolbar} from "./scene-editor-toolbar.js";
import {createFindReplaceController,captureViewportAnchor,revealDocPosition} from "./find-replace-controller.js";
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
//
// Final D1 fix (arrow-navigation scope): `getNavigableSceneIds`, when given,
// tells the controller which scene ids Next/Previous are allowed to land on
// -- see find-replace-controller.js's own doc comment on why this differs
// from a raw "is this scene mounted anywhere in the whole app" check.
// createSceneEditorGroup below passes its own `sceneIds()` (exactly the
// scenes mounted INSIDE THIS "Весь текст" instance); mountSceneEditor never
// passes it at all, which makes the controller default to "just the one
// attached scene" -- exactly standalone/Scene-modal's required behavior,
// with no extra code needed at that call site.
// Find/Replace Stage D2.2.1: `commitProjectReplaceAll`/`rebaseSceneDirtyBaseline`
// are forwarded straight through, unchanged -- both are already plain,
// app-layer-owned functions (js/import-export.js's
// commitProjectReplaceAllScenes/rebaseSceneTextDirtyBaseline) with nothing
// surface-specific to adapt here, unlike navigateToSceneMatch above (which
// needs THIS surface's own openSceneForEditing bound in). Omitted by a
// caller that never wires Replace All (there is none today, but this keeps
// the same "optional, degrades safely" shape every other dependency here
// has) -- find-replace-controller.js's own eligibility check already keeps
// the "Заменить все" button disabled whenever commitProjectReplaceAll is
// missing.
// Find/Replace Stage D2.2.2: `confirmProjectReplaceAll` (js/import-export.js's
// confirmProjectReplaceAllScenes) is forwarded the same way -- also plain,
// app-layer-owned, nothing surface-specific to adapt.
function projectSearchDeps({getProjectData,openSceneForEditing,getNavigableSceneIds,commitProjectReplaceAll,rebaseSceneDirtyBaseline,confirmProjectReplaceAll}){
  if(!getProjectData)return {};
  return {
    getProjectData,
    navigateToSceneMatch:(sceneId,matchRange,options)=>navigateToSceneMatch(sceneId,matchRange,{...options,openSceneForEditing}),
    getNavigableSceneIds,
    commitProjectReplaceAll,
    rebaseSceneDirtyBaseline,
    confirmProjectReplaceAll
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
// Find/Replace Stage D2.1.1 (Goal A): `projectSession` is optional -- given
// only when this mount is the DESTINATION of a project-result navigation
// that had to open a scene nowhere previously mounted (find-replace-
// navigation.js's case B). Every pre-D2.1.1 caller/test that omits it keeps
// working unchanged: `adoptProjectSession(null)` is a no-op (see that
// method's own doc comment), so the new controller starts exactly as before
// -- empty, scope "scene". This is the smallest point where the existing
// global Find/Replace session can be handed to a freshly-created controller:
// AFTER it exists (it needs to, to receive the session) but BEFORE
// attachView runs its own first recomputeAndReveal (so that first project
// search already reflects the adopted query/scope/options rather than the
// controller's own defaults).
// Find/Replace Stage D2.1.2 (Goal I): `onSwitchSurface`/`switchSurfaceLabel`
// are optional -- when given, the toolbar gets one extra small button
// (rendered by createSceneEditorToolbar) that calls
// `onSwitchSurface(exportedProjectSession)` on click, where
// `exportedProjectSession` is this MOUNT's own controller's current project
// session (via `findReplace.exportProjectSession()`, `null` outside project
// scope) -- this module still has zero knowledge of "which OTHER surface"
// exists; the caller (js/scenes.js) decides that and performs the actual
// open (through the SAME `openSceneText`/`editScene` + existing dirty-guard
// path every other transition already uses).
export function mountSceneEditor({editorContainer,toolbarContainer,scene,characters=[],findReplaceContainer=null,surfaceId=null,revealSurface=null,getProjectData=null,openSceneForEditing=null,projectSession=null,onSwitchSurface=null,switchSurfaceLabel=null,commitProjectReplaceAll=null,rebaseSceneDirtyBaseline=null,confirmProjectReplaceAll=null}){
  editorContainer.innerHTML="";
  const doc=loadSceneDocument(sceneDocSchema,scene);
  const findReplace=findReplaceContainer?createFindReplaceController(projectSearchDeps({getProjectData,openSceneForEditing,commitProjectReplaceAll,rebaseSceneDirtyBaseline,confirmProjectReplaceAll})):null;
  findReplace?.adoptProjectSession(projectSession);
  const findReplacePanel=findReplace?createFindReplacePanel(findReplaceContainer,findReplace):null;
  const toolbar=createSceneEditorToolbar(toolbarContainer,{
    characters,onFindReplace:findReplace?()=>findReplace.open("find"):undefined,
    // Editor-handoff Stage D2.1.4 (Finding 2) / D2.1.5 (position handoff):
    // passes ONE handoff object -- this mount's own CURRENT live doc, Find/
    // Replace session (now possibly carrying a same-scene active target, see
    // find-replace-controller.js's exportProjectSession), the real
    // ProseMirror selection/caret, and a viewport-position fallback anchor
    // (find-replace-controller.js's captureViewportAnchor, for a scrolled-
    // but-never-clicked viewport -- Priority 3) -- all captured HERE, at
    // click time, before the caller (js/scenes.js) does anything that could
    // destroy this view, so none of it is ever at risk of being lost
    // mid-switch. `editor` is assigned below, after this closure is created,
    // but only ever CALLED later (on an actual click) -- by then it is
    // always already assigned, same pattern already used elsewhere in this
    // codebase for a just-mounted editor reference captured by an
    // earlier-declared closure.
    // Editor-handoff Stage D2.1.7: also captures `focusTarget` -- "editor"
    // when this mount's own text editor was the last thing to actually hold
    // keyboard focus (tracked via `hasEditorFocus` below, updated by the
    // SAME focusin/focusout listeners already used for the mounted-scene
    // registry's own "which registration is active" tracking -- never a
    // second focus-tracking mechanism), "other" otherwise (e.g. focus was in
    // the Find input, or nowhere in particular). Checking `document.
    // activeElement` HERE, inside the click handler, would not work: a
    // mouse click on this toolbar button itself already moves focus to the
    // button before this handler runs, in every browser this app targets --
    // so "was the editor focused" has to be remembered from the LAST real
    // focus change, not read fresh at click time.
    onSwitchSurface:onSwitchSurface?()=>onSwitchSurface({
      session:findReplace?.exportProjectSession?.()??null,
      liveDoc:editor.getDocJSON(),
      selection:{anchor:editor.view.state.selection.anchor,head:editor.view.state.selection.head},
      viewportAnchor:captureViewportAnchor(editor.view),
      focusTarget:focusAtMousedown?"editor":"other"
    }):undefined,
    switchSurfaceLabel
  });
  const editor=createSceneEditor({
    mount:editorContainer,
    schema:sceneDocSchema,
    doc,
    // Find/Replace Stage D2.1.3 (Finding 2/12): every doc-changing
    // transaction -- typed input, Undo, Redo, and (crucially) a PROGRAMMATIC
    // Find/Replace Replace dispatch -- flows through this one onUpdate hook
    // regardless of source. Typed input already reaches js/dirty-state.js's
    // own document-level "input"/"change" listener (native contenteditable
    // typing dispatches those), but Undo/Redo (prosemirror-history's own
    // keymap-bound commands) and a Replace click (a synthetic view.dispatch()
    // with no real user keystroke) do neither -- so the Save button would
    // otherwise stay stuck at whatever disabled/enabled state it last had
    // until some UNRELATED input event happened to fire. Reusing the
    // existing global syncBeforeUnload() (js/dirty-state.js) -- never a
    // second dirty-tracking mechanism -- closes exactly that gap for every
    // surface built through this factory.
    onUpdate:(state,transaction)=>{toolbar.update(state);findReplace?.handleTransaction(state,transaction);if(transaction.docChanged)globalThis.syncBeforeUnload?.()}
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
  // Editor-handoff Stage D2.1.7: `hasEditorFocus` tracks whether THIS text
  // editor is the thing that currently holds keyboard focus -- read by the
  // onSwitchSurface capture above. `editorContainer` holds nothing but the
  // ProseMirror instance (the toolbar/Find-Replace panel are separate
  // sibling containers), so bubbling focusin/focusout on it is exactly
  // "focus entered/left this editor," reusing the SAME container the
  // pre-existing focusin listener below already uses for a different
  // purpose (marking this registration active in "Весь текст").
  let hasEditorFocus=false;
  const markActiveOnFocus=()=>{if(scene?.id&&registrationId)markMountedSceneActive(scene.id,registrationId);hasEditorFocus=true};
  const markInactiveOnBlur=()=>{hasEditorFocus=false};
  editorContainer.addEventListener("focusin",markActiveOnFocus);
  editorContainer.addEventListener("focusout",markInactiveOnBlur);
  // Editor-handoff Stage D2.1.7: a click on the switch-surface button
  // itself already moves focus to that button (and so fires `focusout`
  // above, flipping `hasEditorFocus` to false) BEFORE the button's own
  // `click` handler runs -- reading `hasEditorFocus` directly inside the
  // onSwitchSurface wrapper below would therefore always see it as false,
  // even when the editor genuinely had focus a moment ago. `mousedown`
  // fires strictly before that focus-shift; a capture-phase document
  // listener snapshots `hasEditorFocus` there, into `focusAtMousedown`,
  // which onSwitchSurface reads instead. Standard technique for "what had
  // focus right before this click", not a global focus-management system --
  // `focusAtMousedown` is this ONE mount's own private closure variable.
  let focusAtMousedown=false;
  const captureFocusAtMousedown=()=>{focusAtMousedown=hasEditorFocus};
  document.addEventListener("mousedown",captureFocusAtMousedown,true);
  return {
    view:editor.view,
    focus(){editor.focus()},
    getDocJSON(){return editor.getDocJSON()},
    serialize(){return serializeSceneDocument(editor.getDoc())},
    openFind(){findReplace?.open("find")},
    openReplace(){findReplace?.open("replace")},
    // Editor-handoff Stage D2.1.4/D2.1.5: applies a handoff object captured
    // by ANOTHER mount's own onSwitchSurface closure above -- `liveDoc`
    // (required; a no-op without it), `session` (the Find/Replace session,
    // possibly carrying a same-scene active `target` -- see find-replace-
    // controller.js's exportProjectSession), `selection`
    // ({anchor,head}, ProseMirror positions valid against `liveDoc`'s own
    // structure since it's the exact doc those positions were captured
    // against), and `viewportAnchor` (a single doc-position fallback, used
    // only when `selection` sits at the trivial just-mounted default AND a
    // meaningful viewport anchor was captured -- Priority 3, "scrolled but
    // never clicked").
    //
    // Restore order (deliberately NOT arbitrary -- see D2.1.5's own
    // completion report for why): the doc must already be live before any
    // Find-target re-resolution is attempted, so `findReplace.
    // adoptProjectSession(session)` -- which resets activeIndex/
    // activeProjectMatchIndex/pendingActiveTarget for BOTH scopes, forcing a
    // genuinely FRESH caret-relative (scene) or pendingActiveTarget-based
    // (project) pick on the NEXT recompute rather than "clamping" whatever
    // the INITIAL mount's own attachView already computed against the
    // transient canonical doc -- runs FIRST, then `editor.replaceDocJSON`
    // installs the live doc AND the resolved restore selection in the SAME
    // transaction. That one transaction's own docChanged dispatch is what
    // triggers the actual fresh recompute (via handleTransaction), so
    // exactly one reveal/scroll action happens, never a competing second one.
    //
    // Priority, matching the approved UX rule: (1) `session.target` (an
    // active Find/Replace match belonging to THIS scene -- its own `from`/
    // `to` range becomes the restore selection, so the post-swap recompute's
    // caret-relative pick lands back on that exact match); (2) `selection`,
    // when it isn't sitting at the trivial just-mounted default (a real
    // caret/range the user actually placed); (3) `viewportAnchor` (a
    // collapsed caret there); (4) whatever `selection` was captured, even if
    // trivial, as the final fallback -- never throws, never invents an
    // arbitrary paragraph/range selection.
    applyHandoff({session=null,liveDoc,selection,viewportAnchor}={}){
      if(!liveDoc)return;
      findReplace?.adoptProjectSession(session);
      const target=session?.target;
      const trivialCaret=selection&&selection.anchor===selection.head&&selection.anchor<=1;
      const restoreAt=target
        ?{anchor:target.from,head:target.to}
        :(trivialCaret&&viewportAnchor!=null&&viewportAnchor>1)
          ?{anchor:viewportAnchor,head:viewportAnchor}
          :(selection||{anchor:0,head:0});
      editor.replaceDocJSON(liveDoc,{selection:restoreAt});
      // Editor-handoff Stage D2.1.5: the swap transaction's own resulting
      // recompute (handleTransaction, triggered by its docChanged) never
      // itself scrolls -- it only calls recompute(), never
      // recomputeAndReveal() (that distinction is deliberate everywhere else
      // in find-replace-controller.js too: recompute must never fight a
      // user's own typing cursor elsewhere in the doc). A destination with a
      // SINGLE scrollable ancestor could appear to reveal correctly anyway,
      // as an unreliable side effect of the browser's own native "scroll a
      // newly-focused/selected range into view" behavior -- but the Scene
      // modal has a nested pair (the outer .modal AND the inner
      // #sceneTextEditor's own bounded scroll region), where that implicit
      // behavior does not reliably reach both levels. Reusing the SAME
      // sticky-aware, multi-ancestor revealDocPosition() every other Find/
      // Replace reveal already goes through -- never a second, competing
      // scroll mechanism -- makes this deterministic on every surface.
      //
      // Editor-handoff Stage D2.1.6: `{align:"center"}` -- a freshly-
      // mounted destination has no scroll history of its own, so the
      // default "nudge to nearest edge" reveal always lands the restored
      // position right at whichever boundary it scrolled from, with no
      // reading context on that side. This is the ONLY call site in the
      // whole app that passes `align` at all; every ordinary Find/Replace
      // navigation and Replace reveal keeps using revealDocPosition's
      // default ("nearest") behavior, completely unchanged.
      revealDocPosition(editor.view,restoreAt.anchor,{align:"center"});
    },
    destroy(){
      editorContainer.removeEventListener("focusin",markActiveOnFocus);
      editorContainer.removeEventListener("focusout",markInactiveOnBlur);
      document.removeEventListener("mousedown",captureFocusAtMousedown,true);
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
export function createSceneEditorGroup({toolbarContainer,characters=[],findReplaceContainer=null,surfaceId=null,revealSurface=null,getProjectData=null,openSceneForEditing=null,commitProjectReplaceAll=null,rebaseSceneDirtyBaseline=null,confirmProjectReplaceAll=null}){
  const findReplace=findReplaceContainer?createFindReplaceController(projectSearchDeps({getProjectData,openSceneForEditing,getNavigableSceneIds:()=>sceneIds(),commitProjectReplaceAll,rebaseSceneDirtyBaseline,confirmProjectReplaceAll})):null;
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
      // Finding 2/12 (see mountSceneEditor's identical comment above): a
      // scene inside "Весь текст" can be edited (typing, Undo/Redo, Replace)
      // even while a DIFFERENT scene is the group's own `activeId` -- the
      // dirty refresh must fire regardless, unlike toolbar.update/
      // findReplace.handleTransaction just above, which are deliberately
      // scoped to the active scene only.
      onUpdate:(state,transaction)=>{if(activeId===sceneId){toolbar.update(state);findReplace?.handleTransaction(state,transaction)}if(transaction.docChanged)globalThis.syncBeforeUnload?.()}
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
