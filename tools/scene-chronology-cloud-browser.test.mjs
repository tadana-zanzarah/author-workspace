import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(8000);

// Minimal mock Supabase client (same shape as tools/cloud-browser.test.mjs / tools/scene-search-filter-cloud-browser.test.mjs).
// create_scene deliberately ignores the client-suggested position and assigns a purely global,
// chapter-agnostic incrementing position — this is the worst case docs/cloud-content-architecture.md
// allows for scenes.position ("chapter_id is a grouping attribute, not an independent ordering
// system"), and it is exactly the shape of server order that used to make chronologicalWarning
// compare a scene against a different chapter's neighbor. If the fix in
// hydrateProjectFromCloudSnapshot (chapter-group before position tie-break) holds, that must never
// produce a false conflict in the table view.
await page.addInitScript(()=>{
  const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"author@example.test"};
  const read=()=>{const db=JSON.parse(localStorage.getItem("mockCloud")||'{"profiles":[],"series":[],"projects":[],"chapters":[],"locations":[],"tags":[],"scenes":[],"scene_tags":[]}');for(const key of ["profiles","series","projects","chapters","locations","tags","scenes","scene_tags"])db[key]||=[];return db};
  const write=value=>localStorage.setItem("mockCloud",JSON.stringify(value));
  const listeners=[];
  globalThis.__mockFailures={};
  globalThis.__callLog=[];
  globalThis.__positionCounter=0;
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
      if(name==="create_chapter"){
        if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
        const chapter={id:crypto.randomUUID(),project_id:project.id,title:args.chapter_title,position:args.chapter_position,deleted_at:null};
        db.chapters.push(chapter);project.revision++;write(db);
        return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:chapter},error:null};
      }
      if(name==="create_scene"){
        if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
        // Deliberately chapter-agnostic global counter — see comment above.
        const position=(globalThis.__positionCounter+=1)*1000;
        const scene={id:crypto.randomUUID(),project_id:project.id,chapter_id:args.target_chapter_id,location_id:args.target_location_id,title:args.scene_title,scene_text:args.scene_text_value,scene_date:args.scene_date_value,scene_time:args.scene_time_value,placement_status:args.placement_status_value,writing_status:args.writing_status_value,included:args.included_value,date_review:args.date_review_value,position,deleted_at:null};
        db.scenes.push(scene);project.revision++;write(db);
        return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:scene},error:null};
      }
      if(name==="update_scene"){
        if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
        const scene=db.scenes.find(x=>x.id===args.target_scene_id);
        Object.assign(scene,{chapter_id:args.target_chapter_id,location_id:args.target_location_id,title:args.scene_title,scene_text:args.scene_text_value,scene_date:args.scene_date_value,scene_time:args.scene_time_value,placement_status:args.placement_status_value,writing_status:args.writing_status_value,included:args.included_value,date_review:args.date_review_value});
        project.revision++;write(db);
        return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:scene},error:null};
      }
      if(name==="move_scene"){
        if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
        const scene=db.scenes.find(x=>x.id===args.target_scene_id);
        scene.chapter_id=args.target_chapter_id;
        scene.position=(globalThis.__positionCounter+=1)*1000;
        project.revision++;write(db);
        return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:scene},error:null};
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
await page.fill('#newProjectForm [name="title"]',"Chronology Project");
await page.click('#newProjectForm button[type="submit"]');
await page.waitForSelector("#newProjectModal",{state:"hidden"});
await page.locator(".cloud-project",{has:page.getByText("Chronology Project",{exact:true})}).getByRole("button",{name:"Открыть"}).click();
await page.waitForSelector('body[data-app-state="workspace"]');

