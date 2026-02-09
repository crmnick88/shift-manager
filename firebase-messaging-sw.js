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

/**
 * ✅ Consistent notifications (even when logged out):
 * We rely on DATA-only payloads sent from Cloud Functions:
 * payload.data = { title, body, icon, url, tag, notificationId }
 */
messaging.onBackgroundMessage((payload) => {
  try {
    const data = (payload && payload.data) ? payload.data : {};
    const title = data.title || "🔔 הודעה";
    const body = data.body || "";
    const icon = data.icon || "/icon-192.png";
    const url = data.url || "/";
    const tag = data.tag || "constraints_reminder";
    const notificationId = data.notificationId || ""; // ✨ NEW: for tracking

    const options = {
      body,
      icon,
      badge: icon,
      tag,
      renotify: true,
      data: { 
        url,
        notificationId, // ✨ NEW: pass it to click handler
      },
    };

    self.registration.showNotification(title, options);
  } catch (e) {
    self.registration.showNotification("🔔 הודעה", {
      body: "קיבלת הודעה חדשה מהמערכת.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "generic",
      renotify: true,
      data: { url: "/" },
    });
  }
});

// ✅ When user clicks the notification, open/focus the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification && event.notification.data && event.notification.data.url) || "/";
  const notificationId = (event.notification && event.notification.data && event.notification.data.notificationId) || "";

  // ✨ NEW: Record that user clicked the notification
  if (notificationId) {
    recordNotificationClick(notificationId);
  }

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });

    // Try to focus an existing tab/window
    for (const client of allClients) {
      // If the client is already on the app origin/path, focus it
      if (client.url && (client.url.includes("crmnick88.github.io/shift-manager") || client.url.includes(url))) {
        return client.focus();
      }
    }

    // Otherwise open a new window
    return clients.openWindow(url);
  })());
});

/**
 * ✨ NEW: Record notification click in Firebase Database
 * @param {string} notificationId
 */
function recordNotificationClick(notificationId) {
  // Get all open clients (tabs/windows) of this app
  clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    if (clientList.length > 0) {
      // Send message to main app to record click
      clientList.forEach((client) => {
        client.postMessage({
          type: "NOTIFICATION_CLICKED",
          notificationId: notificationId,
          clickedAt: Date.now(),
        });
      });
    } else {
      // No open clients - record anonymous click via REST API
      const dbUrl = "https://shift-manager-c026e-default-rtdb.europe-west1.firebasedatabase.app";
      fetch(`${dbUrl}/notificationHistory/${notificationId}/clickedBy/UNKNOWN.json`, {
        method: "PUT",
        body: JSON.stringify({
          clickedAt: Date.now(),
          device: "unknown",
        }),
      }).catch((err) => {
        console.log("Failed to record click:", err);
      });
    }
  });
}
