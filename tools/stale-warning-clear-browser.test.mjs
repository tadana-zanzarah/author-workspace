import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});

// Root cause covered here: a save failure sets the #storageBanner to an "error" state, but
// neither the local-mode nor the cloud-mode save success paths ever cleared it — so a resolved
// problem kept showing until the next reload, looking like a stale leftover instead of something
// tied to the save that actually failed. Both paths (local commitDataChange/saveData, cloud
// runCloudMutation's "saved" state) now clear an "error" banner on the next successful save.
// Genuine non-error warnings (e.g. legacy/migration notices) must be left alone.

// ---- Local mode ----
{
  const context=await browser.newContext();
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${base}?local=1`,{waitUntil:"networkidle"});
  await page.waitForSelector('body[data-app-state="workspace"]');

  const afterFailure=await page.evaluate(()=>{
    const original=localStorage.setItem.bind(localStorage);
    localStorage.setItem=()=>{throw Object.assign(new Error("quota"),{name:"QuotaExceededError"})};
    const result=commitDataChange(next=>{next.__probe=(next.__probe||0)+1},{renderAfter:false});
    localStorage.setItem=original;
    const banner=document.getElementById("storageBanner");
    return {ok:result.ok,bannerClass:banner.className,bannerText:banner.textContent};
  });
  if(afterFailure.ok)throw new Error("local: the induced save failure did not actually fail");
  if(!afterFailure.bannerClass.includes("error")||!afterFailure.bannerText)throw new Error("local: a failed save did not show an error banner");

  const afterSuccess=await page.evaluate(()=>{
    const result=commitDataChange(next=>{next.__probe=(next.__probe||0)+1},{renderAfter:false});
    const banner=document.getElementById("storageBanner");
    return {ok:result.ok,bannerClass:banner.className,bannerText:banner.textContent};
  });
  if(!afterSuccess.ok)throw new Error("local: the follow-up save unexpectedly failed");
  if(afterSuccess.bannerClass.includes("error")||afterSuccess.bannerText)throw new Error("local: a successful save did not clear the earlier stale error banner");

  const realWarningPreserved=await page.evaluate(()=>{
    showStorageMessage("Реальное предупреждение, не связанное с ошибкой сохранения.","warning");
    const result=commitDataChange(next=>{next.__probe=(next.__probe||0)+1},{renderAfter:false});
    const banner=document.getElementById("storageBanner");
    return {ok:result.ok,bannerClass:banner.className,bannerText:banner.textContent};
  });
  if(!realWarningPreserved.ok)throw new Error("local: save unexpectedly failed while checking warning preservation");
  if(!realWarningPreserved.bannerClass.includes("warning")||!realWarningPreserved.bannerText)throw new Error("local: a successful save incorrectly hid a real, unrelated warning");

  await context.close();
}

// ---- Cloud mode ----
{
  const context=await browser.newContext();
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  await page.addInitScript(()=>{
    const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"author@example.test"};
    const read=()=>{const db=JSON.parse(localStorage.getItem("mockCloud")||'{"profiles":[],"series":[],"projects":[],"chapters":[],"locations":[],"tags":[],"scenes":[],"scene_tags":[]}');for(const key of ["profiles","series","projects","chapters","locations","tags","scenes","scene_tags"])db[key]||=[];return db};
    const write=value=>localStorage.setItem("mockCloud",JSON.stringify(value));
    const listeners=[];
    globalThis.__mockFailures={};
    function builder(table){
      const state={action:"select",filters:[],payload:null,single:false};
      const api={
        select(){return api},is(field,value){state.filters.push(row=>row[field]===value);return api},
        eq(field,value){state.filters.push(row=>row[field]===value);return api},
        order(field){state.order=field;return api},single(){state.single=true;return api},
        insert(payload){state.action="insert";state.payload=payload;return api},
        update(payload){state.action="update";state.payload=payload;return api},
        then(resolve){
          const failure=globalThis.__mockFailures[`${table}:${state.action}`];
          if(failure){resolve({data:null,error:new Error(failure)});return}
          const db=read();let rows=db[table].filter(row=>state.filters.every(filter=>filter(row)));
          if(state.action==="insert"){
            const payload=Array.isArray(state.payload)?state.payload:[state.payload];
            rows=payload.map(item=>({...item,id:item.id||crypto.randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:null,status:item.status||"active",...(table==="projects"?{revision:0}:{})}));
            db[table].push(...rows);write(db);
          }else if(state.action==="update"){
            rows=rows.map(row=>Object.assign(row,state.payload,{updated_at:new Date().toISOString()}));write(db);
          }else if(state.order)rows.sort((a,b)=>String(a[state.order]).localeCompare(String(b[state.order])));
          resolve({data:state.single?(rows[0]||null):rows,error:null});
        }
      };return api;
    }
    globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__={
      storage:{from(){return {async upload(){return {data:{},error:null}},async download(){return {data:null,error:new Error("missing")}},async remove(){return {data:{},error:null}}}}},
      auth:{
        async getSession(){return {data:{session:localStorage.getItem("mockSession")?{user}:null},error:null}},
        async getUser(){return {data:{user:localStorage.getItem("mockSession")?user:null},error:null}},
        onAuthStateChange(callback){listeners.push(callback);return {data:{subscription:{unsubscribe(){}}}}},
        async signInWithPassword(){const session={user};localStorage.setItem("mockSession","yes");listeners.forEach(cb=>cb("SIGNED_IN",session));return {data:{session,user},error:null}},
        async signUp(){return {data:{session:null,user},error:null}},
        async signOut(){localStorage.removeItem("mockSession");listeners.forEach(cb=>cb("SIGNED_OUT",null));return {error:null}}
      },
      from:builder,
      async rpc(name,args){
        if(globalThis.__mockFailures[name])return {data:null,error:new Error(globalThis.__mockFailures[name])};
        const db=read();
        const project=db.projects.find(item=>item.id===args.target_project_id);
        if(name==="list_characters"||name==="list_global_character_links")return {data:{ok:true,code:"OK",changed:false,data:[]},error:null};
        if(name==="get_project_content")return {data:project?{ok:true,code:"OK",revision:project.revision||0,changed:false,data:{project:{id:project.id,revision:project.revision||0,updated_at:project.updated_at},chapters:db.chapters.filter(x=>x.project_id===project.id&&!x.deleted_at),locations:db.locations.filter(x=>x.project_id===project.id&&!x.deleted_at),tags:db.tags.filter(x=>x.project_id===project.id),scenes:db.scenes.filter(x=>x.project_id===project.id&&!x.deleted_at),scene_tags:db.scene_tags.filter(x=>x.project_id===project.id),project_characters:[],scene_characters:[],project_character_relations:[],scene_relation_changes:[],character_links:[]}}:{ok:false,code:"NOT_FOUND",changed:false},error:null};
        if(name==="create_scene"){
          if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
          const scene={id:crypto.randomUUID(),project_id:project.id,chapter_id:args.target_chapter_id,location_id:args.target_location_id,title:args.scene_title,scene_text:args.scene_text_value,scene_date:args.scene_date_value,scene_time:args.scene_time_value,placement_status:args.placement_status_value,writing_status:args.writing_status_value,included:args.included_value,date_review:args.date_review_value,position:args.scene_position||1000,deleted_at:null};db.scenes.push(scene);project.revision++;write(db);return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:scene},error:null};
        }
        if(name==="update_scene"){
          if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
          const scene=db.scenes.find(x=>x.id===args.target_scene_id);if(!scene)return {data:{ok:false,code:"NOT_FOUND",changed:false},error:null};
          Object.assign(scene,{chapter_id:args.target_chapter_id,location_id:args.target_location_id,title:args.scene_title,scene_text:args.scene_text_value,scene_date:args.scene_date_value,scene_time:args.scene_time_value,placement_status:args.placement_status_value,writing_status:args.writing_status_value,included:args.included_value,date_review:args.date_review_value});
          project.revision++;write(db);return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:scene},error:null};
        }
        if(name==="set_scene_tags"){
          if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
          db.scene_tags=db.scene_tags.filter(x=>x.scene_id!==args.target_scene_id);for(const tag_id of args.tag_ids||[])db.scene_tags.push({project_id:project.id,scene_id:args.target_scene_id,tag_id});project.revision++;write(db);return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:args.tag_ids||[]},error:null};
        }
        if(name==="set_scene_characters"||name==="set_scene_relation_changes")return {data:{ok:true,code:"OK",revision:project.revision||0,changed:false,data:[]},error:null};
        write(db);return {data:null,error:null};
      }
    };
    const db=read();
    if(!db.profiles.length){db.profiles.push({user_id:user.id,display_name:"Автор",settings:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()});write(db)}
  });

  await page.goto(base,{waitUntil:"networkidle"});
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail","author@example.test");await page.fill("#authPassword","password");
  await page.click("#signInButton");await page.waitForSelector("#projectsScreen:not([hidden])");
  await page.getByRole("button",{name:"＋ Новый проект"}).first().click();
  await page.waitForSelector("#newProjectModal",{state:"visible"});
  await page.fill('#newProjectForm [name="title"]',"Warning Project");
  await page.click('#newProjectForm button[type="submit"]');
  await page.waitForSelector("#newProjectModal",{state:"hidden"});
  await page.locator(".cloud-project",{has:page.getByText("Warning Project",{exact:true})}).getByRole("button",{name:"Открыть"}).click();
  await page.waitForSelector('body[data-app-state="workspace"]');
  await page.click("#addFirst");await page.waitForSelector("#sceneModal",{state:"visible"});
  await page.fill("#sceneTitle","Warn Scene");await page.click("#saveScene");
  await page.getByText("Warn Scene",{exact:true}).waitFor();

  // The mutation queue intentionally latches "failed" after any error (AGENTS.md: a failure must
  // not be retried automatically) — so the realistic recovery path is cloudProjectSync.reload(),
  // exactly like the app's own REVISION_CONFLICT recovery prompt does, before the next edit can
  // go through at all. That reload does not itself touch the banner — only a genuinely successful
  // save afterwards should clear it.
  const reloadAndRerender=()=>page.evaluate(async()=>{const loaded=await cloudProjectSync.reload();if(loaded.ok){data=loaded.data;render()}else throw new Error("reload failed: "+loaded.message)});

  await page.evaluate(()=>{globalThis.__mockFailures.update_scene="offline"});
  await page.evaluate(()=>toggleIncluded(data.scenes.find(x=>x.title==="Warn Scene").id,false));
  await page.waitForFunction(()=>document.getElementById("storageBanner").className.includes("error"));
  const failedBannerText=await page.textContent("#storageBanner");
  if(!failedBannerText)throw new Error("cloud: a failed mutation did not show an error banner");

  await page.evaluate(()=>{delete globalThis.__mockFailures.update_scene});
  await reloadAndRerender();
  const stillErrorAfterReload=await page.evaluate(()=>document.getElementById("storageBanner").className);
  if(!stillErrorAfterReload.includes("error"))throw new Error("cloud: reload alone cleared the error banner (it should only clear on an actual successful save)");
  await page.evaluate(()=>toggleIncluded(data.scenes.find(x=>x.title==="Warn Scene").id,true));
  await page.waitForFunction(()=>!document.getElementById("storageBanner").className.includes("error"));
  const clearedBannerText=await page.textContent("#storageBanner");
  if(clearedBannerText)throw new Error("cloud: a successful mutation did not clear the earlier stale error banner text");

  await page.evaluate(()=>{globalThis.__mockFailures.update_scene="offline"});
  await page.evaluate(()=>toggleIncluded(data.scenes.find(x=>x.title==="Warn Scene").id,false));
  await page.waitForFunction(()=>document.getElementById("storageBanner").className.includes("error"));
  await page.evaluate(()=>{delete globalThis.__mockFailures.update_scene});
  await reloadAndRerender();
  await page.evaluate(()=>showStorageMessage("Реальное предупреждение, не связанное с ошибкой сохранения.","warning"));
  await page.evaluate(()=>toggleIncluded(data.scenes.find(x=>x.title==="Warn Scene").id,true));
  await page.waitForFunction(()=>document.getElementById("saveStatus").textContent==="Сохранено");
  const preservedWarning=await page.textContent("#storageBanner");
  const preservedClass=await page.evaluate(()=>document.getElementById("storageBanner").className);
  if(!preservedClass.includes("warning")||!preservedWarning)throw new Error("cloud: a successful mutation incorrectly hid a real, unrelated warning");

  await context.close();
}

await browser.close();
console.log("stale warning clear-on-success browser tests: OK");
