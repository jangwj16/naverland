self.addEventListener('install', e=>{
  e.waitUntil(caches.open('landlink-v1').then(c=>c.addAll([
    './','./index.html','./manifest.webmanifest',
    './icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'
  ])));
});
self.addEventListener('fetch', e=>{
  e.respondWith(caches.match(e.request).then(r=>r || fetch(e.request)));
});
