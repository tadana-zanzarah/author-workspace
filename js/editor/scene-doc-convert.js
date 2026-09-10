const SCENE_BREAK_PLAIN_TEXT="***";

// align is left unset (null) -- a freshly converted legacy paragraph has no
// explicit alignment, so it renders using whatever the platform default is
// (justify) rather than being locked to an explicit "left" the author never
// actually chose.
function textToParagraph(schema,line){
  return schema.nodes.paragraph.create(null,line.length?[schema.text(line)]:[]);
}

// Legacy sceneText is always literal prose -- never auto-interpreted as structure
// (see architecture audit §6: hand-typed "<b>", "<center>", "***" etc. stay plain
// text unless a future, explicit, opt-in conversion tool says otherwise). One line
// of legacy text becomes exactly one paragraph, even when empty, so an untouched
// document round-trips back to the exact original string.
export function plainTextToDoc(schema,text){
  const lines=String(text||"").split("\n");
  const paragraphs=lines.map(line=>textToParagraph(schema,line));
  return schema.nodes.doc.create(null,paragraphs.length?paragraphs:[textToParagraph(schema,"")]);
}

function paragraphPlainText(node){
  let text="";
  node.forEach(child=>{if(child.isText)text+=child.text});
  return text;
}

// Prose-only extraction for every existing sceneText consumer (word count,
// full-text search, .doc export, storageProjectScore) -- must never contain
// JSON/markup, and a scene break must not inflate the word count.
export function docToPlainText(doc){
  const lines=[];
  doc.forEach(node=>{
    if(node.type.name==="sceneBreak")lines.push(SCENE_BREAK_PLAIN_TEXT);
    else if(node.type.name==="paragraph")lines.push(paragraphPlainText(node));
    else lines.push(node.textContent||"");
  });
  return lines.join("\n");
}

// ProseMirror reuses the exact same cached default-attrs object (e.g. an
// unset paragraph's {align:null}) across every node that doesn't override it
// -- doc.toJSON() assigns that object by reference into each node's own
// "attrs", so two unset paragraphs' JSON.attrs are literally the same object
// (confirmed: schema.nodes.paragraph.create(null,...) twice, then
// doc.toJSON().content[0].attrs===...content[1].attrs is true). That's
// harmless as a JSON *value* (shared substructure, not a real cycle) but the
// app's dirty-tracker snapshot comparison (js/dirty-state.js normalizeSnapshot)
// walks the whole tree with a single "seen" WeakSet and throws on ANY repeated
// object identity, real cycle or not -- so returning the raw toJSON() output
// broke "no dirty on open" as soon as a legacy scene had 2+ paragraphs with
// unset alignment. A cheap deep clone guarantees every node in the returned
// JSON has its own distinct object, with no behavior change to the JSON
// *content* itself.
export function docToJSON(doc){return JSON.parse(JSON.stringify(doc.toJSON()))}
export function docFromJSON(schema,json){return schema.nodeFromJSON(json)}

// A corrupted or future-incompatible sceneTextDoc must never crash the editor --
// it always degrades to the plain-text legacy path instead.
export function loadSceneDocument(schema,scene){
  const raw=scene?.sceneTextDoc;
  if(raw&&typeof raw==="object"&&!Array.isArray(raw)){
    try{
      const doc=docFromJSON(schema,raw);
      doc.check();
      return doc;
    }catch{
      // Corrupt/unrecognized doc JSON: fall through to the legacy plain-text path.
    }
  }
  return plainTextToDoc(schema,scene?.sceneText||"");
}

export function serializeSceneDocument(doc){
  return {sceneText:docToPlainText(doc),sceneTextDoc:docToJSON(doc)};
}
