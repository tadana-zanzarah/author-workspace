const initialState={
  storageWriteEnabled:true,startupLoadInfo:null,data:null,editingSceneId:null,
  insertBeforeSceneId:null,insertChapterId:null,draggedSceneId:null,
  textEditingSceneId:null,profileEditingId:null,profileDraftCharacter:null,profileDraftPhotos:[],
  sceneTagDraft:[],sceneNewTagDraft:{},selectedSceneIndex:null,selectedSceneId:null,
  filters:{search:"",chapter:"",character:"",location:"",tag:"",writing:"",placement:""},
  currentView:"table",infoPanelCollapsed:true,navigationVisible:true,
  renderQueued:false,quickFieldState:null,sortDraggedSceneId:null,searchTimer:null
};
for(const [name,value] of Object.entries(initialState)){
  Object.defineProperty(globalThis,name,{configurable:true,enumerable:false,writable:true,value});
}
export const appState=initialState;
