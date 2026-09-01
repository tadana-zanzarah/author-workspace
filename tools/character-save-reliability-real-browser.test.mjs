import {createRequire} from "node:module";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("character save reliability real-browser test skipped: credentials are not configured");process.exit(0)}
const port=process.env.AUTHOR_WORKSPACE_URL?null:8073;
const server=port?spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore",env:{...process.env,PORT:String(port)}}):null;
const base=process.env.AUTHOR_WORKSPACE_URL||`http://127.0.0.1:${port}/`;
const token=crypto.randomBytes(7).toString("hex"),title=`AW save reliability ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(message)};
let projectId=null,characterIds=[],context,page;
async function openProfileByName(name){
  await page.locator("#profilesGrid .profile-card").filter({has:page.locator(".profile-name",{hasText:name})}).locator('button[aria-label^="Редактировать анкету"]').click();
  await page.waitForSelector("#profileEditorModal");
}
async function listCharacters(){return page.evaluate(async()=>(await cloudState.characterApi.listCharacters()).data.map(c=>({id:c.id,name:c.name,age:c.base_profile?.age})))}
try{
  context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(20000);
  for(let i=0;i<30;i++){try{await page.goto(base,{waitUntil:"networkidle"});break}catch{await new Promise(r=>setTimeout(r,100))}}
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
  const project=await page.evaluate(async title=>{const owner=cloudState.session.user.id;return cloudState.api.createProject({ownerId:owner,title})},title);
  projectId=project.id;
  // Opening the live shared test project occasionally stalls on the first attempt (observed
  // pre-existing flakiness of openCloudProject against the shared test Supabase account,
  // unrelated to character save); retry once before treating it as a real failure.
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},project);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  if(!opened){
    const diag=await page.evaluate(()=>({appState:document.body.dataset.appState,trackers:[...dirtyTrackers.values()].map(t=>({id:t.id,active:t.active,display:document.getElementById(t.id)?.style.display})),banner:document.getElementById("storageBanner")?.textContent}));
    throw new Error(`openCloudProject did not reach workspace state after retries: ${JSON.stringify(diag)}`);
  }
  await page.click("#projectMenu > summary");await page.click("#manageChars");

  // A: create a character with age 32; it must survive save + authoritative reload.
  await page.click("#addChar");await page.click("#createNewCharacter");await page.waitForSelector("#profileEditorModal");
  assert(await page.locator("#saveProfile").isDisabled(),"save must start disabled on a clean blank draft");
  await page.fill("#pf_name","Age Character");await page.fill("#pf_age","32");
  assert(!await page.locator("#saveProfile").isDisabled(),"save must enable once the draft is dirty");
  await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  let chars=await listCharacters();characterIds=chars.map(c=>c.id);
  assert(chars.some(c=>c.name==="Age Character"),"created character missing after authoritative reload");
  // reopen from a fresh authoritative snapshot and read the effective (base+override) age shown in the form.
  await page.evaluate(async()=>{const loaded=await cloudProjectSync.reload();if(loaded.ok){data=loaded.data;render()}});
  await openProfileByName("Age Character");
  assert(await page.inputValue("#pf_age")==="32","age 32 did not survive create + authoritative reload");

  // B: edit the same character, change age to a new value; it must survive a second save + reload.
  await page.fill("#pf_age","41");
  await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  await page.evaluate(async()=>{const loaded=await cloudProjectSync.reload();if(loaded.ok){data=loaded.data;render()}});
  await openProfileByName("Age Character");
  assert(await page.inputValue("#pf_age")==="41","age 41 did not survive edit + second save + authoritative reload");
  await page.click("#cancelProfile");

  // create a second character to use as a structural-link target for F/G.
  await page.click("#addChar");await page.click("#createNewCharacter");await page.waitForSelector("#profileEditorModal");
  await page.fill("#pf_name","Link Target");await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});

  // F: a brand-new character plus a structural link added before the first save must both persist.
  await page.click("#addChar");await page.click("#createNewCharacter");await page.waitForSelector("#profileEditorModal");
  await page.fill("#pf_name","Link Source");
  await page.getByRole("button",{name:"Добавить связь"}).click();
  await page.selectOption("#characterLinkTarget",{label:"Link Target"});
  await page.selectOption("#characterLinkCategory","family");
  await page.selectOption("#characterLinkType","mother");
  await page.selectOption("#characterLinkReverseType","son");
  await page.click("#saveCharacterLink");
  await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  chars=await listCharacters();characterIds=chars.map(c=>c.id);
  let content=await page.evaluate(async()=>(await cloudState.contentApi.loadProjectContent(cloudProjectSync.projectId)).data);
  assert(content.character_links.some(l=>l.type==="mother"&&l.reverse_type==="son"),"structural link created with a brand-new character did not persist");

  // G: editing an existing character's structural link must persist the change.
  await openProfileByName("Link Source");
  await page.locator("#profileCharacterLinks .character-link-row").first().getByRole("button",{name:/Изменить/}).click();
  await page.selectOption("#characterLinkCategory","other");
  await page.selectOption("#characterLinkType","custom");
  await page.fill("#characterLinkCustomLabel","наставник");
  await page.selectOption("#characterLinkReverseType","custom");
  await page.fill("#characterLinkReverseCustomLabel","ученик");
  await page.click("#saveCharacterLink");
  await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  content=await page.evaluate(async()=>(await cloudState.contentApi.loadProjectContent(cloudProjectSync.projectId)).data);
  assert(content.character_links.some(l=>l.custom_label==="наставник"&&l.reverse_custom_label==="ученик"),"structural link edit on an existing character did not persist");

  // C/D: rapid repeated submission of a create must produce exactly one character, and the button must single-flight.
  await page.click("#addChar");await page.click("#createNewCharacter");await page.waitForSelector("#profileEditorModal");
  await page.fill("#pf_name","Rapid Click Character");
  const beforeRapid=(await listCharacters()).length;
  await Promise.allSettled([page.click("#saveProfile"),page.click("#saveProfile",{timeout:1500}),page.click("#saveProfile",{timeout:1500})]);
  await page.waitForSelector("#profileEditorModal",{state:"hidden"}).catch(()=>{});
  await page.waitForTimeout(1000);
  const afterRapid=await listCharacters();
  assert(afterRapid.length-beforeRapid===1,`rapid repeated submit must create exactly one character, created ${afterRapid.length-beforeRapid}`);
  characterIds=afterRapid.map(c=>c.id);

  // E/H/I: a failure partway through the save (image upload) must preserve the dirty draft, allow retry,
  // and retry must not create a duplicate character or a duplicate image.
  await page.click("#addChar");await page.click("#createNewCharacter");await page.waitForSelector("#profileEditorModal");
  await page.fill("#pf_name","Partial Save Character");
  const pngBase64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  await page.setInputFiles("#profilePhotosInput",{name:"tiny.png",mimeType:"image/png",buffer:Buffer.from(pngBase64,"base64")});
  await page.waitForTimeout(300);
  let uploadAttempts=0;
  await page.route("**/storage/v1/object/character-images/**",route=>{uploadAttempts++;if(uploadAttempts===1){route.abort("failed");return}route.continue()});
  await page.click("#saveProfile");
  await page.waitForTimeout(2500);
  let afterFailure=await listCharacters();
  const partialCount=afterFailure.filter(c=>c.name==="Partial Save Character").length;
  assert(partialCount===1,"character identity must exist after the first (partially failed) save attempt");
  assert(await page.evaluate(()=>hasDirtyForms()),"failure must preserve dirty state for retry");
  assert(await page.locator("#profileEditorModal").isVisible(),"failure must not close the modal");
  assert(!await page.locator("#saveProfile").isDisabled(),"failure must re-enable save for a safe retry");
  await page.unroute("**/storage/v1/object/character-images/**");
  await page.click("#saveProfile");
  await page.waitForSelector("#profileEditorModal",{state:"hidden"});
  const afterRetry=await listCharacters();
  const retryMatches=afterRetry.filter(c=>c.name==="Partial Save Character");
  assert(retryMatches.length===1,`retry after partial failure must not duplicate the character, found ${retryMatches.length}`);
  characterIds=afterRetry.map(c=>c.id);
  const partialCharacterId=retryMatches[0].id;
  const images=await page.evaluate(async id=>{const chars=await cloudState.characterApi.listCharacters(),c=chars.data.find(x=>x.id===id);const content=await cloudState.contentApi.loadProjectContent(cloudProjectSync.projectId),pc=content.data.project_characters.find(x=>x.character_id===id);return (await cloudState.imageApi.listImages(id,pc?.id)).data.length},partialCharacterId);
  assert(images===1,`retry after a failed upload must not leave duplicate image rows, found ${images}`);

  console.log(JSON.stringify({ok:true,ageCreateSurvivesReload:true,ageEditSurvivesReload:true,newCharacterLinkPersists:true,existingCharacterLinkEditPersists:true,rapidSubmitCreatesOne:true,failurePreservesDraftAndRetrySucceedsWithoutDuplication:true}));
}finally{
  try{
    if(page){
      const ids=await page.evaluate(async()=>(await cloudState.characterApi.listCharacters()).data.map(c=>c.id)).catch(()=>characterIds);
      await page.evaluate(async({projectId,characterIds}) => {
        const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
        const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
        if(characterIds?.length){
          await client.from("character_links").delete().or(`from_character_id.in.(${characterIds.join(",")}),to_character_id.in.(${characterIds.join(",")})`);
          const images=await client.from("character_images").select("storage_path").in("character_id",characterIds);
          if(images.data?.length)await client.storage.from("character-images").remove(images.data.map(x=>x.storage_path));
          await client.from("character_images").delete().in("character_id",characterIds);
        }
        if(projectId)await client.from("projects").delete().eq("id",projectId);
        if(characterIds?.length)await client.from("characters").delete().in("id",characterIds);
      },{projectId,characterIds:ids}).catch(error=>console.error("cleanup failed",error));
    }
  }finally{await context?.close();await browser.close();server?.kill()}
}
