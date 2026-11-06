const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=Number(process.env.PORT)||4203,host=process.env.HOST||'127.0.0.1';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.task':'application/octet-stream','.png':'image/png','.webp':'image/webp','.json':'application/json'};
const server=http.createServer((req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/')pathname='/index.html';
 if(!(pathname==='/index.html'||pathname.startsWith('/src/')||pathname.startsWith('/assets/'))){res.writeHead(404);res.end('Not found');return;}
 const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
 fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
 if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 });
}catch(_){res.writeHead(400);res.end('Invalid request');}});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,host,()=>console.log('Hurrygoodjob-Text: http://'+(host==='0.0.0.0'?'localhost':host)+':'+port));
