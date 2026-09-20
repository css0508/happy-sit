// PWA Service Worker：离线可用 + 可安装为 App
const CACHE = "reminder-v1";
const ASSETS = [
  "./提醒.html",
  "./manifest.json",
  "./icon.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});

// 后台定时提醒（配合 Periodic Sync，安卓 Chromium 支持）
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "reminder-tick") {
    e.waitUntil(notifyNext());
  }
});

async function notifyNext() {
  const reg = self.registration;
  // 仅工作日 9-18
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return;
  const m = now.getHours() * 60 + now.getMinutes();
  if (m < 9 * 60 || m > 18 * 60) return;
  // 每 45 分钟一次
  if (m % 45 !== 0) return;
  if ("showNotification" in reg) {
    reg.showNotification("💧 久坐提醒", {
      body: "该起身活动 + 喝 100-150ml 水啦",
      icon: "./icon.svg",
      tag: "rem-" + m,
      renotify: true,
    });
  }
}
