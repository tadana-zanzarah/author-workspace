/* Location B3A.1 -- pure direct-children derivation (project-participating hierarchy).
 *
 * Mirrors the identity distinction documented at the top of js/locations.js: a project
 * Location entry's `.id` is project_locations.id (participationId, the id scene.locationId
 * references) while `.locationId` is the global public.locations.id (canonicalId, the space
 * parentId lives in) -- local/non-cloud projects have no split at all, so `.locationId` is
 * absent there and the parent/participation id spaces are the same (see js/locations.js's
 * locationCanonicalId, which callers use to resolve the right id before calling this).
 *
 * Direct children of a Location are OTHER project-participating locations whose parentId
 * equals THIS location's CANONICAL id -- never its participation id. Comparing against the
 * participation id instead would silently produce zero children for every cloud project (see
 * task brief "LIKELY CLIENT-SIDE RULE").
 *
 * Grandchildren are excluded for free: a grandchild's parentId points at its own direct
 * parent's canonical id, not at this location's. A non-participating canonical child never
 * appears because `locations` here is always the current project's participation list, never
 * the global owned-location set -- so this never fabricates project participation.
 */
function locationDirectChildren(canonicalId,locations){
  if(!canonicalId)return [];
  return (locations||[])
    .filter(entry=>entry.parentId===canonicalId)
    .sort((a,b)=>(a.name||"").localeCompare(b.name||"","ru"));
}

/* Location Manual UX Batch B, B5 -- descendant scene statistics: "Сцен здесь" (direct scenes on
 * THIS Location's own project participation, unchanged -- see js/locations.js's existing
 * locationSceneEntries) vs "Сцен внутри" (scenes on ANY descendant Location's participation, any
 * depth, within the CURRENT project -- excluding this Location's own direct scenes).
 *
 * Needs the FULL owned canonical hierarchy (`ownedRows`, keyed by canonical id, including
 * canonical Locations that do NOT participate in the current project) so traversal can walk PAST a
 * non-participating intermediate ancestor without breaking the path to a deeper, participating
 * descendant -- see the task brief's worked example (Шер -> Кабинет Рене -> Ванная). A cycle-safe
 * BFS, small and self-contained rather than importing js/locations.js's own locationDescendantIds
 * (that file is DOM-coupled at module load -- e.g. it constructs a save-button controller at
 * import time -- so it cannot be imported from a plain Node unit test); same bounded/visited-set
 * shape as that helper, scoped to this one derivation.
 *
 * IMPORTANT: scene.location_id (locations[].id here) is always the project PARTICIPATION id, never
 * a canonical id (see js/locations.js's own identity-naming contract) -- this function never
 * compares a scene's locationId against a canonical id directly, only against a participation id
 * resolved through `projectLocations`.
 */
function locationDescendantSceneStats(canonicalId,ownedRows,projectLocations,scenes,maxDepth=64){
  if(!canonicalId||!ownedRows)return {count:0,hasParticipatingDescendants:false};
  const childrenByParent=new Map();
  for(const row of ownedRows.values()){
    if(!row?.parent_id)continue;
    if(!childrenByParent.has(row.parent_id))childrenByParent.set(row.parent_id,[]);
    childrenByParent.get(row.parent_id).push(row.id);
  }
  const participatingByCanonical=new Map((projectLocations||[]).map(l=>[l.locationId||l.id,l.id]));
  const sceneCountByParticipation=new Map();
  for(const scene of scenes||[]){
    if(!scene?.locationId)continue;
    sceneCountByParticipation.set(scene.locationId,(sceneCountByParticipation.get(scene.locationId)||0)+1);
  }
  const visited=new Set([canonicalId]);
  let frontier=[canonicalId],depth=0,count=0,hasParticipatingDescendants=false;
  while(frontier.length&&depth<maxDepth){
    const next=[];
    for(const id of frontier)for(const childId of childrenByParent.get(id)||[]){
      if(visited.has(childId))continue;
      visited.add(childId);next.push(childId);
      const participationId=participatingByCanonical.get(childId);
      if(participationId){
        hasParticipatingDescendants=true;
        count+=sceneCountByParticipation.get(participationId)||0;
      }
    }
    frontier=next;depth++;
  }
  return {count,hasParticipatingDescendants};
}

Object.assign(globalThis,{locationDirectChildren,locationDescendantSceneStats});
export {locationDirectChildren,locationDescendantSceneStats};
