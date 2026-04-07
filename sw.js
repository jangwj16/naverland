// 🔥 강제 버전 업데이트 (버전만 바꿔도 전 직원에게 즉시 업데이트 강제됨)
const CACHE_NAME = 'landlink-v6';   // v2, v3, v4 … 숫자만 바꾸면 강제 업데이트

const FILES_TO_CACHE = [
  './',
  './index.html',
  './login.html',
  './listing.html',
  './building.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// 🔥 설치 단계: 새로운 캐시 저장
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  // 새 버전이 오면 즉시 활성화하도록 설정
  self.skipWaiting();
});

// 🔥 활성화 단계: 오래된 캐시 모두 삭제
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(
        keyList.map(key => {
          if (key !== CACHE_NAME) {
            console.log('🔥 오래된 캐시 삭제:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  // 새 서비스워커 즉시 적용
  self.clients.claim();
});

// 🔥 요청 가로채기 (항상 최신 버전 우선)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 네트워크 응답을 캐시에 업데이트
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // 네트워크 불가 → 캐시 fallback
        return caches.match(event.request);
      })
  );
});
