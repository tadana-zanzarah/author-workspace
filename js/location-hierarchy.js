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

Object.assign(globalThis,{locationDirectChildren});
export {locationDirectChildren};
