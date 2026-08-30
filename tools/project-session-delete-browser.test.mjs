import {createRequire} from "node:module";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();
const page=await context.newPage();
page.setDefaultTimeout(8000);

// This suite covers stage "project-session-delete-warning-ux": last-opened-project
// restore across reload/logout/login, dashboard project delete (soft-delete via the
// existing projects.deleted_at contract), and the app-native confirm modal replacing
// browser confirm() for that destructive action. It never touches the real Supabase
// project: the Supabase client is fully mocked (see cloud-browser.test.mjs for the
// same pattern), scoped to two disposable in-page mock accounts.

await page.addInitScript(()=>{
  const users={
    "author@example.test":{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"author@example.test"},
    "second@example.test":{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",email:"second@example.test"}
  };
  const read=()=>{const db=JSON.parse(localStorage.getItem("mockCloud")||'{"profiles":[],"series":[],"projects":[]}');for(const key of ["profiles","series","projects"])db[key]||=[];return db};
  const write=value=>localStorage.setItem("mockCloud",JSON.stringify(value));
  const listeners=[];
  globalThis.__mockFailures={};
  globalThis.__deleteProjectCalls=0;
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
          if(table==="projects")globalThis.__deleteProjectCalls+=rows.length&&state.payload?.deleted_at?1:0;
          rows=rows.map(row=>Object.assign(row,state.payload,{updated_at:new Date().toISOString()}));write(db);
          // Real PostgREST .single() errors when the filtered update matches no row
          // (already deleted / wrong id) instead of resolving with null data.
          if(state.single&&rows.length===0){resolve({data:null,error:new Error("No rows found")});return}
        }else if(state.order)rows.sort((a,b)=>String(a[state.order]).localeCompare(String(b[state.order])));
        resolve({data:state.single?(rows[0]||null):rows,error:null});
      }
    };return api;
  }
  globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__={
    storage:{from(){return {async upload(){return {data:{},error:null}},async download(){return {data:null,error:new Error("missing")}},async remove(){return {data:{},error:null}}}}},
    auth:{
      async getSession(){const email=localStorage.getItem("mockSession");return {data:{session:email?{user:users[email]}:null},error:null}},
      async getUser(){const email=localStorage.getItem("mockSession");return {data:{user:email?users[email]:null},error:null}},
      onAuthStateChange(callback){listeners.push(callback);return {data:{subscription:{unsubscribe(){}}}}},
      async signInWithPassword({email}){const user=users[email];if(!user)return {data:{session:null,user:null},error:new Error("Invalid login credentials")};const session={user};localStorage.setItem("mockSession",email);listeners.forEach(cb=>cb("SIGNED_IN",session));return {data:{session,user},error:null}},
      async signUp(){return {data:{session:null,user:null},error:null}},
      async signOut(){
        if(globalThis.__mockFailures.signOut)return {error:new Error(globalThis.__mockFailures.signOut)};
        localStorage.removeItem("mockSession");listeners.forEach(cb=>cb("SIGNED_OUT",null));return {error:null};
      }
    },
    from:builder,
    async rpc(name,args){
      if(globalThis.__mockFailures[name])return {data:null,error:new Error(globalThis.__mockFailures[name])};
      const db=read();
      const project=db.projects.find(item=>item.id===args?.target_project_id);
      if(name==="list_characters"||name==="list_global_character_links")return {data:{ok:true,code:"OK",changed:false,data:[]},error:null};
      if(name==="get_project_content")return {data:project&&!project.deleted_at?{ok:true,code:"OK",revision:project.revision||0,changed:false,data:{project:{id:project.id,revision:project.revision||0,updated_at:project.updated_at},chapters:[],locations:[],tags:[],scenes:[],scene_tags:[],project_characters:[],scene_characters:[],project_character_relations:[],scene_relation_changes:[],character_links:[]}}:{ok:false,code:"NOT_FOUND",changed:false},error:null};
      return {data:null,error:null};
    }
  };
  const db=read();
  if(!db.profiles.length){db.profiles.push({user_id:users["author@example.test"].id,display_name:"Автор",settings:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()});write(db)}
});

const projectRow=title=>page.locator(".cloud-project",{has:page.getByText(title,{exact:true})});
const createProject=async title=>{
  await page.getByRole("button",{name:"＋ Новый проект"}).first().click();
  await page.waitForSelector("#newProjectModal",{state:"visible"});
  await page.fill('#newProjectForm [name="title"]',title);
  await page.click('#newProjectForm button[type="submit"]');
  await page.waitForSelector("#newProjectModal",{state:"hidden"});
  await projectRow(title).waitFor();
};
const login=async email=>{
  await page.waitForSelector("#authScreen:not([hidden])");
  await page.fill("#authEmail",email);await page.fill("#authPassword","password");
  await page.click("#signInButton");
};
const lastProjectPreference=userId=>page.evaluate(id=>localStorage.getItem(`authorWorkspace:last-project:${id}`),userId);

