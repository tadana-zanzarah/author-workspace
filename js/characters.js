function characterById(id){return data.characters.find(c=>c.id===id)}

function cropImageStyle(crop){
  // transform-origin must track object-position: anchoring the zoom at a fixed
  // center (instead of at the panned point) leaves the image's edges permanently
  // unreachable once zoom>1, since scaling around the viewport center shrinks the
  // usable pan range instead of extending it toward the true image bounds.
  const x=crop.x*100,y=crop.y*100;
  return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;transform:scale(${crop.zoom})`;
}

function nextCharacterSortOrder(){
  return data.characters.reduce((max,c)=>Math.max(max,Number(c.sortOrder)||0),0)+1000;
}

function computeInsertSortOrder(neighbors,targetIndex){
  const before=neighbors[targetIndex-1]?.sortOrder,after=neighbors[targetIndex]?.sortOrder;
  if(before==null&&after==null)return 1000;
  if(before==null)return after-1000;
  if(after==null)return before+1000;
  const mid=(before+after)/2;
  return mid>before&&mid<after?mid:null;
}

async function reorderCharacterTo(characterId,beforeCharacterId){
  const fromIndex=data.characters.findIndex(c=>c.id===characterId);
  if(fromIndex<0||characterId===beforeCharacterId)return {ok:true,unchanged:true};
  const moved=data.characters[fromIndex];
  const others=data.characters.filter(c=>c.id!==characterId);
  const targetIndex=beforeCharacterId?others.findIndex(c=>c.id===beforeCharacterId):others.length;
  if(beforeCharacterId&&targetIndex<0)return {ok:false};
  if(!isCloudWorkspace()){
    const proposed=[...others];proposed.splice(targetIndex,0,moved);
    if(proposed.every((c,i)=>c.id===data.characters[i].id))return {ok:true,unchanged:true};
    const result=commitDataChange(next=>{
      const idx=next.characters.findIndex(c=>c.id===characterId);
      const [item]=next.characters.splice(idx,1);
      let insertAt=beforeCharacterId?next.characters.findIndex(c=>c.id===beforeCharacterId):next.characters.length;
      if(insertAt<0)insertAt=next.characters.length;
      next.characters.splice(insertAt,0,item);
    },{renderAfter:false});
    if(result.ok){renderProfiles();render()}
    return result;
  }
  const proposed=[...others];proposed.splice(targetIndex,0,moved);
  if(proposed.every((c,i)=>c.id===data.characters[i].id))return {ok:true,unchanged:true};
  let newSortOrder=computeInsertSortOrder(others,targetIndex);
  if(newSortOrder==null){
    for(let i=0;i<proposed.length;i++){
      const character=proposed[i],want=(i+1)*1000;
      if(Number(character.sortOrder)===want)continue;
      const result=await runCloudMutation("reorderProjectCharacter",(_api,revision)=>cloudState.characterApi.updateProjectCharacter(cloudProjectSync.projectId,character.projectCharacterId,revision,{overrides:character.projectOverrides||{},role:character.role,sortOrder:want}),{renderAfter:false});
      if(!result.ok)return result;
    }
    data=cloudProjectSync.confirmedProject;renderProfiles();render();return {ok:true};
  }
  const result=await runCloudMutation("reorderProjectCharacter",(_api,revision)=>cloudState.characterApi.updateProjectCharacter(cloudProjectSync.projectId,moved.projectCharacterId,revision,{overrides:moved.projectOverrides||{},role:moved.role,sortOrder:newSortOrder}),{renderAfter:false});
  if(result.ok){data=cloudProjectSync.confirmedProject;renderProfiles();render()}
  return result;
}

function characterName(id){return characterById(id)?.name||"Неизвестный персонаж"}

// #profilesGrid is flex:1 inside #charsModal's fixed-height flex column (see
// css/profiles.css), so its own clientHeight IS the real available gallery
// viewport — whatever the title/footer/padding chrome actually measures out
// to, not a guessed "100vh minus N px" formula. Cards read this via the
// --profile-card-h custom property instead of hardcoding a height.
function updateProfileGalleryCardHeight(){
  const grid=document.getElementById("profilesGrid");
  if(!grid)return;
  const available=grid.clientHeight;
  if(available<=0)return;
  const safeGap=16;
  grid.style.setProperty("--profile-card-h",`${Math.min(760,Math.max(0,available-safeGap))}px`);
}

function renderProfiles(){
  data.profiles ||= {};
  data.characters.forEach(character=>{
    data.profiles[character.id]=normalizeProfile(data.profiles[character.id],character);
  });
  document.getElementById("profilesGrid").innerHTML=data.characters.map((character,index)=>{
    const p=data.profiles[character.id];
    const full=[p.name||character.name,p.surname].filter(Boolean).join(" ");
    const facts=[
      ["Раса",profileDisplayValue(p,"race")],["Пол",profileDisplayValue(p,"sex")],
      ["Вторичный пол",profileDisplayValue(p,"secondarySex")],["Возраст",profileDisplayValue(p,"age")],
      ["Дата рождения",birthdayDisplay(p)],["Знак зодиака",profileDisplayValue(p,"zodiac")],
      ["Цвет глаз",profileDisplayValue(p,"eyeColor")],["Цвет волос",profileDisplayValue(p,"hairColor")],
      ["Рост",profileDisplayValue(p,"height")],["Телосложение",profileDisplayValue(p,"build")],
      ["Занятость",profileDisplayValue(p,"profession")],["Ориентация",profileDisplayValue(p,"orientation")]
    ].filter(([,v])=>v!==null);
    const primary=p.photos.find(photo=>photo.id===p.primaryPhotoId)||p.photos[0];
    const structural=linksForCharacter(character.id,data.characterLinks||[]);
    const cover=primary?`<button type="button" class="profile-cover-button" aria-label="Открыть оригинальное изображение персонажа ${esc(full||character.name)}" onclick="openPhotoLightboxByCharacter('${jsq(character.id)}','${jsq(primary.id)}')"><img src="${esc(primary.source.value)}" alt="${esc(primary.alt||"")}" style="${cropImageStyle(primary.crop)}"></button>`:`Нет изображения`;
    return `<article class="profile-card" data-character-id="${esc(character.id)}" ondragover="characterDragOver(event,'${jsq(character.id)}')" ondragleave="characterDragLeave(event)" ondrop="characterDropProfile(event,'${jsq(character.id)}')" ondragend="characterDragEnd(event)">
      <div class="profile-drag-handle" draggable="true" aria-label="Перетащить персонажа ${esc(character.name)} для изменения порядка" ondragstart="characterDragStart(event,'${jsq(character.id)}')">↕</div>
      <div class="profile-cover">${cover}</div>
      <div class="profile-body">
        <div class="profile-name">${esc(full||character.name)}</div>
        <div class="profile-card-scroll">
          <div class="profile-facts">${facts.map(([k,v])=>`<div class="profile-fact"><strong>${k}:</strong> ${esc(v)}</div>`).join("")}</div>
          ${!p.hidden?.description&&p.description?`<div class="profile-description">${esc(p.description)}</div>`:""}
          ${structural.length?`<div class="profile-structural-summary"><strong>Связи:</strong>${structural.map(link=>{const other=link.fromCharacterId===character.id?link.toCharacterId:link.fromCharacterId;return `<div>${esc(characterName(other))} — ${esc(characterLinkDisplayLabel(link,character.id))}</div>`}).join("")}</div>`:""}
        </div>
        ${renderProfileAutomaticSection(character.id)}
        <div class="profile-card-actions">
          <button class="row-action-quiet" aria-label="Личная хронология: ${esc(character.name)}" title="Личная хронология" onclick="openCharacterTimeline('${jsq(character.id)}')"><svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><circle cx="8.3" cy="8.7" r="5.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8.3 6v3l2.2 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.6 2.6L3 2.4l.4 1.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button aria-label="Переместить персонажа ${esc(character.name)} влево" onclick="moveProfile('${jsq(character.id)}',-1)">←</button>
          <button aria-label="Переместить персонажа ${esc(character.name)} вправо" onclick="moveProfile('${jsq(character.id)}',1)">→</button>
          <span class="profile-card-actions-spacer" aria-hidden="true"></span>
          <button class="row-action-icon" aria-label="Редактировать анкету: ${esc(character.name)}" title="Редактировать" onclick="editProfile('${jsq(character.id)}')">✎</button>
          <button class="row-action-quiet danger-quiet" aria-label="Удалить персонажа ${esc(character.name)}" title="Удалить" onclick="deleteProfile('${jsq(character.id)}')">🗑</button>
        </div>
      </div>
    </article>`;
  }).join("")||'<div class="empty-work">Персонажей пока нет. Создайте первого персонажа, когда будете готовы.</div>';
}

function characterSceneEntries(characterId){
  return data.scenes.map((scene,index)=>({scene,index})).filter(x=>sceneHasParticipant(x.scene,characterId));
}

function characterLocations(characterId){
  const ids=new Set(characterSceneEntries(characterId).map(x=>x.scene.locationId).filter(Boolean));
  return [...ids].map(locationById).filter(Boolean);
}

function characterTags(characterId){
  const ids=new Set(characterSceneEntries(characterId).flatMap(x=>x.scene.tags));
  return [...ids].map(tagById).filter(Boolean);
}

function characterRelations(characterId){
  const result={...data.profiles?.[characterId]?.initialRelations};
  characterSceneEntries(characterId).forEach(({scene})=>{
    Object.entries(scene.people?.[characterId]?.relationChanges||{}).forEach(([target,value])=>{
      if(value)result[target]=value;else delete result[target];
    });
  });
  return result;
}

function renderProfileAutomaticSection(characterId){
  const entries=characterSceneEntries(characterId);
  const locations=characterLocations(characterId);
  const tags=characterTags(characterId);
  return `<div class="profile-auto">
    <div class="profile-auto-grid">
      <button class="profile-auto-card" onclick="setFilter('character','${jsq(characterId)}');hideModal('charsModal')"><strong>${entries.length}</strong>Все сцены</button>
      <button class="profile-auto-card" onclick="filterCharacterLocations('${jsq(characterId)}')"><strong>${locations.length}</strong>Локации</button>
      <button class="profile-auto-card" onclick="filterCharacterTags('${jsq(characterId)}')"><strong>${tags.length}</strong>Теги</button>
    </div>
  </div>`;
}

function filterCharacterLocations(characterId){
  const locations=characterLocations(characterId);hideModal("charsModal");
  filters.character=[characterId];
  if(locations.length===1)filters.location=locations[0].id;
  render();
}

function filterCharacterTags(characterId){
  const tags=characterTags(characterId);hideModal("charsModal");
  filters.character=[characterId];
  if(tags.length===1)filters.tag=[tags[0].id];
  render();
}

function openCharacterTimeline(characterId){
  const entries=characterSceneEntries(characterId);
  document.getElementById("characterTimelineTitle").textContent=`История персонажа: ${characterName(characterId)}`;
  document.getElementById("characterTimelineSummary").textContent=`${entries.length} сцен · ${entries.reduce((n,x)=>n+countWords(x.scene.sceneText),0)} слов`;
  document.getElementById("characterTimelineList").innerHTML=entries.map(({scene,index})=>{
    const chapter=chapterById(scene.chapterId),loc=locationById(scene.locationId),ws=writingStatusById(scene.writingStatus);
    return `<div class="timeline-entry" onclick="hideModal('characterTimelineModal');selectScene('${jsq(scene.id)}');currentView='list';render()">
      <div class="timeline-entry-title">${esc(scene.title||"Без названия")}</div>
      <div class="timeline-entry-meta">${esc(readableDate(scene)||"без даты")} · ${esc(chapter?.title||"Без главы")} · ${esc(loc?.name||"без локации")} · ${esc(ws.label)}</div>
    </div>`;
  }).join("")||'<div class="empty-work">У персонажа пока нет сцен.</div>';
  showModal("characterTimelineModal");
}

async function moveProfile(characterId,dir){
  const index=data.characters.findIndex(c=>c.id===characterId);
  const target=index+dir;
  if(index<0||target<0||target>=data.characters.length)return;
  if(isCloudWorkspace()){
    const moved=data.characters[index],other=data.characters[target],result=await runCloudMutation("reorderProjectCharacter",(_api,revision)=>cloudState.characterApi.updateProjectCharacter(cloudProjectSync.projectId,moved.projectCharacterId,revision,{overrides:moved.projectOverrides||{},role:moved.role,sortOrder:other.sortOrder}),{renderAfter:false});
    if(result.ok){data=cloudProjectSync.confirmedProject;renderProfiles();render()}return;
  }
  const result=commitDataChange(next=>{[next.characters[index],next.characters[target]]=[next.characters[target],next.characters[index]]},{renderAfter:false});
  if(result.ok){renderProfiles();render()}
}

async function deleteProfile(characterId){
  const character=characterById(characterId);
  if(!character)return;
  if(isCloudWorkspace()){
    let result=await runCloudMutation("removeProjectCharacter",(_api,revision)=>cloudState.characterApi.removeProjectCharacter(cloudProjectSync.projectId,character.projectCharacterId,revision),{renderAfter:false});
    if(!result.ok&&result.code==="DEPENDENCIES_EXIST"){
      const counts=result.dependencies||{},summary=Object.entries(counts).filter(([,value])=>Number(value)>0).map(([key,value])=>`${key}: ${value}`).join("; ");
      if(!confirm(`Персонаж используется в проекте (${summary}). Удалить участие и только проектные зависимости? Общий персонаж сохранится.`))return;
      result=await runCloudMutation("removeProjectCharacterCleanup",(_api,revision)=>cloudState.characterApi.removeProjectCharacter(cloudProjectSync.projectId,character.projectCharacterId,revision,{cleanupDependencies:true}),{renderAfter:false});
    }
    if(!result.ok)return;filters.character=filters.character.filter(id=>id!==characterId);data=cloudProjectSync.confirmedProject;renderProfiles();render();return;
  }
  const linkCount=linksForCharacter(characterId,data.characterLinks||[]).length;
  if(!confirm(`Удалить персонажа «${character.name}» из анкет и колонок? Данные этого персонажа в сценах также будут удалены.${linkCount?` Связанных структурных связей: ${linkCount}; они также будут удалены.`:""}`))return;
  const result=commitDataChange(next=>{
    next.characters=next.characters.filter(c=>c.id!==characterId);
    delete next.profiles[characterId];
    next.scenes.forEach(scene=>{
      delete scene.people?.[characterId];
      for(const p of Object.values(scene.people||{})){
        delete p.relationChanges?.[characterId];
        p.visibleRelations=(p.visibleRelations||[]).filter(id=>id!==characterId);
      }
    });
    for(const p of Object.values(next.profiles||{}))delete p.initialRelations?.[characterId];
    removeCharacterLinksForCharacter(next,characterId);
  },{renderAfter:false});
  if(!result.ok)return;
  filters.character=filters.character.filter(id=>id!==characterId);
  renderProfiles();render();
}

function setupBirthdaySelectors(){
  const month=document.getElementById("pf_birthMonth");
  const day=document.getElementById("pf_birthDay");
  if(!month.options.length){
    month.innerHTML='<option value="">Месяц не указан</option>'+
      Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
    day.innerHTML='<option value="">День не указан</option>'+
      Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
  }
}

function zodiacFor(month,day){
  month=Number(month);day=Number(day);
  if(!month||!day)return "";
  const signs=[
    [1,20,"Козерог","Водолей"],[2,19,"Водолей","Рыбы"],[3,21,"Рыбы","Овен"],
    [4,20,"Овен","Телец"],[5,21,"Телец","Близнецы"],[6,22,"Близнецы","Рак"],
    [7,23,"Рак","Лев"],[8,23,"Лев","Дева"],[9,23,"Дева","Весы"],
    [10,23,"Весы","Скорпион"],[11,22,"Скорпион","Стрелец"],[12,22,"Стрелец","Козерог"]
  ];
  const [,cut,before,after]=signs[month-1];
  return day<cut?before:after;
}

function updateZodiac(){
  document.getElementById("pf_zodiac").value=zodiacFor(
    document.getElementById("pf_birthMonth").value,
    document.getElementById("pf_birthDay").value
  );
}

function profileSaveScopeValue(){
  return document.querySelector('input[name="profileSaveScope"]:checked')?.value||"project";
}

function updateProfileScopeHelp(){
  const help=document.getElementById("profileScopeHelp");if(!help)return;
  help.textContent=profileSaveScopeValue()==="global"
    ?"Общие данные персонажа обновятся во всех проектах, где они не переопределены."
    :"Изменения будут действовать только в этом проекте.";
}

function setupSingleValueCombobox(field,datalistId){
  if(singleValueInputs[field])return;
  const host=document.getElementById(`pf_${field}_host`);if(!host)return;
  singleValueInputs[field]=createSingleValueCombobox({
    host,input:document.getElementById(`pf_${field}`),toggle:host.querySelector(".combobox-toggle"),list:document.getElementById(`pf_${field}_listbox`),
    suggestions:[...document.querySelectorAll(`#${datalistId} option`)].map(x=>x.value)
  });
}

