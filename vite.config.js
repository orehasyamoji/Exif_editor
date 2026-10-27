import { defineConfig } from "vite";
// Generate an exact precache list from the output, including hashed JS/CSS.
export default defineConfig({
  plugins: [
    {
      name: "offline-shell",
      generateBundle(_, bundle) {
        const assets = Object.keys(bundle);
        const list = [
          "./",
          "./index.html",
          "./manifest.webmanifest",
          "./icon.svg",
          "./icon-192.png",
          "./icon-512.png",
          "./apple-touch-icon.png",
          ...assets.filter((x) => x !== "index.html").map((x) => "./" + x),
        ];
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `const PREFIX='film-exif:'+self.registration.scope+':';
const CACHE=PREFIX+'${Date.now()}';
const FILES=${JSON.stringify(list)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 e.respondWith(caches.open(CACHE).then(async c=>{
  const cached=await c.match(e.request,{ignoreSearch:true,ignoreVary:true});if(cached)return cached;
  if(e.request.mode==='navigate'){const page=await c.match(new URL('./index.html',self.registration.scope));if(page)return page;}
  return fetch(e.request);
 }));
});`,
        });
      },
    },
  ],
});