const userAId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",userBId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// ---- 1. Reload inside a cloud project returns to the same project. ----
await page.goto(base,{waitUntil:"networkidle"});
await login("author@example.test");
await page.waitForSelector("#projectsScreen:not([hidden])");
await createProject("Project A");
await projectRow("Project A").getByRole("button",{name:"Открыть"}).click();
await page.waitForSelector('body[data-app-state="workspace"]');
if(await page.locator("#workspaceProjectTitle").innerText()!=="Project A")throw new Error("1: workspace does not show Project A after opening it");
if(await lastProjectPreference(userAId)===null)throw new Error("1: opening a project did not record a last-open preference");

await page.reload({waitUntil:"networkidle"});
await page.waitForSelector('body[data-app-state="workspace"]');
if(await page.locator("#workspaceProjectTitle").innerText()!=="Project A")throw new Error("1: reload inside Project A did not restore the same project");
if(await page.locator("#projectsScreen").isVisible())throw new Error("1: dashboard flashed visible during restore");

// ---- 5. Explicit Back to dashboard must not cause an auto-reopen loop on reload. ----
await page.click("#workspaceAccountMenu > summary");await page.click("#workspaceProjects");
await page.waitForSelector("#projectsScreen:not([hidden])");
if(await lastProjectPreference(userAId)!==null)throw new Error("5: explicit Back did not clear the last-open preference");
await page.reload({waitUntil:"networkidle"});
await page.waitForSelector("#projectsScreen:not([hidden])");
if(await page.locator('body[data-app-state="workspace"]').count())throw new Error("5: reload after an explicit Back auto-reopened the project (redirect loop)");

// ---- Re-opening explicitly still restores correctly on the next reload. ----
await projectRow("Project A").getByRole("button",{name:"Открыть"}).click();
await page.waitForSelector('body[data-app-state="workspace"]');

// ---- 3. Logout, then login as the same user restores the same project. ----
await page.locator("#workspaceAccountMenu > summary").click();
await page.click("#workspaceLogout");
await page.waitForSelector("#authScreen:not([hidden])");
await login("author@example.test");
await page.waitForSelector('body[data-app-state="workspace"]');
if(await page.locator("#workspaceProjectTitle").innerText()!=="Project A")throw new Error("3: login as the same user did not restore the last project");

// ---- 4. A different user must never inherit another account's last-open project. ----
await page.locator("#workspaceAccountMenu > summary").click();
await page.click("#workspaceLogout");
await page.waitForSelector("#authScreen:not([hidden])");
await login("second@example.test");
await page.waitForSelector("#projectsScreen:not([hidden])");
if(await page.locator('body[data-app-state="workspace"]').count())throw new Error("4: a different user was auto-opened into another account's project");
if(await lastProjectPreference(userBId)!==null)throw new Error("4: the new user unexpectedly has a last-open preference already");

// Back to user A for the delete-project scenarios below.
await page.locator("#dashboardAccountMenu > summary").click();
await page.click("#dashboardLogout");
await page.waitForSelector("#authScreen:not([hidden])");
await login("author@example.test");
await page.waitForSelector('body[data-app-state="workspace"]');
await page.click("#workspaceAccountMenu > summary");await page.click("#workspaceProjects");
await page.waitForSelector("#projectsScreen:not([hidden])");

// ---- 7. Cancel delete must not remove the project or use browser confirm(). ----
let nativeDialogFired=false;
page.on("dialog",dialog=>{nativeDialogFired=true;dialog.dismiss()});
await projectRow("Project A").getByRole("button",{name:"Удалить проект"}).click();
if(!await page.locator("#confirmActionModal").isVisible())throw new Error("7: delete did not open the app-native confirmation modal");
if(!(await page.textContent("#confirmActionTitle"))?.includes("Project A"))throw new Error("7: confirmation does not name the project being deleted");
await page.click("#confirmActionCancel");
await page.waitForSelector("#confirmActionModal",{state:"hidden"});
await projectRow("Project A").waitFor();
if(nativeDialogFired)throw new Error("7: a native browser confirm() dialog fired during project delete");

