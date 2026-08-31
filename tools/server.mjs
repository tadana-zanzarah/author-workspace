import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const types = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};

// Dev-only local review metadata contract (see tools/review.mjs and js/dev-review-badge.js).
// Never deployed: GitHub Pages serves static files only, this Node server never runs there.
export const REVIEW_META_PATH = "/__review-meta";
export const REVIEW_TOOL_ID = "author-workspace-review";

export function reviewMeta() {
  try {
    const branch = execFileSync("git",["rev-parse","--abbrev-ref","HEAD"],{cwd:root,encoding:"utf8"}).trim();
    const commit = execFileSync("git",["rev-parse","--short","HEAD"],{cwd:root,encoding:"utf8"}).trim();
    const dirty = execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim().length>0;
    return {tool:REVIEW_TOOL_ID,branch,commit,dirty};
  } catch {
    return {tool:REVIEW_TOOL_ID,branch:null,commit:null,dirty:false,gitUnavailable:true};
  }
}

const server = http.createServer((request,response)=>{
  const pathname = decodeURIComponent(new URL(request.url,"http://localhost").pathname);
  if (pathname === REVIEW_META_PATH) {
    response.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
    response.end(JSON.stringify(reviewMeta()));
    return;
  }
  const requested = pathname.replace(/^\/author-workspace(?=\/|$)/,"")||"/";
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/,"");
  const file = path.resolve(root,relative);
  if (!file.startsWith(root + path.sep) && file !== path.join(root,"index.html")) {
    response.writeHead(403).end("Forbidden"); return;
  }
  fs.readFile(file,(error,content)=>{
    if(error){response.writeHead(error.code==="ENOENT"?404:500).end("Not found");return}
    response.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});
    response.end(content);
  });
});
const port=Number(process.env.PORT||8000);

// Guarded so importing this module for REVIEW_META_PATH/reviewMeta() (from tools/review.mjs
// or tests) never has the side effect of binding a real port.
const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  server.on("error",error=>{
    if(error.code==="EADDRINUSE"){
      console.error(`Порт ${port} уже занят другим процессом. Author Workspace review server не запущен.`);
      process.exitCode=1;
      return;
    }
    throw error;
  });
  server.listen(port,"127.0.0.1",()=>console.log(`Открывайте http://127.0.0.1:${port}/`));
}
