importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDkQ8_F46RQeo9D_R8w7U-h9wy9ynJXy_w",
  authDomain: "porteriavitual.firebaseapp.com",
  projectId: "porteriavitual",
  storageBucket: "porteriavitual.firebasestorage.app",
  messagingSenderId: "821434977499",
  appId: "1:821434977499:web:7057f2bf2f95e17ee890fe",
});

const messaging = firebase.messaging();

// Background message handler — shows notification when app is in background/closed
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Portería Virtual';
  const body  = payload.notification?.body  || '';
  const link  = payload.data?.link || '/';

  self.registration.showNotification(title, {
    body,
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    data:  { link },
    vibrate: [200, 100, 200],
  });
});

// Open or focus app when notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.link || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', link: url });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
