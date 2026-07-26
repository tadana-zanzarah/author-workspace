import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "reference", "author_workspace_v11_stage3.html");
const source = fs.readFileSync(sourcePath, "utf8");
const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
const scriptMatch = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
if (!styleMatch || !scriptMatch) throw new Error("Не найдены встроенные style/script V11");

const style = styleMatch[1];
const script = scriptMatch[1];
const functions = new Map();
const spans = [];
const functionPattern = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;

function closingBrace(text, start, functionName) {
  let depth = 0, quote = "", escaped = false;
  let lineComment = false, blockComment = false, regex = false, regexClass = false;
  let previous = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (lineComment) { if (c === "\n") lineComment = false; continue; }
    if (blockComment) {
      if (c === "*" && n === "/") { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (regex) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === "[") regexClass = true;
      else if (c === "]") regexClass = false;
      else if (c === "/" && !regexClass) regex = false;
      continue;
    }
    if (c === "/" && n === "/") { lineComment = true; i++; continue; }
    if (c === "/" && n === "*") { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "/" && /[=(:,!&|?;{}\[]/.test(previous)) { regex = true; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return i + 1;
    if (!/\s/.test(c)) previous = c;
  }
  throw new Error(`Не найдена закрывающая скобка функции ${functionName}`);
}

for (const match of script.matchAll(functionPattern)) {
  const brace = script.indexOf("{", match.index);
  const end = closingBrace(script, brace, match[1]);
  functions.set(match[1], script.slice(match.index, end));
  spans.push([match.index, end]);
}

const groups = {
  migrations: ["makeId","normalizeChapters","normalizeLocations","canonicalTagName","normalizeTags","defaultData","emptyProfile","normalizeProfile","normalizeData"],
  storage: ["storageProjectScore","parseStorageCandidate","loadDataSafe","showStorageMessage","saveData","initializeStorageNotice","loadUiState","saveUiState"],
  utils: ["esc","jsq","cssEscape","parseSceneMoment","chronologicalWarning","countWords","readableDate","wordEscape","showModal","hideModal"],
  relationships: ["relationshipsBefore","relationshipsAt","personHasContent","renderInitialRelations"],
  scenes: ["sceneById","sceneIndexById","sceneCharacterIds","sceneCharacters","quickEditTitle","openQuickField","quickEditLocation","quickEditWriting","quickEditChapter","selectScene","insertBar","normalizeSceneOrder","firstSceneIdAfterChapter","openNewSceneInChapter","openNewSceneAt","editScene","populateSceneSelectors","ensureTag","addTagToDraft","renderSceneTagDraft","removeSceneTag","buildPeopleForm","markRelationExplicit","relationEdited","resetToInherited","openSceneText","toggleIncluded","confirmSceneDate","quickUpdate","deleteScene"],
  characters: ["characterById","characterName","renderProfiles","characterSceneEntries","characterLocations","characterTags","characterRelations","renderProfileAutomaticSection","filterCharacterLocations","filterCharacterTags","openCharacterTimeline","moveProfile","deleteProfile","setupBirthdaySelectors","zodiacFor","updateZodiac","editProfile","renderProfilePhotos","removeProfilePhoto","compressImage","profileDisplayValue","birthdayDisplay"],
  chapters: ["chapterById","locationById","tagById","writingStatusById","openChaptersManager","renderChaptersManager","saveChapterNames","moveChapter","deleteChapter","openLocationsManager","renderLocationsManager","saveLocations","deleteLocation","openTagsManager","renderTagsManager","saveTags","deleteTag","toggleChapter"],
  filters: ["sceneMatches","setFilter","getVisibleSceneEntries","hasActiveFilters"],
  render: ["projectReadiness","renderDashboard","renderSceneInfo","refreshControls","renderSidebar","renderStats","render","scheduleRender","renderViewSwitch","renderTableView","renderChapterDivider","sceneMetadataHtml","renderTableScene","renderCardsView","renderCompactCard","renderListView","emptySearchMessage"],
  "drag-drop": ["dragStart","dragOver","dragLeave","dropScene","dragEnd","renderSortScenes","openSortScenes","sortDragStart","sortDragOver","sortDrop","sortDragEnd"],
  "import-export": ["includedScenes","openAllScenes","saveAllScenes","exportWholeText"]
};

const assigned = new Set(Object.values(groups).flat());
const missing = [...functions.keys()].filter(name => !assigned.has(name));
const unknown = [...assigned].filter(name => !functions.has(name));
if (missing.length || unknown.length) {
  throw new Error(`Карта функций неполна. Не распределены: ${missing.join(", ")}. Не найдены: ${unknown.join(", ")}`);
}

fs.mkdirSync(path.join(root, "css"), {recursive: true});
fs.mkdirSync(path.join(root, "js"), {recursive: true});

const profileAt = style.indexOf("\n  .profiles-grid");
const layoutAt = style.indexOf("/*", profileAt);
const modalAt = style.indexOf("\n  .modal-backdrop");
const timelineAt = style.indexOf("\n  .viewport");
const cssParts = {
  base: style.slice(0, timelineAt),
  timeline: style.slice(timelineAt, modalAt),
  modals: style.slice(modalAt, profileAt),
  profiles: style.slice(profileAt, layoutAt),
  layout: style.slice(layoutAt)
};
for (const [name, content] of Object.entries(cssParts)) {
  fs.writeFileSync(path.join(root, "css", `${name}.css`), content.trim() + "\n");
}

const constants = `export const STORAGE_KEY="novelTimelineV11";
export const UI_STORAGE_KEY="novelTimelineV11_ui";
export const OLD_KEYS=["novelTimelineV10","novelTimelineV9","novelTimelineV8","novelTimelineV7","novelTimelineV4","novelTimelineV3","novelTimelineV2","novelTimelineV1"];
export const WRITING_STATUSES=[
  {id:"idea",label:"Идея"},
  {id:"plan",label:"План"},
  {id:"draft",label:"Черновик"},
  {id:"edit1",label:"Первая редактура"},
  {id:"edit2",label:"Вторая редактура"},
  {id:"final",label:"Финал"}
];
Object.assign(globalThis,{STORAGE_KEY,UI_STORAGE_KEY,OLD_KEYS,WRITING_STATUSES});
`;
fs.writeFileSync(path.join(root, "js", "constants.js"), constants);

const state = `const initialState={
  storageWriteEnabled:true,startupLoadInfo:null,data:null,editingSceneId:null,
  insertBeforeSceneId:null,insertChapterId:null,draggedSceneId:null,
  textEditingSceneId:null,profileEditingId:null,profileDraftPhotos:[],
  sceneTagDraft:[],selectedSceneIndex:null,selectedSceneId:null,
  filters:{search:"",chapter:"",character:"",location:"",tag:"",writing:"",placement:""},
  currentView:"table",infoPanelCollapsed:true,navigationVisible:true,
  renderQueued:false,quickFieldState:null,sortDraggedSceneId:null,searchTimer:null
};
for(const [name,value] of Object.entries(initialState)){
  Object.defineProperty(globalThis,name,{configurable:true,enumerable:false,writable:true,value});
}
export const appState=initialState;
`;
fs.writeFileSync(path.join(root, "js", "state.js"), state);

for (const [group, names] of Object.entries(groups)) {
  let body = names.map(name => functions.get(name)).join("\n\n");
  if (group === "characters") {
    body = body.replace("name:p.name||name,surname:", "name:p.name||character.name,surname:");
  }
  const exports = `\n\nObject.assign(globalThis,{${names.join(",")}});\nexport {${names.join(",")}};\n`;
  fs.writeFileSync(path.join(root, "js", `${group}.js`), body + exports);
}

let appCode = script;
for (const [start, end] of [...spans].sort((a,b)=>b[0]-a[0])) {
  appCode = appCode.slice(0, start) + appCode.slice(end);
}
appCode = appCode
  .replace(/^const STORAGE_KEY=.*$/m, "")
  .replace(/^const UI_STORAGE_KEY=.*$/m, "")
  .replace(/^const OLD_KEYS=.*$/m, "")
  .replace(/^const WRITING_STATUSES=\[[\s\S]*?^\];\s*$/m, "")
  .replace(/^(?:let|const)\s+(?:storageWriteEnabled|startupLoadInfo|data|editingSceneId|insertBeforeSceneId|insertChapterId|draggedSceneId|textEditingSceneId|profileEditingId|profileDraftPhotos|sceneTagDraft|selectedSceneIndex|selectedSceneId|filters|currentView|infoPanelCollapsed|navigationVisible|renderQueued|quickFieldState|sortDraggedSceneId|searchTimer)\s*=.*?;\s*$/gm, "")
  .trim();

const imports = [
  "constants","state","migrations","storage","utils","relationships","scenes",
  "characters","chapters","filters","render","drag-drop","import-export"
].map(name => `import "./${name}.js";`).join("\n");
fs.writeFileSync(path.join(root, "js", "app.js"), `${imports}\n\n// Инициализация данных выполняется после регистрации функций миграции и хранения.\ndata=loadDataSafe();\n\n${appCode}\n`);

const html = source
  .replace('<meta charset="utf-8" />','<meta charset="utf-8" />\\n<link rel="icon" href="data:," />')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/i, [
    '<link rel="stylesheet" href="css/base.css">',
    '<link rel="stylesheet" href="css/timeline.css">',
    '<link rel="stylesheet" href="css/modals.css">',
    '<link rel="stylesheet" href="css/profiles.css">',
    '<link rel="stylesheet" href="css/layout.css">'
  ].join("\n"))
  .replace(/<script[^>]*>[\s\S]*?<\/script>/i, '<script type="module" src="js/app.js"></script>');
fs.writeFileSync(path.join(root, "index.html"), html);
