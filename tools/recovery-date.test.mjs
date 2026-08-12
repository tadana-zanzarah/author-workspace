import assert from "node:assert/strict";
import {validateDateString,validateTimeString,parseStrictSceneMoment} from "../js/dates.js";
import {prepareProject} from "../js/migrations.js";
import {loadProjectFromStorage,restoreProjectCandidate} from "../js/storage.js";

const validDates=["2026-01-01","2024-02-29","2026-12-31"];
const invalidDates=["2026-02-29","2026-02-31","2026-04-31","2026-13-01","2026-00-01","2026-01-00","случайная строка"];
const validTimes=["00:00","12:30","23:59"];
const invalidTimes=["24:00","27:80","12:60","-1:30","произвольная строка"];
for(const value of validDates)assert.equal(validateDateString(value),true,value);
for(const value of invalidDates)assert.equal(validateDateString(value),false,value);
for(const value of validTimes)assert.equal(validateTimeString(value),true,value);
for(const value of invalidTimes)assert.equal(validateTimeString(value),false,value);
assert.equal(parseStrictSceneMoment({date:"2026-02-31",time:"12:00"}),null);
assert.equal(parseStrictSceneMoment({date:"2024-02-29",time:"23:59"})?.date,"2024-02-29");

function v11(date=""){
  return {version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[{id:"scene-1",date,time:"",chapterId:"chapter-unassigned",locationId:"",tags:[],people:{}}]};
}
const badDate=prepareProject(v11("2026-02-31"));
assert.equal(badDate.canApply,true);
assert.equal(badDate.migratedData.scenes[0].date,"2026-02-31");
assert.equal(badDate.migratedData.scenes[0].dateReview,true);
assert.ok(badDate.warnings.some(item=>item.code==="invalid-scene-date"));

function memory(entries,failKey=""){
  const map=new Map(Object.entries(entries));
  return {getItem:key=>map.has(key)?map.get(key):null,setItem(key,value){if(key===failKey)throw Object.assign(new Error("quota"),{name:"QuotaExceededError"});map.set(key,value)},keys(){return [...map.keys()]},key(i){return [...map.keys()][i]??null},get length(){return map.size},map};
}
const broken="{broken";
const old=JSON.stringify({...v11(),version:10});
const storage=memory({novelTimelineV11:broken,novelTimelineV10:old});
const loaded=loadProjectFromStorage({storage,key:"novelTimelineV11",oldKeys:["novelTimelineV10"]});
assert.equal(loaded.blocked,true);
assert.equal(loaded.candidates.length,1);
assert.equal(storage.getItem("novelTimelineV11"),broken,"кандидат не применяется автоматически");

const failedStorage=memory({novelTimelineV11:broken,novelTimelineV10:old},"novelTimelineV11");
const failed=restoreProjectCandidate({storage:failedStorage,primaryKey:"novelTimelineV11",candidateKey:"novelTimelineV10"});
assert.equal(failed.ok,false);
assert.equal(failedStorage.getItem("novelTimelineV11"),broken);
assert.ok([...failedStorage.map.keys()].some(key=>key.startsWith("novelTimelineV11-recovery-backup-")),"до попытки замены создан backup");

const duplicate={version:10,characters:[{name:"Алекс",surname:"Первый"},{name:"Алекс",surname:"Второй"}],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[{id:"scene-1",chapterId:"chapter-unassigned",people:{Алекс:{action:"реплика",relationChanges:{},visibleRelations:[]}}}]};
const conflict=prepareProject(duplicate);
assert.equal(conflict.canApply,false);
assert.equal(conflict.manualConflicts.length,1);
const reference=conflict.manualConflicts[0].references[0];
const chosen=conflict.manualConflicts[0].candidates[1].id;
const resolutions=Object.fromEntries(conflict.manualConflicts[0].references.map(item=>[item.path,chosen]));
const resolved=prepareProject(duplicate,{characterResolutions:resolutions});
assert.equal(resolved.canApply,true);
assert.ok(resolved.migratedData.scenes[0].people[chosen]);

const unknownLocation=v11();unknownLocation.scenes[0].locationId="location-missing";
const needsConfirmation=prepareProject(unknownLocation);
assert.equal(needsConfirmation.canApply,false);
assert.equal(needsConfirmation.confirmationConflicts[0].resolution,"confirmation");
const confirmed=prepareProject(unknownLocation,{confirmations:{"scenes[0].locationId":true}});
assert.equal(confirmed.canApply,true);
assert.equal(confirmed.migratedData.scenes[0].locationId,"");
const duplicateId=v11();duplicateId.scenes.push({...duplicateId.scenes[0]});
const duplicateReport=prepareProject(duplicateId);
assert.equal(duplicateReport.canApply,false);
assert.equal(duplicateReport.unrecoverableConflicts[0].resolution,"unrecoverable");

console.log("recovery and strict-date tests: OK");
