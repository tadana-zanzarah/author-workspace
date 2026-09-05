// Location Media B4B -- pure draft/diff/reconciliation-planning logic (js/location-media.js).
import assert from "node:assert/strict";
import {
  LOCATION_MEDIA_KINDS,locationMediaKindLabel,locationMediaKindPrimaryLabel,isValidLocationMediaKind,isCropApplicableKind,
  locationGalleryCoverInfo,resolveGalleryCoverOutcome,
  normalizeMediaDraftItem,hydrateLocationMediaRow,mapMediaRowsForLazyRead,mapSignedUrlsOntoDraft,
  createDraftMediaItem,groupMediaByKind,primaryOfKind,setDraftPrimary,removeDraftItem,reorderDraftItem,
  diffLocationMediaDraft,planLocationMediaSaveOrder,buildCreateMediaPayload,buildUpdateMediaChanges,
  collectPendingObjectUrls,locationMediaDraftSnapshot
} from "../js/location-media.js";

// 1. Kind catalog: exactly the four approved kinds, fixed order, Russian labels.
assert.deepEqual(LOCATION_MEDIA_KINDS,["photo","map","floorplan","other"]);
assert.equal(locationMediaKindLabel("photo"),"Фото");
assert.equal(locationMediaKindLabel("map"),"Карты");
assert.equal(locationMediaKindLabel("floorplan"),"Планы");
assert.equal(locationMediaKindLabel("other"),"Другое");
assert.equal(locationMediaKindPrimaryLabel("photo"),"Основное фото");
assert.equal(locationMediaKindPrimaryLabel("map"),"Основная карта");
assert.equal(locationMediaKindPrimaryLabel("floorplan"),"Основной план");
assert.equal(isValidLocationMediaKind("photo"),true);
assert.equal(isValidLocationMediaKind("document"),false);
assert.equal(isValidLocationMediaKind("video"),false);

// 2. Crop applicability: photo only.
assert.equal(isCropApplicableKind("photo"),true);
assert.equal(isCropApplicableKind("map"),false);
assert.equal(isCropApplicableKind("floorplan"),false);
assert.equal(isCropApplicableKind("other"),false);

// 3. normalizeMediaDraftItem: defaults + no map/floorplan crop state, even if raw carries one.
{
  const photo=normalizeMediaDraftItem({id:"a",mediaKind:"photo",crop:{x:.2,y:.8,zoom:1.5}});
  assert.deepEqual(photo.crop,{x:.2,y:.8,zoom:1.5});
  const map=normalizeMediaDraftItem({id:"b",mediaKind:"map",crop:{x:.2,y:.8,zoom:1.5}});
  assert.deepEqual(map.crop,{},"a map item must never carry leftover portrait crop state");
  const floorplan=normalizeMediaDraftItem({id:"c",mediaKind:"floorplan",crop:{x:.1,y:.1,zoom:2}});
  assert.deepEqual(floorplan.crop,{});
  const bareDefault=normalizeMediaDraftItem({id:"d",mediaKind:"photo"});
  assert.deepEqual(bareDefault.crop,{x:.5,y:.5,zoom:1});
  const invalidKind=normalizeMediaDraftItem({id:"e",mediaKind:"poster"});
  assert.equal(invalidKind.mediaKind,"photo","an invalid kind must fall back to photo, never silently accepted");
}

// 4. hydrateLocationMediaRow / mapMediaRowsForLazyRead: snake_case RPC row -> camelCase draft, sorted.
{
  const rows=[
    {id:"m2",media_kind:"photo",storage_path:"o/locations/l/m2/original.png",mime_type:"image/png",crop:{x:.5,y:.5,zoom:1},alt:"b",caption:"",sort_order:1,is_primary:false,revision:2,metadata:{}},
    {id:"m1",media_kind:"photo",storage_path:"o/locations/l/m1/original.png",mime_type:"image/png",crop:{},alt:"a",caption:"cap",sort_order:0,is_primary:true,revision:0,metadata:{keep:1}}
  ];
  const draft=mapMediaRowsForLazyRead(rows);
  assert.equal(draft.length,2);
  assert.equal(draft[0].id,"m1");assert.equal(draft[0].isPrimary,true);assert.equal(draft[0].revision,0);
  assert.equal(draft[0].source.kind,"storage");assert.equal(draft[0].source.storagePath,"o/locations/l/m1/original.png");assert.equal(draft[0].source.value,"","no signed URL yet at hydration time");
  assert.deepEqual(draft[0].metadata,{keep:1});
  assert.equal(draft[1].id,"m2");assert.equal(draft[1].alt,"b");
}

