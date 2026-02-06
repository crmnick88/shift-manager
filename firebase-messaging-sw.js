importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD-uaQ2aO87kGxbcc-m8_9fzJ3uhPv2zvk",
  authDomain: "shift-manager-c026e.firebaseapp.com",
  databaseURL: "https://shift-manager-c026e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "shift-manager-c026e",
  storageBucket: "shift-manager-c026e.firebasestorage.app",
  messagingSenderId: "1091605398341",
  appId: "1:1091605398341:web:cb6c14e7d832c3e8df342c",
});

const messaging = firebase.messaging();

function showNotif(payload) {
  const title =
    payload?.notification?.title ||
    payload?.data?.title ||
    "תזכורת להזנת אילוצים";

  const body =
    payload?.notification?.body ||
    payload?.data?.body ||
    "נא להזין אילוצים לשבוע הקרוב במערכת.";

  const url =
    payload?.data?.url ||
    "https://crmnick88.github.io/";

  return self.registration.showNotification(title, {
    body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url },
    tag: "constraints_reminder",
    renotify: true,
  });
}

// Firebase handler (עובד טוב כשזה data-only)
messaging.onBackgroundMessage((payload) => showNotif(payload));

// גיבוי: אם לפעמים מגיע Push בלי ש-Firebase מפעיל onBackgroundMessage
self.addEventListener("push", (event) => {
  try {
    const payload = event.data ? event.data.json() : {};
    event.waitUntil(showNotif(payload));
  } catch (e) {
    // אם לא JSON
    event.waitUntil(
      self.registration.showNotification("תזכורת", {
        body: "נא להיכנס למערכת.",
        icon: "./icon-192.png",
      }),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "https://crmnick88.github.io/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes("crmnick88.github.io") && client.focus) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
