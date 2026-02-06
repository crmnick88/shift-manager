importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "PUT_YOUR_CONFIG_HERE",
  authDomain: "PUT_YOUR_CONFIG_HERE",
  projectId: "PUT_YOUR_CONFIG_HERE",
  messagingSenderId: "PUT_YOUR_CONFIG_HERE",
  appId: "PUT_YOUR_CONFIG_HERE"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon-192.png'
  });
});
