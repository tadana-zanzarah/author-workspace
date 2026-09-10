// Find/Replace Stage C: the ProseMirror decoration plugin used to highlight
// matches. Kept as its own tiny module (rather than folded into the
// controller) purely for lifecycle clarity -- this file owns nothing but
// "how decorations live inside an EditorState" and has zero find/replace
// business logic (no query, no matching, no replace) of its own.
//
// Decorations are display-only ProseMirror view state: they are never part
// of `doc`, never touched by `doc.toJSON()`/dirty-state snapshots, and a
// transaction that only carries a decoration update (no Steps) can never
// become a prosemirror-history undo entry -- history only records
// Step-bearing transactions. This plugin is therefore safe to add
// unconditionally to every scene editor's plugin list (see
// scene-editor-view.js) with no effect at all until a find-replace
// controller actually attaches to that view and starts dispatching
// decoration updates through it.
import {Plugin,PluginKey} from "prosemirror-state";
import {Decoration,DecorationSet} from "prosemirror-view";

export const findReplacePluginKey=new PluginKey("findReplaceDecorations");

// state.apply: an explicit decoration set arrives via tr.setMeta(pluginKey,
// {decorations}) -- the controller is the only thing that ever sends this.
// Absent that meta, an ordinary document-changing transaction just maps the
// existing decorations across the edit (so they don't visually snap to wrong
// positions for the one frame before the controller's own follow-up
// recompute-and-redispatch lands); a selection-only transaction leaves them
// untouched.
export function createFindReplaceDecorationPlugin(){
  return new Plugin({
    key:findReplacePluginKey,
    state:{
      init(){return DecorationSet.empty},
      apply(tr,decorationSet){
        const meta=tr.getMeta(findReplacePluginKey);
        if(meta&&meta.decorations)return meta.decorations;
        if(tr.docChanged)return decorationSet.map(tr.mapping,tr.doc);
        return decorationSet;
      }
    },
    props:{
      decorations(state){return findReplacePluginKey.getState(state)}
    }
  });
}

// One inline decoration per match, class-only (no inline style, no content
// mutation) -- the active match gets an additional class for a stronger
// visual distinction (css/editor.css). Never wraps raw DOM text nodes
// directly; ProseMirror itself renders inline decorations as spans around
// the existing, unmodified text.
export function buildMatchDecorations(doc,matches,activeIndex){
  if(!matches.length)return DecorationSet.empty;
  const decorations=matches.map((match,index)=>Decoration.inline(match.from,match.to,{
    class:index===activeIndex?"rte-find-match rte-find-match-active":"rte-find-match"
  }));
  return DecorationSet.create(doc,decorations);
}
