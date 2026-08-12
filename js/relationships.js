function relationshipsBefore(sceneIndex){
  const state={};
  data.characters.forEach(character=>{
    state[character.id]={...((data.profiles?.[character.id]?.initialRelations)||{})};
  });
  for(let i=0;i<sceneIndex;i++){
    const scene=data.scenes[i];
    for(const [fromId,p] of Object.entries(scene.people||{})){
      state[fromId] ||= {};
      for(const [toId,value] of Object.entries(p.relationChanges||{})){
        if(value==="")delete state[fromId][toId];
        else state[fromId][toId]=value;
      }
    }
  }
  return state;
}

function relationshipsAt(sceneIndex){
  const state=relationshipsBefore(sceneIndex);
  const scene=data.scenes[sceneIndex];
  if(scene){
    for(const [fromId,p] of Object.entries(scene.people||{})){
      state[fromId] ||= {};
      for(const [toId,value] of Object.entries(p.relationChanges||{})){
        if(value==="")delete state[fromId][toId];
        else state[fromId][toId]=value;
      }
    }
  }
  return state;
}

function personHasContent(p){
  return !!(p&&(
    (p.action||"").trim() ||
    Object.keys(p.relationChanges||{}).length ||
    (p.visibleRelations||[]).length ||
    (p.legacyState||"").trim()
  ));
}

function renderInitialRelations(initial,characterId){
  document.getElementById("profileInitialRelations").innerHTML=data.characters
    .filter(other=>other.id!==characterId)
    .map(other=>`<div class="initial-relation-row">
      <strong>${esc(other.name)}</strong>
      <input class="initial-rel-input" aria-label="Отношение с персонажем ${esc(other.name)}" data-target-id="${esc(other.id)}"
        value="${esc(initial[other.id]||"")}"
        placeholder="Отношение на начало истории; пусто — не задано">
    </div>`).join("");
}

Object.assign(globalThis,{relationshipsBefore,relationshipsAt,personHasContent,renderInitialRelations});
export {relationshipsBefore,relationshipsAt,personHasContent,renderInitialRelations};
