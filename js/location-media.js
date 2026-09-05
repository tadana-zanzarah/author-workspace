/* Location Media B4B -- pure draft/diff/reconciliation-planning logic (js/location-media.js).
 *
 * Companion to js/cloud-location-media-api.js (B4A's adapter: MIME/size validation, path building,
 * upload/delete + Storage cleanup, signed URLs) -- this file owns the DRAFT STATE MODEL: hydrating
 * persisted rows into an editable draft, the pure add/remove/reorder/primary transitions edit mode
 * needs, and the diff that decides what Save must actually send to the already-live B4A RPCs.
 *
 * DRAFT-UNTIL-SAVE (mirrors js/characters.js's profileDraftPhotos/profileDraftPhotoFiles split
 * exactly): a draft item never carries a raw File inline -- a newly picked file's real File object
 * lives in a caller-owned Map keyed by draft id, while the draft item itself only carries
 * {kind:"pending", value:objectUrl}. This keeps every draft item JSON-safe (for safeOwnCopy and the
 * dirty-tracker's normalizeSnapshot) and is what lets the existing Location Profile dirty-tracker
 * treat media exactly like the parent picker/module-selection draft: extra state, no native File
 * input in its serializeForm scan (serializeForm already filters input[type=file] out).
 *
 * CANONICAL-ONLY (B4B UI decision, backend already supports project-scope): every draft item this
 * module produces or accepts has no project_location_id concept at all -- buildCreateMediaPayload
 * hardcodes project_location_id:null in the RPC payload itself, so there is no code path in this
 * file that could accidentally emit a project-scoped create even if a future caller passed one in.
 *
 * REVISION CHAINING (see the B4A verification report's revision-semantics note, and AGENTS.md):
 * this file never manufactures a revision number. planLocationMediaSaveOrder only ORDERS operations
 * (delete -> update[non-primary-setting first, primary-setting last] -> create) so that no operation
 * in one Save pass ever needs an expected_revision value staler than what an EARLIER operation in
 * the SAME pass already caused -- the actual revision values themselves flow from each RPC
 * response, threaded by the caller (js/locations.js's save orchestrator), never computed here.
 */

const LOCATION_MEDIA_KIND_CATALOG=[
  {key:"photo",label:"Фото",primaryLabel:"Основное фото"},
  {key:"map",label:"Карты",primaryLabel:"Основная карта"},
  {key:"floorplan",label:"Планы",primaryLabel:"Основной план"},
  {key:"other",label:"Другое",primaryLabel:"Основное"}
];
const LOCATION_MEDIA_KINDS=LOCATION_MEDIA_KIND_CATALOG.map(k=>k.key);
const LOCATION_MEDIA_KIND_LABELS=Object.fromEntries(LOCATION_MEDIA_KIND_CATALOG.map(k=>[k.key,k.label]));
const LOCATION_MEDIA_KIND_PRIMARY_LABELS=Object.fromEntries(LOCATION_MEDIA_KIND_CATALOG.map(k=>[k.key,k.primaryLabel]));

function locationMediaKindLabel(kind){return LOCATION_MEDIA_KIND_LABELS[kind]||kind}
function locationMediaKindPrimaryLabel(kind){return LOCATION_MEDIA_KIND_PRIMARY_LABELS[kind]||"Основное"}
function isValidLocationMediaKind(kind){return LOCATION_MEDIA_KINDS.includes(kind)}

// Photo is the only kind crop applies to -- maps/floorplans/other must never inherit portrait-style
// crop state (task brief section 9/15). Callers use this both to gate the crop UI affordance and to
// decide whether to strip crop in normalizeMediaDraftItem below.
function isCropApplicableKind(kind){return kind==="photo"}

const DEFAULT_CROP=Object.freeze({x:.5,y:.5,zoom:1});

// Ensures a draft item always has the full expected shape with safe defaults, and -- the one
// enforced invariant -- strips crop back to {} for any non-photo kind, so a map/floorplan/other item
// can never carry leftover portrait crop state from an earlier kind change on the same draft item
// (the add flow lets a NOT-YET-SAVED item's kind be reconsidered; an existing persisted item's kind
// is immutable -- update_location_media has no media_kind parameter -- so this only ever matters for
// brand-new drafts).
function normalizeMediaDraftItem(raw){
  const mediaKind=isValidLocationMediaKind(raw?.mediaKind)?raw.mediaKind:"photo";
  const cropApplicable=isCropApplicableKind(mediaKind);
  return {
    id:String(raw?.id||""),
    mediaKind,
    source:raw?.source&&typeof raw.source==="object"?{...raw.source}:{kind:"pending",value:""},
    crop:cropApplicable?{...DEFAULT_CROP,...(raw?.crop||{})}:{},
    alt:String(raw?.alt||""),
    caption:String(raw?.caption||""),
    sortOrder:Number.isFinite(raw?.sortOrder)?raw.sortOrder:0,
    isPrimary:raw?.isPrimary===true,
    revision:raw?.revision==null?null:Number(raw.revision),
    metadata:raw?.metadata&&typeof raw.metadata==="object"?{...raw.metadata}:{}
  };
}

