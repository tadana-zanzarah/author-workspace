// Location Phase Adaptive Module Selection -- pure state model (js/location-module-selection.js).
// Mirrors the accepted contract (Adaptive Module Selection -- Final Contract Addendum) and the
// backend RPC's own normalization (20260904140000_location_adaptive_module_selection.sql).
import assert from "node:assert/strict";
import {
  LOCATION_MODULE_KEYS,locationModuleLabel,locationModuleHasData,locationModuleRecommendation,
  normalizeModuleSelection,moduleSelectionsEqual,moduleSelectionEffective,
  locationModuleEditVisible,locationModuleReadVisible,locationVisibleModules,locationModulePickerCandidates,
  addEmptyLocationModule,removeEmptyLocationModule,hideLocationModule,showLocationModule,
  deleteLocationModuleSelectionEntry,dropRedundantShownEntries,saveNeedsModuleSelectionWrite
} from "../js/location-module-selection.js";

// 1. Catalog is the six shipped modules (Phase 1: appearanceAtmosphere/geography; B3B:
// governmentSociety/economy; B3C: populationCulture; Location History H-base: history), in this
// fixed order, nothing more.
assert.deepEqual(LOCATION_MODULE_KEYS,["appearanceAtmosphere","geography","governmentSociety","economy","populationCulture","history"]);
assert.equal(locationModuleLabel("appearanceAtmosphere"),"Внешний вид и атмосфера");
assert.equal(locationModuleLabel("geography"),"География и природа");
assert.equal(locationModuleLabel("governmentSociety"),"Государство и общество");
assert.equal(locationModuleLabel("economy"),"Экономика");
assert.equal(locationModuleLabel("populationCulture"),"Население и культура");
assert.equal(locationModuleLabel("history"),"История");

// 2. hasData: empty/absent baseProfile -> false for both modules.
assert.equal(locationModuleHasData({},"appearanceAtmosphere"),false);
assert.equal(locationModuleHasData({baseProfile:{}},"geography"),false);
assert.equal(locationModuleHasData(undefined,"geography"),false);

// 3. hasData: whitespace-only fields still count as empty (delegates to location-base-profile.js's
// own normalization, so a module with only blank strings is never treated as populated).
assert.equal(locationModuleHasData({baseProfile:{geography:{terrain:"   "}}},"geography"),false);

// 4. hasData: a real field makes it true.
assert.equal(locationModuleHasData({baseProfile:{appearanceAtmosphere:{atmosphere:"Тихо"}}},"appearanceAtmosphere"),true);
assert.equal(locationModuleHasData({baseProfile:{geography:{terrain:"Горы"}}},"geography"),true);

// 5. normalizeModuleSelection: dedupe + canonical order, regardless of input order/duplicates.
assert.deepEqual(normalizeModuleSelection({shown:["geography","appearanceAtmosphere","geography"]}),{shown:["appearanceAtmosphere","geography"],hidden:[]});
assert.deepEqual(normalizeModuleSelection({hidden:["appearanceAtmosphere","appearanceAtmosphere"]}),{shown:[],hidden:["appearanceAtmosphere"]});

// 6. normalizeModuleSelection: unknown keys are dropped (frontend catalog is the allowlist here).
// Uses historyNotes -- populationCulture shipped in B3C and is no longer a valid "unknown key"
// example (see location-module-selection.js's own catalog).
assert.deepEqual(normalizeModuleSelection({shown:["historyNotes","appearanceAtmosphere"]}),{shown:["appearanceAtmosphere"],hidden:[]});

// 7. normalizeModuleSelection: malformed input never throws.
assert.deepEqual(normalizeModuleSelection(undefined),{shown:[],hidden:[]});
assert.deepEqual(normalizeModuleSelection(null),{shown:[],hidden:[]});
assert.deepEqual(normalizeModuleSelection({shown:"not-an-array",hidden:42}),{shown:[],hidden:[]});

// 8. normalizeModuleSelection: shown/hidden overlap resolves hidden-wins (this module's own
// normalization is the "untrusted/local" side of the contract, not the strict live-RPC side).
assert.deepEqual(normalizeModuleSelection({shown:["geography"],hidden:["geography"]}),{shown:[],hidden:["geography"]});

// 9. moduleSelectionsEqual: order/duplicate-insensitive, shape-insensitive for equivalent states.
assert.equal(moduleSelectionsEqual({shown:["appearanceAtmosphere","geography"]},{shown:["geography","appearanceAtmosphere","geography"]}),true);
assert.equal(moduleSelectionsEqual({shown:["appearanceAtmosphere"]},{shown:["geography"]}),false);
assert.equal(moduleSelectionsEqual(undefined,{shown:[],hidden:[]}),true);
assert.equal(moduleSelectionsEqual(undefined,{shown:["geography"]}),false);

