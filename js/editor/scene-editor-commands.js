import {toggleMark} from "prosemirror-commands";
import {undo,redo} from "prosemirror-history";
import {Selection,TextSelection} from "prosemirror-state";
import {sceneDocSchema as schema} from "./scene-doc-schema.js";

export function toggleBold(state,dispatch){return toggleMark(schema.marks.strong)(state,dispatch)}
export function toggleItalic(state,dispatch){return toggleMark(schema.marks.em)(state,dispatch)}
export function toggleStrike(state,dispatch){return toggleMark(schema.marks.strike)(state,dispatch)}

// doc.nodesBetween(from,to) visits a node whenever its range merely *touches*
// [from,to], not only when the selection actually contains part of it -- so a
// selection ending exactly at the start of the next paragraph (a very common
// result of "select N lines", e.g. Home, Shift+Down x4) still visits that next
// paragraph even though none of its own content is selected. Require true
// overlap with each paragraph's own content range (contentStart, contentEnd)
// so a boundary-touching endpoint on either side never pulls in a neighbor
// that was never actually part of the selection.
function paragraphPositionsInSelection(state){
  const {from,to}=state.selection;
  const positions=[];
  state.doc.nodesBetween(from,to,(node,pos)=>{
    if(node.type!==schema.nodes.paragraph)return;
    const contentStart=pos+1,contentEnd=pos+1+node.content.size;
    if(to>contentStart&&from<contentEnd)positions.push(pos);
  });
  if(!positions.length){
    const $from=state.selection.$from;
    if($from.parent.type===schema.nodes.paragraph)positions.push($from.before());
  }
  return positions;
}

// Alignment is a paragraph attribute, not a node/mark -- applies to every
// paragraph touched by the selection (or the paragraph the cursor sits in).
export function setAlign(align){
  return function(state,dispatch){
    const positions=paragraphPositionsInSelection(state);
    if(!positions.length)return false;
    if(dispatch){
      const tr=state.tr;
      positions.forEach(pos=>{
        const node=tr.doc.nodeAt(pos);
        if(node)tr.setNodeMarkup(pos,undefined,{...node.attrs,align});
      });
      dispatch(tr);
    }
    return true;
  };
}

export function alignActive(state,align){
  const positions=paragraphPositionsInSelection(state);
  if(!positions.length)return align==="justify";
  return positions.every(pos=>(state.doc.nodeAt(pos)?.attrs.align||"justify")===align);
}

// Inserting a leaf atom node leaves ProseMirror's default resulting selection
// as a NodeSelection wrapping that very node -- if left alone, the *next*
// command (e.g. a POV insert right after) would replace the separator instead
// of adding after it. Explicitly move the selection to a real text position
// right after the break, adding a trailing empty paragraph if the break landed
// at the very end of the document, so the author (or the next command) always
// has somewhere ordinary to continue into.
export function insertSceneBreak(state,dispatch){
  if(dispatch){
    const node=schema.nodes.sceneBreak.create();
    let tr=state.tr.replaceSelectionWith(node);
    const after=Math.min(tr.selection.to,tr.doc.content.size);
    let target=Selection.findFrom(tr.doc.resolve(after),1,true);
    if(!target){
      tr=tr.insert(tr.doc.content.size,schema.nodes.paragraph.create());
      target=TextSelection.near(tr.doc.resolve(tr.doc.content.size-1));
    }
    dispatch(tr.setSelection(target).scrollIntoView());
  }
  return true;
}

// Insert plain, ordinary text at the current position -- not a permanent node,
// no forced marks (inheritMarks:false so it never picks up formatting from
// wherever the cursor happened to be either). The author applies Bold/Italic
// afterward with the normal editor commands, same as any other text they type.
// Generic on purpose (just "insert this text"), even though POV is the only
// caller today -- see architecture audit §11: a future reusable snippet/
// template feature can reuse this unchanged.
export function insertPlainText(text){
  return function(state,dispatch){
    if(!text)return false;
    if(dispatch){
      let tr=state.tr.replaceSelectionWith(schema.text(text),false);
      tr=tr.insertText(" ");
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function insertPovText(name){
  return insertPlainText(`pov ${name}`);
}

export {undo,redo};