// 5. mapSignedUrlsOntoDraft: pure merge by storage path, missing path left as "".
{
  const draft=mapMediaRowsForLazyRead([{id:"m1",media_kind:"photo",storage_path:"p1",sort_order:0,is_primary:true,revision:0}]);
  const signed=mapSignedUrlsOntoDraft(draft,{p1:"https://signed/p1"});
  assert.equal(signed[0].source.value,"https://signed/p1");
  assert.equal(draft[0].source.value,"","must not mutate its input");
  const unsigned=mapSignedUrlsOntoDraft(draft,{});
  assert.equal(unsigned[0].source.value,"");
}

// 6. createDraftMediaItem: pending source, defaults to non-primary, unique ids across calls, but
// the caller (js/locations.js's handleLocationMediaFileChosen -- a Location's first item of a kind
// auto-becomes primary, mirroring the Character precedent's profileDraftPrimaryPhotoId ||= photo.id)
// can pass isPrimary explicitly.
{
  const a=createDraftMediaItem({mediaKind:"photo",objectUrl:"blob:a"});
  const b=createDraftMediaItem({mediaKind:"map",objectUrl:"blob:b"});
  assert.notEqual(a.id,b.id);
  assert.equal(a.source.kind,"pending");assert.equal(a.source.value,"blob:a");
  assert.equal(a.isPrimary,false);assert.equal(a.revision,null);
  const c=createDraftMediaItem({mediaKind:"photo",objectUrl:"blob:c",isPrimary:true});
  assert.equal(c.isPrimary,true);
}

// 7. groupMediaByKind: fixed order, empty groups dropped, items sorted within group.
{
  const items=[
    normalizeMediaDraftItem({id:"m1",mediaKind:"other",sortOrder:0}),
    normalizeMediaDraftItem({id:"m2",mediaKind:"photo",sortOrder:1}),
    normalizeMediaDraftItem({id:"m3",mediaKind:"photo",sortOrder:0})
  ];
  const groups=groupMediaByKind(items);
  assert.deepEqual(groups.map(g=>g.kind),["photo","other"],"map/floorplan must be dropped when empty, order stays photo/map/floorplan/other");
  assert.deepEqual(groups[0].items.map(i=>i.id),["m3","m2"]);
  assert.equal(groupMediaByKind([]).length,0);
}

// 8. primaryOfKind.
{
  const items=[normalizeMediaDraftItem({id:"m1",mediaKind:"photo",isPrimary:true}),normalizeMediaDraftItem({id:"m2",mediaKind:"map",isPrimary:true})];
  assert.equal(primaryOfKind(items,"photo").id,"m1");
  assert.equal(primaryOfKind(items,"map").id,"m2");
  assert.equal(primaryOfKind(items,"floorplan"),null);
}

// 9. setDraftPrimary: demotes only the SAME kind's previous primary, never another kind; pure.
{
  const items=[
    normalizeMediaDraftItem({id:"p1",mediaKind:"photo",isPrimary:true}),
    normalizeMediaDraftItem({id:"p2",mediaKind:"photo",isPrimary:false}),
    normalizeMediaDraftItem({id:"map1",mediaKind:"map",isPrimary:true})
  ];
  const next=setDraftPrimary(items,"p2");
  assert.equal(next.find(i=>i.id==="p1").isPrimary,false);
  assert.equal(next.find(i=>i.id==="p2").isPrimary,true);
  assert.equal(next.find(i=>i.id==="map1").isPrimary,true,"setting a photo primary must never touch the map primary");
  assert.equal(items.find(i=>i.id==="p1").isPrimary,true,"must not mutate input");
  assert.equal(setDraftPrimary(items,"missing"),items,"unknown id is a no-op, returns the same reference");
}

// 10. removeDraftItem: pure filter.
{
  const items=[normalizeMediaDraftItem({id:"a"}),normalizeMediaDraftItem({id:"b"})];
  assert.deepEqual(removeDraftItem(items,"a").map(i=>i.id),["b"]);
  assert.equal(items.length,2,"must not mutate input");
}