// 10. moduleSelectionEffective: null when genuinely empty (mirrors the server's "no moduleSelection
// key at all" collapse); a real object when not.
assert.equal(moduleSelectionEffective({shown:[],hidden:[]}),null);
assert.equal(moduleSelectionEffective(undefined),null);
assert.deepEqual(moduleSelectionEffective({shown:["geography"]}),{shown:["geography"],hidden:[]});

// 11. Edit visibility: (hasData OR shown) AND NOT hidden.
{
  const emptyLocation={baseProfile:{}};
  const populatedLocation={baseProfile:{geography:{terrain:"Горы"}}};
  assert.equal(locationModuleEditVisible(emptyLocation,{},"geography"),false,"empty + not selected -> not edit-visible");
  assert.equal(locationModuleEditVisible(emptyLocation,{shown:["geography"]},"geography"),true,"empty + shown -> edit-visible");
  assert.equal(locationModuleEditVisible(populatedLocation,{},"geography"),true,"has data -> edit-visible even with no selection state");
  assert.equal(locationModuleEditVisible(populatedLocation,{hidden:["geography"]},"geography"),false,"has data but hidden -> NOT edit-visible");
  assert.equal(locationModuleEditVisible(emptyLocation,{shown:["geography"],hidden:["geography"]},"geography"),false,"hidden overrides shown even when both raw-present (post-normalization)");
}

// 12. Read visibility: hasData AND NOT hidden -- an added-but-empty module never appears in Read.
{
  const emptyLocation={baseProfile:{}};
  const populatedLocation={baseProfile:{geography:{terrain:"Горы"}}};
  assert.equal(locationModuleReadVisible(emptyLocation,{shown:["geography"]},"geography"),false,"shown but empty -> not read-visible");
  assert.equal(locationModuleReadVisible(populatedLocation,{},"geography"),true,"has data, no hide -> read-visible");
  assert.equal(locationModuleReadVisible(populatedLocation,{hidden:["geography"]},"geography"),false,"has data but hidden -> not read-visible");
}

// 13. locationVisibleModules: fixed catalog order, both modes.
{
  const location={baseProfile:{appearanceAtmosphere:{atmosphere:"Тихо"},geography:{terrain:"Горы"}}};
  assert.deepEqual(locationVisibleModules(location,{},{mode:"edit"}),["appearanceAtmosphere","geography"]);
  assert.deepEqual(locationVisibleModules(location,{hidden:["appearanceAtmosphere"]},{mode:"read"}),["geography"]);
}

// 14. Picker candidates: truly-absent module -> action "add"; hidden populated module -> action
// "show", visually distinguishable via hasData:true; an already edit-visible module is never a
// candidate at all.
{
  const location={baseProfile:{geography:{terrain:"Горы"}}};
  const selection={hidden:["geography"]};
  const candidates=locationModulePickerCandidates(location,selection);
  assert.deepEqual(candidates.map(c=>c.key).sort(),["appearanceAtmosphere","economy","geography","governmentSociety","history","populationCulture"]);
  const geo=candidates.find(c=>c.key==="geography");
  assert.equal(geo.action,"show");
  assert.equal(geo.hasData,true);
  const appearance=candidates.find(c=>c.key==="appearanceAtmosphere");
  assert.equal(appearance.action,"add");
  assert.equal(appearance.hasData,false);

  // Once shown, a module is no longer a candidate (using a location with no data at all, so
  // geography's candidacy here is solely a function of selection state, not hasData).
  const emptyLocation={baseProfile:{}};
  const shownSelection={shown:["appearanceAtmosphere"]};
  assert.deepEqual(locationModulePickerCandidates(emptyLocation,shownSelection).map(c=>c.key),["geography","governmentSociety","economy","populationCulture","history"]);
}

// 22. B3B hasData: governmentSociety/economy follow the exact same rules as the existing modules.
assert.equal(locationModuleHasData({baseProfile:{governmentSociety:{governmentForm:"   "}}},"governmentSociety"),false);
assert.equal(locationModuleHasData({baseProfile:{governmentSociety:{leadership:"Совет старейшин"}}},"governmentSociety"),true);
assert.equal(locationModuleHasData({baseProfile:{economy:{}}},"economy"),false);
assert.equal(locationModuleHasData({baseProfile:{economy:{currency:"кроны"}}},"economy"),true);

