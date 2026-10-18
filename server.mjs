import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.txt':'text/plain; charset=utf-8'};
const port=Number(process.env.PORT)||4173;
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)||pathname.split('/').some(x=>x.startsWith('.'))){res.writeHead(403).end();return;}
  const data=await readFile(file);
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(data);
 }catch{res.writeHead(404).end('Not found');}
});
server.on('error',error=>{
 console.error(error.code==='EADDRINUSE'?`포트 ${port}를 사용 중입니다. 이미 열린 http://127.0.0.1:${port}를 확인하거나 기존 서버 창을 닫아 주세요.`:error.message);
 process.exitCode=1;
});
server.listen(port,'127.0.0.1',()=>console.log(`알약 카운터: http://127.0.0.1:${port}`));
