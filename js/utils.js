function esc(s=""){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

function jsq(s){return String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'")}

function cssEscape(s){return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"')}

function parseSceneMoment(scene){
  if(!scene?.date)return null;
  const dateParts=scene.date.split("-").map(Number);
  if(dateParts.length!==3||dateParts.some(Number.isNaN))return null;
  const [y,m,d]=dateParts;
  let hh=0,mm=0,hasTime=false;
  if(scene.time){
    const parts=scene.time.split(":").map(Number);
    if(parts.length>=2&&!parts.some(Number.isNaN)){
      [hh,mm]=parts;
      hasTime=true;
    }
  }
  return {value:new Date(y,m-1,d,hh,mm).getTime(),date:scene.date,time:scene.time||"",hasTime};
}

function chronologicalWarning(index){
  const current=parseSceneMoment(data.scenes[index]);
  if(!current)return false;
  let prev=null,next=null;
  for(let i=index-1;i>=0;i--){
    const p=parseSceneMoment(data.scenes[i]);
    if(p){prev=p;break}
  }
  for(let i=index+1;i<data.scenes.length;i++){
    const n=parseSceneMoment(data.scenes[i]);
    if(n){next=n;break}
  }
  if(prev){
    if(current.date<prev.date)return true;
    if(current.date===prev.date&&current.hasTime&&prev.hasTime&&current.time<prev.time)return true;
  }
  if(next){
    if(current.date>next.date)return true;
    if(current.date===next.date&&current.hasTime&&next.hasTime&&current.time>next.time)return true;
  }
  return false;
}

function countWords(value){
  return (String(value||"").trim().match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)||[]).length;
}

function readableDate(scene){
  const parts=[];
  if(scene.date)parts.push(scene.date.split("-").reverse().join("."));
  if(scene.time)parts.push(scene.time);
  return parts.join(" ");
}

function wordEscape(s=""){
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function showModal(id){document.getElementById(id).style.display="flex"}

function hideModal(id){document.getElementById(id).style.display="none"}

Object.assign(globalThis,{esc,jsq,cssEscape,parseSceneMoment,chronologicalWarning,countWords,readableDate,wordEscape,showModal,hideModal});
export {esc,jsq,cssEscape,parseSceneMoment,chronologicalWarning,countWords,readableDate,wordEscape,showModal,hideModal};