// 23. locationModuleRecommendation: guidance-only lookup, never throws, "none" for an
// unspecified/custom type (no typePreset) and for a module with no recommendation table.
assert.equal(locationModuleRecommendation("governmentSociety","country"),"strong");
assert.equal(locationModuleRecommendation("governmentSociety","continent"),"none");
assert.equal(locationModuleRecommendation("governmentSociety","district"),"recommend");
assert.equal(locationModuleRecommendation("economy","transport"),"strong");
assert.equal(locationModuleRecommendation("economy","street"),"recommend");
assert.equal(locationModuleRecommendation("economy","room"),"none");
assert.equal(locationModuleRecommendation("governmentSociety",null),"none");
assert.equal(locationModuleRecommendation("governmentSociety",undefined),"none");
assert.equal(locationModuleRecommendation("governmentSociety","some-custom-unlisted-type"),"none");
assert.equal(locationModuleRecommendation("appearanceAtmosphere","country"),"none","Phase 1 modules have no recommendation table");
assert.equal(locationModuleRecommendation("geography","country"),"none","Phase 1 modules have no recommendation table");

// 27. B3C hasData: populationCulture follows the exact same rules as the existing modules.
assert.equal(locationModuleHasData({baseProfile:{populationCulture:{populationCharacter:"   "}}},"populationCulture"),false);
assert.equal(locationModuleHasData({baseProfile:{populationCulture:{socialNorms:"Не свистеть на корабле."}}},"populationCulture"),true);
assert.equal(locationModuleHasData({baseProfile:{populationCulture:{}}},"populationCulture"),false);

// 28. B3C recommendation matrix: country/region/settlement/district -> strong;
// world/continent/street/building/transport -> recommend; room/natural_place/other -> none.
assert.equal(locationModuleRecommendation("populationCulture","country"),"strong");
assert.equal(locationModuleRecommendation("populationCulture","region"),"strong");
assert.equal(locationModuleRecommendation("populationCulture","settlement"),"strong");
assert.equal(locationModuleRecommendation("populationCulture","district"),"strong");
assert.equal(locationModuleRecommendation("populationCulture","world"),"recommend");
assert.equal(locationModuleRecommendation("populationCulture","continent"),"recommend");
assert.equal(locationModuleRecommendation("populationCulture","street"),"recommend");
assert.equal(locationModuleRecommendation("populationCulture","building"),"recommend");
assert.equal(locationModuleRecommendation("populationCulture","transport"),"recommend");
assert.equal(locationModuleRecommendation("populationCulture","room"),"none");
assert.equal(locationModuleRecommendation("populationCulture","natural_place"),"none");
assert.equal(locationModuleRecommendation("populationCulture","other"),"none");
assert.equal(locationModuleRecommendation("populationCulture",null),"none");

// 15. addEmptyLocationModule: adds to shown, removes from hidden if it was there (defensive).
assert.deepEqual(addEmptyLocationModule({},"geography"),{shown:["geography"],hidden:[]});
assert.deepEqual(addEmptyLocationModule({hidden:["geography"]},"geography"),{shown:["geography"],hidden:[]});
assert.deepEqual(addEmptyLocationModule({shown:["geography"]},"geography"),{shown:["geography"],hidden:[]},"adding an already-shown module is idempotent");

// 16. removeEmptyLocationModule: drops from shown only, never touches hidden.
assert.deepEqual(removeEmptyLocationModule({shown:["appearanceAtmosphere"],hidden:["geography"]},"appearanceAtmosphere"),{shown:[],hidden:["geography"]});

// 17. hideLocationModule: adds to hidden, drops from shown.
assert.deepEqual(hideLocationModule({shown:["geography"]},"geography"),{shown:[],hidden:["geography"]});
assert.deepEqual(hideLocationModule({},"geography"),{shown:[],hidden:["geography"]});

// 18. showLocationModule (restore a hidden populated module): removes from hidden, NEVER adds to
// shown -- hasData already implies visible once restored.
assert.deepEqual(showLocationModule({hidden:["geography"]},"geography"),{shown:[],hidden:[]});
assert.deepEqual(showLocationModule({shown:["appearanceAtmosphere"],hidden:["geography"]},"geography"),{shown:["appearanceAtmosphere"],hidden:[]});

// 19. deleteLocationModuleSelectionEntry: strips from both arrays unconditionally.
assert.deepEqual(deleteLocationModuleSelectionEntry({shown:["geography"],hidden:["geography"]},"geography"),{shown:[],hidden:[]});
assert.deepEqual(deleteLocationModuleSelectionEntry({shown:["appearanceAtmosphere"]},"geography"),{shown:["appearanceAtmosphere"],hidden:[]});

// 20. dropRedundantShownEntries: a shown module that gained data is dropped from shown; hidden is
// untouched; a shown module that's STILL empty survives.
{
  const draftAfterFilling={baseProfile:{geography:{terrain:"Горы"}}};
  assert.deepEqual(dropRedundantShownEntries({shown:["appearanceAtmosphere","geography"],hidden:["geography"]},draftAfterFilling),
    {shown:["appearanceAtmosphere"],hidden:["geography"]},"geography dropped from shown (now has data); appearanceAtmosphere (still empty) survives; hidden untouched");
}

