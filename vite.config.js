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
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 e.respondWith((async()=>{
  const c=await caches.open(CACHE);
  if(e.request.mode==='navigate')return c.match(new URL('./index.html',self.registration.scope));
  const cached=await c.match(e.request,{ignoreSearch:true,ignoreVary:true});if(cached)return cached;
  const keys=(await caches.keys()).filter(k=>k.startsWith(PREFIX)&&k!==CACHE).reverse();
  for(const key of keys){const previous=await(await caches.open(key)).match(e.request,{ignoreSearch:true,ignoreVary:true});if(previous)return previous;}
  return fetch(e.request);
 })());
});`,
          });
        },
      },
    },
  ],
});
