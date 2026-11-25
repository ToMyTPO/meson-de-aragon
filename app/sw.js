/* Service worker: permite instalar la app y mostrar notificaciones. Los datos de mercado nunca se cachean. */
const CACHE = "bv-v14";
const SHELL = ["./", "index.html", "styles.css", "app.js", "analysis.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // APIs: siempre a la red
  // Red primero para tener siempre la última versión; caché si no hay conexión
  e.respondWith(
    // Petición por URL (no reutilizar e.request con opciones: Safari puede rechazarlo en navegaciones)
    fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || (e.request.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