// Hydrates one list_location_media RPC row (snake_case) into the draft shape above. No signed URL
// yet -- that is filled in separately (mapSignedUrlsOntoDraft) once the small per-Profile signing
// batch resolves, so hydration itself never blocks on a network round trip.
function hydrateLocationMediaRow(row){
  return normalizeMediaDraftItem({
    id:row.id,mediaKind:row.media_kind,
    source:{kind:"storage",value:"",storagePath:row.storage_path,mimeType:row.mime_type},
    crop:row.crop,alt:row.alt,caption:row.caption,sortOrder:Number(row.sort_order)||0,
    isPrimary:row.is_primary===true,revision:row.revision,metadata:row.metadata
  });
}
// "Lazy read mapping" -- the whole small per-Location list, in stored sort_order.
function mapMediaRowsForLazyRead(rows){return (rows||[]).map(hydrateLocationMediaRow).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id))}

// "Signed URL mapping" -- pure merge by storage path. Never mutates its input; a path with no entry
// in signedUrlByPath (a failed/pending sign) leaves that item's source.value at "" so the UI can
// render an explicit unavailable state instead of a broken <img>, matching the Character precedent's
// own "signed URL refresh fails -> metadata remains, UI shows unavailable" contract.
function mapSignedUrlsOntoDraft(draft,signedUrlByPath){
  return (draft||[]).map(item=>{
    if(item.source?.kind!=="storage")return item;
    const url=signedUrlByPath?.[item.source.storagePath];
    return url?{...item,source:{...item.source,value:url}}:item;
  });
}

let draftIdCounter=0;
function nextDraftMediaId(uuid){
  if(uuid)return String(uuid);
  draftIdCounter+=1;
  return `draft-media-${draftIdCounter}-${Date.now()}`;
}

// A brand-new, never-persisted draft item from a picked File. `objectUrl` is the caller's
// URL.createObjectURL(file) result -- this module never touches the DOM/File APIs itself, keeping
// it fully unit-testable without a browser. sortOrder defaults to "after every existing item of the
// SAME kind" (callers usually pass the count of same-kind items already in the draft).
function createDraftMediaItem({id,mediaKind,objectUrl,sortOrder=0,alt="",caption="",isPrimary=false}={}){
  return normalizeMediaDraftItem({id:nextDraftMediaId(id),mediaKind,source:{kind:"pending",value:objectUrl||""},sortOrder,alt,caption,isPrimary:isPrimary===true,revision:null});
}

// Groups by the fixed catalog order (photo, map, floorplan, other), each group's items already in
// sortOrder order, and DROPS any kind with zero items -- callers must never render an empty group
// (task brief "Do not render empty groups").
function groupMediaByKind(items){
  const byKind=new Map(LOCATION_MEDIA_KINDS.map(k=>[k,[]]));
  for(const item of (items||[]))if(byKind.has(item.mediaKind))byKind.get(item.mediaKind).push(item);
  return LOCATION_MEDIA_KIND_CATALOG
    .map(({key,label,primaryLabel})=>({kind:key,label,primaryLabel,items:[...byKind.get(key)].sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id))}))
    .filter(group=>group.items.length>0);
}

function primaryOfKind(items,kind){return (items||[]).find(item=>item.mediaKind===kind&&item.isPrimary)||null}

// Setting a new primary demotes ONLY the previous primary of the SAME kind -- never crosses kinds,
// never touches the other scope (there is no other scope reachable from this module at all, B4B
// being canonical-only). Pure: returns a new array, never mutates its input.
function setDraftPrimary(items,id){
  const target=(items||[]).find(item=>item.id===id);
  if(!target)return items;
  return items.map(item=>{
    if(item.id===id)return item.isPrimary?item:{...item,isPrimary:true};
    if(item.mediaKind===target.mediaKind&&item.isPrimary)return {...item,isPrimary:false};
    return item;
  });
}

// Pure remove. The caller is responsible for the side effects a removed item requires (revoking its
// object URL if it was still pending, dropping it from the pending-File Map) -- see
// collectPendingObjectUrls below for the testable part of that.
function removeDraftItem(items,id){return (items||[]).filter(item=>item.id!==id)}

