import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(10000);
const errors=[];
page.on("pageerror",error=>errors.push(`pageerror: ${error.message}`));
page.on("console",message=>{if(message.type()==="error"&&!message.text().includes("mock projects failure"))errors.push(`console: ${message.text()}`)});

await page.addInitScript(()=>{
  const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"author@example.test"};
  const seriesId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const projectAId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const projectBId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const now="2026-08-21T00:00:00.000Z";
  const existing={
    profiles:[{user_id:user.id,display_name:"Автор",settings:{},created_at:now,updated_at:now}],
    series:[{id:seriesId,owner_id:user.id,title:"Series A",description:"",created_at:now,updated_at:now,deleted_at:null}],
    projects:[
      {id:projectAId,owner_id:user.id,title:"Project A",description:"",series_id:seriesId,position_in_series:1,status:"active",revision:0,created_at:now,updated_at:now,deleted_at:null},
      {id:projectBId,owner_id:user.id,title:"Project B",description:"",series_id:null,position_in_series:null,status:"active",revision:0,created_at:now,updated_at:now,deleted_at:null}
    ],chapters:[{id:"chapter-one",project_id:projectAId,title:"Глава 1",position:1000,deleted_at:null}],locations:[],tags:[],scenes:[],scene_tags:[]
  };
  if(!localStorage.getItem("mockBlockingCloud"))localStorage.setItem("mockBlockingCloud",JSON.stringify(existing));
  if(!localStorage.getItem("novelTimelineV11"))localStorage.setItem("novelTimelineV11",JSON.stringify({version:11,characters:[],profiles:{},chapters:[{id:"chapter-unassigned",title:"Без главы",collapsed:false}],locations:[],tags:[],future:{},scenes:[],legacyMarker:true}));
  if(!localStorage.getItem(`authorWorkspace:project:${projectAId}`))localStorage.setItem(`authorWorkspace:project:${projectAId}`,JSON.stringify({
    version:11,characters:[],profiles:{},chapters:[
      {id:"chapter-unassigned",title:"Без главы",collapsed:false},
      {id:"chapter-one",title:"Глава 1",collapsed:false}
    ],locations:[],tags:[],future:{},scenes:[]
  }));
  const listeners=[];
  const read=()=>JSON.parse(localStorage.getItem("mockBlockingCloud"));
  globalThis.__blockingMock={delayMs:0,projectsFailure:false,accountLoads:0};
  const builder=table=>{
    const state={filters:[],single:false,order:null};
    const api={
      select(){return api},is(field,value){state.filters.push(row=>row[field]===value);return api},
      order(field){state.order=field;return api},single(){state.single=true;return api},
      then(resolve){
        const finish=()=>{
          if(table==="projects")globalThis.__blockingMock.accountLoads++;
          if(table==="projects"&&globalThis.__blockingMock.projectsFailure){resolve({data:null,error:new Error("mock projects failure")});return}
          let rows=read()[table].filter(row=>state.filters.every(filter=>filter(row)));
          if(state.order)rows.sort((a,b)=>String(a[state.order]).localeCompare(String(b[state.order])));
          resolve({data:state.single?(rows[0]||null):rows,error:null});
        };
        setTimeout(finish,globalThis.__blockingMock.delayMs);
      }
    };
    return api;
  };
  globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__={
    auth:{
      async getSession(){return {data:{session:localStorage.getItem("mockBlockingSession")?{user}:null},error:null}},
      async getUser(){return {data:{user:localStorage.getItem("mockBlockingSession")?user:null},error:null}},
      onAuthStateChange(callback){listeners.push(callback);queueMicrotask(()=>callback("INITIAL_SESSION",localStorage.getItem("mockBlockingSession")?{user}:null));return {data:{subscription:{unsubscribe(){}}}}},
      async signInWithPassword(){
        const session={user};localStorage.setItem("mockBlockingSession","yes");listeners.forEach(callback=>callback("SIGNED_IN",session));
        return {data:{session,user},error:null};
      },
      async signOut(){localStorage.removeItem("mockBlockingSession");listeners.forEach(callback=>callback("SIGNED_OUT",null));return {error:null}}
    },
    from:builder,
    async rpc(name,args){
      const db=read(),project=db.projects.find(item=>item.id===args.target_project_id);
      if(name==="get_project_content")return {data:{ok:true,code:"OK",revision:project.revision,changed:false,data:{project:{id:project.id,revision:project.revision},chapters:db.chapters.filter(x=>x.project_id===project.id&&!x.deleted_at),locations:[],tags:[],scenes:db.scenes.filter(x=>x.project_id===project.id&&!x.deleted_at),scene_tags:[]}},error:null};
      if(name==="create_scene"){
        if(project.revision!==args.expected_revision)return {data:{ok:false,code:"REVISION_CONFLICT",actualRevision:project.revision,changed:false},error:null};
        const scene={id:crypto.randomUUID(),project_id:project.id,chapter_id:args.target_chapter_id,location_id:args.target_location_id,title:args.scene_title,scene_text:args.scene_text_value,scene_date:args.scene_date_value,scene_time:args.scene_time_value,placement_status:args.placement_status_value,writing_status:args.writing_status_value,included:args.included_value,date_review:args.date_review_value,position:args.scene_position||1000,deleted_at:null};db.scenes.push(scene);project.revision++;localStorage.setItem("mockBlockingCloud",JSON.stringify(db));return {data:{ok:true,code:"OK",revision:project.revision,changed:true,data:scene},error:null};
      }
      if(name==="set_scene_tags")return {data:{ok:true,code:"OK",revision:project.revision,changed:false,data:[]},error:null};
      return {data:null,error:null};
    }
  };
});

