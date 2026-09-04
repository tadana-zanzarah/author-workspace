// Location Phase B3A -- pure normalization/patch-building logic (js/location-base-profile.js).
// Mirrors the server-side three-state contract (supabase/migrations/20260904130000_location_
// base_profile_modules.sql): unchanged module omitted from patch, changed module replaced
// wholesale, cleared module -> JSON null, individual field removal drops the old field entirely.
import assert from "node:assert/strict";
import {
  normalizeAppearanceAtmosphere,normalizeGeography,normalizeGovernmentSociety,normalizeEconomy,normalizePopulationCulture,isModuleEmpty,
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

// B3B: governmentSociety/economy normalization -- same generic contract, different field lists.

// 14. completely empty / whitespace-only -> empty normalized module
assert.deepEqual(normalizeGovernmentSociety({}),{});
assert.deepEqual(normalizeGovernmentSociety(undefined),{});
assert.deepEqual(normalizeGovernmentSociety({governmentForm:"   ",leadership:"\t",politicalSituation:"",lawsAndRules:"  "}),{});
assert.deepEqual(normalizeEconomy({}),{});
assert.deepEqual(normalizeEconomy({currency:"  ",economicCharacter:"",costOfLiving:"\n"}),{});

// 15. blank/duplicate array entries removed, case-insensitive dedupe (shared normalizeMultiValue).
assert.deepEqual(normalizeGovernmentSociety({securityForces:["","  ","Городская стража","городская стража"]}),{securityForces:["Городская стража"]});
assert.deepEqual(normalizeEconomy({scarcity:["Чистая вода","","чистая вода"]}),{scarcity:["Чистая вода"]});

// 16. populated governmentSociety normalized: trims, keeps only non-empty fields, fixed key order.
assert.deepEqual(
  normalizeGovernmentSociety({
    governmentForm:"  Монархия  ",leadership:"Король Эдмунд III",politicalSituation:"",lawsAndRules:"Комендантский час с 22:00",
    securityForces:["  Королевская гвардия  "],notableInstitutions:[]
  }),
  {governmentForm:"Монархия",leadership:"Король Эдмунд III",lawsAndRules:"Комендантский час с 22:00",securityForces:["Королевская гвардия"]}
);

// 17. populated economy normalized.
assert.deepEqual(
  normalizeEconomy({
    currency:"Кроны",economicCharacter:"",industries:["Сельское хозяйство","  Рыболовство  "],
    costOfLiving:"Дёшево",scarcity:[],tradeConnections:["Морской путь на юг"]
  }),
  {currency:"Кроны",costOfLiving:"Дёшево",industries:["Сельское хозяйство","Рыболовство"],tradeConnections:["Морской путь на юг"]}
);

// 18. buildLocationBaseProfilePatch: all four modules coexist -- editing governmentSociety must
// not disturb appearanceAtmosphere/geography/economy, and vice versa (extends test 12 to 4 keys).
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{},originalGeography:{terrain:"Горы"},originalGovernmentSociety:{},originalEconomy:{currency:"Кроны"},
    draftAppearance:{},draftGeography:{terrain:"Горы"},draftGovernmentSociety:{leadership:"Совет"},draftEconomy:{currency:"Кроны"}
  });
  assert.ok(patch);
  assert.deepEqual(Object.keys(patch),["governmentSociety"],"only the actually-changed module (governmentSociety) appears in the patch");
  assert.deepEqual(patch.governmentSociety,{leadership:"Совет"});
}

// 19. clearing governmentSociety to empty -> JSON null, geography/economy untouched/omitted.
{
  const patch=buildLocationBaseProfilePatch({
    originalGovernmentSociety:{leadership:"Совет"},originalEconomy:{currency:"Кроны"},
    draftGovernmentSociety:{leadership:"   "},draftEconomy:{currency:"Кроны"}
  });
  assert.ok(patch);
  assert.equal(patch.governmentSociety,null);
  assert.ok(!("economy" in patch),"unchanged economy must not appear in the patch");
  assert.ok(!("appearanceAtmosphere" in patch)&&!("geography" in patch),"omitted B3A args must normalize to unchanged, not spuriously appear");
}

// 20. omitting governmentSociety/economy args entirely (pre-B3B call shape) still works -- both
// normalize to {} on both sides, so they're simply absent from the patch, never treated as changed.
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{},originalGeography:{},
    draftAppearance:{atmosphere:"Напряжённо"},draftGeography:{}
  });
  assert.ok(patch);
  assert.deepEqual(Object.keys(patch),["appearanceAtmosphere"]);
}

// B3C: populationCulture normalization -- same generic contract, seven fields (three prose, four
// chip lists), deliberately no numeric/statistical fields.