// Move `id` one step earlier/later within its OWN kind group only -- cross-kind reordering has no
// product meaning (each kind renders as its own separate group) and would silently perturb another
// kind's sort_order for no reason. Renumbers only the affected kind's items (0,1,2,...) so the
// backend's global `sort_order` column stays a clean dense sequence per kind without colliding with
// any other kind's own numbering.
function reorderDraftItem(items,id,direction){
  const target=(items||[]).find(item=>item.id===id);
  if(!target)return items;
  const sameKind=(items||[]).filter(item=>item.mediaKind===target.mediaKind).sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
  const index=sameKind.findIndex(item=>item.id===id);
  const swapWith=direction==="up"?index-1:index+1;
  if(swapWith<0||swapWith>=sameKind.length)return items;
  const reordered=[...sameKind];
  [reordered[index],reordered[swapWith]]=[reordered[swapWith],reordered[index]];
  const renumbered=new Map(reordered.map((item,i)=>[item.id,i]));
  return items.map(item=>renumbered.has(item.id)?{...item,sortOrder:renumbered.get(item.id)}:item);
}

function mediaFieldsEqual(a,b){
  return a.mediaKind===b.mediaKind&&a.alt===b.alt&&a.caption===b.caption&&a.sortOrder===b.sortOrder
    &&a.isPrimary===b.isPrimary&&JSON.stringify(a.crop)===JSON.stringify(b.crop)&&JSON.stringify(a.metadata)===JSON.stringify(b.metadata);
}

// The diff Save actually reconciles against: NEW (draft item with a pending source and no persisted
// counterpart), CHANGED (persisted item whose editable fields differ), REMOVED (persisted item no
// longer in the draft), UNCHANGED (excluded entirely -- no RPC call).
function diffLocationMediaDraft(original,draft){
  const originalById=new Map((original||[]).map(item=>[item.id,item]));
  const draftIds=new Set((draft||[]).map(item=>item.id));
  const toCreate=[],toUpdate=[];
  for(const item of (draft||[])){
    const before=originalById.get(item.id);
    if(!before){toCreate.push(item);continue}
    if(!mediaFieldsEqual(before,item))toUpdate.push({item,before});
  }
  const toDelete=(original||[]).filter(item=>!draftIds.has(item.id));
  return {toCreate,toUpdate,toDelete};
}

// Orders a diff into the sequence that is provably safe against an intra-save spurious
// REVISION_CONFLICT (see this file's header): deletes (nothing else can depend on a row that's
// gone), then updates that do NOT newly become primary (their captured revision is still fresh --
// nothing before this step could have touched them), then updates that DO newly become primary
// (each such update demotes whatever the backend currently considers primary for that kind -- safe
// to run last since any sibling's OWN direct edit in this same pass already completed in the
// previous step), then creates (a primary-setting create's demotion side effect can only ever land
// on a row this pass has already finished editing, by the same reasoning).
function planLocationMediaSaveOrder(diff){
  const primarySetting=({item,before})=>item.isPrimary===true&&before.isPrimary!==true;
  const updatesNonPrimary=diff.toUpdate.filter(entry=>!primarySetting(entry));
  const updatesPrimary=diff.toUpdate.filter(primarySetting);
  return {toDelete:diff.toDelete,toUpdate:[...updatesNonPrimary,...updatesPrimary],toCreate:diff.toCreate};
}

// The exact create_location_media RPC payload shape, canonical-only by construction (see this
// file's header) -- expectedRevision is threaded in by the caller from the running
// locations.revision counter, never invented here.
function buildCreateMediaPayload(draftItem,{locationId,storagePath,mimeType,expectedRevision}){
  return {
    media_id:draftItem.id,location_id:locationId,project_location_id:null,
    storage_path:storagePath,mime_type:mimeType,media_kind:draftItem.mediaKind,
    crop:draftItem.crop,alt:draftItem.alt,caption:draftItem.caption,
    sort_order:draftItem.sortOrder,is_primary:draftItem.isPrimary,metadata:draftItem.metadata,
    expected_revision:expectedRevision
  };
}

// The exact update_location_media RPC "changes" shape (js/cloud-location-media-api.js's updateMedia
// expects {crop,alt,caption,isPrimary,sortOrder,metadata}).
function buildUpdateMediaChanges(draftItem){
  return {crop:draftItem.crop,alt:draftItem.alt,caption:draftItem.caption,isPrimary:draftItem.isPrimary,sortOrder:draftItem.sortOrder,metadata:draftItem.metadata};
}

