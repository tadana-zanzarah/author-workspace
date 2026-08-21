import {
  STORAGE_KEY,
  UI_STORAGE_KEY,
  CLOUD_PROJECT_STORAGE_PREFIX,
  CLOUD_PROJECT_UI_STORAGE_PREFIX
} from "./constants.js";

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let activeCloudProjectId=null;

function assertCloudProjectId(projectId){
  if(!UUID_PATTERN.test(String(projectId||"")))throw new TypeError("Некорректный ID облачного проекта.");
  return String(projectId).toLowerCase();
}
function projectWorkspaceKey(projectId){return `${CLOUD_PROJECT_STORAGE_PREFIX}${assertCloudProjectId(projectId)}`}
function projectUiKey(projectId){return `${CLOUD_PROJECT_UI_STORAGE_PREFIX}${assertCloudProjectId(projectId)}`}
function activateCloudWorkspace(projectId){activeCloudProjectId=assertCloudProjectId(projectId);return activeWorkspaceContext()}
function activateLegacyWorkspace(){activeCloudProjectId=null;return activeWorkspaceContext()}
function activeWorkspaceContext(){
  return activeCloudProjectId
    ?{projectId:activeCloudProjectId,storageKey:projectWorkspaceKey(activeCloudProjectId),uiStorageKey:projectUiKey(activeCloudProjectId),legacy:false}
    :{projectId:null,storageKey:STORAGE_KEY,uiStorageKey:UI_STORAGE_KEY,legacy:true};
}
function hasLegacyWorkspace(storage=globalThis.localStorage){
  try{return storage.getItem(STORAGE_KEY)!==null}catch{return false}
}

Object.assign(globalThis,{projectWorkspaceKey,projectUiKey,activateCloudWorkspace,activateLegacyWorkspace,activeWorkspaceContext,hasLegacyWorkspace});
export {projectWorkspaceKey,projectUiKey,activateCloudWorkspace,activateLegacyWorkspace,activeWorkspaceContext,hasLegacyWorkspace};
