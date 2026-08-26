import {createRequire} from "node:module";
import assert from "node:assert/strict";
const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");

const email=process.env.AUTH_ACCEPTANCE_EMAIL,password=process.env.AUTH_ACCEPTANCE_PASSWORD;
const base=process.env.AUTHOR_WORKSPACE_URL||"http://localhost:8000/";
if(!email||!password){console.log("real auth login acceptance skipped: credentials are not configured");process.exit(0)}

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(15000);
const authStatuses=[];page.on("response",response=>{if(response.url().includes("crchibwumcuuqhkabmfj.supabase.co"))authStatuses.push({status:response.status(),url:response.url()})});

async function login(){
  await page.locator("#authEmail").fill(email);await page.locator("#authPassword").fill(password);await page.locator("#signInButton").click();
  await page.waitForSelector("#projectsScreen:not([hidden])");
  await page.waitForFunction(()=>globalThis.cloudState?.dashboardStatus==="success");
  assert.equal(await page.getByRole("heading",{name:"Мои проекты"}).isVisible(),true);
  return page.evaluate(()=>({sessionUser:cloudState.session?.user?.id,profileUser:cloudState.profile?.user_id,status:cloudState.dashboardStatus}));
}

try{
  await page.goto(base,{waitUntil:"networkidle"});await page.waitForSelector("#authScreen:not([hidden])");
  const first=await login();assert.equal(first.status,"success");assert.equal(first.profileUser,first.sessionUser);
  await page.locator("#dashboardAccountMenu > summary").click();await page.locator("#dashboardLogout").click();await page.waitForSelector("#authScreen:not([hidden])");
  const second=await login();assert.equal(second.status,"success");assert.equal(second.profileUser,second.sessionUser);
  assert.equal(authStatuses.some(item=>item.status===401),false,`unexpected 401: ${JSON.stringify(authStatuses.filter(item=>item.status===401))}`);
  console.log(JSON.stringify({ok:true,userId:second.sessionUser,dashboard:"Мои проекты",logoutLogin:true,http401:0}));
}finally{await browser.close()}