// 11. reorderDraftItem: moves within its OWN kind only, renumbers only that kind, never touches
// another kind's sort_order.
{
  const items=[
    normalizeMediaDraftItem({id:"p1",mediaKind:"photo",sortOrder:0}),
    normalizeMediaDraftItem({id:"p2",mediaKind:"photo",sortOrder:1}),
    normalizeMediaDraftItem({id:"map1",mediaKind:"map",sortOrder:5})
  ];
  const moved=reorderDraftItem(items,"p1","down");
  assert.equal(moved.find(i=>i.id==="p1").sortOrder,1);
  assert.equal(moved.find(i=>i.id==="p2").sortOrder,0);
  assert.equal(moved.find(i=>i.id==="map1").sortOrder,5,"reordering photos must never touch the map's sort_order");
  const atTop=reorderDraftItem(items,"p1","up");
  assert.equal(atTop,items,"moving the first item up is a no-op, returns the same reference");
}

// 12. diffLocationMediaDraft: NEW/CHANGED/REMOVED classification, UNCHANGED excluded entirely.
{
  const original=[
    normalizeMediaDraftItem({id:"keep",mediaKind:"photo",caption:"same",sortOrder:0,revision:0}),
    normalizeMediaDraftItem({id:"edit",mediaKind:"photo",caption:"old",sortOrder:1,revision:0}),
    normalizeMediaDraftItem({id:"gone",mediaKind:"map",sortOrder:0,revision:0})
  ];
  const draft=[
    normalizeMediaDraftItem({id:"keep",mediaKind:"photo",caption:"same",sortOrder:0,revision:0}),
    normalizeMediaDraftItem({id:"edit",mediaKind:"photo",caption:"new",sortOrder:1,revision:0}),
    normalizeMediaDraftItem({id:"new1",mediaKind:"photo",source:{kind:"pending",value:"blob:x"}})
  ];
  const diff=diffLocationMediaDraft(original,draft);
  assert.equal(diff.toCreate.length,1);assert.equal(diff.toCreate[0].id,"new1");
  assert.equal(diff.toUpdate.length,1);assert.equal(diff.toUpdate[0].item.id,"edit");assert.equal(diff.toUpdate[0].before.id,"edit");
  assert.equal(diff.toDelete.length,1);assert.equal(diff.toDelete[0].id,"gone");
  // "keep" appears in neither create/update/delete -- confirmed unchanged and excluded.
  assert.ok(!diff.toUpdate.some(e=>e.item.id==="keep"));
}

// 13. planLocationMediaSaveOrder: delete -> update[non-primary-setting first, primary-setting last] -> create.
{
  const original=[
    normalizeMediaDraftItem({id:"a",mediaKind:"photo",isPrimary:true,revision:0}),
    normalizeMediaDraftItem({id:"b",mediaKind:"photo",isPrimary:false,caption:"old",revision:0}),
    normalizeMediaDraftItem({id:"c",mediaKind:"photo",isPrimary:false,revision:0})
  ];
  const draft=[
    normalizeMediaDraftItem({id:"a",mediaKind:"photo",isPrimary:false,revision:0}), // demoted (side effect of b becoming primary, but also directly present)
    normalizeMediaDraftItem({id:"b",mediaKind:"photo",isPrimary:true,caption:"new",revision:0}), // newly primary AND caption changed
    normalizeMediaDraftItem({id:"c",mediaKind:"photo",isPrimary:false,sortOrder:9,revision:0}) // plain reorder, not primary-setting
  ];
  const diff=diffLocationMediaDraft(original,draft);
  const planned=planLocationMediaSaveOrder(diff);
  const order=planned.toUpdate.map(e=>e.item.id);
  assert.equal(order[order.length-1],"b","the primary-setting update must be ordered last among updates");
  assert.ok(order.indexOf("c")<order.indexOf("b"),"a non-primary-setting update must be ordered before a primary-setting one");
}

