function validateDateString(value){
  if(typeof value!=="string")return false;
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(year<1||month<1||month>12||day<1)return false;
  const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
  return day<=daysInMonth;
}

function validateTimeString(value){
  if(typeof value!=="string")return false;
  const match=/^(\d{2}):(\d{2})$/.exec(value);
  return !!match&&Number(match[1])>=0&&Number(match[1])<=23&&Number(match[2])>=0&&Number(match[2])<=59;
}

function parseStrictSceneMoment(scene){
  if(!validateDateString(scene?.date))return null;
  if(scene.time&&!validateTimeString(scene.time))return null;
  const [year,month,day]=scene.date.split("-").map(Number);
  const [hour,minute]=scene.time?scene.time.split(":").map(Number):[0,0];
  return {value:Date.UTC(year,month-1,day,hour,minute),date:scene.date,time:scene.time||"",hasTime:!!scene.time};
}

Object.assign(globalThis,{validateDateString,validateTimeString,parseStrictSceneMoment});
export {validateDateString,validateTimeString,parseStrictSceneMoment};