// Two explicit chapters (leaving the default "Без главы" unused and empty), so scene creation
// order can interleave chapters through the mock's chapter-agnostic global position counter,
// while chapter ORDER stays unambiguous: Chapter One, then Chapter Two.
await page.locator("#projectMenu summary").click();
await page.click("#manageChapters");
await page.click("#addChapter");
await page.locator(".chapter-name-input").last().fill("Chapter One");
await page.click("#addChapter");
await page.locator(".chapter-name-input").last().fill("Chapter Two");
await page.click("#saveChapters");
await page.waitForFunction(()=>data.chapters.some(x=>x.title==="Chapter One")&&data.chapters.some(x=>x.title==="Chapter Two"));
await page.click("#closeChapters");

// See scene-chronology-browser.test.mjs: the row's date input was replaced by a
// compact read-only .scene-chronology-chip (design/core-workspace-recomposition);
// it carries the same review/conflict signal the old input's className used to.
const classes=async()=>page.evaluate(()=>[...document.querySelectorAll(".scene-row")].map(row=>{
  const chip=row.querySelector(".scene-chronology-chip");
  return {
    id:row.dataset.sceneId,title:row.querySelector(".scene-title").textContent,
    dateClass:chip.classList.contains("conflict")?"date-conflict":chip.classList.contains("review")?"date-review":""
  };
}));
const byTitle=(rows,title)=>rows.find(r=>r.title===title);

const createScene=async({title,date,chapterLabel})=>{
  await page.click("#addFirst").catch(()=>{});
  if(!await page.locator("#sceneModal").isVisible()){
    await page.locator(".insert-content button").last().click();
  }
  await page.waitForSelector("#sceneModal",{state:"visible"});
  await page.fill("#sceneTitle",title);
  if(date)await page.fill("#sceneDate",date);
  if(chapterLabel)await page.selectOption("#sceneChapter",{label:chapterLabel});
  await page.click("#saveScene");
  await page.waitForSelector("#sceneModal",{state:"hidden"});
  await page.getByText(title,{exact:true}).first().waitFor();
};

// Interleave chapters on creation: A1(Chapter One), B1(Chapter Two), A2(Chapter One). The mock
// assigns strictly increasing, chapter-agnostic positions, so on the server A2's position sits
// AFTER B1's — exactly the shape that used to leak a false conflict into Chapter One's own
// scenes (and into Chapter Two's lone scene) purely because of server-side position interleaving.
await createScene({title:"A1",date:"2024-01-01",chapterLabel:"Chapter One"});
await createScene({title:"B1",date:"2024-06-01",chapterLabel:"Chapter Two"});
await createScene({title:"A2",date:"2024-01-05",chapterLabel:"Chapter One"});

let rows=await classes();
if(byTitle(rows,"A1").dateClass==="date-conflict"||byTitle(rows,"A2").dateClass==="date-conflict")
  throw new Error(`Cloud chapter-agnostic server position leaked a false chronology conflict: ${JSON.stringify(rows)}`);
if(byTitle(rows,"B1").dateClass==="date-conflict")
  throw new Error(`B1 must not conflict either (it is alone in its chapter): ${JSON.stringify(rows)}`);

const order=await page.evaluate(()=>data.scenes.map(s=>s.title));
if(order.join(",")!=="A1,A2,B1")
  throw new Error(`Cloud-hydrated scenes must be grouped by chapter order (Chapter One, then Chapter Two), matching local mode, got: ${order.join(",")}`);

// PERFORMANCE: pure UI chronology recalculation (switching views, re-rendering existing data)
// must never perform an additional Supabase call.
await page.evaluate(()=>{globalThis.__callLog.length=0});
await page.click('[data-view="list"]');
await page.click('[data-view="cards"]');
await page.click('[data-view="table"]');
await page.waitForTimeout(150);
const callsDuringViewSwitch=await page.evaluate(()=>globalThis.__callLog.slice());
if(callsDuringViewSwitch.length)
  throw new Error(`View switching must not touch the cloud; observed calls: ${JSON.stringify(callsDuringViewSwitch)}`);

await context.close();await browser.close();
console.log("Scene chronology (cloud mode) browser tests passed");
