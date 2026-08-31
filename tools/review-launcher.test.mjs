import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { gitInfo, checkHealth, openBrowser, HOST, PORT, REVIEW_URL } from "./review.mjs";
import { REVIEW_TOOL_ID } from "./server.mjs";

// --- canonical URL -----------------------------------------------------
assert.equal(HOST,"127.0.0.1","review launcher targets 127.0.0.1 by default");
assert.equal(PORT,8000,"review launcher targets port 8000 by default");
assert.equal(REVIEW_URL,"http://127.0.0.1:8000/","canonical review URL");

// --- launcher never mutates git state -----------------------------------
const launcherSource = fs.readFileSync(new URL("./review.mjs",import.meta.url),"utf8");
for (const forbidden of ["checkout","switch","reset","pull","merge","push"]) {
  const pattern = new RegExp(`["'\`]${forbidden}["'\`]`);
  assert.equal(pattern.test(launcherSource),false,`review.mjs must never invoke git ${forbidden}`);
}

// --- gitInfo reads branch/commit/dirty from a scratch repo, read-only ---
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),"awreview-"));
execFileSync("git",["init","-q"],{cwd:scratch});
execFileSync("git",["config","user.email","test@example.com"],{cwd:scratch});
execFileSync("git",["config","user.name","Test"],{cwd:scratch});
fs.writeFileSync(path.join(scratch,"file.txt"),"a");
execFileSync("git",["add","file.txt"],{cwd:scratch});
execFileSync("git",["commit","-q","-m","init"],{cwd:scratch});
execFileSync("git",["checkout","-q","-b","feature/scratch-branch"],{cwd:scratch});

let info = gitInfo(scratch);
assert.equal(info.branch,"feature/scratch-branch","gitInfo reports the current branch");
assert.equal(typeof info.commit==="string" && info.commit.length>0,true,"gitInfo reports a short commit hash");
assert.equal(info.dirty,false,"clean scratch tree reports not dirty");

fs.writeFileSync(path.join(scratch,"file.txt"),"b");
info = gitInfo(scratch);
assert.equal(info.dirty,true,"uncommitted change reports dirty");
fs.rmSync(scratch,{recursive:true,force:true});

// --- /__review-meta contract + server reuse detection --------------------
const testPort = 8791;
const serverChild = spawn(process.execPath,["tools/server.mjs"],{cwd:process.cwd(),stdio:"ignore",env:{...process.env,PORT:String(testPort)}});

async function waitReady() {
  for (let attempt=0;attempt<50;attempt++) {
    const result = await checkHealth({port:testPort,timeoutMs:300});
    if (result.status==="ours") return result;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error("test server never became healthy");
}

try {
  const first = await waitReady();
  assert.equal(first.meta.tool,REVIEW_TOOL_ID,"review-meta payload identifies the tool");
  assert.equal(typeof first.meta.branch,"string");
  assert.equal(typeof first.meta.commit,"string");
  assert.equal(typeof first.meta.dirty,"boolean");

  // Exactly what `npm run review` relies on to avoid EADDRINUSE on a second launch.
  const second = await checkHealth({port:testPort});
  assert.equal(second.status,"ours","a second health check reuses the already-running server instead of needing a new process");

  // A foreign server on the port must never be mistaken for ours (never reused, never killed).
  const foreignPort = 8792;
  const foreignServer = http.createServer((request,response)=>{response.writeHead(200,{"Content-Type":"text/plain"});response.end("hello");});
  await new Promise(resolve=>foreignServer.listen(foreignPort,"127.0.0.1",resolve));
  const foreignResult = await checkHealth({port:foreignPort});
  assert.equal(foreignResult.status,"foreign","a non-Author-Workspace server on the port is reported as foreign, never reused");
  await new Promise(resolve=>foreignServer.close(resolve));

  const downResult = await checkHealth({port:8793});
  assert.equal(downResult.status,"down","no listener on the port is reported as down");

  // A second server.mjs on an already-used port must fail cleanly, not crash with a raw stack trace.
  const clash = spawnSync(process.execPath,["tools/server.mjs"],{cwd:process.cwd(),env:{...process.env,PORT:String(testPort)},encoding:"utf8",timeout:3000});
  assert.notEqual(clash.status,0,"a second server.mjs on an occupied port exits non-zero");
  assert.match(clash.stderr,/уже занят/,"EADDRINUSE produces a clear message instead of an uncaught exception");
} finally {
  serverChild.kill();
}

// --- browser opening is mockable, no real browser windows in tests -------
const calls = [];
const fakeSpawn = (...args)=>{calls.push(args);return {unref(){}};};

openBrowser("http://127.0.0.1:8000/",{spawnImpl:fakeSpawn,platform:"win32"});
assert.equal(calls.at(-1)[0],"cmd");
assert.deepEqual(calls.at(-1)[1],["/c","start","","http://127.0.0.1:8000/"]);

openBrowser("http://127.0.0.1:8000/",{spawnImpl:fakeSpawn,platform:"darwin"});
assert.deepEqual(calls.at(-1),["open",["http://127.0.0.1:8000/"],{stdio:"ignore",detached:true}]);

openBrowser("http://127.0.0.1:8000/",{spawnImpl:fakeSpawn,platform:"linux"});
assert.equal(calls.at(-1)[0],"xdg-open");

console.log("review launcher unit tests: OK");
