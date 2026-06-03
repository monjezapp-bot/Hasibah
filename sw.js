// ═══════════════════════════════════════════════
// SERVICE WORKER — حاسبة الشفت
// النسخة: 1.0.0
// ═══════════════════════════════════════════════
const CACHE = 'shift-calc-v1';
const ASSETS = ['/', '/index.html', '/firebase-config.js'];

// ── تثبيت وتخزين مؤقت ──
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request))
      .catch(() => caches.match('/index.html'))
  );
});

// ══════════════════════════════════════════════
// PUSH NOTIFICATIONS — إشعارات خارجية
// ══════════════════════════════════════════════
self.addEventListener('push', e => {
  let data = { title: '🛵 حاسبة الشفت', body: 'إشعار جديد', type: 'general' };
  try { data = { ...data, ...e.data.json() }; } catch(_) {}

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    vibrate: data.type === 'shift_start' ? [300, 100, 300, 100, 300] : [200, 100, 200],
    tag: data.type || 'general',
    renotify: true,
    requireInteraction: data.type === 'shift_start',
    data: { url: '/', type: data.type },
    actions: data.type === 'shift_start' ? [
      { action: 'start', title: '▶ ابدأ الشيفت' },
      { action: 'snooze', title: '⏰ تأجيل 10 دقائق' }
    ] : []
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── نغمة تنبيه عبر postMessage ──
self.addEventListener('message', e => {
  if (e.data?.type === 'PLAY_SOUND') {
    // نبلّغ كل النوافذ المفتوحة لتشغيل الصوت
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => clients.forEach(c => c.postMessage({ type: 'PLAY_SOUND', sound: e.data.sound })));
  }
  if (e.data?.type === 'SCHEDULE_ALARM') {
    scheduleAlarmCheck(e.data.time, e.data.before);
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'snooze') {
    // أعد الجدولة بعد 10 دقائق
    setTimeout(() => {
      self.registration.showNotification('🛵 تذكير: حان وقت الشيفت!', {
        body: 'تم التأجيل 10 دقائق — الوقت حان الآن!',
        icon: '/icon-192.png',
        vibrate: [300,100,300,100,300],
      });
    }, 10 * 60 * 1000);
    return;
  }
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) { clients[0].focus(); return; }
      self.clients.openWindow('/');
    })
  );
});

// ── Alarm check via periodic sync (fallback) ──
function scheduleAlarmCheck(targetTime, minutesBefore) {
  // نحفظ في IndexedDB للـ background check
  const req = indexedDB.open('shift-alarms', 1);
  req.onupgradeneeded = e => e.target.result.createObjectStore('alarms', { keyPath: 'id' });
  req.onsuccess = e => {
    const db = e.target.result;
    const tx = db.transaction('alarms', 'readwrite');
    tx.objectStore('alarms').put({ id: 'main', targetTime, minutesBefore, createdAt: Date.now() });
  };
}

// ── Background alarm check ──
self.addEventListener('periodicsync', e => {
  if (e.tag === 'alarm-check') {
    e.waitUntil(checkAlarms());
  }
});

async function checkAlarms() {
  return new Promise((resolve) => {
    const req = indexedDB.open('shift-alarms', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      try {
        const tx = db.transaction('alarms', 'readonly');
        tx.objectStore('alarms').get('main').onsuccess = ev => {
          const alarm = ev.target.result;
          if (!alarm) { resolve(); return; }
          const now = new Date();
          const [h, m] = alarm.targetTime.split(':').map(Number);
          const alarmDate = new Date(now); alarmDate.setHours(h, m, 0, 0);
          const beforeDate = new Date(alarmDate.getTime() - alarm.minutesBefore * 60000);
          const diff = alarmDate - now;
          const diffBefore = beforeDate - now;
          if (Math.abs(diff) < 60000) {
            self.registration.showNotification('🛵 حان وقت الشيفت!', {
              body: 'وقت العمل وصل يا كابتن — بالتوفيق والرزق الوفير!',
              icon: '/icon-192.png', vibrate: [300,100,300,100,300],
              requireInteraction: true, tag: 'shift_start'
            });
          } else if (Math.abs(diffBefore) < 60000 && alarm.minutesBefore > 0) {
            self.registration.showNotification(`⏰ تنبيه: الشيفت بعد ${alarm.minutesBefore} دقيقة`, {
              body: 'استعد يا كابتن!',
              icon: '/icon-192.png', vibrate: [200,100,200],
              tag: 'shift_before'
            });
          }
          resolve();
        };
      } catch(_) { resolve(); }
    };
    req.onerror = () => resolve();
  });
}
