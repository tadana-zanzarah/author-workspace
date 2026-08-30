export const STORAGE_KEY="novelTimelineV11";
export const UI_STORAGE_KEY="novelTimelineV11_ui";
export const CLOUD_PROJECT_STORAGE_PREFIX="authorWorkspace:project:";
export const CLOUD_PROJECT_UI_STORAGE_PREFIX="authorWorkspace:project-ui:";
export const LAST_OPEN_PROJECT_STORAGE_PREFIX="authorWorkspace:last-project:";
export const OLD_KEYS=["novelTimelineV10","novelTimelineV9","novelTimelineV8","novelTimelineV7","novelTimelineV4","novelTimelineV3","novelTimelineV2","novelTimelineV1"];
export const WRITING_STATUSES=[
  {id:"idea",label:"Идея"},
  {id:"plan",label:"План"},
  {id:"draft",label:"Черновик"},
  {id:"edit1",label:"Первая редактура"},
  {id:"edit2",label:"Вторая редактура"},
  {id:"final",label:"Финал"}
];
Object.assign(globalThis,{STORAGE_KEY,UI_STORAGE_KEY,CLOUD_PROJECT_STORAGE_PREFIX,CLOUD_PROJECT_UI_STORAGE_PREFIX,LAST_OPEN_PROJECT_STORAGE_PREFIX,OLD_KEYS,WRITING_STATUSES});
