import assert from "node:assert/strict";
import {EditorState, TextSelection} from "prosemirror-state";
import {history} from "prosemirror-history";
import {sceneDocSchema as schema} from "../js/editor/scene-doc-schema.js";
import {
  plainTextToDoc,docToPlainText,docToJSON,docFromJSON,loadSceneDocument,
  serializeSceneDocument,sceneTextDocPlainText
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

// POV insert: plain bold text using the given name, not a permanent node.
{
  let state=EditorState.create({schema,doc:plainTextToDoc(schema,""),plugins:[history()]});
  const ok=insertPovText("Мартин Моралес")(state,tr=>{state=state.apply(tr)});
  assert.ok(ok,"POV insert применяется");
  assert.ok(docToPlainText(state.doc).includes("pov Мартин Моралес"),"вставленный текст содержит имя персонажа");
  let sawBold=false;
  state.doc.descendants(node=>{if(node.isText&&schema.marks.strong.isInSet(node.marks))sawBold=true});
  assert.ok(sawBold,"POV вставляется полужирным по умолчанию");
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

// sceneTextDocPlainText / preservedSceneTextDoc contract used by the still-plain
// Scene modal and "Весь текст" to avoid leaving a rich doc silently stale.
{
  const doc=plainTextToDoc(schema,"Текст сцены.");
  const docJson=docToJSON(doc);
  assert.equal(sceneTextDocPlainText(schema,docJson),"Текст сцены.","извлечение текста из сохранённого документа совпадает с оригиналом");
  assert.equal(sceneTextDocPlainText(schema,null),null,"отсутствующий документ не ломает проверку");
  assert.equal(sceneTextDocPlainText(schema,{type:"not-a-doc"}),null,"чужеродный JSON не ломает проверку, а считается несовпадением");
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