// ---- 9. Single-flight: double-clicking Confirm only deletes once. ----
// __deleteProjectCalls is incremented by the mock's own table-level update handler
// (see addInitScript above) whenever a "projects" row is soft-deleted, so it counts
// the actual number of delete requests reaching the backend, not just JS call sites.
await page.evaluate(()=>{globalThis.__deleteProjectCalls=0});
// Simulate the preference still pointing at the project about to be deleted (Back already
// clears it in the normal flow — this isolates the delete handler's own cleanup, requirement 12,
// from the Back-navigation cleanup already covered by requirement 5 above).
await page.evaluate(userId=>{
  const project=JSON.parse(localStorage.getItem("mockCloud")).projects.find(p=>p.title==="Project A"&&!p.deleted_at);
  localStorage.setItem(`authorWorkspace:last-project:${userId}`,project.id);
},userAId);
await projectRow("Project A").getByRole("button",{name:"Удалить проект"}).click();
await page.waitForSelector("#confirmActionModal",{state:"visible"});
// Two rapid clicks dispatched from a single DOM tick — the realistic shape of a double-click —
// rather than two separate Playwright actions, which can race against the first click already
// closing/hiding the modal and then hang polling for an element that is intentionally gone.
await page.evaluate(()=>{const button=document.getElementById("confirmActionConfirm");button.click();button.click()});
await page.waitForSelector("#confirmActionModal",{state:"hidden"});
await page.waitForFunction(()=>!JSON.parse(localStorage.getItem("mockCloud")).projects.find(p=>p.title==="Project A"&&!p.deleted_at));
if(await page.evaluate(()=>globalThis.__deleteProjectCalls)!==1)throw new Error("9: double-confirm triggered more than one delete call");

// ---- 8/12. Success feedback, dashboard refresh, and preference cleanup. ----
if(!await page.getByText("удалён",{exact:false}).count())throw new Error("8: no success feedback shown after deleting a project");
if(await projectRow("Project A").count())throw new Error("10: deleted project still listed on the dashboard");
if(await lastProjectPreference(userAId)!==null)throw new Error("12: deleting the last-open project did not clear its preference");

// ---- 2. A stale/deleted last-open preference falls back to the dashboard on reload. ----
await page.reload({waitUntil:"networkidle"});
await page.waitForSelector("#projectsScreen:not([hidden])");
if(await page.locator('body[data-app-state="workspace"]').count())throw new Error("2: reload with no remaining project tried to open a workspace anyway");

// ---- 11. Failed delete: project remains, UI shows failure, button is usable again. ----
await createProject("Project B");
await projectRow("Project B").getByRole("button",{name:"Открыть"}).click();
await page.waitForSelector('body[data-app-state="workspace"]');
await page.click("#workspaceAccountMenu > summary");await page.click("#workspaceProjects");
await page.waitForSelector("#projectsScreen:not([hidden])");
await page.evaluate(()=>{globalThis.__mockFailures["projects:update"]="offline"});
await projectRow("Project B").getByRole("button",{name:"Удалить проект"}).click();
await page.waitForSelector("#confirmActionModal",{state:"visible"});
await page.click("#confirmActionConfirm");
await page.waitForSelector("#confirmActionModal",{state:"hidden"});
if(!await projectRow("Project B").count())throw new Error("11: project disappeared from the dashboard despite the delete failing");
const deleteButton=projectRow("Project B").getByRole("button",{name:"Удалить проект"});
if(await deleteButton.isDisabled())throw new Error("11: delete button stayed disabled after a failed delete");
if(await deleteButton.innerText()!=="Удалить проект")throw new Error("11: delete button did not reset its label after a failed delete");
if(!await page.getByText("Не удалось",{exact:false}).count()&&!await page.locator("#cloudFailure").isVisible())throw new Error("11: no failure feedback shown for a failed delete");
await page.evaluate(()=>{delete globalThis.__mockFailures["projects:update"]});

// Clean up: delete Project B for real so no fixture project is left dangling in mockCloud.
await deleteButton.click();
await page.waitForSelector("#confirmActionModal",{state:"visible"});
await page.click("#confirmActionConfirm");
await page.waitForSelector("#confirmActionModal",{state:"hidden"});
await page.waitForFunction(()=>!JSON.parse(localStorage.getItem("mockCloud")).projects.find(p=>p.title==="Project B"&&!p.deleted_at));
const remaining=await page.evaluate(()=>JSON.parse(localStorage.getItem("mockCloud")).projects.filter(p=>!p.deleted_at));
if(remaining.length)throw new Error(`cleanup: fixture projects left over: ${remaining.map(p=>p.title).join(", ")}`);

await context.close();await browser.close();
console.log("project session / delete-project browser tests: OK");
