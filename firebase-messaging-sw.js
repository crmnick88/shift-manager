/* firebase-messaging-sw.js */

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD-uaQ2aO87kGxbcc-m8_9fzJ3uhPv2zvk",
  authDomain: "shift-manager-c026e.firebaseapp.com",
  databaseURL: "https://shift-manager-c026e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "shift-manager-c026e",
  storageBucket: "shift-manager-c026e.firebasestorage.app",
  messagingSenderId: "1091605398341",
  appId: "1:1091605398341:web:cb6c14e7d832c3e8df342c"
});

const messaging = firebase.messaging();

/**
 * כשמגיעה הודעה כשהאתר "ברקע"/סגור:
 * מציגים תמיד Notification אמיתי עם fallback אם אין notification בפיילוד.
 */
messaging.onBackgroundMessage((payload) => {
  try {
    const title =
      (payload && payload.notification && payload.notification.title) ||
      (payload && payload.data && payload.data.title) ||
      "תזכורת";

    const body =
      (payload && payload.notification && payload.notification.body) ||
      (payload && payload.data && payload.data.body) ||
      "";

    const icon =
      (payload && payload.notification && payload.notification.icon) ||
      "./icon-192.png";

    const options = {
      body,
      icon,
      // שומרים מידע נוסף אם תרצה בעתיד לפתוח דף כשמקליקים על ההתראה
      data: payload && payload.data ? payload.data : {}
    };

    self.registration.showNotification(title, options);
  } catch (e) {
    // לא להפיל את ה-SW על חריגה
    console.log("onBackgroundMessage error:", e);
  }
});

/**
 * מה קורה כשמקליקים על ההתראה:
 * יפתח/ימקד את האתר.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen =
    (event.notification && event.notification.data && event.notification.data.url) ||
    "https://crmnick88.github.io/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && client.focus) return client.focus();
      }
      return clients.openWindow(urlToOpen);
    })
  );
});
