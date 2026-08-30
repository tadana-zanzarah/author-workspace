import {createRequire} from "node:module";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("character order real-browser test skipped: credentials are not configured");process.exit(0)}
const port=process.env.AUTHOR_WORKSPACE_URL?null:8074;
const server=port?spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}}):null;
const base=process.env.AUTHOR_WORKSPACE_URL||`http://127.0.0.1:${port}/`;
const token=crypto.randomBytes(7).toString("hex");
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(message)};
let projectAId=null,projectBId=null,characterIds=[],context,page;

async function createCharacter(name){
  await page.click("#addChar");await page.click("#createNewCharacter");await page.waitForSelector("#profileEditorModal");
  await page.fill("#pf_name",name);await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});
}
async function projectOrder(){return page.evaluate(()=>data.characters.map(c=>c.name))}
async function openProjectByObject(project){
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},project);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  if(!opened)throw new Error("openCloudProject did not reach workspace state after retries");
}

try{
  context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(20000);
  for(let i=0;i<30;i++){try{await page.goto(base,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");

  const projectA=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},`AW char order A ${token}`);
  projectAId=projectA.id;
  await openProjectByObject(projectA);
  await page.click("#projectMenu > summary");await page.click("#manageChars");

  // A. The real regression report: characters created in this order must be *displayed* in this
  // order (not alphabetical, not random UUID order) after each create round-trips through the
  // real attach/create RPC and a fresh authoritative reload.
  for(const name of ["Зейн","Рене де Лакруа-Бреннер","Арман Бреннер","Реми Бреннер"])await createCharacter(name);
  await page.evaluate(async()=>{const loaded=await cloudProjectSync.reload();if(loaded.ok){data=loaded.data;renderProfiles();render()}});
  let order=await projectOrder();
  assert(order.join("|")==="Зейн|Рене де Лакруа-Бреннер|Арман Бреннер|Реми Бреннер",`creation order not preserved after real attach/create + authoritative reload: ${order.join("|")}`);
  characterIds=await page.evaluate(()=>data.characters.map(c=>c.id));

  // B/C/D. Manual drag reorder (Арман before Зейн) persists across an explicit fresh authoritative reload.
  await page.evaluate(()=>reorderCharacterTo(data.characters.find(c=>c.name==="Арман Бреннер").id,data.characters.find(c=>c.name==="Зейн").id));
  await page.waitForTimeout(300);
  order=await projectOrder();
  assert(order[0]==="Арман Бреннер"&&order[1]==="Зейн",`drag reorder against the real cloud RPC failed: ${order.join("|")}`);
  await page.evaluate(async()=>{const loaded=await cloudProjectSync.reload();if(loaded.ok){data=loaded.data;renderProfiles();render()}});
  order=await projectOrder();
  assert(order[0]==="Арман Бреннер"&&order[1]==="Зейн",`reorder did not survive a fresh authoritative reload: ${order.join("|")}`);

  // F. Attach an existing global character (created inside project A) as a new attach in a second
  // project must land at the end of project B's list, and G: removing + re-attaching also goes to
  // the end — independent of project A's own order.
  const reneId=(await page.evaluate(()=>data.characters.find(c=>c.name==="Рене де Лакруа-Бреннер").id));
  const projectB=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},`AW char order B ${token}`);
  projectBId=projectB.id;
  await openProjectByObject(projectB);
  await createCharacter("Локальный для B");
  characterIds.push(await page.evaluate(()=>data.characters.find(c=>c.name==="Локальный для B").id));
  await page.evaluate(async id=>{await runCloudMutation("attachProjectCharacter",(_api,revision)=>cloudState.characterApi.attachProjectCharacter(cloudProjectSync.projectId,id,revision,{sortOrder:nextCharacterSortOrder()}))},reneId);
  order=await projectOrder();
  assert(order.join("|")==="Локальный для B|Рене де Лакруа-Бреннер",`attaching an existing global character did not append it to the end of project B: ${order.join("|")}`);

  // E. Reordering the shared character in project B must not affect its position back in project A.
  await page.evaluate(()=>reorderCharacterTo(data.characters.find(c=>c.name==="Рене де Лакруа-Бреннер").id,data.characters.find(c=>c.name==="Локальный для B").id));
  order=await projectOrder();
  assert(order[0]==="Рене де Лакруа-Бреннер",`reorder in project B did not apply to project B: ${order.join("|")}`);
  await openProjectByObject(projectA);
  order=await projectOrder();
  assert(order[0]==="Арман Бреннер"&&order[1]==="Зейн",`reordering the shared character in project B leaked into project A's order: ${order.join("|")}`);

  // G. Remove the character from project A, then re-attach it: a soft-removed project_characters
  // row must be reactivatable (fix/project-character-reattach), not rejected as DUPLICATE forever.
  const reneInA=await page.evaluate(()=>data.characters.find(c=>c.name==="Рене де Лакруа-Бреннер"));
  const reneProjectCharacterIdBeforeRemove=reneInA.projectCharacterId;
  await page.evaluate(async pc=>{await runCloudMutation("removeProjectCharacter",(_api,revision)=>cloudState.characterApi.removeProjectCharacter(cloudProjectSync.projectId,pc,revision))},reneProjectCharacterIdBeforeRemove);
  order=await projectOrder();
  assert(!order.includes("Рене де Лакруа-Бреннер"),"remove did not take effect in project A");
  const reattachResult=await page.evaluate(async id=>runCloudMutation("attachProjectCharacter",(_api,revision)=>cloudState.characterApi.attachProjectCharacter(cloudProjectSync.projectId,id,revision,{sortOrder:nextCharacterSortOrder()})),reneId);
  assert(reattachResult.ok&&reattachResult.code==="OK","re-attaching a previously-removed character to the same project must succeed, not DUPLICATE");
  order=await projectOrder();
  assert(order[order.length-1]==="Рене де Лакруа-Бреннер",`re-attached character must land at the end of project A's order: ${order.join("|")}`);
  const reneAfterReattach=await page.evaluate(()=>data.characters.find(c=>c.name==="Рене де Лакруа-Бреннер"));
  assert(reneAfterReattach.id===reneId,"re-attach must keep the same global character identity");
  assert(reneAfterReattach.projectCharacterId===reneProjectCharacterIdBeforeRemove,"re-attach must reactivate the same participation row, not create a new one (project_characters_project_character_key is unique on (project_id,character_id) regardless of removed_at)");

  // Re-attaching an already-active character must still be a true no-op duplicate.
  const activeDuplicate=await page.evaluate(async id=>runCloudMutation("attachProjectCharacter",(_api,revision)=>cloudState.characterApi.attachProjectCharacter(cloudProjectSync.projectId,id,revision,{sortOrder:nextCharacterSortOrder()})),reneId);
  assert(activeDuplicate.code==="DUPLICATE","attaching an already-active character must still be rejected as DUPLICATE");

  // H. A fresh authoritative reload must preserve the reactivated participation.
  await page.evaluate(async()=>{const loaded=await cloudProjectSync.reload();if(loaded.ok){data=loaded.data;renderProfiles();render()}});
  order=await projectOrder();
  assert(order[order.length-1]==="Рене де Лакруа-Бреннер",`re-attach did not survive a fresh authoritative reload: ${order.join("|")}`);

  // I. Project B's own participation/order for the same global character must be unaffected by A's remove+reattach.
  await openProjectByObject(projectB);
  order=await projectOrder();
  assert(order[0]==="Рене де Лакруа-Бреннер"&&order.includes("Локальный для B"),`project B's participation/order for the shared character was affected by project A's remove+reattach: ${order.join("|")}`);

  console.log(JSON.stringify({ok:true,creationOrderMatchesRealRpc:true,dragReorderSurvivesAuthoritativeReload:true,attachAppendsToEnd:true,crossProjectOrderIsolation:true,reattachAfterRemoveSucceeds:true,reattachReactivatesSameRow:true,reattachSurvivesReload:true,projectBIsolationAfterReattach:true}));
}finally{
  try{
    if(page){
      await page.evaluate(async({projectAId,projectBId,characterIds})=>{
        const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
        const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
        for(const projectId of [projectAId,projectBId])if(projectId)await client.from("projects").delete().eq("id",projectId);
        if(characterIds?.length)await client.from("characters").delete().in("id",characterIds);
      },{projectAId,projectBId,characterIds}).catch(error=>console.error("cleanup failed",error));
    }
  }finally{await context?.close();await browser.close();server?.kill()}
}