// Testable half of object-URL cleanup: which pending items in `removedOrReplaced` actually hold a
// revocable blob: URL. The caller (DOM-facing code) calls URL.revokeObjectURL on each returned value
// -- kept out of this module so the decision of WHICH urls need revoking stays unit-testable.
function collectPendingObjectUrls(items){
  return (items||[]).filter(item=>item.source?.kind==="pending"&&item.source.value).map(item=>item.source.value);
}

// Dirty-tracker snapshot: the draft array is already JSON-safe (no File objects inline -- see this
// file's header), so this is mostly a defensive shallow-safe copy for the extra-state slot passed
// to serializeForm, mirroring profileEditorModal's `photos:safeOwnCopy(profileDraftPhotos)` exactly.
// The ONE deliberate exception: a persisted (`source.kind==="storage"`) item's signed URL is a
// transient runtime value (AGENTS.md: never canonical data) that can change on every re-sign with a
// fresh expiry/signature despite nothing user-relevant changing -- included verbatim here, the
// dirty-tracker would flag the Profile as dirty forever. storagePath/mimeType (stable, real
// identity) stay; only the churning signed value is dropped. A pending item's object-URL value IS
// kept -- a different file genuinely is a different draft state.
function locationMediaDraftSnapshot(draft){
  return (draft||[]).map(item=>({
    ...item,
    source:item.source?.kind==="storage"?{kind:"storage",storagePath:item.source.storagePath,mimeType:item.source.mimeType}:{...item.source},
    crop:{...item.crop},metadata:{...item.metadata}
  }));
}

/* ---- Gallery cover (B4C) ----
 * Canonical primary PHOTO only, sourced entirely from get_project_content's own bounded
 * primary_photo projection -- the server-side correlated subquery already restricts this to
 * media_kind='photo', is_primary=true, project_location_id is null, deleted_at is null (see the
 * B4A migration header). This module therefore never re-derives "is this a photo / is this
 * primary / is this canonical" eligibility from a full media list -- there IS no full media list
 * in the Gallery's hydration payload to derive it from, by design (loading one would be the exact
 * N+1 the B4A/B4C audits both ruled out). These two functions only decide how to RENDER whatever
 * already arrived: what to sign, and what a signing attempt's outcome means for the card. */

// hasCover:false whenever primaryPhoto is absent (no primary photo, a map/floorplan/other-only
// Location, or a primary photo whose backing row was deleted and the project has since been
// reloaded -- a deleted photo is never still present in a fresh primary_photo projection).
function locationGalleryCoverInfo(location){
  const photo=location?.primaryPhoto;
  if(!photo?.storagePath)return {hasCover:false,storagePath:null,alt:""};
  return {hasCover:true,storagePath:photo.storagePath,alt:photo.alt||""};
}

// Pure mapping from a cloud-location-media-api signedUrl() result to a render outcome. "cover"
// only on a genuine ok:true with a real url string; any failure (network error, missing/deleted
// object, malformed response) resolves to "fallback" -- the existing monogram letter stays
// visible, never a broken <img>.
function resolveGalleryCoverOutcome(signedResult){
  return (signedResult?.ok&&signedResult?.url)?"cover":"fallback";
}

Object.assign(globalThis,{
  LOCATION_MEDIA_KIND_CATALOG,LOCATION_MEDIA_KINDS,locationMediaKindLabel,locationMediaKindPrimaryLabel,isValidLocationMediaKind,isCropApplicableKind,
  locationGalleryCoverInfo,resolveGalleryCoverOutcome,
  normalizeMediaDraftItem,hydrateLocationMediaRow,mapMediaRowsForLazyRead,mapSignedUrlsOntoDraft,
  createDraftMediaItem,groupMediaByKind,primaryOfKind,setDraftPrimary,removeDraftItem,reorderDraftItem,
  diffLocationMediaDraft,planLocationMediaSaveOrder,buildCreateMediaPayload,buildUpdateMediaChanges,
  collectPendingObjectUrls,locationMediaDraftSnapshot
});
export {
  LOCATION_MEDIA_KIND_CATALOG,LOCATION_MEDIA_KINDS,locationMediaKindLabel,locationMediaKindPrimaryLabel,isValidLocationMediaKind,isCropApplicableKind,
  locationGalleryCoverInfo,resolveGalleryCoverOutcome,
  normalizeMediaDraftItem,hydrateLocationMediaRow,mapMediaRowsForLazyRead,mapSignedUrlsOntoDraft,
  createDraftMediaItem,groupMediaByKind,primaryOfKind,setDraftPrimary,removeDraftItem,reorderDraftItem,
  diffLocationMediaDraft,planLocationMediaSaveOrder,buildCreateMediaPayload,buildUpdateMediaChanges,
  collectPendingObjectUrls,locationMediaDraftSnapshot
};
