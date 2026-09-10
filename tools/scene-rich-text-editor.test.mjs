import assert from "node:assert/strict";
import {EditorState, TextSelection} from "prosemirror-state";
import {history} from "prosemirror-history";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {
  plainTextToDoc,docToPlainText,docToJSON,docFromJSON,loadSceneDocument,
  serializeSceneDocument
} from "../js/editor/scene-doc-convert.js";
import {
  toggleBold,toggleItalic,toggleStrike,setAlign,alignActive,insertSceneBreak,insertPovText
} from "../js/editor/scene-editor-commands.js";
import {normalizeSceneTextDoc} from "../js/migrations.js";

function countWords(value){
  return (String(value||"").trim().match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length;
}

function applyCommand(getState,setState,command,...args){
  const state=getState();
  const fn=typeof command==="function"?command:command(...args);
  const ok=fn(state,tr=>setState(state.apply(tr)));
  return ok;
}

// 1. Legacy plain text -> editor document conversion preserves text exactly
// (round trip), including blank lines, and never interprets legacy markup.
{
  const original="Первый абзац.\nВторой абзац.\n\nПустая строка выше.";
  const doc=plainTextToDoc(schema,original);
  assert.equal(docToPlainText(doc),original,"обычный многострочный текст восстанавливается посимвольно");

  const dangerous="<script>alert(1)</script> и <b>жирный</b> и *** и <tab>";
  const legacyDoc=plainTextToDoc(schema,dangerous);
  assert.equal(legacyDoc.childCount,1,"одна строка легаси-текста остаётся одним абзацем, а не структурой");
  assert.equal(legacyDoc.firstChild.type.name,"paragraph","легаси-строка не превращается в sceneBreak/другой узел");
  assert.equal(docToPlainText(legacyDoc),dangerous,"опасно выглядящий легаси-текст сохраняется буквально");
  let sawUnexpectedNode=false;
  legacyDoc.descendants(node=>{if(node.type.name!=="paragraph"&&!node.isText)sawUnexpectedNode=true});
  assert.equal(sawUnexpectedNode,false,"легаси-текст не порождает узлы форматирования");
}

// 6. Dangerous HTML-like text stays literal/non-executable at the schema level:
// the schema only knows a closed set of node/mark types, so foreign markup can
// never be smuggled in as structure, and text content always round-trips as data.
{
  const xssText="<img src=x onerror=alert(1)>";
  const doc=schema.nodes.doc.create(null,[schema.nodes.paragraph.create(null,[schema.text(xssText)])]);
  const roundTripped=docFromJSON(schema,docToJSON(doc));
  assert.equal(roundTripped.firstChild.firstChild.text,xssText,"опасный текст остаётся буквальными данными после round-trip");

  const foreignDocJson={type:"doc",content:[{type:"html_blob",attrs:{raw:"<script>alert(1)</script>"}}]};
  assert.throws(()=>{const d=docFromJSON(schema,foreignDocJson);d.check()},"схема отвергает неизвестные типы узлов");

  // A scene whose stored sceneTextDoc is foreign/corrupt must never crash the
  // editor -- it falls back to the legacy plain-text path.
  const scene={sceneText:"Обычный текст сцены.",sceneTextDoc:foreignDocJson};
  const fallbackDoc=loadSceneDocument(schema,scene);
  assert.equal(docToPlainText(fallbackDoc),scene.sceneText,"повреждённый sceneTextDoc откатывается на обычный текст без потери данных");
}

// 2. Structured serialization round trip: text, bold, italic, strike,
// alignment and a scene break all survive toJSON -> fromJSON.
// 3. A formatting command never destroys surrounding text.
{
  let state=EditorState.create({schema,doc:plainTextToDoc(schema,"Пример текста для форматирования."),plugins:[history()]});
  const get=()=>state,set=next=>{state=next};
  const originalPlainText=docToPlainText(state.doc);

  const paraSize=state.doc.firstChild.content.size;
  set(state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,1+paraSize))));
  assert.ok(applyCommand(get,set,toggleBold),"bold применяется к выделению");
  assert.ok(applyCommand(get,set,toggleItalic),"italic применяется к выделению");
  assert.equal(docToPlainText(state.doc),originalPlainText,"форматирование не меняет сам текст");

  let sawBold=false,sawItalic=false;
  state.doc.descendants(node=>{
    if(node.isText){
      if(schema.marks.strong.isInSet(node.marks))sawBold=true;
      if(schema.marks.em.isInSet(node.marks))sawItalic=true;
    }
  });
  assert.ok(sawBold&&sawItalic,"bold и italic отметки реально применены");

  assert.ok(applyCommand(get,set,setAlign("center")),"выравнивание применяется");
  assert.ok(alignActive(state,"center"),"alignActive согласована с применённой командой");

  assert.ok(applyCommand(get,set,toggleStrike),"strike применяется");
  let sawStrike=false;
  state.doc.descendants(node=>{if(node.isText&&schema.marks.strike.isInSet(node.marks))sawStrike=true});
  assert.ok(sawStrike,"strike отметка реально применена");

  set(state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc))));
  assert.ok(applyCommand(get,set,insertSceneBreak),"разделитель сцены вставляется");
  let sawBreak=false;
  state.doc.descendants(node=>{if(node.type.name==="sceneBreak")sawBreak=true});
  assert.ok(sawBreak,"узел sceneBreak реально вставлен");

  const {sceneText,sceneTextDoc}=serializeSceneDocument(state.doc);
  assert.ok(sceneText.includes("***"),"разделитель сцены отражён в plain-тексте как ***");
  const restored=docFromJSON(schema,sceneTextDoc);
  assert.deepEqual(restored.toJSON(),state.doc.toJSON(),"весь документ (текст+форматирование+разделитель) переживает round-trip");
  let restoredAlign=null;
  restored.descendants(node=>{if(node.type.name==="paragraph"&&node.attrs.align==="center")restoredAlign=node.attrs.align});
  assert.equal(restoredAlign,"center","выравнивание переживает round-trip");

  // 5. Plain-text extraction contains prose only -- formatting/structure never
  // inflates the word count existing consumers (js/render.js, js/utils.js) rely on.
  const wordsBefore=countWords(originalPlainText);
  const wordsAfter=countWords(docToPlainText(state.doc));
  assert.equal(wordsAfter,wordsBefore,"форматирование и разделитель сцены не увеличивают число слов");
}

