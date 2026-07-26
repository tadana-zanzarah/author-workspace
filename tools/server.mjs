import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const types = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};
const server = http.createServer((request,response)=>{
  const requested = decodeURIComponent(new URL(request.url,"http://localhost").pathname);
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
server.listen(8000,"127.0.0.1",()=>console.log("Открывайте http://127.0.0.1:8000/"));
