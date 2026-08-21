import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(8000);

await page.addInitScript(()=>{
  const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"author@example.test"};
  const read=()=>JSON.parse(localStorage.getItem("mockCloud")||'{"profiles":[],"series":[],"projects":[]}');
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
      async getUser(){return {data:{user:localStorage.getItem("mockSession")?user:null},error:null}},
      onAuthStateChange(callback){listeners.push(callback);return {data:{subscription:{unsubscribe(){}}}}},
      async signInWithPassword(){const session={user};localStorage.setItem("mockSession","yes");listeners.forEach(cb=>cb("SIGNED_IN",session));return {data:{session,user},error:null}},
      async signUp(){return {data:{session:null,user},error:null}},
      async signOut(){
        if(globalThis.__mockFailures.signOut)return {error:new Error(globalThis.__mockFailures.signOut)};
        localStorage.removeItem("mockSession");listeners.forEach(cb=>cb("SIGNED_OUT",null));return {error:null};
      }
    },
    from:builder,
    async rpc(name,args){
      if(globalThis.__mockFailures[name])return {data:null,error:new Error(globalThis.__mockFailures[name])};
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

const projectRow=title=>page.locator(".cloud-project",{has:page.getByText(title,{exact:true})});
const createProject=async(title,seriesLabel="Без цикла")=>{
  await page.getByRole("button",{name:"＋ Новый проект"}).first().click();
  await page.waitForSelector("#newProjectModal",{state:"visible"});
  await page.fill('#newProjectForm [name="title"]',title);
  await page.selectOption('#newProjectForm [name="seriesId"]',{label:seriesLabel});
  await page.click('#newProjectForm button[type="submit"]');
  await page.waitForSelector("#newProjectModal",{state:"hidden"});
  await projectRow(title).waitFor();
};

await page.goto("http://127.0.0.1:8000/author-workspace/",{waitUntil:"networkidle"});
await page.waitForSelector("#authScreen:not([hidden])");
await page.fill("#authEmail","author@example.test");await page.fill("#authPassword","password");
await page.click("#signInButton");await page.waitForSelector("#projectsScreen:not([hidden])");
if(!await page.getByRole("heading",{name:"Мои проекты"}).isVisible())throw new Error("Dashboard heading is not visible");
if(!await page.getByRole("button",{name:"＋ Новый проект"}).first().isVisible())throw new Error("New Project button is not visible");
if(!await page.getByRole("button",{name:"＋ Новый цикл"}).isVisible())throw new Error("New Series button is not visible");
if(!await page.getByText("Создайте свой первый проект",{exact:true}).isVisible())throw new Error("Project empty state is missing");

await page.getByRole("button",{name:"＋ Новый проект"}).first().click();
if(await page.evaluate(()=>document.activeElement?.getAttribute("name"))!=="title")throw new Error("New Project modal initial focus is incorrect");
await page.keyboard.press("Shift+Tab");
if(!await page.evaluate(()=>document.getElementById("newProjectModal").contains(document.activeElement)))throw new Error("New Project modal focus trap failed");
await page.keyboard.press("Escape");await page.waitForSelector("#newProjectModal",{state:"hidden"});
await page.getByRole("button",{name:"＋ Новый проект"}).first().click();
await page.fill('#newProjectForm [name="title"]',"Failure draft");
await page.evaluate(()=>globalThis.__mockFailures["projects:insert"]="offline");
await page.click('#newProjectForm button[type="submit"]');
if(!await page.locator("#newProjectModal").isVisible()||await page.inputValue('#newProjectForm [name="title"]')!=="Failure draft")throw new Error("Project failure closed or cleared the form");
await page.evaluate(()=>delete globalThis.__mockFailures["projects:insert"]);
await page.click("#cancelNewProject");
await page.waitForSelector("#discardChangesModal",{state:"visible"});await page.click("#discardChanges");

await createProject("Project A");
await page.getByRole("button",{name:"＋ Новый цикл"}).click();
await page.waitForSelector("#newSeriesModal",{state:"visible"});
if(await page.evaluate(()=>document.activeElement?.getAttribute("name"))!=="title")throw new Error("New Series modal initial focus is incorrect");
await page.locator("#newSeriesModal").click({position:{x:2,y:2}});await page.waitForSelector("#newSeriesModal",{state:"hidden"});
await page.getByRole("button",{name:"＋ Новый цикл"}).click();
await page.fill('#newSeriesForm [name="title"]',"Series A");
await page.evaluate(()=>globalThis.__mockFailures["series:insert"]="offline");
await page.click('#newSeriesForm button[type="submit"]');
if(!await page.locator("#newSeriesModal").isVisible()||await page.inputValue('#newSeriesForm [name="title"]')!=="Series A")throw new Error("Series failure closed or cleared the form");
await page.evaluate(()=>delete globalThis.__mockFailures["series:insert"]);
await page.click('#newSeriesForm button[type="submit"]');
await page.waitForSelector("#newSeriesModal",{state:"hidden"});
await page.getByRole("heading",{name:"Series A"}).waitFor();

await createProject("Project B","Series A");
await createProject("Project C","Series A");
await page.evaluate(()=>globalThis.__mockFailures.set_project_series="offline");
await projectRow("Project A").locator("select").selectOption({label:"Series A"});
if(await projectRow("Project A").locator("select").inputValue()!=="")throw new Error("Failed move left a false series selection");
await page.evaluate(()=>delete globalThis.__mockFailures.set_project_series);
await projectRow("Project A").locator("select").selectOption({label:"Series A"});
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("mockCloud")).projects.find(project=>project.title==="Project A").series_id);

