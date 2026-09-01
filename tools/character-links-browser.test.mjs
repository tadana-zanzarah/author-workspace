import {createRequire} from "node:module";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright"),port=3031,server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}});
const project={version:11,characters:[{id:"character-a",name:"Анна"},{id:"character-b",name:"Борис"}],profiles:{"character-a":{id:"character-a",characterId:"character-a",name:"Анна",initialRelations:{}},"character-b":{id:"character-b",characterId:"character-b",name:"Борис",initialRelations:{}}},characterLinks:[],chapters:[{id:"chapter-unassigned",title:"Без главы"}],locations:[],tags:[],future:{},scenes:[]};
const openProfile=async(page,name)=>{await page.locator("#profilesGrid .profile-card").filter({has:page.locator(".profile-name",{hasText:name})}).locator('button[aria-label^="Редактировать анкету"]').click()};
try{
  await new Promise(r=>setTimeout(r,500));const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
  const page=await browser.newPage({viewport:{width:390,height:760}});page.setDefaultTimeout(7000);await page.addInitScript(value=>{if(sessionStorage.getItem("character-links-seeded"))return;sessionStorage.setItem("character-links-seeded","1");localStorage.setItem("novelTimelineV11",JSON.stringify(value))},project);
  for(let i=0;i<30;i++){try{await page.goto(`http://127.0.0.1:${port}/?local=1`,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.click("#projectMenu > summary");await page.click("#manageChars");await openProfile(page,"Анна");
  await page.getByRole("button",{name:"Добавить связь"}).click();
  if(await page.locator("#characterLinkTarget option[value='character-a']").count())throw new Error("self target offered");
  await page.selectOption("#characterLinkTarget","character-b");await page.selectOption("#characterLinkCategory","family");await page.selectOption("#characterLinkType","mother");await page.selectOption("#characterLinkReverseType","son");await page.click("#saveCharacterLink");
  if(!await page.evaluate(()=>hasDirtyForms()))throw new Error("link add did not dirty profile");await page.click("#saveProfile");
  await openProfile(page,"Анна");if(!await page.locator("#profileCharacterLinks").getByText(/Борис.*сын/i).count())throw new Error("forward display missing");await page.click("#cancelProfile");
  await openProfile(page,"Борис");if(!await page.locator("#profileCharacterLinks").getByText(/Анна.*мать/i).count())throw new Error("reverse display missing");
  const row=page.locator("#profileCharacterLinks .character-link-row").first();await row.getByRole("button",{name:/Изменить/}).click();await page.selectOption("#characterLinkCategory","other");await page.selectOption("#characterLinkType","custom");await page.fill("#characterLinkCustomLabel","наставник");await page.selectOption("#characterLinkReverseType","custom");await page.fill("#characterLinkReverseCustomLabel","ученик");await page.click("#saveCharacterLink");await page.click("#saveProfile");
  await openProfile(page,"Анна");if(!await page.locator("#profileCharacterLinks").getByText(/Борис.*наставник/).count())throw new Error("custom reverse edit missing");
  await page.locator("#profileCharacterLinks .character-link-row").first().getByRole("button",{name:/Удалить/}).click();if(!await page.evaluate(()=>hasDirtyForms()))throw new Error("delete did not dirty profile");await page.click("#cancelProfile");await page.click("#discardChanges");
  await openProfile(page,"Анна");if(!await page.locator("#profileCharacterLinks .character-link-row").count())throw new Error("discard lost stored link");
  const box=await page.locator("#profileCharacterLinks").boundingBox();if(!box||box.x<0||box.x+box.width>390)throw new Error("mobile links overflow");
  await page.getByRole("button",{name:"Добавить связь"}).click();await page.selectOption("#characterLinkTarget","character-b");await page.selectOption("#characterLinkCategory","other");await page.selectOption("#characterLinkType","custom");await page.fill("#characterLinkCustomLabel","ученик");await page.selectOption("#characterLinkReverseType","custom");await page.fill("#characterLinkReverseCustomLabel","наставник");await page.click("#saveCharacterLink");
  if(!await page.locator("#characterLinkError").getByText(/уже существует/i).count())throw new Error("reversed duplicate was not blocked");await page.click("#cancelCharacterLink");await page.click("#discardChanges");
  await page.locator("#profileCharacterLinks .character-link-row").first().getByRole("button",{name:/Удалить/}).click();
  await page.evaluate(()=>{window.__linkSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){const error=new Error("quota");error.name="QuotaExceededError";throw error}});await page.click("#saveProfile");
  if(!await page.locator("#profileEditorModal").isVisible()||await page.locator("#profileCharacterLinks .character-link-row").count()||!await page.evaluate(()=>hasDirtyForms()))throw new Error("save failure lost structural-link draft or dirty state");
  await page.evaluate(()=>{Storage.prototype.setItem=window.__linkSetItem});await page.click("#cancelProfile");await page.click("#discardChanges");
  await page.reload({waitUntil:"networkidle"});await page.click("#projectMenu > summary");await page.click("#manageChars");await openProfile(page,"Анна");if(!await page.locator("#profileCharacterLinks .character-link-row").count())throw new Error("reload lost structural link");await page.click("#cancelProfile");
  page.once("dialog",dialog=>dialog.accept());await page.locator("#profilesGrid .profile-card").filter({has:page.locator(".profile-name",{hasText:"Борис"})}).locator('button[aria-label^="Удалить персонажа"]').click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("novelTimelineV11")));if(stored.characterLinks.length)throw new Error("character deletion left dangling links");
  console.log("character links browser tests: OK");await browser.close();
}finally{server.kill()}
