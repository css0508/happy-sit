// ============================================================
// 久坐提醒 Service Worker
// 核心目标：锁屏 / 清后台 / 页面关闭后，仍能准点弹通知 + 响铃 + 振动
// 原理：安装时根据 SCHEDULE 计算每个提醒时间点，用 setTimeout 唤醒自身
//       （Service Worker 被 setTimeout 持活，不依赖页面）
// ============================================================

const SCHEDULE = [
  "08:50","09:45","10:30","11:15","12:00","13:00",
  "13:45","14:30","15:15","16:00","16:45","17:30","18:00"
];
const WORK_START = 9 * 60, WORK_END = 18 * 60;

function timeToMin(str){ const [h,m]=str.split(":").map(Number); return h*60+m; }
function isWorkday(){ const d=new Date().getDay(); return d>=1 && d<=5; }

// ---- 注册前台页面用来显示的通知点击行为 ----
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  // 点击通知时把 App 拉到前台
  e.waitUntil(
    self.clients.matchAll({type:"window", includeUncontrolled:true}).then(clients=>{
      if(clients.length){ clients[0].focus(); return; }
      if(self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});

// ---- 安装：预缓存资源，保证离线能打开页面 ----
const CACHE = "reminder-v2";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
  // 安装完成立即排一次提醒
  scheduleAll();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
  scheduleAll();
});

// ---- 缓存策略：优先缓存（离线可用） ----
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});

// ============================================================
// 核心：后台定时
// 每次 Service Worker 启动（安装 / 激活 / 页面消息 / 通知触发后）
// 都重新计算「下一个提醒时间点」，setTimeout 到点后：
//   1. 弹出系统通知
//   2. 向前台页面发消息，让页面播放声音 + 振动
//   3. 递归排下一个时间点
// 关键点：setTimeout 会阻止 SW 进入休眠，实现"准后台"运行
// （安卓 Chrome 下，SW 生命周期内 setTimeout 可被唤醒）
// ============================================================
let timer = null;

function scheduleAll(){
  if(timer){ clearTimeout(timer); timer = null; }
  const now = new Date();
  const cur = now.getHours()*60 + now.getMinutes();

  // 找到下一个还没过的提醒时间点
  let next = null;
  for(const t of SCHEDULE){
    const m = timeToMin(t);
    if(m > cur){ next = {t, m}; break; }
  }

  // 今天提醒都结束了 → 排到明天第一个
  if(!next){
    next = { t: SCHEDULE[0], m: timeToMin(SCHEDULE[0]) + 24*60 };
  }

  const targetMs = (() => {
    const d = new Date();
    const [h,m] = next.t.split(":").map(Number);
    // 如果是明天的（m 被加了 24*60），用今天的日期 + 明天
    let dayOffset = (next.m >= 24*60) ? 1 : 0;
    d.setHours(h, m % 60, 0, 0);
    if(dayOffset){ d.setDate(d.getDate()+1); }
    return d.getTime();
  })();

  const delay = targetMs - Date.now();
  // 保险：超过 30 天的延迟用 setInterval 轮询兜底（setTimeout 上限约 24.8 天，但保守处理）
  if(delay > 0){
    timer = setTimeout(() => fire(next.t), delay);
    console.log("[SW] 下次提醒:", next.t, "约", Math.round(delay/1000/60), "分钟后");
  }
}

async function fire(timeStr){
  const now = new Date();
  const day = now.getDay();
  const m = now.getHours()*60 + now.getMinutes();

  // 只在「工作日 + 上班时段」内真正弹通知；其他时段静默跳过，直接排下一个
  const inWorkTime = m >= WORK_START && m <= WORK_END;
  const isWeekend = (day === 0 || day === 6);

  if(!isWeekend && inWorkTime){
    // 1) 系统通知（锁屏也能看到，离线可用）
    if("showNotification" in self.registration){
      self.registration.showNotification("💧 久坐提醒 · " + timeStr, {
        body: "该喝水 + 起身活动啦！",
        icon: "./icon.svg",
        badge: "./icon.svg",
        tag: "sit-reminder",
        renotify: true,
        requireInteraction: false,
        vibrate: [300, 150, 300, 150, 400]
      });
    }
    // 2) 通知前台页面 → 播放声音 + 振动（页面打开时更明显）
    const clients = await self.clients.matchAll({type:"window", includeUncontrolled:true});
    clients.forEach(c => c.postMessage({type:"remind", time: timeStr}));
  }

  // 3) 递归：排下一个时间点（保证链条不断）
  scheduleAll();
}

// ---- 页面发来的消息：立即试响 / 查询状态 ----
self.addEventListener("message", (e) => {
  const data = e.data || {};
  if(data.type === "test"){
    // 5 秒后试响一次，用于用户验证离线是否生效
    setTimeout(() => {
      self.registration.showNotification("🔔 测试提醒（离线验证）", {
        body: "如果你锁屏也能看到这条，说明后台提醒已生效",
        icon: "./icon.svg", tag:"rem-test"
      });
      self.clients.matchAll({type:"window"}).then(clients=>{
        clients.forEach(c=>c.postMessage({type:"remind", time:"测试"}));
      });
    }, 5000);
  }
  if(data.type === "reschedule"){
    scheduleAll();
  }
});
