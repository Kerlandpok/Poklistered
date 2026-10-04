const CACHE="poklistered-auto-v1",SHELL=["./","./index.html","./manifest.webmanifest","./logo.png","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./cloud.js?v=1","./firebase-transport.js?v=1","https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js","https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js","https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("poklistered-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),scope=new URL(self.registration.scope);
 if(event.request.method!=='GET'||!(url.origin===scope.origin&&url.pathname.startsWith(scope.pathname)||url.origin==='https://www.gstatic.com'&&url.pathname.includes('/firebasejs/')))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}catch{const hit=await cache.match(event.request,{ignoreSearch:true});if(hit)return hit;if(event.request.mode==='navigate')return await cache.match(new URL('index.html',scope),{ignoreSearch:true})||Response.error();return Response.error();}})());
});

