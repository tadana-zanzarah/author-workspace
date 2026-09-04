// Location Phase B3A -- NARROW real-cloud smoke against the REAL production Supabase project
// (already-published base_profile thematic-module contract), driven through the current
// feature-branch's ACTUAL application save path: js/locations.js's saveLocationProfile() and its
// real DOM (Location Profile modal, disclosure controls, multi-value widgets, Save button), not
// hand-written RPC calls. Disposable CLOUD_TEST fixture user + one disposable project + two
// disposable canonical Locations (primary + a parent for TEST 8), all named with this run's
// unique token. Skips gracefully if credentials are not configured. Mirrors
// tools/location-phase-b2-real-cloud-check.mjs exactly for login/cleanup conventions -- see that
// file's header for why (public anon key + RLS, no service role, cleanup via the already-
// authenticated browser session).
//
// Scope: this checks the B3A frontend/application path (js/locations.js + js/location-base-
// profile.js) against the already-published update_location_canonical(location_base_profile_
// patch) contract. No schema change, no migration, no SQL Editor, no direct manual SQL. The
// backend's own three-state contract (absent/null/{}/object) is already exhaustively covered by
// supabase/tests/location_base_profile_modules.sql in disposable CI -- this does not repeat that.
import {createRequire} from "node:module";
import crypto from "node:crypto";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const email=process.env.CLOUD_TEST_EMAIL,password=process.env.CLOUD_TEST_PASSWORD;
if(!email||!password){console.log("location phase B3A real-cloud check skipped: credentials are not configured");process.exit(0)}

const token=crypto.randomBytes(6).toString("hex");
const projectTitle=`AW loc-b3a ${token}`;
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const assert=(value,message)=>{if(!value)throw new Error(`ASSERT FAILED: ${message}`)};

async function login(){
  const context=await browser.newContext();
  const page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(base,{waitUntil:"networkidle"});
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword",password);await page.click("#signInButton");
  await page.waitForSelector("#projectsScreen:not([hidden])");
  await page.waitForFunction(()=>globalThis.cloudState?.dashboardStatus==="success",null,{timeout:30000});
  return {context,page};
}

// Identical convention to tools/location-phase-b2-real-cloud-check.mjs's cleanup(): delete the
// disposable project (cascades project_locations/scenes), then delete every canonical Location
// this account owns whose name contains this run's token -- not just the ones this script happened
// to capture an id for -- so a missed capture never orphans a globally-owned canonical row.
async function cleanup(page,projectIds,canonicalLocationIds,titles,token){
  return page.evaluate(async({projectIds,canonicalLocationIds,titles,token})=>{
    const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm");
    const client=createClient("https://crchibwumcuuqhkabmfj.supabase.co","sb_publishable_XF0Jk1qKpK4OgW8NAyaj7g_IuAdH8RT");
    const session=await cloudState.client.auth.getSession();
    await client.auth.setSession(session.data.session);
    const owner=session.data.session.user.id;
    const found=await client.from("projects").select("id").in("title",titles);
    if(found.error)throw found.error;
    const projects=[...new Set([...projectIds,...found.data.map(x=>x.id)])];
    if(projects.length){const d=await client.from("projects").delete().in("id",projects);if(d.error)throw d.error}
    const ownedLocations=await client.from("locations").select("id,name").eq("owner_id",owner);
    if(ownedLocations.error)throw ownedLocations.error;
    const tokenMatchedLocationIds=ownedLocations.data.filter(l=>l.name.includes(token)).map(l=>l.id);
    const allLocationIds=[...new Set([...canonicalLocationIds,...tokenMatchedLocationIds])];
    if(allLocationIds.length){const d=await client.from("locations").delete().in("id",allLocationIds);if(d.error)throw d.error}
    const remainingProjects=await client.from("projects").select("id").in("id",projects);
    const remainingLocations=allLocationIds.length?await client.from("locations").select("id").in("id",allLocationIds):{data:[]};
    const remainingParticipation=projects.length?await client.from("project_locations").select("id").in("project_id",projects):{data:[]};
    const remainingScenes=projects.length?await client.from("scenes").select("id").in("project_id",projects):{data:[]};
    return {
      projects:remainingProjects.data.length,locations:remainingLocations.data.length,
      participation:remainingParticipation.data.length,scenes:remainingScenes.data.length
    };
  },{projectIds,canonicalLocationIds,titles,token});
}