// Justify-by-default alignment semantics (T1 corrective UX pass, items 2/6):
// unset (null) alignment renders as the platform default (justify); explicit
// left/center/right/justify are distinct stored states that always survive a
// round trip; legacy plain-text conversion never bakes in an explicit "left"
// the author never actually chose, and Justify being default never blocks an
// author from deliberately choosing Left.
{
  const legacyDoc=plainTextToDoc(schema,"Обычный абзац.");
  assert.equal(legacyDoc.firstChild.attrs.align,null,"легаси-абзац не получает явное align:left при конвертации, а остаётся unset");

  let state=EditorState.create({schema,doc:legacyDoc,plugins:[history()]});
  const get=()=>state,set=next=>{state=next};
  assert.ok(alignActive(state,"justify"),"неявное (unset) выравнивание по умолчанию — по ширине");
  assert.equal(alignActive(state,"left"),false,"неявное выравнивание не путается с явным left");

  assert.ok(applyCommand(get,set,setAlign("left")),"явный Left применяется несмотря на Justify по умолчанию");
  assert.equal(state.doc.firstChild.attrs.align,"left","явный Left хранится как отдельное значение, а не сливается с default");
  assert.ok(alignActive(state,"left"),"alignActive видит явный left");
  assert.equal(alignActive(state,"justify"),false,"после явного left это больше не считается justify");

  for(const value of ["left","center","right","justify"]){
    assert.ok(applyCommand(get,set,setAlign(value)),`явное ${value} применяется`);
    const restored=docFromJSON(schema,docToJSON(state.doc));
    assert.equal(restored.firstChild.attrs.align,value,`${value} переживает сериализацию/десериализацию`);
  }
}

// 3. Alignment selection-boundary bug: a selection whose endpoint sits exactly
// at the start of the next paragraph (e.g. Home, Shift+Down x4 across 4
// lines) must not also align that next paragraph. Reproduces the exact
// reported case (4 paragraphs selected, a 5th immediately below) for every
// alignment value.
{
  for(const value of ["left","center","right","justify"]){
    const doc=plainTextToDoc(schema,"P1\nP2\nP3\nP4\nP5");
    let state=EditorState.create({schema,doc,plugins:[history()]});
    const get=()=>state,set=next=>{state=next};
    const p5Start=doc.content.child(0).nodeSize+doc.content.child(1).nodeSize+doc.content.child(2).nodeSize+doc.content.child(3).nodeSize+1;
    set(state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,p5Start))));
    assert.ok(applyCommand(get,set,setAlign(value)),`${value}: команда применяется к выделению 4 абзацев`);
    const aligns=[];
    state.doc.forEach(node=>aligns.push(node.attrs.align));
    assert.deepEqual(aligns.slice(0,4),[value,value,value,value],`${value}: первые 4 абзаца выровнены`);
    assert.equal(aligns[4],null,`${value}: пятый абзац НЕ затронут (выделение лишь касалось его границы)`);
  }
}