// 21. completely empty / whitespace-only -> empty normalized module.
assert.deepEqual(normalizePopulationCulture({}),{});
assert.deepEqual(normalizePopulationCulture(undefined),{});
assert.deepEqual(normalizePopulationCulture({populationCharacter:"   ",customsAndTraditions:"\t",socialNorms:""}),{});
assert.ok(isModuleEmpty(normalizePopulationCulture({})));

// 22. blank/duplicate array entries removed, case-insensitive dedupe (shared normalizeMultiValue).
assert.deepEqual(normalizePopulationCulture({peoplesAndGroups:["","  ","Портовые грузчики","портовые грузчики"]}),{peoplesAndGroups:["Портовые грузчики"]});
assert.deepEqual(normalizePopulationCulture({languages:["Общий","","общий"]}),{languages:["Общий"]});
assert.deepEqual(normalizePopulationCulture({holidays:["День города","День города"]}),{holidays:["День города"]});
assert.deepEqual(normalizePopulationCulture({beliefs:["Вера моряков","  "]}),{beliefs:["Вера моряков"]});

// 23. populated populationCulture normalized: trims, keeps only non-empty fields, fixed key order.
assert.deepEqual(
  normalizePopulationCulture({
    populationCharacter:"  Космополитичный порт  ",peoplesAndGroups:["Докеры","  Северная диаспора  "],
    languages:["Общий"],customsAndTraditions:"",holidays:[],beliefs:["Вера моряков"],socialNorms:"Не свистеть на пришвартованном корабле."
  }),
  {populationCharacter:"Космополитичный порт",peoplesAndGroups:["Докеры","Северная диаспора"],languages:["Общий"],beliefs:["Вера моряков"],socialNorms:"Не свистеть на пришвартованном корабле."}
);

// 24. buildLocationBaseProfilePatch: populationCulture coexists with all four existing modules --
// editing it must not disturb appearanceAtmosphere/geography/governmentSociety/economy.
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{},originalGeography:{terrain:"Горы"},originalGovernmentSociety:{},originalEconomy:{currency:"Кроны"},originalPopulationCulture:{},
    draftAppearance:{},draftGeography:{terrain:"Горы"},draftGovernmentSociety:{},draftEconomy:{currency:"Кроны"},draftPopulationCulture:{socialNorms:"Не шуметь ночью."}
  });
  assert.ok(patch);
  assert.deepEqual(Object.keys(patch),["populationCulture"],"only the actually-changed module (populationCulture) appears in the patch");
  assert.deepEqual(patch.populationCulture,{socialNorms:"Не шуметь ночью."});
}

// 25. clearing populationCulture to empty -> JSON null, other modules untouched/omitted.
{
  const patch=buildLocationBaseProfilePatch({
    originalPopulationCulture:{socialNorms:"Не шуметь ночью."},originalEconomy:{currency:"Кроны"},
    draftPopulationCulture:{socialNorms:"   "},draftEconomy:{currency:"Кроны"}
  });
  assert.ok(patch);
  assert.equal(patch.populationCulture,null);
  assert.ok(!("economy" in patch),"unchanged economy must not appear in the patch");
  assert.ok(!("appearanceAtmosphere" in patch)&&!("geography" in patch)&&!("governmentSociety" in patch),"omitted args must normalize to unchanged, not spuriously appear");
}

// 26. omitting populationCulture args entirely (pre-B3C call shape) still works -- normalizes to {}
// on both sides, so it's simply absent from the patch, never treated as changed.
{
  const patch=buildLocationBaseProfilePatch({
    originalAppearance:{},originalGeography:{},
    draftAppearance:{atmosphere:"Напряжённо"},draftGeography:{}
  });
  assert.ok(patch);
  assert.deepEqual(Object.keys(patch),["appearanceAtmosphere"]);
}

// applyLocationBaseProfilePatch: local-mode mirror of the server's patch-application loop.
assert.deepEqual(applyLocationBaseProfilePatch({description:"D",geography:{terrain:"Горы"}},{geography:null}),{description:"D"});
assert.deepEqual(applyLocationBaseProfilePatch({description:"D"},{geography:{terrain:"Горы"}}),{description:"D",geography:{terrain:"Горы"}});
assert.deepEqual(applyLocationBaseProfilePatch({description:"D",appearanceAtmosphere:{atmosphere:"X"}},{geography:{terrain:"Горы"}}),{description:"D",appearanceAtmosphere:{atmosphere:"X"},geography:{terrain:"Горы"}},"a key absent from the patch must be left untouched");
assert.deepEqual(applyLocationBaseProfilePatch(undefined,{geography:{terrain:"Горы"}}),{geography:{terrain:"Горы"}});
assert.deepEqual(applyLocationBaseProfilePatch({description:"D"},null),{description:"D"},"a null patch must be a no-op");

console.log("location-base-profile unit tests: OK");
