// Location Phase B3A -- pure normalization/patch-building logic (js/location-base-profile.js).
// Mirrors the server-side three-state contract (supabase/migrations/20260904130000_location_
// base_profile_modules.sql): unchanged module omitted from patch, changed module replaced
// wholesale, cleared module -> JSON null, individual field removal drops the old field entirely.
import assert from "node:assert/strict";
import {
  normalizeAppearanceAtmosphere,normalizeGeography,isModuleEmpty,
  buildLocationBaseProfilePatch,applyLocationBaseProfilePatch
} from "../js/location-base-profile.js";

// 1. completely empty Appearance -> empty normalized module
assert.deepEqual(normalizeAppearanceAtmosphere({}),{});
assert.deepEqual(normalizeAppearanceAtmosphere(undefined),{});
assert.ok(isModuleEmpty(normalizeAppearanceAtmosphere({})));

// 2. whitespace-only values removed
assert.deepEqual(normalizeAppearanceAtmosphere({visualDescription:"   ",atmosphere:"\t\n ",sounds:""}),{});

// 3. blank array entries removed
assert.deepEqual(normalizeAppearanceAtmosphere({notableFeatures:["","  ","Резной трон","Резной трон"]}),{notableFeatures:["Резной трон"]});

// 4. populated Appearance normalized (trims, keeps only non-empty fields, in fixed key order)
assert.deepEqual(
  normalizeAppearanceAtmosphere({
    visualDescription:"  Каменные стены  ",atmosphere:"Тяжёлая тишина",sounds:"",smells:"  ",
    lighting:"Тусклый свет факелов",climateFeel:"",notableFeatures:["  Трещина в потолке  ","Алтарь"]
  }),
  {visualDescription:"Каменные стены",atmosphere:"Тяжёлая тишина",lighting:"Тусклый свет факелов",notableFeatures:["Трещина в потолке","Алтарь"]}
);

// 5. populated Geography normalized
assert.deepEqual(
  normalizeGeography({terrain:"  Горы  ",climate:"Холодный",water:"",vegetation:"",coordinates:"45N 12E",area:"",elevation:"2000 м",access:"",naturalFeatures:["Ледник",""]}),
  {terrain:"Горы",climate:"Холодный",coordinates:"45N 12E",elevation:"2000 м",naturalFeatures:["Ледник"]}
);

// 6. unchanged module omitted from patch (geography changes, appearance does not)
{
  const original={appearanceAtmosphere:{atmosphere:"Спокойно"},geography:{terrain:"Горы"}};
  const draft={appearanceAtmosphere:{atmosphere:"Спокойно"},geography:{terrain:"Горы",climate:"Холодный"}};
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:original.appearanceAtmosphere,originalGeography:original.geography,
    draftAppearance:draft.appearanceAtmosphere,draftGeography:draft.geography
  });
  assert.ok(patch);
  assert.ok(!("appearanceAtmosphere" in patch),"unchanged Appearance must be omitted from the patch entirely");
  assert.deepEqual(patch.geography,{terrain:"Горы",climate:"Холодный"});
}

// 7. changed module included
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{},originalGeography:{},
    draftAppearance:{atmosphere:"Гулкое эхо"},draftGeography:{}
  });
  assert.ok(patch);
  assert.deepEqual(patch.appearanceAtmosphere,{atmosphere:"Гулкое эхо"});
}

// 8. cleared module -> JSON null
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{atmosphere:"Гулкое эхо"},originalGeography:{},
    draftAppearance:{atmosphere:"   "},draftGeography:{}
  });
  assert.ok(patch);
  assert.equal(patch.appearanceAtmosphere,null,"a module cleared down to zero fields must patch as JSON null, not {}");
}

// 9. individual field removal produces full replacement without the old field
{
  const original={terrain:"Горы",climate:"Холодный"};
  const draft={terrain:"Горы",climate:""}; // user cleared just "climate"
  const patch=buildLocationBaseProfilePatch({originalAppearance:{},originalGeography:original,draftAppearance:{},draftGeography:draft});
  assert.deepEqual(patch.geography,{terrain:"Горы"});
  assert.ok(!("climate" in patch.geography),"cleared field must be entirely absent from the replacement object, not sent as an empty string");
}

// 10. Appearance change preserves Geography by omitting the Geography key
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{},originalGeography:{terrain:"Горы"},
    draftAppearance:{atmosphere:"Напряжённо"},draftGeography:{terrain:"Горы"}
  });
  assert.ok("appearanceAtmosphere" in patch);
  assert.ok(!("geography" in patch),"unrelated unchanged Geography must not appear in the patch at all");
}

// 11. Geography change preserves Appearance by omitting the Appearance key
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{atmosphere:"Напряжённо"},originalGeography:{},
    draftAppearance:{atmosphere:"Напряжённо"},draftGeography:{terrain:"Горы"}
  });
  assert.ok("geography" in patch);
  assert.ok(!("appearanceAtmosphere" in patch),"unrelated unchanged Appearance must not appear in the patch at all");
}

// 12. both changed -> both keys
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{},originalGeography:{},
    draftAppearance:{atmosphere:"Напряжённо"},draftGeography:{terrain:"Горы"}
  });
  assert.ok("appearanceAtmosphere" in patch&&"geography" in patch);
}

// 13. both unchanged -> no patch at all (null, not {})
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{atmosphere:"Напряжённо"},originalGeography:{terrain:"Горы"},
    draftAppearance:{atmosphere:"  Напряжённо  "},draftGeography:{terrain:"Горы",climate:""} // whitespace/blank-key noise only
  });
  assert.equal(patch,null,"a semantic no-op (whitespace/blank-field noise only) must produce no patch");
}

// applyLocationBaseProfilePatch: local-mode mirror of the server's patch-application loop.
assert.deepEqual(applyLocationBaseProfilePatch({description:"D",geography:{terrain:"Горы"}},{geography:null}),{description:"D"});
assert.deepEqual(applyLocationBaseProfilePatch({description:"D"},{geography:{terrain:"Горы"}}),{description:"D",geography:{terrain:"Горы"}});
assert.deepEqual(applyLocationBaseProfilePatch({description:"D",appearanceAtmosphere:{atmosphere:"X"}},{geography:{terrain:"Горы"}}),{description:"D",appearanceAtmosphere:{atmosphere:"X"},geography:{terrain:"Горы"}},"a key absent from the patch must be left untouched");
assert.deepEqual(applyLocationBaseProfilePatch(undefined,{geography:{terrain:"Горы"}}),{geography:{terrain:"Горы"}});
assert.deepEqual(applyLocationBaseProfilePatch({description:"D"},null),{description:"D"},"a null patch must be a no-op");

console.log("location-base-profile unit tests: OK");
