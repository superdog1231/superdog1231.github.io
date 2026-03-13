/* sw.js - Super Dog 自動更新版 */
const SW_VERSION = '2026-03-13_1'; // 你要手動改版號也行（非必須，但建議）
const CACHE_PREFIX = 'superdog-cache';
const RUNTIME_CACHE = `${CACHE_PREFIX}-${SW_VERSION}`;

// 安裝：不強制預先快取，避免你更新檔案卻被舊 precache 綁住
self.addEventListener('install', (event) => {
  // 讓新的 SW 下載好後可被指示立刻啟用
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 清掉舊版本快取
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );

    // 讓所有分頁立刻被新 SW 接管
    await self.clients.claim();
  })());
});

// 接收指令：立刻跳過等待，啟用新 SW
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 抓取策略
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只處理同源請求（避免干擾外部 CDN）
  if (url.origin !== self.location.origin) return;

  // ✅ 1) HTML：永遠先走網路，確保更新；網路失敗才回快取
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        return cached || new Response('離線狀態，且尚無快取頁面。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // ✅ 2) 其他靜態檔：Stale-While-Revalidate（先回快取，再背景更新）
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);

    const fetchPromise = fetch(req).then((res) => {
      // 只快取成功回應
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    // 有快取先回快取，沒有就等網路
    return cached || (await fetchPromise) || new Response('', { status: 504 });
  })());
});