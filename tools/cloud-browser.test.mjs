import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(7000);

await page.addInitScript(()=>{
  const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"author@example.test"};
  const read=()=>JSON.parse(localStorage.getItem("mockCloud")||'{"profiles":[],"series":[],"projects":[]}');
  const write=value=>localStorage.setItem("mockCloud",JSON.stringify(value));
  const listeners=[];
  function builder(table){
    const state={action:"select",filters:[],payload:null,single:false};
    const api={
      select(){return api},is(field,value){state.filters.push(row=>row[field]===value);return api},
      eq(field,value){state.filters.push(row=>row[field]===value);return api},
      order(field){state.order=field;return api},single(){state.single=true;return api},
      insert(payload){state.action="insert";state.payload=payload;return api},
      update(payload){state.action="update";state.payload=payload;return api},
      then(resolve){
        const db=read();let rows=db[table].filter(row=>state.filters.every(filter=>filter(row)));
        if(state.action==="insert"){
          const payload=Array.isArray(state.payload)?state.payload:[state.payload];
          rows=payload.map(item=>({...item,id:item.id||crypto.randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:null,status:item.status||"active"}));
          db[table].push(...rows);write(db);
        }else if(state.action==="update"){
          rows=rows.map(row=>Object.assign(row,state.payload,{updated_at:new Date().toISOString()}));write(db);
        }else if(state.order)rows.sort((a,b)=>String(a[state.order]).localeCompare(String(b[state.order])));
        resolve({data:state.single?(rows[0]||null):rows,error:null});
      }
    };return api;
  }
  globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__={
    auth:{
      async getSession(){return {data:{session:localStorage.getItem("mockSession")?{user}:null},error:null}},
      onAuthStateChange(callback){listeners.push(callback);return {data:{subscription:{unsubscribe(){}}}}},
      async signInWithPassword(){const session={user};localStorage.setItem("mockSession","yes");listeners.forEach(cb=>cb("SIGNED_IN",session));return {data:{session,user},error:null}},
      async signUp(){return {data:{session:null,user},error:null}},
      async signOut(){localStorage.removeItem("mockSession");listeners.forEach(cb=>cb("SIGNED_OUT",null));return {error:null}}
    },
    from:builder,
    async rpc(name,args){
      const db=read();
      if(name==="set_project_series"){
        const project=db.projects.find(item=>item.id===args.target_project_id);
        Object.assign(project,{series_id:args.target_series_id,position_in_series:args.target_series_id?args.target_position:null});
      }
      if(name==="reorder_series_projects")args.ordered_project_ids.forEach((id,index)=>{db.projects.find(item=>item.id===id).position_in_series=index+1});
      if(name==="archive_series_keep_projects"){
        db.projects.filter(item=>item.series_id===args.target_series_id).forEach(item=>Object.assign(item,{series_id:null,position_in_series:null}));
        db.series.find(item=>item.id===args.target_series_id).deleted_at=new Date().toISOString();
      }
      write(db);return {data:null,error:null};
    }
  };
  const db=read();
  if(!db.profiles.length){db.profiles.push({user_id:user.id,display_name:"Автор",settings:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()});write(db)}
});

await page.goto("http://127.0.0.1:8000/author-workspace/",{waitUntil:"networkidle"});
await page.waitForSelector("#authScreen:not([hidden])");
await page.fill("#authEmail","author@example.test");await page.fill("#authPassword","password");
await page.click("#signInButton");await page.waitForSelector("#projectsScreen:not([hidden])");

await page.fill('#newProjectForm [name="title"]',"Standalone A");await page.click('#newProjectForm button[type="submit"]');
await page.waitForSelector('button.cloud-project-title',{hasText:"Standalone A"});
await page.fill('#newSeriesForm [name="title"]',"Series A");await page.click('#newSeriesForm button[type="submit"]');
await page.waitForSelector(".cloud-card h3",{hasText:"Series A"});

await page.selectOption('#newProjectForm [name="seriesId"]',{label:"Series A"});
await page.fill('#newProjectForm [name="title"]',"Book 1");await page.click('#newProjectForm button[type="submit"]');
await page.selectOption('#newProjectForm [name="seriesId"]',{label:"Series A"});
await page.fill('#newProjectForm [name="title"]',"Book 2");await page.click('#newProjectForm button[type="submit"]');
await page.waitForSelector('button.cloud-project-title',{hasText:"Book 2"});

const standaloneRow=page.locator(".cloud-project",{has:page.getByText("Standalone A",{exact:true})});
await standaloneRow.locator("select").selectOption({label:"Series A"});
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("mockCloud")).projects.find(p=>p.title==="Standalone A").series_id);
const movedRow=page.locator(".cloud-project",{has:page.getByText("Standalone A",{exact:true})});
await movedRow.locator("select").selectOption("");
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("mockCloud")).projects.find(p=>p.title==="Standalone A").series_id===null);

const book2Row=page.locator(".cloud-project",{has:page.getByText("Book 2",{exact:true})});
await book2Row.getByRole("button",{name:/Поднять/}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("mockCloud")).projects.find(p=>p.title==="Book 2").position_in_series===1);

await page.getByText("Standalone A",{exact:true}).click();await page.waitForSelector('body[data-app-state="workspace"]');
await page.evaluate(()=>{data.extraNamespaceMarker="A";saveData()});
await page.click("#backToProjects");await page.getByText("Book 1",{exact:true}).click();
const isolated=await page.evaluate(()=>({marker:data.extraNamespaceMarker,context:activeWorkspaceContext(),legacy:localStorage.getItem("novelTimelineV11"),keys:Array.from({length:localStorage.length},(_,index)=>localStorage.key(index))}));
if(isolated.marker!==undefined||isolated.keys.filter(key=>key.startsWith("authorWorkspace:project:")).length<2)throw new Error(`Cloud project local namespaces are not isolated: ${JSON.stringify(isolated)}`);

await page.reload({waitUntil:"networkidle"});await page.waitForSelector("#projectsScreen:not([hidden])");
await page.click("#dashboardLogout");await page.waitForSelector("#authScreen:not([hidden])");
if(await page.evaluate(()=>localStorage.getItem("mockSession")))throw new Error("Logout did not clear mock session");

await context.close();await browser.close();
console.log("cloud browser tests: OK");