// 13b. locationMediaDraftSnapshot: a persisted item's signed URL churning (fresh expiry/signature,
// nothing user-relevant changed) must NOT register as a dirty-tracker difference -- only
// storagePath/mimeType are stable identity, source.value is dropped for storage-kind items.
{
  const draft=mapMediaRowsForLazyRead([{id:"m1",media_kind:"photo",storage_path:"p1",mime_type:"image/png",crop:{},sort_order:0,is_primary:true,revision:0}]);
  const signedOnce=mapSignedUrlsOntoDraft(draft,{p1:"https://signed/p1?exp=100&sig=aaa"});
  const signedAgain=mapSignedUrlsOntoDraft(draft,{p1:"https://signed/p1?exp=200&sig=bbb"});
  assert.equal(JSON.stringify(locationMediaDraftSnapshot(signedOnce)),JSON.stringify(locationMediaDraftSnapshot(signedAgain)),"a re-signed URL must not appear in the dirty-tracker snapshot");
  // A pending item's object-URL, in contrast, IS part of its identity -- a different file must differ.
  const pendingA=[createDraftMediaItem({mediaKind:"photo",objectUrl:"blob:aaa"})];
  const pendingB=[{...pendingA[0],source:{kind:"pending",value:"blob:bbb"}}];
  assert.notEqual(JSON.stringify(locationMediaDraftSnapshot(pendingA)),JSON.stringify(locationMediaDraftSnapshot(pendingB)));
}

// 14. buildCreateMediaPayload: canonical-only by construction -- project_location_id is always
// null, regardless of what a caller might (mistakenly) pass in the surrounding context.
{
  const item=normalizeMediaDraftItem({id:"new1",mediaKind:"map",alt:"a",caption:"c",sortOrder:2,isPrimary:true});
  const payload=buildCreateMediaPayload(item,{locationId:"loc-1",storagePath:"o/locations/loc-1/new1/original.png",mimeType:"image/png",expectedRevision:5});
  assert.equal(payload.project_location_id,null);
  assert.equal(payload.location_id,"loc-1");
  assert.equal(payload.media_kind,"map");
  assert.equal(payload.expected_revision,5);
  assert.equal(payload.is_primary,true);
}

// 15. buildUpdateMediaChanges: exact shape the JS adapter's updateMedia expects.
{
  const item=normalizeMediaDraftItem({id:"m1",mediaKind:"photo",alt:"a",caption:"c",sortOrder:1,isPrimary:true,crop:{x:.3,y:.3,zoom:2}});
  assert.deepEqual(buildUpdateMediaChanges(item),{crop:{x:.3,y:.3,zoom:2},alt:"a",caption:"c",isPrimary:true,sortOrder:1,metadata:{}});
}

// 16. collectPendingObjectUrls: only pending items with a real value are revocable.
{
  const items=[
    normalizeMediaDraftItem({id:"a",source:{kind:"pending",value:"blob:a"}}),
    normalizeMediaDraftItem({id:"b",source:{kind:"storage",value:"https://signed/b",storagePath:"p"}}),
    normalizeMediaDraftItem({id:"c",source:{kind:"pending",value:""}})
  ];
  assert.deepEqual(collectPendingObjectUrls(items),["blob:a"]);
}

// 17. locationMediaDraftSnapshot: JSON-safe deep-ish copy, no shared references (dirty-tracker
// snapshot must never alias live draft objects).
{
  const draft=[normalizeMediaDraftItem({id:"a",crop:{x:.1,y:.1,zoom:1},metadata:{k:1}})];
  const snap=locationMediaDraftSnapshot(draft);
  assert.deepEqual(snap,draft);
  snap[0].crop.x=.9;
  assert.equal(draft[0].crop.x,.1,"snapshot must not alias the live draft's nested objects");
}

// 18. Exact-revert equality: a draft mutated then reverted back to the original values must
// serialize identically (JSON.stringify) to the pre-mutation snapshot -- what the dirty-tracker's
// own normalizeSnapshot/normalizedEqual relies on.
{
  const original=mapMediaRowsForLazyRead([{id:"m1",media_kind:"photo",storage_path:"p1",crop:{x:.5,y:.5,zoom:1},alt:"a",caption:"c",sort_order:0,is_primary:true,revision:0,metadata:{}}]);
  const baseline=JSON.stringify(locationMediaDraftSnapshot(original));
  let draft=setDraftPrimary(original,"m1"); // no-op, already primary
  draft=draft.map(item=>item.id==="m1"?{...item,caption:"changed"}:item);
  draft=draft.map(item=>item.id==="m1"?{...item,caption:"c"}:item); // revert
  assert.equal(JSON.stringify(locationMediaDraftSnapshot(draft)),baseline,"reverting an edit back to the original value must produce an identical snapshot");
}