await projectRow("Project C").getByRole("button",{name:/Поднять/}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("mockCloud")).projects.find(project=>project.title==="Project C").position_in_series===1);
await page.reload({waitUntil:"networkidle"});await page.waitForSelector("#projectsScreen:not([hidden])");
const orderedTitles=await page.locator('[data-series-id] .cloud-project-title').allTextContents();
if(orderedTitles[0]!=="Project C")throw new Error(`Project order was not preserved: ${orderedTitles.join(", ")}`);

await projectRow("Project A").getByRole("button",{name:"Убрать из цикла"}).click();
await page.waitForFunction(()=>JSON.parse(localStorage.getItem("mockCloud")).projects.find(project=>project.title==="Project A").series_id===null);

await projectRow("Project A").getByRole("button",{name:"Открыть"}).click();
await page.waitForSelector('body[data-app-state="workspace"]');
if(!await page.getByText("Текущий проект:",{exact:false}).isVisible()||await page.locator("#workspaceProjectTitle").innerText()!=="Project A")throw new Error("Workspace does not identify Project A");
await page.click("#projectMenu > summary");await page.click("#manageChars");
if(await page.locator("#projectMenu").getAttribute("open")!==null)throw new Error("Navigation menu stayed open after Characters");
await page.click("#closeChars");
await page.click("#sidebarManageChars");if(!await page.locator("#charsModal").isVisible())throw new Error("Sidebar Characters manager did not open");
await page.click("#addChar");
if(await page.inputValue("#pf_name")!==""||await page.getAttribute("#pf_name","placeholder")!=="Имя")throw new Error("New character name is not empty with Имя placeholder");
await page.click("#cancelProfile");await page.waitForSelector("#profileEditorModal",{state:"hidden"});await page.click("#closeChars");
await page.click("#addFirst");await page.waitForSelector("#sceneModal",{state:"visible"});
await page.fill("#sceneTitle","Scene only in A");await page.click("#saveScene");
await page.getByText("Scene only in A",{exact:true}).waitFor();

await page.evaluate(()=>{const node=document.getElementById("cloudFailure");node.hidden=false;node.textContent="old failure";document.getElementById("storageBanner").className="storage-banner error"});
await page.click("#backToProjects");await page.waitForSelector("#projectsScreen:not([hidden])");
if(await page.locator("#cloudFailure").isVisible()||await page.locator("#storageBanner").isVisible())throw new Error("Successful top-left navigation kept stale cloud error");
await projectRow("Project B").getByRole("button",{name:"Открыть"}).click();
await page.waitForSelector('body[data-app-state="workspace"]');
if(await page.getByText("Scene only in A",{exact:true}).count())throw new Error("Project A scene leaked into Project B DOM");

await page.locator("#workspaceAccountMenu > summary").click();await page.click("#workspaceProjects");await page.waitForSelector("#projectsScreen:not([hidden])");
if(await page.locator("#cloudFailure").isVisible())throw new Error("Account-menu navigation kept cloud error");
await projectRow("Project A").getByRole("button",{name:"Открыть"}).click();
await page.getByText("Scene only in A",{exact:true}).waitFor();
const namespacesBeforeLogout=await page.evaluate(()=>Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).filter(key=>key.startsWith("authorWorkspace:project:")));

await page.locator("#workspaceAccountMenu > summary").click();
if(!await page.getByRole("button",{name:"Выйти"}).last().isVisible())throw new Error("Workspace logout is not visible");
await page.evaluate(()=>globalThis.__mockFailures.signOut="offline");
await page.click("#workspaceLogout");
if(!await page.locator('body[data-app-state="workspace"]').count())throw new Error("Failed signOut hid the workspace");
await page.evaluate(()=>delete globalThis.__mockFailures.signOut);
await page.click("#workspaceLogout");await page.waitForSelector("#authScreen:not([hidden])");
const namespacesAfterLogout=await page.evaluate(()=>Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).filter(key=>key.startsWith("authorWorkspace:project:")));
if(JSON.stringify(namespacesAfterLogout)!==JSON.stringify(namespacesBeforeLogout))throw new Error("Logout changed local project namespaces");

await page.fill("#authEmail","author@example.test");await page.fill("#authPassword","password");
await page.click("#signInButton");await page.waitForSelector("#projectsScreen:not([hidden])");
for(const title of ["Project A","Project B","Project C"])if(!await page.getByText(title,{exact:true}).count())throw new Error(`${title} missing after re-login`);
await page.locator("#dashboardAccountMenu > summary").click();
if(!await page.getByRole("button",{name:"Выйти"}).first().isVisible())throw new Error("Dashboard logout is not visible");
await page.setViewportSize({width:390,height:760});
if(!await page.getByRole("button",{name:"＋ Новый проект"}).first().isVisible()||!await page.getByRole("button",{name:"＋ Новый цикл"}).isVisible()||!await page.locator("#dashboardAccountMenu > summary").isVisible())throw new Error("Mobile dashboard actions are not visible");

await context.close();await browser.close();
console.log("cloud browser real UI tests: OK");
