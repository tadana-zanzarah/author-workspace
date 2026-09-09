const SCENE_BREAK_PLAIN_TEXT="***";

function textToParagraph(schema,line){
  return schema.nodes.paragraph.create({align:"left"},line.length?[schema.text(line)]:[]);
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

export function docToJSON(doc){return doc.toJSON()}
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

// Used by every plain-text-only save path (main Scene modal, "Весь текст") to
// decide whether an existing sceneTextDoc is still consistent with a plain-text
// edit made outside the rich editor. Never throws -- a corrupt/foreign doc is
// treated as "no longer matching" so it gets safely dropped rather than kept
// silently stale. See architecture audit §6 and the T1 persistence decision.
export function sceneTextDocPlainText(schema,sceneTextDocJSON){
  if(!sceneTextDocJSON)return null;
  try{return docToPlainText(docFromJSON(schema,sceneTextDocJSON))}
  catch{return null}
}