// POV insert: plain ordinary text using the given name, not a permanent node,
// and NOT forcibly bold -- the author applies Bold/Italic manually afterward
// with the normal editor commands (T1 corrective UX pass, item 5).
{
  let state=EditorState.create({schema,doc:plainTextToDoc(schema,""),plugins:[history()]});
  const ok=insertPovText("Мартин Моралес")(state,tr=>{state=state.apply(tr)});
  assert.ok(ok,"POV insert применяется");
  assert.ok(docToPlainText(state.doc).includes("pov Мартин Моралес"),"вставленный текст содержит имя персонажа");
  let sawBold=false,sawAnyMark=false;
  state.doc.descendants(node=>{if(node.isText){if(schema.marks.strong.isInSet(node.marks))sawBold=true;if(node.marks.length)sawAnyMark=true}});
  assert.equal(sawBold,false,"POV больше не вставляется полужирным принудительно");
  assert.equal(sawAnyMark,false,"POV вставляется как обычный текст без каких-либо меток");

  // Selecting the inserted text and applying Bold manually still works
  // normally -- the author is not blocked from formatting it themselves.
  const inserted="pov Мартин Моралес";
  state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,1+inserted.length)));
  assert.ok(toggleBold(state,tr=>{state=state.apply(tr)}),"автор может вручную выделить и выделить жирным вставленный POV");
  let sawManualBold=false;
  state.doc.descendants(node=>{if(node.isText&&schema.marks.strong.isInSet(node.marks))sawManualBold=true});
  assert.ok(sawManualBold,"ручное применение Bold к POV-тексту работает как к обычному тексту");
}

// 4. Multi-step undo/redo: several independent operations, all reversible and
// re-appliable, purely through prosemirror-history (no view needed).
{
  let state=EditorState.create({schema,doc:plainTextToDoc(schema,"Начало."),plugins:[history()]});
  const get=()=>state,set=next=>{state=next};
  const initialJSON=state.doc.toJSON();

  set(state.apply(state.tr.insertText(" Первое.",state.doc.content.size-1)));
  const afterFirst=state.doc.toJSON();
  set(state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,3))));
  applyCommand(get,set,toggleBold);
  const afterSecond=state.doc.toJSON();
  set(state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc))));
  applyCommand(get,set,insertSceneBreak);
  const afterThird=state.doc.toJSON();

  const {undo,redo}=await import("prosemirror-history");
  assert.ok(undo(get(),tr=>set(get().apply(tr))),"undo #1 доступен");
  assert.deepEqual(get().doc.toJSON(),afterSecond,"undo #1 возвращает состояние после второго шага");
  assert.ok(undo(get(),tr=>set(get().apply(tr))),"undo #2 доступен");
  assert.deepEqual(get().doc.toJSON(),afterFirst,"undo #2 возвращает состояние после первого шага");
  assert.ok(undo(get(),tr=>set(get().apply(tr))),"undo #3 доступен");
  assert.deepEqual(get().doc.toJSON(),initialJSON,"undo #3 возвращает исходный документ");
  assert.equal(undo(get()),false,"история исчерпана, дальше отменять нечего");

  assert.ok(redo(get(),tr=>set(get().apply(tr))),"redo #1");
  assert.deepEqual(get().doc.toJSON(),afterFirst);
  assert.ok(redo(get(),tr=>set(get().apply(tr))),"redo #2");
  assert.deepEqual(get().doc.toJSON(),afterSecond);
  assert.ok(redo(get(),tr=>set(get().apply(tr))),"redo #3");
  assert.deepEqual(get().doc.toJSON(),afterThird,"redo восстанавливает все три шага по порядку");
}

// normalizeSceneTextDoc (js/migrations.js): only a plausible doc-JSON shape is
// kept; anything else (wrong type, corrupted) is dropped, never stored as-is.
{
  const valid={type:"doc",content:[{type:"paragraph",content:[]}]};
  assert.deepEqual(normalizeSceneTextDoc(valid),valid,"валидный doc JSON сохраняется");
  assert.equal(normalizeSceneTextDoc(null),null);
  assert.equal(normalizeSceneTextDoc("не документ"),null,"строка отклоняется");
  assert.equal(normalizeSceneTextDoc([1,2,3]),null,"массив отклоняется");
  assert.equal(normalizeSceneTextDoc({type:"paragraph"}),null,"объект без content отклоняется");
  const withProto=JSON.parse('{"type":"doc","content":[],"__proto__":{"polluted":true}}');
  assert.equal(Object.prototype.hasOwnProperty.call(normalizeSceneTextDoc(withProto),"polluted"),false,"prototype-pollution ключи не переживают normalizeSceneTextDoc");
  assert.equal(({}).polluted,undefined,"глобальный Object.prototype не заражён");
}

console.log("scene rich-text editor unit tests: OK");