function editProfile(characterId){
  return requestEditorTransition(()=>editProfileNow(characterId));
}

function editProfileNow(characterId){
  setupBirthdaySelectors();
  profileEditingId=characterId;
  const character=characterById(characterId)||profileDraftCharacter;if(!character||character.id!==characterId)return;
  const p=normalizeProfile(data.profiles?.[characterId],character);
  document.getElementById("cloudProfileScope").hidden=!isCloudWorkspace();document.getElementById("profileSaveScopeProject").checked=true;updateProfileScopeHelp();
  profileDraftPhotoFiles=new Map();profileDraftPhotos=safeOwnCopy(p.photos||[]);profileDraftPrimaryPhotoId=p.primaryPhotoId||profileDraftPhotos[0]?.id||"";profileDraftActivePhotoId=profileDraftPrimaryPhotoId;profileDraftCharacterLinks=safeOwnCopy(data.characterLinks||[]);
  document.getElementById("profileEditorTitle").textContent=p.name||character.name?`Анкета: ${p.name||character.name}`:"Новый персонаж";
  const values={
    name:p.name||character.name,surname:p.surname,race:p.race,sex:p.sex,secondarySex:p.secondarySex,
    age:p.age,height:p.height,build:p.build,eyeColor:p.eyeColor,hairColor:p.hairColor,hairstyle:p.hairstyle,
    profession:p.profession,orientation:p.orientation,
    character:p.character,features:p.features,
    description:p.description
  };
  for(const [key,value] of Object.entries(values)){
    const el=document.getElementById("pf_"+key);
    if(el)el.value=value??"";
  }
  multiValueInputs.favorites ||= createMultiValueCombobox({host:document.getElementById("pf_favorites"),suggestions:[...document.querySelectorAll("#foodOptions option")].map(x=>x.value),placeholder:"Добавить любимое значение…",label:"Любимая еда и напитки",onChange:syncBeforeUnload});
  multiValueInputs.hobbies ||= createMultiValueCombobox({host:document.getElementById("pf_hobbies"),suggestions:[...document.querySelectorAll("#hobbyOptions option")].map(x=>x.value),placeholder:"Добавить хобби…",label:"Хобби и увлечения",onChange:syncBeforeUnload});
  multiValueInputs.favorites.setValues(p.favorites);
  multiValueInputs.hobbies.setValues(p.hobbies);
  setupSingleValueCombobox("race","raceOptions");
  setupSingleValueCombobox("secondarySex","secondarySexOptions");
  setupSingleValueCombobox("build","buildOptions");
  setupSingleValueCombobox("eyeColor","eyeColorOptions");
  setupSingleValueCombobox("hairColor","hairColorOptions");
  setupSingleValueCombobox("hairstyle","hairstyleOptions");
  setupSingleValueCombobox("profession","professionOptions");
  setupSingleValueCombobox("orientation","orientationOptions");
  document.getElementById("pf_birthYear").value=p.birthday?.year||"";
  document.getElementById("pf_birthMonth").value=p.birthday?.month||"";
  document.getElementById("pf_birthDay").value=p.birthday?.day||"";
  updateZodiac();
  ["race","sex","secondarySex","age","birthday","zodiac","height","build","eyeColor","hairColor","hairstyle","profession",
   "orientation","favorites","hobbies","character","features","description"].forEach(key=>{
    document.getElementById("hide_"+key).checked=!!p.hidden?.[key];
  });
  renderProfilePhotos();
  renderInitialRelations(p.initialRelations||{},characterId);
  renderProfileCharacterLinks();
  showModal("profileEditorModal");
  trackerFor("profileEditorModal").captureInitialState();
  globalThis.profileSaveButton?.refresh();
}