// 21. saveNeedsModuleSelectionWrite: true only when the NORMALIZED selection actually differs --
// a differently-ordered/duplicated resubmission of the same effective state needs no write.
assert.equal(saveNeedsModuleSelectionWrite({shown:["appearanceAtmosphere","geography"]},{shown:["geography","appearanceAtmosphere","geography"]}),false);
assert.equal(saveNeedsModuleSelectionWrite({shown:["geography"]},{hidden:["geography"]}),true);
assert.equal(saveNeedsModuleSelectionWrite(undefined,{shown:[],hidden:[]}),false);
assert.equal(saveNeedsModuleSelectionWrite(undefined,{shown:["geography"]}),true);

// ---------------------------------------------------------------------------
// History (Location History -- HYBRID IMPLEMENTATION): the ONE module whose hasData spans base_
// profile prose AND a separate events array -- hiding it must hide both together, per the task
// brief ("Do NOT create a second visibility system for events").
// ---------------------------------------------------------------------------

// 29. hasData: empty prose AND no events -> false. Prose alone, events alone, or both -> true.
assert.equal(locationModuleHasData({baseProfile:{}},"history"),false);
assert.equal(locationModuleHasData({baseProfile:{},historyEvents:[]},"history"),false);
assert.equal(locationModuleHasData({baseProfile:{history:{origin:"   "}},historyEvents:[]},"history"),false,"whitespace-only prose still counts as empty");
assert.equal(locationModuleHasData({baseProfile:{history:{origin:"Основан беженцами."}}},"history"),true,"prose alone is enough");
assert.equal(locationModuleHasData({baseProfile:{},historyEvents:[{id:"e1",title:"Пожар"}]},"history"),true,"events alone are enough, with zero prose");
assert.equal(locationModuleHasData({baseProfile:{history:{legends:"Дракон спит под городом."}},historyEvents:[{id:"e1",title:"Пожар"}]},"history"),true,"both together");
assert.equal(locationModuleHasData(undefined,"history"),false);
assert.equal(locationModuleHasData({baseProfile:{history:{}},historyEvents:"not-an-array"},"history"),false,"a malformed historyEvents value must never throw or count as data");

// 30. Read/edit visibility: hiding history hides the WHOLE section (prose and events together) --
// exercised through the exact same generic visibility functions every other module uses, with no
// history-specific branch in either of them.
{
  const eventsOnlyLocation={baseProfile:{},historyEvents:[{id:"e1",title:"Пожар"}]};
  assert.equal(locationModuleReadVisible(eventsOnlyLocation,{},"history"),true,"events-only history is read-visible when not hidden");
  assert.equal(locationModuleReadVisible(eventsOnlyLocation,{hidden:["history"]},"history"),false,"hiding history hides the events too, not just prose");
  assert.equal(locationModuleEditVisible(eventsOnlyLocation,{hidden:["history"]},"history"),false);
  const proseOnlyLocation={baseProfile:{history:{origin:"X"}},historyEvents:[]};
  assert.equal(locationModuleReadVisible(proseOnlyLocation,{hidden:["history"]},"history"),false,"hiding history hides prose-only History too");
}

// 31. Catalog/candidates include history like any other module.
{
  const location={baseProfile:{history:{origin:"X"}}};
  assert.deepEqual(locationVisibleModules(location,{},{mode:"edit"}),["history"]);
}

// 32. History recommendation matrix, per the implementation brief: country/region/settlement/
// district/building -> strong; world/continent/street/natural_place/transport -> recommend;
// room/other -> none.
assert.equal(locationModuleRecommendation("history","country"),"strong");
assert.equal(locationModuleRecommendation("history","region"),"strong");
assert.equal(locationModuleRecommendation("history","settlement"),"strong");
assert.equal(locationModuleRecommendation("history","district"),"strong");
assert.equal(locationModuleRecommendation("history","building"),"strong");
assert.equal(locationModuleRecommendation("history","world"),"recommend");
assert.equal(locationModuleRecommendation("history","continent"),"recommend");
assert.equal(locationModuleRecommendation("history","street"),"recommend");
assert.equal(locationModuleRecommendation("history","natural_place"),"recommend");
assert.equal(locationModuleRecommendation("history","transport"),"recommend");
assert.equal(locationModuleRecommendation("history","room"),"none");
assert.equal(locationModuleRecommendation("history","other"),"none");
assert.equal(locationModuleRecommendation("history",null),"none");

console.log("location-module-selection.test.mjs OK");
