import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { REVIEW_META_PATH, REVIEW_TOOL_ID } from "./server.mjs";

export const ROOT = process.cwd();
export const HOST = "127.0.0.1";
export const PORT = Number(process.env.PORT || 8000);
export const REVIEW_URL = `http://${HOST}:${PORT}/`;

// Read-only: this launcher must never switch, reset, pull, merge, or push the
// checked-out working tree. It only reports what is already there.
export function gitInfo(cwd = ROOT) {
  try {
    const branch = execFileSync("git",["rev-parse","--abbrev-ref","HEAD"],{cwd,encoding:"utf8"}).trim();
    const commit = execFileSync("git",["rev-parse","--short","HEAD"],{cwd,encoding:"utf8"}).trim();
    const dirty = execFileSync("git",["status","--porcelain"],{cwd,encoding:"utf8"}).trim().length>0;
    return {branch,commit,dirty};
  } catch {
    return {branch:null,commit:null,dirty:false};
  }
}

export function checkHealth({host=HOST,port=PORT,timeoutMs=800}={}) {
  return new Promise(resolve=>{
    const request = http.get({host,port,path:REVIEW_META_PATH,timeout:timeoutMs},res=>{
      let body="";
      res.on("data",chunk=>{body+=chunk});
      res.on("end",()=>{
        try {
          const json = JSON.parse(body);
          resolve(json && json.tool===REVIEW_TOOL_ID ? {status:"ours",meta:json} : {status:"foreign"});
        } catch {
          resolve({status:"foreign"});
        }
      });
    });
    request.on("timeout",()=>{request.destroy();resolve({status:"down"})});
    request.on("error",()=>resolve({status:"down"}));
  });
}

export async function waitForHealth({attempts=30,delayMs=200}={}) {
  for (let i=0;i<attempts;i++) {
    const result = await checkHealth();
    if (result.status==="ours") return result;
    await new Promise(resolve=>setTimeout(resolve,delayMs));
  }
  return {status:"down"};
}

export function openBrowser(url,{spawnImpl=spawn,platform=process.platform}={}) {
  if (platform==="win32") {
    return spawnImpl("cmd",["/c","start","",url],{stdio:"ignore",detached:true});
  }
  if (platform==="darwin") {
    return spawnImpl("open",[url],{stdio:"ignore",detached:true});
  }
  return spawnImpl("xdg-open",[url],{stdio:"ignore",detached:true});
}

function printStatus(meta) {
  const dirty = meta.dirty ? " · DIRTY" : "";
  const branch = meta.branch ?? "unknown";
  const commit = meta.commit ?? "unknown";
  console.log(`LOCAL · ${branch} · ${commit}${dirty}`);
  console.log(`Открывайте ${REVIEW_URL}`);
}

export async function main() {
  const initial = await checkHealth();

  if (initial.status==="ours") {
    printStatus(initial.meta);
    openBrowser(REVIEW_URL).unref();
    return;
  }

  if (initial.status==="foreign") {
    console.error(`Порт ${PORT} занят другим процессом (это не Author Workspace review server).`);
    console.error(`Освободите порт ${PORT} или запустите: PORT=<другой порт> npm run review`);
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath,["tools/server.mjs"],{cwd:ROOT,stdio:"inherit",env:{...process.env,PORT:String(PORT)}});
  child.on("error",error=>{
    console.error("Не удалось запустить tools/server.mjs:",error.message);
    process.exitCode = 1;
  });

  const ready = await waitForHealth();
  if (ready.status!=="ours") {
    console.error(`Сервер не ответил на ${REVIEW_META_PATH} вовремя.`);
    process.exitCode = 1;
    return;
  }

  printStatus(ready.meta);
  openBrowser(REVIEW_URL).unref();

  await new Promise(resolve=>{ child.on("exit",resolve); });
}

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main();
}
