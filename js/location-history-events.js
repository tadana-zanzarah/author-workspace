/* Location History H-events -- pure draft/diff/local-mode logic (js/location-history-events.js).
 *
 * Companion to js/cloud-content-api.js (the live list/create/update/delete_location_history_event
 * RPCs) -- this file owns the DRAFT STATE MODEL: hydrating persisted rows into an editable draft,
 * the pure add/remove/reorder transitions edit mode needs, the diff that decides what Save must
 * actually send, and the local-mode <-> cloud-mode shape mapping. Mirrors js/location-media.js's own
 * DRAFT-UNTIL-SAVE / diff / reconciliation-planning discipline closely, simplified because events
 * have no Storage upload, no per-kind grouping, no primary concept, and no project scope at all
 * (canonical-only, by explicit product decision -- see the H-events migration header).
 *
 * DATE MODEL (fixed, do not "improve" this without a new product decision): `dateLabel` is free-form
 * author text ("около 1240 года", "за три века до войны", "", "неизвестно") and is NEVER parsed by
 * anything in this file to determine order. Order is `sortOrder` only, exactly like
 * js/location-media.js's own sortOrder / js/chapters.js's position.
 */

// A draft item's full expected shape with safe defaults. `revision` is null for a brand-new,
// never-persisted item (mirrors location-media's draft items) -- update/delete reconciliation reads
// `before.revision`, i.e. the ORIGINAL persisted item's revision, never this field on the draft.
function normalizeHistoryEventDraftItem(raw){
  return {
    id:String(raw?.id||""),
    title:String(raw?.title||""),
    dateLabel:String(raw?.dateLabel||""),
    description:String(raw?.description||""),
    sortOrder:Number.isFinite(raw?.sortOrder)?raw.sortOrder:0,
    revision:raw?.revision==null?null:Number(raw.revision),
    metadata:raw?.metadata&&typeof raw.metadata==="object"?{...raw.metadata}:{}
  };
}

// Hydrates one list_location_history_events RPC row (snake_case) into the draft shape above.
function hydrateLocationHistoryEventRow(row){
  return normalizeHistoryEventDraftItem({
    id:row.id,title:row.title,dateLabel:row.date_label,description:row.description,
    sortOrder:Number(row.sort_order)||0,revision:row.revision,metadata:row.metadata
  });
}
// The whole small per-Location event list, in stored sort_order (mirrors location-media's
// mapMediaRowsForLazyRead exactly).
function mapHistoryEventRowsForLazyRead(rows){return (rows||[]).map(hydrateLocationHistoryEventRow).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id))}

// Local-mode shape: a plain array on the local Location record (location.historyEvents), per the
// task brief -- id/title/dateLabel/description/sortOrder only, no revision/deleted_at/metadata
// (those are cloud-only concepts; local mode has no separate canonical table to version). Defensive
// against any malformed/missing/legacy shape, mirroring how every other local array field
// (aliases, etc.) is defended at the read site rather than backfilled in js/migrations.js -- an old
// local project with no historyEvents field at all simply normalizes to [].
function normalizeLocalHistoryEvents(raw){
  if(!Array.isArray(raw))return [];
  return raw.filter(item=>item&&typeof item==="object").map(item=>({
    id:String(item.id||""),title:String(item.title||""),dateLabel:String(item.dateLabel||""),
    description:String(item.description||""),sortOrder:Number.isFinite(item.sortOrder)?item.sortOrder:0
  })).filter(item=>item.id);
}
// The exact local-storage shape Save writes back onto location.historyEvents -- strips the
// cloud-only revision/metadata fields a draft item otherwise carries, per the task brief ("Do not
// include cloud-only fields such as: revision, deleted_at, metadata unless existing local
// conventions require metadata explicitly" -- they don't here).
function buildLocalHistoryEventsForSave(draftItems){
  return (draftItems||[]).map(item=>({id:item.id,title:item.title,dateLabel:item.dateLabel,description:item.description,sortOrder:item.sortOrder}));
}

let draftIdCounter=0;
function nextDraftHistoryEventId(uuid){
  if(uuid)return String(uuid);
  draftIdCounter+=1;
  return `draft-history-event-${draftIdCounter}-${Date.now()}`;
}

// A brand-new, never-persisted draft item. sortOrder defaults to "after every existing item"
// (callers usually pass the current draft length).
function createDraftHistoryEvent({id,title="",dateLabel="",description="",sortOrder=0}={}){
  return normalizeHistoryEventDraftItem({id:nextDraftHistoryEventId(id),title,dateLabel,description,sortOrder,revision:null});
}

function removeHistoryEventDraftItem(items,id){return (items||[]).filter(item=>item.id!==id)}

