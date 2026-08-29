import {createRequire} from "node:module";
import assert from "node:assert/strict";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/author-workspace/";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});

async function pageFor(scenario="none",suffix=""){
  const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(8000);
  await page.addInitScript(value=>{
    globalThis.__authScenario=value;globalThis.__authCalls={account:0,signUp:0,signIn:0,redirect:null};
    const user={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"new@example.test"};const listeners=[];let authenticated=value==="callback-session";
    const session=()=>({user});
    const query={select(){return query},is(){return query},order(){return query},single(){return query},then(resolve){globalThis.__authCalls.account++;const stack=new Error().stack||"";const table=stack.includes("profiles")?"profile":"list";resolve({data:table==="profile"?{user_id:user.id,display_name:"Автор"}:[],error:null})}};
    globalThis.__AUTHOR_WORKSPACE_SUPABASE_CLIENT__={auth:{
      async getSession(){return {data:{session:authenticated?session():null},error:null}},
      async getUser(){return {data:{user:authenticated?user:null},error:null}},
      onAuthStateChange(callback){listeners.push(callback);if(value==="callback-session")queueMicrotask(()=>callback("INITIAL_SESSION",session()));return {data:{subscription:{unsubscribe(){}}}}},
      async signUp(input){globalThis.__authCalls.signUp++;globalThis.__authCalls.redirect=input.options.emailRedirectTo;if(value==="signup-rate")return {data:null,error:{status:429,message:"For security purposes, you can only request this after 52 seconds."}};const current=value==="signup-session"?session():null;if(current){authenticated=true;listeners.forEach(cb=>cb("SIGNED_IN",current))}return {data:{user,session:current},error:null}},
      async signInWithPassword(){globalThis.__authCalls.signIn++;if(value==="invalid-login")return {data:null,error:{message:"Invalid login credentials"}};const current=session();authenticated=true;listeners.forEach(cb=>cb("SIGNED_IN",current));return {data:{user,session:current},error:null}},async signOut(){authenticated=false;return {error:null}}
    },storage:{from(){return {}}},from(){return query},async rpc(){return {data:null,error:null}}};
  },scenario);
  await page.goto(base+suffix,{waitUntil:"networkidle"});return {page,context};
}

{
  const {page,context}=await pageFor();await page.waitForSelector("#authScreen:not([hidden])");
  assert.equal(await page.locator("#authTitle").textContent(),"Вход");assert.equal(await page.locator("#signInButton").textContent(),"Войти");
  await page.click("#authModeSwitch");assert.equal(await page.locator("#authTitle").textContent(),"Создание аккаунта");
  for(const id of ["authDisplayName","authEmail","authPassword","authPasswordConfirm"])assert.equal(await page.locator(`#${id}`).isVisible(),true,id);
  await page.click("#authModeSwitch");assert.equal(await page.locator("#authTitle").textContent(),"Вход");
  await page.click("#authModeSwitch");await page.fill("#authDisplayName","Новый автор");await page.fill("#authEmail","new@example.test");await page.fill("#authPassword","password");await page.fill("#authPasswordConfirm","different");await page.click("#signInButton");
  assert.equal(await page.locator("#authMessage").textContent(),"Пароли не совпадают.");assert.equal(await page.evaluate(()=>globalThis.__authCalls.signUp),0);await context.close();
}
{
  const {page,context}=await pageFor("signup-none");await page.click("#authModeSwitch");await page.fill("#authDisplayName","Новый автор");await page.fill("#authEmail","new@example.test");await page.fill("#authPassword","password");await page.fill("#authPasswordConfirm","password");await page.click("#signInButton");
  await page.waitForSelector("#signupSuccess:not([hidden])");assert.match(await page.locator("#signupSuccessText").textContent(),/new@example\.test/);assert.equal(await page.evaluate(()=>globalThis.__authCalls.account),0);assert.equal(await page.evaluate(()=>globalThis.__authCalls.redirect),"http://127.0.0.1:8000/");await context.close();
}
{
  const {page,context}=await pageFor("signup-session");await page.click("#authModeSwitch");await page.fill("#authDisplayName","Новый автор");await page.fill("#authEmail","new@example.test");await page.fill("#authPassword","password");await page.fill("#authPasswordConfirm","password");await page.click("#signInButton");await page.waitForTimeout(250);const signupState=await page.evaluate(()=>({status:globalThis.cloudState?.dashboardStatus,calls:globalThis.__authCalls,app:document.body.dataset.appState,failure:document.querySelector("#cloudFailure")?.textContent}));assert.deepEqual(signupState,{status:"success",calls:{account:3,signUp:1,signIn:0,redirect:"http://127.0.0.1:8000/"},app:"projects",failure:""});await context.close();
}
{
  const {page,context}=await pageFor("signup-rate");await page.click("#authModeSwitch");await page.fill("#authDisplayName","Новый автор");await page.fill("#authEmail","new@example.test");await page.fill("#authPassword","password");await page.fill("#authPasswordConfirm","password");await page.click("#signInButton");assert.match(await page.locator("#authMessage").textContent(),/примерно через минуту/);await context.close();
}
{
  const {page,context}=await pageFor("invalid-login");await page.fill("#authEmail","new@example.test");await page.fill("#authPassword","password");await page.click("#signInButton");assert.equal(await page.locator("#authMessage").textContent(),"Неверный email или пароль.");await context.close();
}
{
  const {page,context}=await pageFor("none","?type=signup");await page.waitForSelector("#authScreen:not([hidden])");assert.equal(await page.locator("#authMessage").textContent(),"Email подтверждён. Теперь войдите в аккаунт.");assert.equal(await page.evaluate(()=>globalThis.__authCalls.account),0);await context.close();
}
{
  const {page,context}=await pageFor("callback-session","?type=signup");await page.waitForSelector("#projectsEmptyState:not([hidden])");assert.equal(await page.getByRole("heading",{name:"Мои проекты"}).isVisible(),true);assert.equal(await page.evaluate(()=>globalThis.__authCalls.account),3,"callback race loaded dashboard more than once");await context.close();
}
{
  const {page,context}=await pageFor();await page.fill("#authEmail","new@example.test");await page.fill("#authPassword","password");await page.click("#signInButton");await page.waitForSelector("#projectsEmptyState:not([hidden])");assert.equal(await page.evaluate(()=>globalThis.__authCalls.signIn),1);await context.close();
}
await browser.close();console.log("auth production-DOM browser tests passed");
