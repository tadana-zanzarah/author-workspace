import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const port=8017,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
const project={version:11,characters:[{id:"character-a",name:"Анна"}],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",hobbies:"Чтение, музыка",favorites:"Кофе, дождь",photos:[],hidden:{},initialRelations:{},pluginField:{keep:true}}},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{},scenes:[]};
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
try{
  const page=await browser.newPage({viewport:{width:390,height:760}});page.setDefaultTimeout(6000);const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(value=>{if(sessionStorage.getItem("multi-value-seeded"))return;sessionStorage.setItem("multi-value-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.click("#projectMenu > summary");await page.click("#manageChars");await page.locator("#profilesGrid button").filter({hasText:"Открыть анкету"}).click();
  const hobbies=page.locator("#pf_hobbies"),input=hobbies.locator("input");
  const initialHobbies=await hobbies.locator(".multi-value-chip").allTextContents();if(initialHobbies.length!==2)throw new Error(`Old hobbies string was not rendered as chips: ${JSON.stringify(initialHobbies)} errors=${errors.join(" | ")} html=${await hobbies.innerHTML()}`);
  await input.click();if(await input.getAttribute("aria-expanded")!=="true")throw new Error("Combobox did not open");
  await hobbies.getByRole("option",{name:"Фотография",exact:true}).click();
  await input.click();await hobbies.getByRole("option",{name:"Кино",exact:true}).click();
  if((await hobbies.locator(".multi-value-chip").count())!==4)throw new Error("Repeated selection did not retain chips");
  await input.fill("кино");await input.press("Enter");if((await hobbies.locator(".multi-value-chip").count())!==4)throw new Error("Duplicate was added");
  await input.fill("Историческая реконструкция");await input.press("Enter");if(!await hobbies.getByText("Историческая реконструкция",{exact:true}).count())throw new Error("Custom value missing");
  await hobbies.getByRole("button",{name:"Удалить значение «Фотография»"}).click();await input.click();if(!await hobbies.getByRole("option",{name:"Фотография",exact:true}).count())throw new Error("Removed suggestion unavailable");
  await input.press("ArrowDown");await input.press("ArrowUp");await input.press("Escape");if(await input.getAttribute("aria-expanded")!=="false"||!await page.locator("#profileEditorModal").isVisible())throw new Error("First Escape did not close only dropdown");
  const favorites=page.locator("#pf_favorites"),favoriteInput=favorites.locator("input");await favoriteInput.click();await favorites.getByRole("option",{name:"Чай",exact:true}).click();await favoriteInput.fill("Матча");await favoriteInput.press("Enter");
  if(!await page.evaluate(()=>hasDirtyForms()))throw new Error("Chip changes did not mark profile dirty");
  const box=await hobbies.boundingBox();if(!box||box.x<0||box.x+box.width>390)throw new Error("Mobile combobox exceeds viewport");
  await page.click("#saveProfile");
  let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));
  if(!Array.isArray(saved.profiles["character-a"].hobbies)||!saved.profiles["character-a"].hobbies.includes("Историческая реконструкция")||!saved.profiles["character-a"].favorites.includes("Матча")||!saved.profiles["character-a"].pluginField?.keep)throw new Error("Array persistence or unknown profile field failed");
  await page.locator("#profilesGrid button").filter({hasText:"Открыть анкету"}).click();if(!await hobbies.getByText("Историческая реконструкция",{exact:true}).count())throw new Error("Close/reopen lost chips");await page.click("#cancelProfile");
  await page.reload({waitUntil:"networkidle"});await page.click("#projectMenu > summary");await page.click("#manageChars");await page.locator("#profilesGrid button").filter({hasText:"Открыть анкету"}).click();if(!await page.locator("#pf_favorites").getByText("Матча",{exact:true}).count())throw new Error("Reload lost values");
  const reloadInput=page.locator("#pf_hobbies input");await reloadInput.fill("Черновое хобби");await reloadInput.press("Enter");
  await page.evaluate(()=>{window.__originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){const error=new Error("quota");error.name="QuotaExceededError";throw error}});await page.click("#saveProfile");
  if(!await page.locator("#profileEditorModal").isVisible()||!await page.locator("#pf_hobbies").getByText("Черновое хобби",{exact:true}).count()||!await page.evaluate(()=>hasDirtyForms()))throw new Error("Save failure lost modal, chips, or dirty state");
  await page.evaluate(()=>{Storage.prototype.setItem=window.__originalSetItem;document.getElementById("cancelProfile").click()});if(!await page.locator("#discardChangesModal").isVisible())throw new Error("Dirty close guard missing after save failure");await page.click("#continueEditing");if(!await page.locator("#pf_hobbies").getByText("Черновое хобби",{exact:true}).count())throw new Error("Continue editing lost draft");
  console.log("multi-value profile browser tests: OK");
}finally{await browser.close();server.kill()}
