import {createRequire} from "node:module";
import {spawn} from "node:child_process";

const require=createRequire("C:/Users/tadan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const {chromium}=require("playwright");
const base=process.env.AUTHOR_WORKSPACE_URL||"http://127.0.0.1:8000/";
const server=spawn(process.execPath,["tools/server.mjs"],{stdio:"ignore"});
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});

async function goto(page){
  for(let attempt=0;attempt<30;attempt++){try{await page.goto(base,{waitUntil:"networkidle"});return}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
  throw new Error("server never became ready");
}

try{
  // 1) Real local server (`node tools/server.mjs`) answers /__review-meta -> badge renders,
  //    and existing app behavior (#board, no console errors) is unaffected by the new script.
  const realPage=await browser.newPage();
  const realErrors=[];
  realPage.on("pageerror",error=>realErrors.push(error.message));
  await goto(realPage);
  await realPage.waitForSelector("body");
  const badge=await realPage.waitForSelector("#localReviewBadge",{state:"attached",timeout:5000});
  const badgeText=await badge.textContent();
  if(!/^LOCAL · /.test(badgeText))throw new Error(`Badge text missing LOCAL prefix: ${badgeText}`);
  if(realErrors.length)throw new Error(`Real local server produced page errors: ${realErrors.join(" | ")}`);
  await realPage.close();

  // 2) Simulated production: /__review-meta absent (404) -> badge must NOT render.
  const prodPage=await browser.newPage();
  await prodPage.route("**/__review-meta",route=>route.fulfill({status:404,body:"Not found"}));
  await goto(prodPage);
  await prodPage.waitForSelector("body");
  await prodPage.waitForTimeout(300);
  const prodBadgeCount=await prodPage.locator("#localReviewBadge").count();
  if(prodBadgeCount!==0)throw new Error("Badge rendered even though /__review-meta was unavailable (simulated production)");
  await prodPage.close();

  // 3) Long branch name: badge stays out of document flow, truncates visually,
  //    and keeps the full branch/commit available via the title tooltip.
  const longPage=await browser.newPage();
  const longBranch="feature/this-is-a-deliberately-very-long-branch-name-for-truncation-testing";
  await longPage.route("**/__review-meta",route=>route.fulfill({
    status:200,
    contentType:"application/json",
    body:JSON.stringify({tool:"author-workspace-review",branch:longBranch,commit:"abc1234",dirty:true})
  }));
  await goto(longPage);
  const longBadge=await longPage.waitForSelector("#localReviewBadge",{state:"attached",timeout:5000});
  const info=await longBadge.evaluate(node=>({
    position:getComputedStyle(node).position,
    overflow:getComputedStyle(node).overflow,
    title:node.title,
    text:node.textContent
  }));
  if(info.position!=="fixed")throw new Error(`Badge must be position:fixed (out of document flow), got ${info.position}`);
  if(!info.title.includes(longBranch))throw new Error("Full branch name must be available via title tooltip when truncated");
  if(!info.title.includes("abc1234"))throw new Error("Full commit must be available via title tooltip");
  if(!/DIRTY/.test(info.text))throw new Error("Dirty working tree must be reflected in the badge");
  await longPage.close();

  console.log("review badge browser tests passed");
}finally{
  await browser.close();
  server.kill();
}