function renderProfilePhotos(){
  // The resume photo column shows one dominant active/primary portrait
  // (.photo-item-primary) plus a narrow vertical rail (.photo-rail) beside
  // it — replacing the old vertical mini-gallery of stacked photo cards
  // with per-thumbnail action rows (nested vertical + horizontal
  // scrolling, tiny abbreviated buttons). The rail always renders (even
  // with 0-1 photos, where it's simply empty) so its width is reserved and
  // adding a 2nd photo never shifts anything beside it. Clicking a
  // thumbnail makes it the "active" photo; one shared action row underneath
  // the portrait then operates on whichever photo is active, instead of
  // rendering four controls under every thumbnail.
  if(!profileDraftPhotos.some(photo=>photo.id===profileDraftActivePhotoId)){
    profileDraftActivePhotoId=profileDraftPrimaryPhotoId||profileDraftPhotos[0]?.id||"";
  }
  const grid=document.getElementById("profilePhotosGrid");
  const active=draftPhoto(profileDraftActivePhotoId);
  if(!active){
    grid.innerHTML='<div class="photo-item-empty">Нет фото</div>';
    return;
  }
  const isPrimary=active.id===profileDraftPrimaryPhotoId;
  const rail=profileDraftPhotos.length<2?"":profileDraftPhotos.map((photo,i)=>{
    const isActive=photo.id===profileDraftActivePhotoId;
    const isPhotoPrimary=photo.id===profileDraftPrimaryPhotoId;
    return `<button type="button" class="photo-thumb${isActive?" photo-thumb-active":""}" data-photo-id="${esc(photo.id)}" role="option" aria-selected="${isActive}" aria-label="Фотография ${i+1}${isPhotoPrimary?" (главная)":""}" onclick="setActivePhoto('${jsq(photo.id)}')">
      <img src="${esc(photo.source.value)}" alt="" style="${cropImageStyle(photo.crop)}">
      ${isPhotoPrimary?'<span class="photo-thumb-primary-mark" aria-hidden="true">★</span>':""}
    </button>`;
  }).join("");
  const viewIcon='<svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.1 10.1L13.8 13.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const cropIcon='<svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path d="M4.5 1.3V11a1 1 0 001 1h9.2M1.3 4.5H11a1 1 0 011 1v9.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const starIcon='<svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path d="M8 2.3l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 10.9l-3.4 1.9.7-3.8-2.8-2.7 3.8-.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const trashIcon='<svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path d="M3.4 4.6h9.2M6.5 4.6V3.1a1 1 0 011-1h1a1 1 0 011 1v1.5M6.7 7.1v4.3M9.3 7.1v4.3M4.6 4.6l.6 7.8a1 1 0 001 .9h3.6a1 1 0 001-.9l.6-7.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  grid.innerHTML=`
    <div class="photo-item photo-item-primary" data-photo-id="${esc(active.id)}">
      <img src="${esc(active.source.value)}" alt="${esc(active.alt||"")}" style="${cropImageStyle(active.crop)}">
      ${isPrimary?'<span class="photo-primary">Главное</span>':""}
      <div class="photo-actions">
        <button type="button" class="row-action-quiet photo-action-icon" data-action="view-photo" aria-label="Просмотреть фотографию" title="Просмотреть фотографию" onclick="openPhotoLightbox('${jsq(active.id)}')">${viewIcon}</button>
        <button type="button" class="row-action-quiet photo-action-icon" data-action="crop-photo" aria-label="Кадрировать фотографию" title="Кадрировать фотографию" onclick="openPhotoCrop('${jsq(active.id)}')">${cropIcon}</button>
        ${!isPrimary?`<button type="button" class="row-action-quiet photo-action-icon" data-action="make-primary" aria-label="Сделать главным" title="Сделать главным" onclick="setPrimaryPhoto('${jsq(active.id)}')">${starIcon}</button>`:""}
        <button type="button" class="row-action-quiet danger-quiet photo-action-icon" data-action="delete-photo" aria-label="Удалить фотографию" title="Удалить фотографию" onclick="removeActiveProfilePhoto()">${trashIcon}</button>
      </div>
    </div>
    <div class="photo-rail" role="listbox" aria-label="Фотографии персонажа">${rail}</div>`;
}

function setActivePhoto(id){
  if(!profileDraftPhotos.some(photo=>photo.id===id))return;
  profileDraftActivePhotoId=id;
  renderProfilePhotos();
}

function removeProfilePhoto(index){
  const removed=profileDraftPhotos[index];if(removed?.source?.kind==="pending")URL.revokeObjectURL(removed.source.value);profileDraftPhotoFiles.delete(removed?.id);
  profileDraftPhotos.splice(index,1);
  if(!profileDraftPhotos.some(photo=>photo.id===profileDraftPrimaryPhotoId))profileDraftPrimaryPhotoId=profileDraftPhotos[0]?.id||"";
  renderProfilePhotos();
  syncBeforeUnload();
}

function removeActiveProfilePhoto(){
  const index=profileDraftPhotos.findIndex(photo=>photo.id===profileDraftActivePhotoId);
  if(index>=0)removeProfilePhoto(index);
}

async function readOriginalImage(file){
  if(!file.type.startsWith("image/"))throw new Error("Неподдерживаемый формат файла.");
  if(file.size>3*1024*1024)throw new Error("Файл больше 3 МБ и может переполнить локальное хранилище.");
  if(isCloudWorkspace()){
    const objectUrl=URL.createObjectURL(file);
    try{await new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(new Error("Файл не является корректным изображением."));image.src=objectUrl})}
    catch(error){URL.revokeObjectURL(objectUrl);throw error}
    const id=crypto.randomUUID(),photo=normalizePhoto({id,source:{kind:"pending",value:objectUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""},profileEditingId,profileDraftPhotos.length);profileDraftPhotoFiles.set(id,file);return photo;
  }
  const dataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
  await new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=resolve;image.onerror=()=>reject(new Error("Файл не является корректным изображением."));
    image.src=dataUrl;
  });
  return normalizePhoto({id:makeId("photo"),source:{kind:"data-url",value:dataUrl},crop:{x:.5,y:.5,zoom:1},alt:"",caption:""},profileEditingId,profileDraftPhotos.length);
}

function setPrimaryPhoto(id){if(profileDraftPhotos.some(photo=>photo.id===id)){profileDraftPrimaryPhotoId=id;renderProfilePhotos();syncBeforeUnload()}}
function draftPhoto(id){return profileDraftPhotos.find(photo=>photo.id===id)}
function openPhotoLightbox(id){const photo=draftPhoto(id);if(!photo)return;document.getElementById("photoLightboxImage").src=photo.source.value;document.getElementById("photoLightboxCaption").textContent=photo.caption||"Оригинальное изображение";showModal("photoLightboxModal")}
function openPhotoLightboxByCharacter(characterId,id){const p=normalizeProfile(data.profiles?.[characterId],characterById(characterId));const photo=p.photos.find(x=>x.id===id);if(!photo)return;document.getElementById("photoLightboxImage").src=photo.source.value;document.getElementById("photoLightboxCaption").textContent=photo.caption||`Оригинальное изображение: ${p.name}`;showModal("photoLightboxModal")}
function syncCropPreview(){const crop=photoCropState?.draft;if(!crop)return;document.getElementById("photoCropImage").style.cssText=cropImageStyle(crop);document.getElementById("photoCropZoom").value=crop.zoom}
function openPhotoCrop(id){const photo=draftPhoto(id);if(!photo)return;photoCropState={id,draft:{...photo.crop}};document.getElementById("photoCropImage").src=photo.source.value;syncCropPreview();showModal("photoCropModal",{initialFocus:"#photoCropZoom"})}
function nudgePhotoCrop(dx,dy){
  // dx/dy is the desired on-screen movement of the IMAGE (positive = image moves
  // right/down, matching drag direction and the "→"/"↓" button labels). crop.x/y
  // is a CSS object-position fraction, which moves the image the OPPOSITE way as
  // it increases, so the sign is inverted here rather than at each caller.
  if(!photoCropState)return;
  photoCropState.draft.x=Math.max(0,Math.min(1,photoCropState.draft.x-dx));
  photoCropState.draft.y=Math.max(0,Math.min(1,photoCropState.draft.y-dy));
  syncCropPreview();
}
function savePhotoCrop(){const photo=draftPhoto(photoCropState?.id);if(photo)photo.crop={...photoCropState.draft};photoCropState=null;renderProfilePhotos();forceHideModal("photoCropModal");syncBeforeUnload()}
function cancelPhotoCrop(){photoCropState=null;forceHideModal("photoCropModal")}

function profileDisplayValue(profile,key){
  if(profile.hidden?.[key])return null;
  const value=profile[key];
  return (Array.isArray(value)?value.join(", "):String(value??"").trim())||"Не указано";
}

function birthdayDisplay(profile){
  if(profile.hidden?.birthday)return null;
  const b=profile.birthday||{};
  if(!b.month&&!b.day&&!b.year)return "Не указано";
  const parts=[];
  if(b.day)parts.push(String(b.day).padStart(2,"0"));
  if(b.month)parts.push(String(b.month).padStart(2,"0"));
  let result=parts.join(".");
  if(b.year)result+=(result?".":"")+b.year;
  return result||"Не указано";
}

Object.assign(globalThis,{characterById,cropImageStyle,characterName,nextCharacterSortOrder,computeInsertSortOrder,reorderCharacterTo,renderProfiles,updateProfileGalleryCardHeight,characterSceneEntries,characterLocations,characterTags,characterRelations,renderProfileAutomaticSection,filterCharacterLocations,filterCharacterTags,openCharacterTimeline,moveProfile,deleteProfile,setupBirthdaySelectors,zodiacFor,updateZodiac,profileSaveScopeValue,updateProfileScopeHelp,setupSingleValueCombobox,editProfile,renderProfilePhotos,setActivePhoto,removeProfilePhoto,removeActiveProfilePhoto,readOriginalImage,setPrimaryPhoto,openPhotoLightbox,openPhotoLightboxByCharacter,openPhotoCrop,nudgePhotoCrop,savePhotoCrop,cancelPhotoCrop,syncCropPreview,profileDisplayValue,birthdayDisplay});
export {characterById,cropImageStyle,characterName,nextCharacterSortOrder,computeInsertSortOrder,reorderCharacterTo,renderProfiles,updateProfileGalleryCardHeight,characterSceneEntries,characterLocations,characterTags,characterRelations,renderProfileAutomaticSection,filterCharacterLocations,filterCharacterTags,openCharacterTimeline,moveProfile,deleteProfile,setupBirthdaySelectors,zodiacFor,updateZodiac,profileSaveScopeValue,updateProfileScopeHelp,setupSingleValueCombobox,editProfile,renderProfilePhotos,setActivePhoto,removeProfilePhoto,removeActiveProfilePhoto,readOriginalImage,setPrimaryPhoto,openPhotoLightbox,openPhotoLightboxByCharacter,openPhotoCrop,nudgePhotoCrop,savePhotoCrop,cancelPhotoCrop,syncCropPreview,profileDisplayValue,birthdayDisplay};
