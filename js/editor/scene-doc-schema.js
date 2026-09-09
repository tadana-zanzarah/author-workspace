import {Schema} from "prosemirror-model";

// Paragraph alignment is a paragraph *attribute*, never a separate node type and
// never stored markup -- alignment/indent are presentation over one structural
// paragraph kind. See docs: text-formatting architecture audit T1, §5/§7.
const ALIGN_VALUES=["left","center","right"];

function normalizeAlign(value){return ALIGN_VALUES.includes(value)?value:"left"}

// T1 document schema: doc/paragraph/text + a structural scene-break block, and
// bold/italic/strike marks. A future inline "footnote" mark (word/phrase -> id of
// an attached note) can be added to `marks` later without touching any node here --
// deliberately not built in T1 (see audit §9).
export const sceneDocSchema=new Schema({
  nodes:{
    doc:{content:"block+"},
    paragraph:{
      group:"block",
      content:"inline*",
      attrs:{align:{default:"left"}},
      parseDOM:[{tag:"p",getAttrs(dom){return {align:normalizeAlign(dom.style?.textAlign)}}}],
      toDOM(node){
        const align=normalizeAlign(node.attrs.align);
        return ["p",{class:`scene-paragraph scene-paragraph-${align}`},0];
      }
    },
    text:{group:"inline"},
    // Structural scene separator ("* * *"). An atom leaf block: never plain prose
    // text, so paragraph-level typography/autoformat rules can never pick it up.
    // The cursor can sit immediately before/after it like any other block boundary.
    sceneBreak:{
      group:"block",
      atom:true,
      selectable:true,
      parseDOM:[{tag:"div.scene-break"}],
      toDOM(){return ["div",{class:"scene-break","aria-label":"Разделитель сцены",contenteditable:"false"},"* * *"]}
    }
  },
  marks:{
    strong:{
      parseDOM:[{tag:"strong"},{tag:"b"},{style:"font-weight",getAttrs:value=>/^(bold|[7-9]\d{2,})$/.test(value)&&null}],
      toDOM(){return ["strong",0]}
    },
    em:{
      parseDOM:[{tag:"i"},{tag:"em"},{style:"font-style=italic"}],
      toDOM(){return ["em",0]}
    },
    strike:{
      parseDOM:[{tag:"s"},{tag:"strike"},{tag:"del"},{style:"text-decoration=line-through"}],
      toDOM(){return ["s",0]}
    }
  }
});

export {ALIGN_VALUES,normalizeAlign};
