function characterById(id){return data.characters.find(c=>c.id===id)}

function characterName(id){return characterById(id)?.name||"Неизвестный персонаж"}

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
      ["Рост",profileDisplayValue(p,"height")],["Телосложение",profileDisplayValue(p,"build")],
      ["Занятость",profileDisplayValue(p,"profession")],["Ориентация",profileDisplayValue(p,"orientation")]
    ].filter(([,v])=>v!==null);
    const cover=p.photos?.[0]?`<img src="${p.photos[0]}" alt="">`:`Нет изображения`;
    return `<article class="profile-card">
      <div class="profile-cover">${cover}</div>
      <div class="profile-body">
        <div class="profile-name">${esc(full||character.name)}</div>
        <div class="profile-facts">${facts.map(([k,v])=>`<div class="profile-fact"><strong>${k}:</strong> ${esc(v)}</div>`).join("")}</div>
        ${!p.hidden?.description&&p.description?`<div class="profile-description">${esc(p.description)}</div>`:""}
        ${renderProfileAutomaticSection(character.id)}
        <div class="profile-card-actions">
          <button onclick="openCharacterTimeline('${jsq(character.id)}')">Личная хронология</button>
          <button onclick="editProfile('${jsq(character.id)}')">Открыть анкету</button>
          <button aria-label="Переместить персонажа ${esc(character.name)} влево" onclick="moveProfile('${jsq(character.id)}',-1)">←</button>
          <button aria-label="Переместить персонажа ${esc(character.name)} вправо" onclick="moveProfile('${jsq(character.id)}',1)">→</button>
          <button class="danger" onclick="deleteProfile('${jsq(character.id)}')">Удалить</button>
        </div>
      </div>
    </article>`;
  }).join("")||'<div class="empty-work">Персонажей пока нет. Создайте первого персонажа, когда будете готовы.</div>';
}

function characterSceneEntries(characterId){
  return data.scenes.map((scene,index)=>({scene,index})).filter(x=>personHasContent(x.scene.people?.[characterId]));
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
  const words=entries.reduce((n,x)=>n+countWords(x.scene.sceneText),0);
  const relations=characterRelations(characterId);
  return `<div class="profile-auto">
    <div class="profile-auto-grid">
      <button class="profile-auto-card" onclick="setFilter('character','${jsq(characterId)}');hideModal('charsModal')"><strong>${entries.length}</strong>Все сцены</button>
      <button class="profile-auto-card" onclick="openCharacterTimeline('${jsq(characterId)}')"><strong>${entries.length}</strong>Хронология</button>
      <button class="profile-auto-card" onclick="filterCharacterLocations('${jsq(characterId)}')"><strong>${locations.length}</strong>Локации</button>
      <button class="profile-auto-card" onclick="filterCharacterTags('${jsq(characterId)}')"><strong>${tags.length}</strong>Теги</button>
      <div class="profile-auto-card"><strong>${words}</strong>Слов в сценах</div>
      <div class="profile-auto-card"><strong>${Object.keys(relations).length}</strong>Отношений</div>
    </div>
    ${Object.keys(relations).length?`<div class="profile-relations-list" style="margin-top:8px">${Object.entries(relations).map(([t,v])=>`<div><strong>${esc(characterName(t))}:</strong> ${esc(v)}</div>`).join("")}</div>`:""}
  </div>`;
}

function filterCharacterLocations(characterId){
  const locations=characterLocations(characterId);hideModal("charsModal");
  filters.character=characterId;
  if(locations.length===1)filters.location=locations[0].id;
  render();
}

function filterCharacterTags(characterId){
  const tags=characterTags(characterId);hideModal("charsModal");
  filters.character=characterId;
  if(tags.length===1)filters.tag=tags[0].id;
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

function moveProfile(characterId,dir){
  const index=data.characters.findIndex(c=>c.id===characterId);
  const target=index+dir;
  if(index<0||target<0||target>=data.characters.length)return;
  const result=commitDataChange(next=>{[next.characters[index],next.characters[target]]=[next.characters[target],next.characters[index]]},{renderAfter:false});
  if(result.ok){renderProfiles();render()}
}

function deleteProfile(characterId){
  const character=characterById(characterId);
  if(!character)return;
  if(!confirm(`Удалить персонажа «${character.name}» из анкет и колонок? Данные этого персонажа в сценах также будут удалены.`))return;
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
  },{renderAfter:false});
  if(!result.ok)return;
  if(filters.character===characterId)filters.character="";
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