// --- small DOM helpers over the real Location Profile modal (same ids the B3A local browser
// test drives -- tools/location-phase-b3a-profile-modules-browser.test.mjs) ---
async function ensureExpanded(page,moduleKey){
  const toggleId=moduleKey==="appearanceAtmosphere"?"locProfileAppearanceToggle":"locProfileGeographyToggle";
  const expanded=await page.evaluate(id=>document.getElementById(id).getAttribute("aria-expanded")==="true",toggleId);
  if(!expanded)await page.click(`#${toggleId}`);
}
async function addMultiValue(page,hostId,text){
  const host=page.locator(`#${hostId}`);
  await host.locator("input").click();
  await host.locator("input").fill(text);
  await host.locator("input").press("Enter");
}
async function clickSaveAndWait(page){
  await page.click("#locationProfileSave");
  await page.waitForFunction(()=>document.getElementById("locationProfileEditView").hidden===true,{timeout:15000});
}
async function callsSince(page,index){return page.evaluate(i=>window.__b3aCalls.slice(i),index)}

let session,report={},projectIds=[],canonicalLocationIds=[];
try{
  session=await login();
  const {page}=session;

  // ---- Fixture project ----
  const project=await page.evaluate(async title=>{
    const owner=cloudState.session.user.id;
    return cloudState.api.createProject({ownerId:owner,title});
  },projectTitle);
  projectIds.push(project.id);
  const pa=project.id;
  let rev=0;

  // ---- Fixture: primary Location (core-only) ----
  const primaryCreate=await page.evaluate(async({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`B3A Primary ${token}`,typePreset:"settlement",description:`Disposable B3A smoke fixture ${token}.`,shortSummary:`Original short summary ${token}.`
  }),{pa,rev,token});
  assert(primaryCreate.ok,`create_location_canonical (primary) must succeed: ${JSON.stringify(primaryCreate)}`);
  rev=primaryCreate.revision;
  const participationId=primaryCreate.data.id,canonicalId=primaryCreate.data.location_id;
  canonicalLocationIds.push(canonicalId);

  // ---- Fixture: parent Location (TEST 8 only) ----
  const parentCreate=await page.evaluate(async({pa,rev,token})=>cloudState.contentApi.createLocationCanonical(pa,rev,{
    name:`B3A Parent ${token}`,typePreset:"country",description:""
  }),{pa,rev,token});
  assert(parentCreate.ok,`create_location_canonical (parent) must succeed: ${JSON.stringify(parentCreate)}`);
  rev=parentCreate.revision;
  const parentCanonicalId=parentCreate.data.location_id;
  canonicalLocationIds.push(parentCanonicalId);

  // ---- Open the disposable project through the REAL workspace path ----
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  let opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  for(let attempt=0;attempt<3&&!opened;attempt++){
    await page.waitForTimeout(1000);
    await page.evaluate(async project=>{await openCloudProject(project)},project);
    opened=await page.locator('body[data-app-state="workspace"]').isVisible().catch(()=>false);
  }
  assert(opened,"openCloudProject must reach workspace state for the disposable project");

  // Spy on the two RPC wrappers saveLocationProfile() actually calls, WITHOUT reimplementing
  // them -- installed on cloudState.contentApi, which is the single instance created once at
  // login and reused as cloudProjectSync.api for every project open (js/cloud-app.js:244,256), so
  // this survives every reload()/reopen for the rest of this run. Records the real arguments
  // saveLocationProfile() passed, i.e. the actual outgoing location_base_profile_patch.
  await page.evaluate(()=>{
    window.__b3aCalls=[];
    const originalUpdate=cloudState.contentApi.updateLocationCanonical.bind(cloudState.contentApi);
    cloudState.contentApi.updateLocationCanonical=(...args)=>{
      window.__b3aCalls.push({name:"updateLocationCanonical",locationId:args[0],expectedRevision:args[1],options:args[2]});
      return originalUpdate(...args);
    };
    const originalParent=cloudState.contentApi.setLocationParent.bind(cloudState.contentApi);
    cloudState.contentApi.setLocationParent=(...args)=>{
      window.__b3aCalls.push({name:"setLocationParent",locationId:args[0],expectedRevision:args[1],parentId:args[2]});
      return originalParent(...args);
    };
  });

  // ================= TEST 1: initial hydration =================
  await page.evaluate(id=>openLocationProfile(id),participationId);
  const initial=await page.evaluate(id=>{
    const location=locationById(id);
    return {
      appearanceEmpty:isModuleEmpty(normalizeAppearanceAtmosphere(location.baseProfile?.appearanceAtmosphere)),
      geographyEmpty:isModuleEmpty(normalizeGeography(location.baseProfile?.geography)),
      description:location.description,shortSummary:location.shortSummary,
      hasAppearanceKey:!!location.baseProfile&&"appearanceAtmosphere" in location.baseProfile,
      hasGeographyKey:!!location.baseProfile&&"geography" in location.baseProfile
    };
  },participationId);
  assert(initial.appearanceEmpty,"a freshly-created Location's Appearance must hydrate as semantically empty");
  assert(initial.geographyEmpty,"a freshly-created Location's Geography must hydrate as semantically empty");
  assert(initial.description===`Disposable B3A smoke fixture ${token}.`,"description must be unaffected by B3A hydration");
  assert(initial.shortSummary===`Original short summary ${token}.`,"shortSummary must be unaffected by B3A hydration");
  // Opening the read-only Profile issues no RPC call at all -- confirm no accidental thematic key
  // was persisted merely by hydrating/opening (a raw server-side read, not the JS-hydrated shape).
  const rawAfterOpen=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rawPrimaryAfterOpen=rawAfterOpen.data.locations.find(l=>l.id===participationId);
  assert(!("appearanceAtmosphere" in (rawPrimaryAfterOpen.base_profile||{})),"merely opening/hydrating must not persist an appearanceAtmosphere key server-side");
  assert(!("geography" in (rawPrimaryAfterOpen.base_profile||{})),"merely opening/hydrating must not persist a geography key server-side");
  report.test1_initialHydration={appearanceEmpty:true,geographyEmpty:true,coreFieldsUnaffected:true,noAccidentalServerPersistence:true};
  await page.evaluate(()=>document.getElementById("locationProfileClose").click());

  // ================= TEST 2: save Appearance only =================
  const revBeforeAppearance=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  const callsBeforeAppearance=(await page.evaluate(()=>window.__b3aCalls.length));
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  await ensureExpanded(page,"appearanceAtmosphere");
  await page.fill("#locProfileVisualDescription",`Каменные стены, покрытые мхом ${token}.`);
  await page.fill("#locProfileAtmosphere",`Тихо и торжественно ${token}.`);
  await page.fill("#locProfileClimateFeel",`Даже летом здесь прохладно ${token}.`);
  await addMultiValue(page,"locProfileNotableFeatures",`Треснувший колокол ${token}`);
  await clickSaveAndWait(page);
  const callsAfterAppearance=await callsSince(page,callsBeforeAppearance);
  assert(callsAfterAppearance.length===1&&callsAfterAppearance[0].name==="updateLocationCanonical","exactly one updateLocationCanonical call must fire for an Appearance-only save");
  const appearancePatch=callsAfterAppearance[0].options.baseProfilePatch;
  assert(appearancePatch&&"appearanceAtmosphere" in appearancePatch,`outgoing patch must contain appearanceAtmosphere: ${JSON.stringify(appearancePatch)}`);
  assert(!("geography" in appearancePatch),`outgoing patch must NOT contain geography (untouched): ${JSON.stringify(appearancePatch)}`);
  const revAfterAppearance=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  assert(revAfterAppearance===revBeforeAppearance+1,`revision must advance by exactly 1 (before=${revBeforeAppearance}, after=${revAfterAppearance})`);
  // Fresh cloud read (not just the in-memory post-save state) to confirm real persistence.
  const freshAfterAppearance=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterAppearance=freshAfterAppearance.data.locations.find(l=>l.id===participationId);
  assert(rowAfterAppearance.base_profile.appearanceAtmosphere?.visualDescription===`Каменные стены, покрытые мхом ${token}.`,"Appearance visualDescription must persist to a fresh cloud read");
  assert(JSON.stringify(rowAfterAppearance.base_profile.appearanceAtmosphere?.notableFeatures)===JSON.stringify([`Треснувший колокол ${token}`]),"notableFeatures must persist as an array");
  assert(!("geography" in rowAfterAppearance.base_profile),"Geography must remain absent after an Appearance-only save");
  assert(rowAfterAppearance.description===`Disposable B3A smoke fixture ${token}.`&&rowAfterAppearance.base_profile.shortSummary===`Original short summary ${token}.`,"description/shortSummary must be preserved");
  report.test2_appearanceOnly={patchShape:Object.keys(appearancePatch),revision:`${revBeforeAppearance}->${revAfterAppearance}`,persisted:true};

  // ================= TEST 3: save Geography, preserving Appearance =================
  const revBeforeGeography=revAfterAppearance;
  const callsBeforeGeography=await page.evaluate(()=>window.__b3aCalls.length);
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  await ensureExpanded(page,"geography");
  await page.fill("#locProfileTerrain",`Скалистое плато ${token}`);
  await page.fill("#locProfileClimate",`Сухой континентальный ${token}`);
  await page.fill("#locProfileCoordinates","52°N 8°E");
  await addMultiValue(page,"locProfileNaturalFeatures",`Расщелина ${token}`);
  await clickSaveAndWait(page);
  const callsAfterGeography=await callsSince(page,callsBeforeGeography);
  assert(callsAfterGeography.length===1,"exactly one updateLocationCanonical call must fire for a Geography-only save");
  const geographyPatch=callsAfterGeography[0].options.baseProfilePatch;
  assert(geographyPatch&&"geography" in geographyPatch,`outgoing patch must contain geography: ${JSON.stringify(geographyPatch)}`);
  assert(!("appearanceAtmosphere" in geographyPatch),`outgoing patch must NOT contain appearanceAtmosphere (untouched): ${JSON.stringify(geographyPatch)}`);
  const revAfterGeography=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  assert(revAfterGeography===revBeforeGeography+1,`revision must advance by exactly 1 (before=${revBeforeGeography}, after=${revAfterGeography})`);
  const freshAfterGeography=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterGeography=freshAfterGeography.data.locations.find(l=>l.id===participationId);
  assert(rowAfterGeography.base_profile.appearanceAtmosphere?.visualDescription===`Каменные стены, покрытые мхом ${token}.`,"Appearance must remain EXACTLY preserved after a Geography-only save");
  assert(rowAfterGeography.base_profile.geography?.terrain===`Скалистое плато ${token}`,"Geography terrain must persist");
  assert(rowAfterGeography.base_profile.geography?.coordinates==="52°N 8°E","Geography coordinates must persist");
  assert(rowAfterGeography.name===`B3A Primary ${token}`,"Core Identity (name) must remain preserved");
  report.test3_geographyPreservesAppearance={patchShape:Object.keys(geographyPatch),appearancePreserved:true,revision:`${revBeforeGeography}->${revAfterGeography}`};

  // ================= TEST 4: individual field clear (Geography.climate) =================
  const revBeforeFieldClear=revAfterGeography;
  const callsBeforeFieldClear=await page.evaluate(()=>window.__b3aCalls.length);
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  assert((await page.evaluate(()=>document.getElementById("locProfileClimate").value))===`Сухой континентальный ${token}`,"climate must be prefilled from the prior save before clearing it");
  await page.fill("#locProfileClimate","");
  await clickSaveAndWait(page);
  const callsAfterFieldClear=await callsSince(page,callsBeforeFieldClear);
  assert(callsAfterFieldClear.length===1&&callsAfterFieldClear[0].name==="updateLocationCanonical","exactly one updateLocationCanonical call must fire for a field-clear save");
  const fieldClearPatch=callsAfterFieldClear[0].options.baseProfilePatch;
  assert(fieldClearPatch.geography&&typeof fieldClearPatch.geography==="object","clearing one field must send a full replacement object, not null");
  assert(fieldClearPatch.geography.terrain===`Скалистое плато ${token}`,"the replacement object must still contain the untouched terrain field");
  assert(!("climate" in fieldClearPatch.geography),`the replacement object must NOT contain climate: ${JSON.stringify(fieldClearPatch.geography)}`);
  const revAfterFieldClear=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  assert(revAfterFieldClear===revBeforeFieldClear+1,"field-clear save must advance revision by exactly 1");
  const freshAfterFieldClear=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterFieldClear=freshAfterFieldClear.data.locations.find(l=>l.id===participationId);
  assert(rowAfterFieldClear.base_profile.geography.terrain===`Скалистое плато ${token}`,"terrain must remain after clearing only climate");
  assert(!("climate" in rowAfterFieldClear.base_profile.geography),"climate key must be genuinely gone from the stored module, not an empty string");
  report.test4_individualFieldClear={outgoingReplacementOmitsClimate:true,terrainSurvives:true,climateAbsentAfterReload:true};

  // ================= TEST 5: full module clear (Appearance) =================
  const revBeforeModuleClear=revAfterFieldClear;
  const callsBeforeModuleClear=await page.evaluate(()=>window.__b3aCalls.length);
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  await page.click("#locProfileAppearanceClear");
  await clickSaveAndWait(page);
  const callsAfterModuleClear=await callsSince(page,callsBeforeModuleClear);
  assert(callsAfterModuleClear.length===1&&callsAfterModuleClear[0].name==="updateLocationCanonical","exactly one updateLocationCanonical call must fire for a module-clear save");
  const moduleClearPatch=callsAfterModuleClear[0].options.baseProfilePatch;
  assert(moduleClearPatch.appearanceAtmosphere===null,`fully clearing a module must send JSON null, got: ${JSON.stringify(moduleClearPatch.appearanceAtmosphere)}`);
  assert(!("geography" in moduleClearPatch),"clearing Appearance must not touch the Geography key in the patch");
  const revAfterModuleClear=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  assert(revAfterModuleClear===revBeforeModuleClear+1,"module-clear save must advance revision by exactly 1");
  const freshAfterModuleClear=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterModuleClear=freshAfterModuleClear.data.locations.find(l=>l.id===participationId);
  assert(!("appearanceAtmosphere" in rowAfterModuleClear.base_profile),"appearanceAtmosphere key must be entirely absent from base_profile after a full clear, not {}");
  assert(rowAfterModuleClear.base_profile.geography.terrain===`Скалистое плато ${token}`,"Geography must remain intact after clearing Appearance");
  assert(rowAfterModuleClear.name===`B3A Primary ${token}`,"Core Identity must remain intact after clearing Appearance");
  report.test5_fullModuleClear={outgoingNull:true,keyAbsentAfterReload:true,siblingModulePreserved:true};

  // ================= TEST 6: both modules in one save =================
  const revBeforeBoth=revAfterModuleClear;
  const callsBeforeBoth=await page.evaluate(()=>window.__b3aCalls.length);
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  await ensureExpanded(page,"appearanceAtmosphere");
  await page.fill("#locProfileVisualDescription",`Возрождённое убранство зала ${token}.`);
  await page.fill("#locProfileVegetation",`Дикий плющ по стенам ${token}`);
  await clickSaveAndWait(page);
  const callsAfterBoth=await callsSince(page,callsBeforeBoth);
  assert(callsAfterBoth.length===1,`changing both modules in one edit must still be exactly ONE canonical call, got ${callsAfterBoth.length}`);
  const bothPatch=callsAfterBoth[0].options.baseProfilePatch;
  assert("appearanceAtmosphere" in bothPatch&&"geography" in bothPatch,`patch must carry both module keys in one call: ${JSON.stringify(bothPatch)}`);
  const revAfterBoth=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  assert(revAfterBoth===revBeforeBoth+1,`both-modules-in-one-save must advance revision by exactly 1 (not 2), before=${revBeforeBoth} after=${revAfterBoth}`);
  const freshAfterBoth=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterBoth=freshAfterBoth.data.locations.find(l=>l.id===participationId);
  assert(rowAfterBoth.base_profile.appearanceAtmosphere?.visualDescription===`Возрождённое убранство зала ${token}.`,"Appearance change from the combined save must persist");
  assert(rowAfterBoth.base_profile.geography?.vegetation===`Дикий плющ по стенам ${token}`,"Geography change from the combined save must persist");
  report.test6_bothModulesOneSave={singleCanonicalCall:true,oneRevisionIncrement:true,bothPersisted:true};

  // ================= TEST 7: Core field + thematic field in one save =================
  const revBeforeCoreThematic=revAfterBoth;
  const callsBeforeCoreThematic=await page.evaluate(()=>window.__b3aCalls.length);
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  await page.fill("#locProfileShortSummary",`Обновлённое короткое описание ${token}.`);
  await page.fill("#locProfileWater",`Подземный источник ${token}`);
  await clickSaveAndWait(page);
  const callsAfterCoreThematic=await callsSince(page,callsBeforeCoreThematic);
  assert(callsAfterCoreThematic.length===1,"Core + thematic in one edit must still be exactly ONE canonical call");
  const revAfterCoreThematic=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  assert(revAfterCoreThematic===revBeforeCoreThematic+1,"Core + thematic save must advance revision by exactly 1");
  const freshAfterCoreThematic=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterCoreThematic=freshAfterCoreThematic.data.locations.find(l=>l.id===participationId);
  assert(rowAfterCoreThematic.base_profile.shortSummary===`Обновлённое короткое описание ${token}.`,"the ordinary core field (shortSummary) must persist");
  assert(rowAfterCoreThematic.base_profile.geography?.water===`Подземный источник ${token}`,"the thematic field (geography.water) from the SAME save must persist");
  report.test7_coreAndThematicOneSave={singleCanonicalCall:true,oneRevisionIncrement:true,bothValuesPersisted:true};

  // ================= TEST 8: Core + thematic + parent revision chain =================
  const revBeforeChain=revAfterCoreThematic;
  const callsBeforeChain=await page.evaluate(()=>window.__b3aCalls.length);
  // Pre-warm the owned-locations cache synchronously so the parent picker is populated the
  // instant edit mode opens (syncLocationProfileEditFields reads it synchronously from cache --
  // see js/locations.js ownedLocationRowsSync/ensureOwnedLocationsLoaded), avoiding a flaky race
  // against the async list_owned_locations fetch that would otherwise still be in flight.
  await page.evaluate(()=>loadOwnedLocationRows(true));
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  await page.fill("#locProfileOfficialName",`Официальное название ${token}`);
  await ensureExpanded(page,"appearanceAtmosphere");
  await page.fill("#locProfileSounds",`Эхо шагов по камню ${token}`);
  await page.click("#locProfileParent");
  await page.locator("#locProfileParentListbox [role=option]",{hasText:`B3A Parent ${token}`}).click();
  assert(await page.evaluate(()=>trackerFor("locationProfileModal").isDirty()),"selecting a parent must mark the form dirty before save");
  await clickSaveAndWait(page);
  const callsAfterChain=await callsSince(page,callsBeforeChain);
  assert(callsAfterChain.length===2,`Core+thematic+parent must be exactly TWO calls (update then set-parent), got ${callsAfterChain.length}: ${JSON.stringify(callsAfterChain.map(c=>c.name))}`);
  assert(callsAfterChain[0].name==="updateLocationCanonical"&&callsAfterChain[1].name==="setLocationParent","order must be updateLocationCanonical THEN setLocationParent");
  assert(callsAfterChain[0].expectedRevision===revBeforeChain,"the core-identity call must use the revision the Location had BEFORE this edit");
  const chainPatch=callsAfterChain[0].options.baseProfilePatch;
  assert(chainPatch&&"appearanceAtmosphere" in chainPatch,"the core-identity call in the chain must still carry the thematic patch");
  const revAfterChain=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  assert(callsAfterChain[1].expectedRevision===revBeforeChain+1,`set_location_parent must be called with the FRESH revision update_location_canonical returned (expected ${revBeforeChain+1}, got ${callsAfterChain[1].expectedRevision})`);
  assert(revAfterChain===revBeforeChain+2,`the full chain must advance revision by exactly 2 (core step + parent step), before=${revBeforeChain} after=${revAfterChain}`);
  const freshAfterChain=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterChain=freshAfterChain.data.locations.find(l=>l.id===participationId);
  assert(rowAfterChain.official_name===`Официальное название ${token}`,"Core field (officialName) from the chained save must persist");
  assert(rowAfterChain.base_profile.appearanceAtmosphere?.sounds===`Эхо шагов по камню ${token}`,"Thematic field from the chained save must persist");
  assert(rowAfterChain.parent_id===parentCanonicalId,"parent_id must reflect the newly selected parent after the chain");
  report.test8_coreThematicParentChain={tested:true,twoCalls:true,order:"updateLocationCanonical -> setLocationParent",
    freshRevisionChaining:`core:${revBeforeChain}->${revBeforeChain+1}, parent:${revBeforeChain+1}->${revAfterChain}`,allThreeCategoriesPersisted:true};

  // ================= TEST 9: no-op thematic save =================
  const revBeforeNoop=revAfterChain;
  const callsBeforeNoop=await page.evaluate(()=>window.__b3aCalls.length);
  await page.evaluate(id=>openLocationProfile(id),participationId);
  await page.click("#locationProfileEdit");
  const dirtyOnOpen=await page.evaluate(()=>trackerFor("locationProfileModal").isDirty());
  const saveDisabledOnOpen=await page.evaluate(()=>document.getElementById("locationProfileSave").disabled);
  assert(!dirtyOnOpen,"opening Edit on an unchanged Location must not mark the form dirty");
  assert(saveDisabledOnOpen,"Save must stay disabled -- the UI must not be able to fire a meaningless save at all");
  const callsAfterNoopAttempt=await callsSince(page,callsBeforeNoop);
  assert(callsAfterNoopAttempt.length===0,"no RPC call may fire when nothing was changed");
  await page.evaluate(()=>document.getElementById("locationProfileCancelEdit").click());
  // Supplementary application-layer confirmation (same layer B2's own no-op tests exercise): an
  // explicit no-op call (unchanged core fields, baseProfilePatch:null) must report changed:false
  // and must NOT advance the revision -- proves the already-published RPC contract still holds
  // through this exact JS wrapper, without re-deriving the whole SQL-level no-op suite.
  // typePreset must be passed explicitly and match the fixture's actual stored value ("settlement")
  // -- the JS wrapper defaults an OMITTED typePreset to null (see js/cloud-content-api.js), which
  // would make this call a real mutation (type_preset: "settlement" -> null), not the no-op it is
  // meant to prove.
  const explicitNoop=await page.evaluate(async({canonicalId,revBeforeNoop,token})=>cloudState.contentApi.updateLocationCanonical(canonicalId,revBeforeNoop,{
    name:`B3A Primary ${token}`,officialName:`Официальное название ${token}`,typePreset:"settlement",description:`Disposable B3A smoke fixture ${token}.`,
    shortSummary:`Обновлённое короткое описание ${token}.`,baseProfilePatch:null
  }),{canonicalId,revBeforeNoop,token});
  assert(explicitNoop.ok&&explicitNoop.changed===false,`an explicit unchanged-fields + baseProfilePatch:null call must report changed:false: ${JSON.stringify(explicitNoop)}`);
  assert(explicitNoop.locationRevision===revBeforeNoop,"a genuine no-op must not advance the revision");
  report.test9_noOp={uiPreventedAnyCall:true,revisionUnchanged:true,falseThematicPatchGenerated:false};

  // ================= TEST 10: stale revision =================
  const revBeforeStale=(await page.evaluate(id=>locationById(id).locationRevision,participationId));
  const successfulStaleSetup=await page.evaluate(async({canonicalId,revBeforeStale,token})=>cloudState.contentApi.updateLocationCanonical(canonicalId,revBeforeStale,{
    name:`B3A Primary ${token}`,officialName:`Официальное название ${token}`,typePreset:"settlement",description:`Disposable B3A smoke fixture ${token}.`,
    shortSummary:`Обновлённое короткое описание ${token}.`,baseProfilePatch:{geography:{terrain:`Скалистое плато ${token}`,climate:`STALE-TARGET ${token}`}}
  }),{canonicalId,revBeforeStale,token});
  assert(successfulStaleSetup.ok&&successfulStaleSetup.locationRevision===revBeforeStale+1,`stale-test setup update must succeed and advance revision: ${JSON.stringify(successfulStaleSetup)}`);
  const staleAttempt=await page.evaluate(async({canonicalId,revBeforeStale,token})=>cloudState.contentApi.updateLocationCanonical(canonicalId,revBeforeStale,{
    name:`B3A Primary ${token}`,officialName:`Официальное название ${token}`,typePreset:"settlement",description:`Disposable B3A smoke fixture ${token}.`,
    shortSummary:`Обновлённое короткое описание ${token}.`,baseProfilePatch:{geography:{terrain:`Скалистое плато ${token}`,climate:`STALE OVERWRITE ATTEMPT ${token}`}}
  }),{canonicalId,revBeforeStale,token});
  assert(!staleAttempt.ok&&staleAttempt.code==="LOCATION_REVISION_CONFLICT",`a thematic save with a stale expected_location_revision must be rejected: ${JSON.stringify(staleAttempt)}`);
  const freshAfterStale=await page.evaluate(pa=>cloudState.contentApi.loadProjectContent(pa),pa);
  const rowAfterStale=freshAfterStale.data.locations.find(l=>l.id===participationId);
  assert(rowAfterStale.base_profile.geography.climate===`STALE-TARGET ${token}`,"the successful setup update's value must remain -- the stale attempt must not have overwritten it");
  report.test10_staleRevision={tested:true,code:staleAttempt.code,newerValuePreserved:true};

  // ================= TEST 11: hydration after a genuinely fresh reopen =================
  await page.evaluate(async project=>{await openCloudProject(project)},project);
  await page.waitForFunction(()=>Array.isArray(globalThis.data?.locations));
  const finalHydration=await page.evaluate(id=>{
    const location=locationById(id);
    // Use the REAL hydration helpers (js/location-base-profile.js), not a raw read of
    // location.baseProfile directly -- the normalized storage contract deliberately OMITS an
    // empty array field entirely (see TEST 10's manual replace, which dropped naturalFeatures),
    // so "missing key" is an expected, legitimate storage state. What must always hold is the
    // HYDRATION safety net: hydrateAppearanceAtmosphere/hydrateGeography must turn that missing
    // key into a real [] for the UI, never undefined.
    const hydratedAppearance=hydrateAppearanceAtmosphere(location.baseProfile?.appearanceAtmosphere);
    const hydratedGeography=hydrateGeography(location.baseProfile?.geography);
    return {
      id:location.id,locationId:location.locationId,
      hasDescription:typeof location.baseProfile?.description==="string",
      hasShortSummary:typeof location.baseProfile?.shortSummary==="string",
      appearance:location.baseProfile?.appearanceAtmosphere,
      geography:location.baseProfile?.geography,
      notableFeaturesIsArray:Array.isArray(hydratedAppearance.notableFeatures),
      naturalFeaturesIsArray:Array.isArray(hydratedGeography.naturalFeatures)
    };
  },participationId);
  assert(finalHydration.id===participationId&&finalHydration.locationId===canonicalId,"B3A must not disturb B2 identity semantics: id=participation, locationId=canonical");
  assert(finalHydration.hasDescription&&finalHydration.hasShortSummary,"description/shortSummary must hydrate as strings on a fresh reopen");
  assert(!finalHydration.appearance||typeof finalHydration.appearance==="object","appearanceAtmosphere, if present, must hydrate as an object (it was cleared in TEST 5 then repopulated in TEST 6)");
  assert(finalHydration.geography&&typeof finalHydration.geography==="object","geography must hydrate as an object");
  assert(finalHydration.notableFeaturesIsArray,"notableFeatures must hydrate as a real array on a fresh reopen");
  assert(finalHydration.naturalFeaturesIsArray,"naturalFeatures must hydrate as a real array on a fresh reopen");
  report.test11_freshHydration={idSemanticsCorrect:true,shapesCorrect:true,arraysHydrateAsArrays:true};

  console.log(JSON.stringify({ok:true,...report},null,2));
}catch(error){
  console.log(JSON.stringify({ok:false,error:error.message,partialReport:report},null,2));
  process.exitCode=1;
}finally{
  try{
    if(!session)throw new Error("login never succeeded; nothing to clean up via the browser session");
    const counts=await cleanup(session.page,projectIds,canonicalLocationIds,[projectTitle],token);
    console.log(JSON.stringify({cleanup:counts}));
    if(!(counts.projects===0&&counts.locations===0&&counts.participation===0&&counts.scenes===0)){
      console.log(JSON.stringify({cleanupIncomplete:true,counts}));
      process.exitCode=1;
    }
  }catch(cleanupError){
    console.log(JSON.stringify({cleanupError:cleanupError.message}));
    process.exitCode=1;
  }
  if(session)await session.context.close();
  await browser.close();
}
