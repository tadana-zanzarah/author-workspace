// Location History H-events -- pure draft/diff/local-mode logic (js/location-history-events.js).
import assert from "node:assert/strict";
import {
  normalizeHistoryEventDraftItem,hydrateLocationHistoryEventRow,mapHistoryEventRowsForLazyRead,
  normalizeLocalHistoryEvents,buildLocalHistoryEventsForSave,
  createDraftHistoryEvent,removeHistoryEventDraftItem,reorderHistoryEventDraftItem,
  historyEventFieldsEqual,diffHistoryEventsDraft,planLocationHistoryEventsSaveOrder,
  buildCreateHistoryEventPayload,buildUpdateHistoryEventChanges,locationHistoryEventsDraftSnapshot
} from "../js/location-history-events.js";

// 1. normalizeHistoryEventDraftItem: safe defaults, revision null for a brand-new item.
{
  const item=normalizeHistoryEventDraftItem({id:"a",title:"Пожар"});
  assert.equal(item.dateLabel,"");assert.equal(item.description,"");assert.equal(item.sortOrder,0);
  assert.equal(item.revision,null);assert.deepEqual(item.metadata,{});
  const withRevision=normalizeHistoryEventDraftItem({id:"b",title:"X",revision:3});
  assert.equal(withRevision.revision,3);
}

// 2. hydrateLocationHistoryEventRow / mapHistoryEventRowsForLazyRead: snake_case RPC row ->
//    camelCase draft, sorted by (sortOrder,id). date_label survives verbatim, including fantasy
//    labels and an empty string -- never parsed, never rejected.
{
  const rows=[
    {id:"e2",title:"Второе","date_label":"около 1240 года","description":"","sort_order":1,revision:0,metadata:{}},
    {id:"e1",title:"Первое","date_label":"","description":"неизвестно когда","sort_order":0,revision:2,metadata:{keep:1}},
    {id:"e3",title:"Легенда","date_label":"за три века до войны","description":"","sort_order":2,revision:0,metadata:{}}
  ];
  const draft=mapHistoryEventRowsForLazyRead(rows);
  assert.equal(draft.length,3);
  assert.equal(draft[0].id,"e1");assert.equal(draft[0].dateLabel,"","blank date_label preserved, not defaulted to something else");
  assert.equal(draft[0].revision,2);assert.deepEqual(draft[0].metadata,{keep:1});
  assert.equal(draft[1].id,"e2");assert.equal(draft[1].dateLabel,"около 1240 года");
  assert.equal(draft[2].id,"e3");assert.equal(draft[2].dateLabel,"за три века до войны","odd fantasy label accepted verbatim, never parsed");
}

// 3. normalizeLocalHistoryEvents: defensive against every malformed/legacy shape (missing field,
//    non-array, non-object entries, entries with no id) -- an old local project with no
//    historyEvents field at all must normalize to [], never throw.
{
  assert.deepEqual(normalizeLocalHistoryEvents(undefined),[]);
  assert.deepEqual(normalizeLocalHistoryEvents(null),[]);
  assert.deepEqual(normalizeLocalHistoryEvents("not-an-array"),[]);
  assert.deepEqual(normalizeLocalHistoryEvents([null,42,"x"]),[]);
  const events=normalizeLocalHistoryEvents([
    {id:"e1",title:"Основание","dateLabel":"около 800 года","description":"","sortOrder":0},
    {title:"Без id"}, // dropped -- no stable id
  ]);
  assert.equal(events.length,1);
  assert.equal(events[0].id,"e1");assert.equal(events[0].title,"Основание");
}

// 4. buildLocalHistoryEventsForSave: strips cloud-only fields (revision/metadata), keeps exactly
//    id/title/dateLabel/description/sortOrder.
{
  const draft=[normalizeHistoryEventDraftItem({id:"e1",title:"X",dateLabel:"Y",description:"Z",sortOrder:2,revision:5,metadata:{a:1}})];
  const local=buildLocalHistoryEventsForSave(draft);
  assert.deepEqual(local,[{id:"e1",title:"X",dateLabel:"Y",description:"Z",sortOrder:2}]);
  assert.equal(Object.hasOwn(local[0],"revision"),false);
  assert.equal(Object.hasOwn(local[0],"metadata"),false);
}

// 5. createDraftHistoryEvent: brand-new item, revision null, uses the supplied id verbatim.
{
  const item=createDraftHistoryEvent({id:"e9",title:"Новое событие",sortOrder:3});
  assert.equal(item.id,"e9");assert.equal(item.revision,null);assert.equal(item.sortOrder,3);
  const auto=createDraftHistoryEvent({});
  assert.ok(auto.id.startsWith("draft-history-event-"));
}