function editProfile(characterId){
  return requestEditorTransition(()=>editProfileNow(characterId));
}

function editProfileNow(characterId){
  setupBirthdaySelectors();
  profileEditingId=characterId;
  const character=characterById(characterId)||profileDraftCharacter;if(!character||character.id!==characterId)return;
  const p=normalizeProfile(data.profiles?.[characterId],character);
  profileDraftPhotos=[...(p.photos||[])];
  document.getElementById("profileEditorTitle").textContent=`Анкета: ${p.name||character.name}`;
  const values={
    name:p.name||character.name,surname:p.surname,race:p.race,sex:p.sex,secondarySex:p.secondarySex,
    age:p.age,height:p.height,build:p.build,profession:p.profession,orientation:p.orientation,
    favorites:p.favorites,hobbies:p.hobbies,character:p.character,features:p.features,
    description:p.description
  };
  for(const [key,value] of Object.entries(values)){
    const el=document.getElementById("pf_"+key);
    if(el)el.value=value??"";
  }
  document.getElementById("pf_birthYear").value=p.birthday?.year||"";
  document.getElementById("pf_birthMonth").value=p.birthday?.month||"";
  document.getElementById("pf_birthDay").value=p.birthday?.day||"";
  updateZodiac();
  ["race","sex","secondarySex","age","birthday","zodiac","height","build","profession",
   "orientation","favorites","hobbies","character","features","description"].forEach(key=>{
    document.getElementById("hide_"+key).checked=!!p.hidden?.[key];
  });
  renderProfilePhotos();
  renderInitialRelations(p.initialRelations||{},characterId);
  showModal("profileEditorModal");
  trackerFor("profileEditorModal").captureInitialState();
}

function renderProfilePhotos(){
  document.getElementById("profilePhotosGrid").innerHTML=profileDraftPhotos.map((src,i)=>`
    <div class="photo-item">
      <img src="${src}" alt="">
      <button type="button" class="danger" aria-label="Удалить фотографию ${i+1}" onclick="removeProfilePhoto(${i})">×</button>
    </div>`).join("");
}

function removeProfilePhoto(index){
  profileDraftPhotos.splice(index,1);
  renderProfilePhotos();
  syncBeforeUnload();
}

async function compressImage(file){
  const dataUrl=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
  const img=await new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=reject;
    image.src=dataUrl;
  });
  const max=1000;
  const scale=Math.min(1,max/Math.max(img.width,img.height));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(img.width*scale));
  canvas.height=Math.max(1,Math.round(img.height*scale));
  canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",.82);
}

function profileDisplayValue(profile,key){
  if(profile.hidden?.[key])return null;
  const value=profile[key];
  return String(value??"").trim()||"Не указано";
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

Object.assign(globalThis,{characterById,characterName,renderProfiles,characterSceneEntries,characterLocations,characterTags,characterRelations,renderProfileAutomaticSection,filterCharacterLocations,filterCharacterTags,openCharacterTimeline,moveProfile,deleteProfile,setupBirthdaySelectors,zodiacFor,updateZodiac,editProfile,renderProfilePhotos,removeProfilePhoto,compressImage,profileDisplayValue,birthdayDisplay});
export {characterById,characterName,renderProfiles,characterSceneEntries,characterLocations,characterTags,characterRelations,renderProfileAutomaticSection,filterCharacterLocations,filterCharacterTags,openCharacterTimeline,moveProfile,deleteProfile,setupBirthdaySelectors,zodiacFor,updateZodiac,editProfile,renderProfilePhotos,removeProfilePhoto,compressImage,profileDisplayValue,birthdayDisplay};
