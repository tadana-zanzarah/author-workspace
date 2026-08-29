import assert from "node:assert/strict";
import {discoverLocalMigrationSources,migrationErrorMessage} from "../js/local-to-cloud-migration-ui.js";

const project={version:11,title:"Локальный роман",characters:[{id:"c1"}],profiles:{c1:{photos:[]}},characterLinks:[],chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],scenes:[{id:"s1"}]};
const storage={getItem:key=>key==="novelTimelineV11"?JSON.stringify(project):null};
const sources=discoverLocalMigrationSources(storage);
assert.equal(sources.length,1);
assert.equal(sources[0].id,"novelTimelineV11");
assert.equal(sources[0].title,"Локальный роман");
assert.equal(sources[0].counts.characters,1);
assert.equal(sources[0].counts.scenes,1);
assert.deepEqual(discoverLocalMigrationSources({getItem:()=>"broken"}),[]);

assert.match(migrationErrorMessage("REVISION_CONFLICT"),/изменился после проверки/);
assert.match(migrationErrorMessage("TARGET_NOT_EMPTY"),/уже появились данные/);
assert.match(migrationErrorMessage("UNKNOWN_IMPORT_RESULT"),/Проверяем результат/);
assert.doesNotMatch(migrationErrorMessage("STORAGE_COLLISION"),/path|storage/i);

console.log("local to cloud migration UI tests passed");