// Move `id` one step earlier/later within the WHOLE list (no kind grouping, unlike Media -- there is
// only one list). Renumbers every item to a clean dense 0..n-1 sequence, same reasoning as
// js/location-media.js's reorderDraftItem: keeps the backend's numeric sort_order a clean sequence
// without ever needing a second "recompute order" pass.
function reorderHistoryEventDraftItem(items,id,direction){
  const sorted=[...(items||[])].sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
  const index=sorted.findIndex(item=>item.id===id);
  if(index<0)return items;
  const swapWith=direction==="up"?index-1:index+1;
  if(swapWith<0||swapWith>=sorted.length)return items;
  [sorted[index],sorted[swapWith]]=[sorted[swapWith],sorted[index]];
  const renumbered=new Map(sorted.map((item,i)=>[item.id,i]));
  return (items||[]).map(item=>renumbered.has(item.id)?{...item,sortOrder:renumbered.get(item.id)}:item);
}

function historyEventFieldsEqual(a,b){
  return a.title===b.title&&a.dateLabel===b.dateLabel&&a.description===b.description&&a.sortOrder===b.sortOrder;
}

// The diff Save actually reconciles against: NEW (draft item with no persisted counterpart),
// CHANGED (persisted item whose editable fields differ), REMOVED (persisted item no longer in the
// draft), UNCHANGED (excluded entirely -- no RPC call). Mirrors
// js/location-media.js's diffLocationMediaDraft exactly.
function diffHistoryEventsDraft(original,draft){
  const originalById=new Map((original||[]).map(item=>[item.id,item]));
  const draftIds=new Set((draft||[]).map(item=>item.id));
  const toCreate=[],toUpdate=[];
  for(const item of (draft||[])){
    const before=originalById.get(item.id);
    if(!before){toCreate.push(item);continue}
    if(!historyEventFieldsEqual(before,item))toUpdate.push({item,before});
  }
  const toDelete=(original||[]).filter(item=>!draftIds.has(item.id));
  return {toCreate,toUpdate,toDelete};
}

// Save order is fixed and simple (no primary-demotion complexity to sequence around, unlike Media):
// delete persisted removals, update changed persisted events, create new events -- delete/create are
// the only two operations that touch locations.revision, and reconcileLocationHistoryEventsDraft
// (js/locations.js) threads that value between them in this same order.
function planLocationHistoryEventsSaveOrder(diff){
  return {toDelete:diff.toDelete,toUpdate:diff.toUpdate,toCreate:diff.toCreate};
}

// The exact create_location_history_event RPC argument shape (js/cloud-content-api.js's
// createLocationHistoryEvent expects {title,dateLabel,description,sortOrder}). expectedRevision is
// threaded in by the caller from the running locations.revision counter, never invented here.
function buildCreateHistoryEventPayload(draftItem,{locationId,expectedRevision}){
  return {
    eventId:draftItem.id,locationId,title:draftItem.title,dateLabel:draftItem.dateLabel,
    description:draftItem.description,sortOrder:draftItem.sortOrder,expectedRevision
  };
}
// The exact update_location_history_event RPC "changes" shape.
function buildUpdateHistoryEventChanges(draftItem){
  return {title:draftItem.title,dateLabel:draftItem.dateLabel,description:draftItem.description,sortOrder:draftItem.sortOrder};
}

// Dirty-tracker snapshot: the draft array is already JSON-safe, so this is a defensive shallow-safe
// copy for the extra-state slot passed to serializeForm, mirroring
// js/location-media.js's locationMediaDraftSnapshot.
function locationHistoryEventsDraftSnapshot(draft){
  return (draft||[]).map(item=>({...item,metadata:{...item.metadata}}));
}

Object.assign(globalThis,{
  normalizeHistoryEventDraftItem,hydrateLocationHistoryEventRow,mapHistoryEventRowsForLazyRead,
  normalizeLocalHistoryEvents,buildLocalHistoryEventsForSave,
  createDraftHistoryEvent,removeHistoryEventDraftItem,reorderHistoryEventDraftItem,
  diffHistoryEventsDraft,planLocationHistoryEventsSaveOrder,
  buildCreateHistoryEventPayload,buildUpdateHistoryEventChanges,locationHistoryEventsDraftSnapshot
});
export {
  normalizeHistoryEventDraftItem,hydrateLocationHistoryEventRow,mapHistoryEventRowsForLazyRead,
  normalizeLocalHistoryEvents,buildLocalHistoryEventsForSave,
  createDraftHistoryEvent,removeHistoryEventDraftItem,reorderHistoryEventDraftItem,
  historyEventFieldsEqual,diffHistoryEventsDraft,planLocationHistoryEventsSaveOrder,
  buildCreateHistoryEventPayload,buildUpdateHistoryEventChanges,locationHistoryEventsDraftSnapshot
};
