import assert from "node:assert/strict";
import {normalizePhoto,normalizeProfile,normalizeProject} from "../js/migrations.js";

const character={id:"character-a",name:"Анна"};
const dataUrl="data:image/png;base64,AAAA";

{
  const photo=normalizePhoto(dataUrl,"character-a",0);
  assert.equal(typeof photo,"object");
  assert.match(photo.id,/^photo-/);
  assert.deepEqual(photo.source,{kind:"data-url",value:dataUrl});
  assert.deepEqual(photo.crop,{x:.5,y:.5,zoom:1});
}

{
  const original={id:"photo-stable",source:{kind:"data-url",value:dataUrl},crop:{x:2,y:-1,zoom:"bad"},future:{keep:true}};
  const photo=normalizePhoto(original,"character-a",0);
  assert.equal(photo.id,"photo-stable");
  assert.deepEqual(photo.crop,{x:1,y:0,zoom:1});
  assert.deepEqual(photo.future,{keep:true});
  assert.notEqual(photo,original);
}

{
  const photo=normalizePhoto({src:dataUrl,legacyMeta:"keep"},"character-a",0);
  assert.equal(photo.source.value,dataUrl);
  assert.equal(photo.src,dataUrl);
  assert.equal(photo.legacyMeta,"keep");
}

{
  const profile=normalizeProfile({photos:[dataUrl,{source:{kind:"data-url",value:dataUrl},crop:null}],primaryPhotoId:"missing"},character);
  assert.equal(profile.photos.length,2);
  assert.equal(profile.primaryPhotoId,profile.photos[0].id);
  assert.ok(profile.photos.every(photo=>photo.crop&&photo.source?.value===dataUrl));
}

{
  const project={version:11,characters:[character],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",photos:[{id:"photo-a",source:{kind:"data-url",value:dataUrl},crop:{x:.2,y:.8,zoom:1.7},pluginMeta:{keep:true}}],primaryPhotoId:"photo-a"}},chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]};
  const exported=JSON.parse(JSON.stringify(normalizeProject(project)));
  const imported=normalizeProject(exported);
  assert.deepEqual(imported.profiles["character-a"].photos,exported.profiles["character-a"].photos);
  assert.equal(imported.profiles["character-a"].primaryPhotoId,"photo-a");
  assert.deepEqual(imported.profiles["character-a"].photos[0].pluginMeta,{keep:true});
}

console.log("character image data tests passed");