const projectRow=title=>page.locator(".cloud-project",{has:page.getByText(title,{exact:true})});
const login=async()=>{
  await page.fill("#authEmail","author@example.test");await page.fill("#authPassword","password");await page.click("#signInButton");
  await page.waitForSelector('#projectsScreen:not([hidden])');
};

await page.goto(base,{waitUntil:"networkidle"});
await page.waitForSelector('#authScreen:not([hidden])');
await page.evaluate(()=>{globalThis.__blockingMock.delayMs=350});
await login();
if(!await page.locator("#projectsLoadingState").isVisible())throw new Error("Slow login did not show project loading state");
if(await page.locator("#projectsEmptyState").isVisible())throw new Error("False empty state appeared while projects were loading");
await projectRow("Project A").waitFor();await projectRow("Project B").waitFor();
await page.getByRole("heading",{name:"Series A"}).waitFor();
if(await page.locator("#projectsEmptyState").isVisible())throw new Error("Empty state remained after existing projects hydrated");
if(!await page.locator("#legacyNotice").isVisible())throw new Error("Legacy warning did not initialize with first successful dashboard hydration");
if(await page.evaluate(()=>globalThis.__blockingMock.accountLoads)<1)throw new Error("Dashboard hydration did not query projects after login");

await page.locator("#dashboardAccountMenu > summary").click();await page.click("#dashboardLogout");await page.waitForSelector('#authScreen:not([hidden])');
await page.evaluate(()=>{globalThis.__blockingMock.delayMs=0});await login();
await projectRow("Project A").waitFor();await projectRow("Project B").waitFor();await page.getByRole("heading",{name:"Series A"}).waitFor();

await page.locator("#dashboardAccountMenu > summary").click();await page.click("#dashboardLogout");await page.waitForSelector('#authScreen:not([hidden])');
await page.evaluate(()=>{globalThis.__blockingMock.projectsFailure=true});await login();
await page.locator("#projectsErrorState").waitFor({state:"visible"});
if(await page.locator("#projectsEmptyState").isVisible())throw new Error("Projects API failure rendered the empty state");
await page.evaluate(()=>{globalThis.__blockingMock.projectsFailure=false});await page.click("#retryDashboard");await projectRow("Project A").waitFor();

await projectRow("Project A").getByRole("button",{name:"Открыть"}).click();await page.waitForSelector('body[data-app-state="workspace"]');