// 6. removeHistoryEventDraftItem: pure removal.
{
  const items=[normalizeHistoryEventDraftItem({id:"a"}),normalizeHistoryEventDraftItem({id:"b"})];
  const removed=removeHistoryEventDraftItem(items,"a");
  assert.equal(removed.length,1);assert.equal(removed[0].id,"b");
  assert.equal(items.length,2,"must not mutate the input array");
}

// 7. reorderHistoryEventDraftItem: single flat list (no kind grouping, unlike Media), renumbers to
//    a clean dense 0..n-1 sequence, undated events reorder exactly like dated ones.
{
  const items=[
    normalizeHistoryEventDraftItem({id:"a",sortOrder:0}),
    normalizeHistoryEventDraftItem({id:"b",sortOrder:1,dateLabel:""}), // undated
    normalizeHistoryEventDraftItem({id:"c",sortOrder:2})
  ];
  const movedUp=reorderHistoryEventDraftItem(items,"b","up");
  assert.deepEqual(movedUp.map(i=>[i.id,i.sortOrder]).sort((x,y)=>x[1]-y[1]),[["b",0],["a",1],["c",2]]);
  // Boundary: moving the first item up, or the last item down, is a no-op (same array reference
  // shape -- nothing renumbered).
  const noop=reorderHistoryEventDraftItem(items,"a","up");
  assert.deepEqual(noop.map(i=>i.sortOrder),items.map(i=>i.sortOrder));
  const unknown=reorderHistoryEventDraftItem(items,"missing","up");
  assert.equal(unknown,items,"an unknown id must return the input unchanged");
}

// 8. historyEventFieldsEqual / diffHistoryEventsDraft: NEW/CHANGED/REMOVED/UNCHANGED, exact revert
//    equality (a draft reset back to the original produces zero diff entries).
{
  const original=[
    normalizeHistoryEventDraftItem({id:"a",title:"A",dateLabel:"L1",description:"D1",sortOrder:0,revision:0}),
    normalizeHistoryEventDraftItem({id:"b",title:"B",dateLabel:"",description:"",sortOrder:1,revision:2})
  ];
  // Exact revert: a draft that's a deep copy of original must diff to nothing.
  const revertedDraft=original.map(item=>({...item}));
  const revertDiff=diffHistoryEventsDraft(original,revertedDraft);
  assert.deepEqual(revertDiff,{toCreate:[],toUpdate:[],toDelete:[]});

  const draft=[
    {...original[0],title:"A changed"}, // CHANGED
    normalizeHistoryEventDraftItem({id:"c",title:"C new",revision:null}) // NEW ("b" implicitly REMOVED)
  ];
  const diff=diffHistoryEventsDraft(original,draft);
  assert.equal(diff.toCreate.length,1);assert.equal(diff.toCreate[0].id,"c");
  assert.equal(diff.toUpdate.length,1);assert.equal(diff.toUpdate[0].item.id,"a");assert.equal(diff.toUpdate[0].before.id,"a");assert.equal(diff.toUpdate[0].before.revision,0,"before must be the ORIGINAL persisted item, revision included, for expected_revision threading");
  assert.equal(diff.toDelete.length,1);assert.equal(diff.toDelete[0].id,"b");

  assert.equal(historyEventFieldsEqual(original[0],{...original[0]}),true);
  assert.equal(historyEventFieldsEqual(original[0],{...original[0],sortOrder:5}),false);
}

// 9. planLocationHistoryEventsSaveOrder: fixed order delete -> update -> create (no primary-
//    demotion complexity, unlike Media).
{
  const plan=planLocationHistoryEventsSaveOrder({toDelete:["d"],toUpdate:["u"],toCreate:["c"]});
  assert.deepEqual(plan,{toDelete:["d"],toUpdate:["u"],toCreate:["c"]});
}

// 10. buildCreateHistoryEventPayload / buildUpdateHistoryEventChanges: exact RPC argument shapes.
{
  const item=normalizeHistoryEventDraftItem({id:"e1",title:"T",dateLabel:"L",description:"D",sortOrder:2});
  const createPayload=buildCreateHistoryEventPayload(item,{locationId:"loc-1",expectedRevision:7});
  assert.deepEqual(createPayload,{eventId:"e1",locationId:"loc-1",title:"T",dateLabel:"L",description:"D",sortOrder:2,expectedRevision:7});
  const updateChanges=buildUpdateHistoryEventChanges(item);
  assert.deepEqual(updateChanges,{title:"T",dateLabel:"L",description:"D",sortOrder:2});
}

// 11. locationHistoryEventsDraftSnapshot: JSON-safe shallow copy for the dirty-tracker, does not
//     alias the source array/objects.
{
  const draft=[normalizeHistoryEventDraftItem({id:"e1",title:"T",metadata:{a:1}})];
  const snapshot=locationHistoryEventsDraftSnapshot(draft);
  assert.deepEqual(snapshot,draft);
  snapshot[0].title="mutated";
  assert.equal(draft[0].title,"T","snapshot must not alias the source draft items");
}

console.log("location-history-events draft/diff unit tests passed");
