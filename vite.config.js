import { defineConfig } from "vite";
// Cache HTML from this build, never a potentially stale CDN/HTTP response.
export default defineConfig({
  plugins: [
    {
      name: "offline-shell",
      enforce: "post",
      generateBundle: {
        order: "post",
        handler(_, bundle) {
          const html = String(bundle["index.html"].source);
          const list = [
            "./manifest.webmanifest",
            "./icon.svg",
            "./icon-192.png",
            "./icon-512.png",
            "./apple-touch-icon.png",
            ...Object.keys(bundle)
              .filter((x) => x !== "index.html")
              .map((x) => "./" + x),
          ];
          this.emitFile({
            type: "asset",
            fileName: "sw.js",
            source: `const PREFIX='film-exif:'+self.registration.scope+':';
const CACHE=PREFIX+'${Date.now()}';
const HTML=${JSON.stringify(html)};
const FILES=${JSON.stringify(list)};
self.addEventListener('install',e=>e.waitUntil((async()=>{
 const c=await caches.open(CACHE);
 try {
  await c.addAll(FILES.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
  const page=new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  await c.put(new URL('./',self.registration.scope),page.clone());
  await c.put(new URL('./index.html',self.registration.scope),page);
 } catch(error) {await caches.delete(CACHE);throw error;}
 // Do not skipWaiting: editing tabs must finish before a new version activates.
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
 // Retain previous build assets for documents still held in Safari's page cache.
 const old=(await caches.keys()).filter(k=>k.startsWith(PREFIX)&&k!==CACHE);
 await Promise.all(old.slice(0,-2).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
// Storage may be evicted independently of the active worker on Safari.
// Never resolve respondWith with the undefined result of Cache.match().
const ASSETS=new Set(FILES.map(path=>new URL(path,self.registration.scope).href));
const CRITICAL=FILES.filter(path=>/\\.(js|css)$/.test(path));
const RECOVERY='<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Film EXIF</title><body style="background:#171819;color:#eee;font:16px -apple-system,sans-serif;padding:40px;line-height:1.8"><h1 style="font-size:22px">Film EXIF</h1><p>オフライン用データを再取得できませんでした。<br>インターネットに接続して再読み込みしてください。</p><p>保存済みプリセットを削除する必要はありません。</p><button style="min-height:44px;padding:10px 24px;font:inherit" onclick="location.reload()">再読み込み</button></body></html>';
function htmlResponse(html,status=200){return new Response(html,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});}
async function assetResponse(request){
 let current;
 try{
  current=await caches.open(CACHE);
  const cached=await current.match(request,{ignoreSearch:true,ignoreVary:true});if(cached)return cached;
  const keys=(await caches.keys()).filter(k=>k.startsWith(PREFIX)&&k!==CACHE).reverse();
  for(const key of keys){const previous=await(await caches.open(key)).match(request,{ignoreSearch:true,ignoreVary:true});if(previous)return previous;}
 }catch{} // A storage failure must not prevent online use.
 try{
  const response=await fetch(request);
  if(response.ok&&ASSETS.has(request.url)&&current){try{await current.put(request,response.clone());}catch{}}
  return response;
 }catch{return new Response('接続して再読み込みしてください。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
}
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 e.respondWith((async()=>{
  if(e.request.mode==='navigate'){
   // HTML is bundled with the worker, not dependent on a cache entry. Repair
   // missing scripts/styles first; when offline, show a self-contained recovery
   // page instead of an unstyled or nonfunctional application document.
   const assets=await Promise.all(CRITICAL.map(path=>assetResponse(new Request(new URL(path,self.registration.scope),{cache:'reload'}))));
   const ready=assets.every((r,i)=>r.ok&&(/\\.css$/.test(CRITICAL[i])?/text\\/css/i:/javascript|ecmascript/i).test(r.headers.get('Content-Type')||''));
   return htmlResponse(ready?HTML:RECOVERY,ready?200:503);
  }
  return assetResponse(e.request);
 })());
});`,
          });
        },
      },
    },
  ],
});
