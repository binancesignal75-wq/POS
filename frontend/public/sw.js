// Sirf app install ke liye. Kuch cache nahi karta: POS ko hamesha taaza version aur live data chahiye.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
