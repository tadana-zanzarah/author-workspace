/* Location Phase B2: centralized type-preset vocabulary + Russian display labels.
 * type_preset is preset-plus-custom-label (see Phase 3 migration header), never a rigid
 * enum: NULL means "not specified" and must never be silently coerced to "other". Every
 * place in the UI that needs a human label for a Location's type reads it from here instead
 * of hard-coding strings inline, so the wording only ever needs to change in one place. */

const LOCATION_TYPE_PRESETS=[
  {value:"world",label:"Мир"},
  {value:"continent",label:"Континент"},
  {value:"country",label:"Страна"},
  {value:"region",label:"Регион"},
  {value:"settlement",label:"Населённый пункт"},
  {value:"district",label:"Район"},
  {value:"street",label:"Улица"},
  {value:"building",label:"Здание"},
  {value:"room",label:"Помещение"},
  {value:"natural_place",label:"Природное место"},
  {value:"transport",label:"Транспорт / транспортный объект"},
  {value:"other",label:"Другое"}
];

const LOCATION_TYPE_LABELS=Object.fromEntries(LOCATION_TYPE_PRESETS.map(p=>[p.value,p.label]));

function locationTypePresetLabel(typePreset){
  return LOCATION_TYPE_LABELS[typePreset]||null;
}

// Preset drives broad semantics; a custom label drives display specificity. A custom label
// wins for DISPLAY (e.g. type_preset=settlement + custom_type_label="Столица" shows
// "Столица"), but the preset itself is never overwritten/ignored -- callers that need the
// broad category (filtering/grouping) must keep reading location.typePreset directly.
function locationDisplayTypeLabel(location){
  const custom=(location?.customTypeLabel||"").trim();
  if(custom)return custom;
  return locationTypePresetLabel(location?.typePreset)||null;
}

Object.assign(globalThis,{LOCATION_TYPE_PRESETS,LOCATION_TYPE_LABELS,locationTypePresetLabel,locationDisplayTypeLabel});
export {LOCATION_TYPE_PRESETS,LOCATION_TYPE_LABELS,locationTypePresetLabel,locationDisplayTypeLabel};
