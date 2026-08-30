import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(8000);

// Minimal mock Supabase client (same shape as tools/cloud-browser.test.mjs) with call counting added,
// so we can prove that typing into the search box performs zero extra cloud round-trips (SEARCH SEMANTICS /
// PERFORMANCE requirement: filtering must be client-side over the already-loaded workspace).
await page.addInitScript(()=>{
  const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"author@example.test"};
  const read=()=>{const db=JSON.parse(localStorage.getItem("mockCloud")||'{"profiles":[],"series":[],"projects":[],"chapters":[],"locations":[],"tags":[],"scenes":[],"scene_tags":[]}');for(const key of ["profiles","series","projects","chapters","locations","tags","scenes","scene_tags"])db[key]||=[];return db};
  const write=value=>localStorage.setItem("mockCloud",JSON.stringify(value));
  const listeners=[];
  globalThis.__mockFailures={};
  globalThis.__callLog=[];
  function builder(table){
    const state={action:"select",filters:[],payload:null,single:false};
    const api={
      select(){return api},is(field,value){state.filters.push(row=>row[field]===value);return api},
      eq(field,value){state.filters.push(row=>row[field]===value);return api},
      order(field){state.order=field;return api},single(){state.single=true;return api},
      insert(payload){state.action="insert";state.payload=payload;return api},
      update(payload){state.action="update";state.payload=payload;return api},
      then(resolve){
        globalThis.__callLog.push(`from:${table}:${state.action}`);
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
      globalThis.__callLog.push(`rpc:${name}`);
      if(globalThis.__mockFailures[name])return {data:null,error:new Error(globalThis.__mockFailures[name])};
      const db=read();
      const project=db.projects.find(item=>item.id===args?.target_project_id);
      if(name==="list_characters"||name==="list_global_character_links")return {data:{ok:true,code:"OK",changed:false,data:[]},error:null};
      if(name==="get_project_content")return {data:project?{ok:true,code:"OK",revision:project.revision||0,changed:false,data:{project:{id:project.id,revision:project.revision||0,updated_at:project.updated_at},chapters:db.chapters.filter(x=>x.project_id===project.id&&!x.deleted_at),locations:[],tags:[],scenes:db.scenes.filter(x=>x.project_id===project.id&&!x.deleted_at),scene_tags:[],project_characters:[],scene_characters:[],project_character_relations:[],scene_relation_changes:[],character_links:[]}}:{ok:false,code:"NOT_FOUND",changed:false},error:null};
      if(name==="create_scene"){
        if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
        const scene={id:crypto.randomUUID(),project_id:project.id,chapter_id:args.target_chapter_id,location_id:args.target_location_id,title:args.scene_title,scene_text:args.scene_text_value,scene_date:args.scene_date_value,scene_time:args.scene_time_value,placement_status:args.placement_status_value,writing_status:args.writing_status_value,included:args.included_value,date_review:args.date_review_value,position:args.scene_position||1000,deleted_at:null};db.scenes.push(scene);project.revision++;write(db);return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:scene},error:null};
      }
      if(name==="set_scene_tags")return {data:{ok:true,code:"OK",revision:project.revision||0,changed:false,data:[]},error:null};
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
await page.fill('#newProjectForm [name="title"]',"Search Project");
await page.click('#newProjectForm button[type="submit"]');
await page.waitForSelector("#newProjectModal",{state:"hidden"});
await page.locator(".cloud-project",{has:page.getByText("Search Project",{exact:true})}).getByRole("button",{name:"Открыть"}).click();
await page.waitForSelector('body[data-app-state="workspace"]');

for(const [title,text] of [["Утро","Тихое начало дня"],["Вечер","Обычный вечер"],["Ночь","Совсем другая тема"]]){
  await page.click("#addFirst");
  await page.waitForSelector("#sceneModal",{state:"visible"});
  await page.fill("#sceneTitle",title);
  await page.fill("#sceneText",text);
  await page.click("#saveScene");
  await page.getByText(title,{exact:true}).first().waitFor();
}

// SEARCH SEMANTICS in cloud mode: filtering narrows the cloud-hydrated scene list exactly like local mode.
const visibleTitles=async()=>page.evaluate(()=>getVisibleSceneEntries().map(({scene})=>scene.title));
await page.fill("#projectSearch","Совсем другая");
await page.waitForTimeout(250);
let titles=await visibleTitles();
if(titles.join(",")!=="Ночь")throw new Error(`Cloud-mode text search matched the wrong set: ${titles.join(",")}`);

// PERFORMANCE: typing into search must not perform any additional Supabase call.
await page.evaluate(()=>{globalThis.__callLog.length=0});
await page.fill("#projectSearch","");
await page.type("#projectSearch","Вечер",{delay:30});
await page.waitForTimeout(300);
titles=await visibleTitles();
if(titles.join(",")!=="Вечер")throw new Error(`Cloud-mode search regressed while typing: ${titles.join(",")}`);
const callsDuringSearch=await page.evaluate(()=>globalThis.__callLog.slice());
if(callsDuringSearch.length)throw new Error(`Search must be client-side only; observed cloud calls: ${JSON.stringify(callsDuringSearch)}`);

await context.close();await browser.close();
console.log("Scene search/filter (cloud mode) browser tests passed");