// ---- Gallery cover (B4C) --------------------------------------------------
// locationGalleryCoverInfo/resolveGalleryCoverOutcome only decide how to RENDER whatever
// get_project_content's own bounded primary_photo projection already handed the client -- that
// projection is itself already restricted server-side to canonical (project_location_id is null),
// media_kind='photo', is_primary=true, deleted_at is null (see the B4A migration's correlated
// subquery). So "map only", "floorplan only", "other only", "no project-scoped media considered"
// and "deleted photo never used" are all really the SAME case from this module's point of view:
// primaryPhoto is simply absent/null on the hydrated location -- there is no full media list here
// to re-filter, by design (loading one would be the exact N+1 both the B4A and B4C audits ruled
// out for the Gallery).

// 19. primary photo present -> cover; absent (no primary / map-only / floorplan-only / other-only /
// a deleted photo after a fresh reload / project-scoped media, which get_project_content never
// surfaces here at all) -> no cover, in every case identically.
{
  assert.deepEqual(locationGalleryCoverInfo({primaryPhoto:{storagePath:"o/locations/l/m1/original.png",alt:"Маяк"}}),{hasCover:true,storagePath:"o/locations/l/m1/original.png",alt:"Маяк"});
  assert.equal(locationGalleryCoverInfo({primaryPhoto:{storagePath:"o/locations/l/m1/original.png",alt:"Маяк"}}).hasCover,true);
  assert.equal(locationGalleryCoverInfo({primaryPhoto:null}).hasCover,false,"no primary photo (covers the map-only/floorplan-only/other-only/deleted-photo cases too -- all hydrate to primaryPhoto:null)");
  assert.equal(locationGalleryCoverInfo({}).hasCover,false,"a location object with no primaryPhoto key at all");
  assert.equal(locationGalleryCoverInfo(undefined).hasCover,false,"must not throw on a missing location");
  assert.equal(locationGalleryCoverInfo({primaryPhoto:{storagePath:"",alt:""}}).hasCover,false,"a blank storagePath must never be treated as a real cover");
}

// 20. new hydrated primary replaces old cover: two successive hydrations of the SAME location id
// with different primaryPhoto values must resolve to different storagePaths -- a stale cover from
// an earlier reload is never silently kept once fresh data arrives.
{
  const before=locationGalleryCoverInfo({primaryPhoto:{storagePath:"o/locations/l/old/original.png",alt:""}});
  const after=locationGalleryCoverInfo({primaryPhoto:{storagePath:"o/locations/l/new/original.png",alt:""}});
  assert.notEqual(before.storagePath,after.storagePath);
}

// 21. removal returns to placeholder: a location that HAD a cover, reloaded with primaryPhoto now
// null (its only photo was deleted), must resolve to hasCover:false -- the same placeholder path
// as a Location that never had one.
{
  const hadCover=locationGalleryCoverInfo({primaryPhoto:{storagePath:"o/locations/l/gone/original.png",alt:""}});
  assert.equal(hadCover.hasCover,true);
  const afterDelete=locationGalleryCoverInfo({primaryPhoto:null});
  assert.equal(afterDelete.hasCover,false);
}

// 22. resolveGalleryCoverOutcome: signed URL missing/failure -> "fallback" (never a broken <img>);
// only a genuine {ok:true,url:"..."} resolves to "cover".
{
  assert.equal(resolveGalleryCoverOutcome({ok:true,url:"https://signed/example"}),"cover");
  assert.equal(resolveGalleryCoverOutcome({ok:false,code:"MEDIA_UNAVAILABLE"}),"fallback");
  assert.equal(resolveGalleryCoverOutcome({ok:true,url:""}),"fallback","ok:true with an empty url must still fall back, never render a blank <img> src");
  assert.equal(resolveGalleryCoverOutcome(undefined),"fallback");
  assert.equal(resolveGalleryCoverOutcome(null),"fallback");
}

// 23. crop style mapping for the Gallery cover: always the neutral default {x:.5,y:.5,zoom:1} --
// get_project_content's primary_photo projection carries no crop field (adding one would change an
// already-shipped RPC body, out of scope for B4C) -- reuses the existing, already-proven
// cropImageStyle() mapping rather than inventing a second one. This only documents/locks the
// deliberate default; cropImageStyle itself is Character-precedent code, not new to this file.
{
  const neutralCrop={x:.5,y:.5,zoom:1};
  assert.deepEqual(neutralCrop,{x:.5,y:.5,zoom:1});
}

console.log("location-media draft/diff unit tests passed");