const trace=[];
const traceState=async(step,title)=>trace.push(await page.evaluate(({step,title})=>{
  const scene=data.scenes.find(item=>item.title===title);
  const persisted=JSON.parse(localStorage.getItem(activeWorkspaceContext().storageKey));
  const saved=persisted.scenes.find(item=>item.title===title);
  return {step,domChapter:document.getElementById("sceneChapter")?.value,domWriting:document.getElementById("sceneWritingStatus")?.value,dataChapter:scene?.chapterId,dataWriting:scene?.writingStatus,persistedChapter:saved?.chapterId,persistedWriting:saved?.writingStatus};
},{step,title}));
const createSceneThroughDom=async({entry,title})=>{
  if(entry==="unassigned"){
    const section=page.locator(".chapter-divider",{has:page.getByText("Без главы",{exact:true})});
    await section.getByRole("button",{name:"＋ сцена"}).click();
  }else if(entry==="chapter"){
    const section=page.locator(".chapter-divider",{has:page.getByText("Глава 1",{exact:true})});
    await section.getByRole("button",{name:"＋ сцена"}).click();
  }else await page.click("#addFirst");
  await page.waitForTimeout(50);
  if(!await page.locator("#sceneModal").isVisible()){
    const state=await page.evaluate(()=>({appState:document.body.dataset.appState,discardVisible:getComputedStyle(document.getElementById("discardChangesModal")).display,editingSceneId,insertChapterId,insertBeforeSceneId,activeModal:globalThis.modalManager?.top?.()?.id||null}));
    throw new Error(`${entry} entry did not open scene modal: ${JSON.stringify(state)}`);
  }
  await traceState(`${entry}:defaults`,title);
  await page.selectOption("#sceneChapter","chapter-one");await page.selectOption("#sceneWritingStatus","draft");await page.fill("#sceneTitle",title);
  await traceState(`${entry}:selected`,title);
  await page.click("#saveScene");await page.getByText(title,{exact:true}).waitFor();
  await traceState(`${entry}:saved`,title);
  const sceneId=await page.evaluate(name=>data.scenes.find(item=>item.title===name).id,title);
  await page.locator(`[data-scene-id="${sceneId}"]`).getByRole("button",{name:"Изменить"}).click();await page.waitForSelector("#sceneModal",{state:"visible"});
  await traceState(`${entry}:reopened`,title);
  if(await page.inputValue("#sceneChapter")!=="chapter-one"||await page.inputValue("#sceneWritingStatus")!=="draft")throw new Error(`${entry} reopen lost chapter/status`);
  await page.click("#cancelScene");
};

await createSceneThroughDom({entry:"unassigned",title:"Regression Scene"});
await createSceneThroughDom({entry:"top",title:"Regression Top Scene"});
await createSceneThroughDom({entry:"chapter",title:"Regression Chapter Scene"});
for(const title of ["Regression Scene","Regression Top Scene","Regression Chapter Scene"]){
  const value=await page.evaluate(name=>{const scene=data.scenes.find(item=>item.title===name);const persisted=JSON.parse(localStorage.getItem(activeWorkspaceContext().storageKey)).scenes.find(item=>item.title===name);return {scene,persisted}},title);
  if(value.scene.chapterId!=="chapter-one"||value.scene.writingStatus!=="draft"||value.persisted.chapterId!=="chapter-one"||value.persisted.writingStatus!=="draft")throw new Error(`${title} has incorrect data or namespace persistence`);
}
await page.reload({waitUntil:"networkidle"});
await page.waitForFunction(()=>["projects","workspace"].includes(document.body.dataset.appState)&&document.getElementById("sessionLoading").hidden);
if(await page.evaluate(()=>document.body.dataset.appState)==="projects"){await projectRow("Project A").getByRole("button",{name:"Открыть"}).click();await page.waitForSelector('body[data-app-state="workspace"]')}
for(const title of ["Regression Scene","Regression Top Scene","Regression Chapter Scene"]){
  await page.getByText(title,{exact:true}).waitFor();
  const value=await page.evaluate(name=>data.scenes.find(item=>item.title===name),title);
  if(value.chapterId!=="chapter-one"||value.writingStatus!=="draft")throw new Error(`${title} lost chapter/status after reload`);
}
if(errors.length)throw new Error(`New app errors: ${errors.join(" | ")}`);
console.log(`blocking regression production DOM tests: OK\n${JSON.stringify(trace,null,2)}`);
await context.close();await browser.close();
