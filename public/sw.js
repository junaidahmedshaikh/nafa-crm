/* NAFA CRM service worker.
 * Present so the app is installable. It deliberately caches nothing: every page is per-user and authenticated,
 * so serving a stored copy could show someone else's data or stale figures. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
