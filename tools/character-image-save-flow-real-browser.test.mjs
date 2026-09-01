import {createRequire} from "node:module";import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/"),{chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/",email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("character image save-flow real-browser test skipped: credentials are not configured");process.exit(0)}
// Regression coverage for the "column reference p.id is ambiguous" blocking bug: a
// project-scoped character image's make-primary / crop / delete RPCs (update_character_image,
// delete_character_image) failed with Postgres error 42702 because those functions reused a
// plpgsql variable name ("p") as a SQL table alias in the same query. Fixed by
// supabase/migrations/20260901120000_fix_character_image_update_delete_p_ambiguity.sql.
// This test exercises the real user flow end-to-end against the live cloud project using a
// disposable CLOUD_TEST_* fixture account/project/character, and cleans up everything it created.
const title=`AW save-flow ${crypto.randomBytes(6).toString("hex")}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const assert=(v,m)=>{if(!v)throw new Error(m)};
let page,fixture;
try{
  page=await context.newPage();
  await page.goto(base,{waitUntil:"networkidle"});
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");

  const result=await page.evaluate(async title=>{
    const owner=cloudState.session.user.id;
    const proj=await cloudState.api.createProject({ownerId:owner,title});
    const made=await cloudState.characterApi.createCharacterAndAttach(proj.id,0,{name:"Save Flow Char",baseProfile:{}},{});
    if(!made.ok)return {stage:"create_character_and_attach",made};
    const character=made.data.character,pc=made.data.project_character;
    const svg=color=>new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/></svg>`);
    const idA=crypto.randomUUID(),idB=crypto.randomUUID();
    const upA=await cloudState.imageApi.uploadImage({characterId:character.id,projectCharacterId:pc.id,photoId:idA,file:new File([svg("tomato")],"a.png",{type:"image/png"}),photo:{id:idA,crop:{x:.5,y:.5,zoom:1}},scope:"project",expectedRevision:made.revision,isPrimary:true,sortOrder:0});
    if(!upA.ok)return {stage:"upload_primary",upA};
    const upB=await cloudState.imageApi.uploadImage({characterId:character.id,projectCharacterId:pc.id,photoId:idB,file:new File([svg("blue")],"b.png",{type:"image/png"}),photo:{id:idB,crop:{x:.5,y:.5,zoom:1}},scope:"project",expectedRevision:upA.revision,isPrimary:false,sortOrder:1});
    if(!upB.ok)return {stage:"upload_secondary",upB};

    // CASE 1: ordinary profile save, no image changes -- update_project_character with unchanged overrides is a semantic no-op.
    const case1=await cloudState.characterApi.updateProjectCharacter(proj.id,pc.id,upB.revision,{overrides:{},role:null,sortOrder:0});
    if(!case1.ok)return {stage:"case1_plain_save",case1};

    // CASE 2: select secondary (idB) -> make primary -> save.
    const case2=await cloudState.imageApi.updateImage(idB,case1.revision,{isPrimary:true});
    if(!case2.ok)return {stage:"case2_make_primary",case2};

    // CASE 3: crop the (now primary) secondary photo -> save.
    const newCrop={x:.2,y:.3,zoom:2.2};
    const case3=await cloudState.imageApi.updateImage(idB,case2.revision,{crop:newCrop});
    if(!case3.ok)return {stage:"case3_crop_save",case3};

    // CASE 4 (combined make-primary + crop, exercised again on the other photo to prove it's not a one-shot fluke):
    const case4a=await cloudState.imageApi.updateImage(idA,case3.revision,{isPrimary:true});
    if(!case4a.ok)return {stage:"case4_make_primary_again",case4a};
    const case4b=await cloudState.imageApi.updateImage(idA,case4a.revision,{crop:{x:.7,y:.1,zoom:1.4}});
    if(!case4b.ok)return {stage:"case4_crop_again",case4b};

    const listed=await cloudState.imageApi.listImages(character.id,pc.id);
    if(!listed.ok)return {stage:"list_after_saves",listed};

    // CASE: delete probe on the same project-scoped image branch (shares the fixed functions).
    // Project-scoped images compare expected_revision against the PROJECT's revision (not the
    // image row's own .revision column) -- case4b.revision is the project revision returned by
    // the last successful project-scoped image mutation.
    const deleteProbe=await cloudState.imageApi.deleteImage(idB,case4b.revision);
    if(!deleteProbe.ok)return {stage:"delete_probe",deleteProbe};

    return {stage:"done",owner,projectId:proj.id,characterId:character.id,projectCharacterId:pc.id,idA,idB,listedBeforeDelete:listed.data};
  },title);

  fixture={projectId:result.projectId,characterId:result.characterId};
  assert(result.stage==="done",`flow failed at ${result.stage}: ${JSON.stringify(result)}`);
  assert(result.listedBeforeDelete.length===2,"expected exactly 2 image rows before delete (no duplicates)");
  const rowA=result.listedBeforeDelete.find(r=>r.id===result.idA);
  assert(rowA.is_primary===true,"image A should be primary after CASE 4");
  assert(Math.abs(rowA.crop.x-.7)<1e-9&&Math.abs(rowA.crop.zoom-1.4)<1e-9,"image A crop did not persist");
  const primaryCount=result.listedBeforeDelete.filter(r=>r.is_primary).length;
  assert(primaryCount===1,`expected exactly one primary image, got ${primaryCount}`);

  // CASE 5: reload persists primary + crop.
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector("#projectsScreen:not([hidden])");
  const reloaded=await page.evaluate(async s=>cloudState.imageApi.listImages(s.characterId,s.projectCharacterId),{characterId:result.characterId,projectCharacterId:result.projectCharacterId});
  assert(reloaded.ok&&reloaded.data.length===1,"expected exactly 1 remaining image row after reload (B was deleted)");
  const persistedA=reloaded.data[0];
  assert(persistedA.id===result.idA&&persistedA.is_primary===true,"primary image not persisted across reload");
  assert(Math.abs(persistedA.crop.x-.7)<1e-9,"crop not persisted across reload");

  console.log(JSON.stringify({ok:true,case1:true,case2:true,case3:true,case4:true,case5Reload:true,noDuplicates:true,onePrimary:true,deleteProbe:true}));
}finally{
  try{
    if(fixture?.characterId||fixture?.projectId){
      await page.evaluate(async f=>{
        // Deletion order matters: project_characters/character_images both hold
        // "on delete restrict" FKs to characters, so the project (which cascades to
        // project_characters) must go before the character, not after.
        if(f.characterId)await cloudState.client.from("character_images").delete().eq("character_id",f.characterId);
        if(f.projectId)await cloudState.client.from("projects").delete().eq("id",f.projectId);
        if(f.characterId)await cloudState.client.from("characters").delete().eq("id",f.characterId);
      },fixture);
    }
  }catch(cleanupError){console.log("cleanup error",cleanupError.message)}
  await context.close();
  await browser.close();
}
