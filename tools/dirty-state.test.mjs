import assert from "node:assert/strict";
import {createDirtyTracker,normalizedEqual} from "../js/dirty-state.js";

assert.equal(normalizedEqual({b:2,a:1},{a:1,b:2}),true,"порядок ключей не создаёт ложный dirty-state");
assert.equal(normalizedEqual(["a","b"],["b","a"]),false,"значимый порядок массивов сохраняется");
assert.equal(normalizedEqual("data:image/png;base64,AAAA","data:image/png;base64,AAAA"),true,"data URL сравнивается безопасно");

let draft={title:"Сцена",tags:["tag-a"],photo:"data:image/png;base64,AAAA"};
const tracker=createDirtyTracker("sceneEditor",()=>draft);
tracker.captureInitialState();
assert.equal(tracker.isDirty(),false,"исходная форма чистая");
draft={...draft,title:"Изменено"};
assert.equal(tracker.isDirty(),true,"реальное изменение обнаружено");
draft={...draft,title:"Сцена"};
assert.equal(tracker.isDirty(),false,"возврат к baseline снова делает форму чистой");
draft={...draft,photo:"data:image/png;base64,BBBB"};
assert.equal(tracker.isDirty(),true,"изменение фотографии обнаружено");
tracker.captureInitialState();
assert.equal(tracker.isDirty(),false,"успешное сохранение обновляет baseline");
draft={...draft,tags:["tag-a","tag-b"]};
assert.equal(tracker.isDirty(),true,"изменение тегов обнаружено");
tracker.resetDirty();
assert.equal(tracker.isDirty(),false,"подтверждённый discard сбрасывает tracker");

console.log("dirty-state unit tests: OK");
