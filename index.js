const {onValueCreated} = require("firebase-functions/v2/database");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");

initializeApp();

/**
 * ✅ שליחה ידנית (דרך הכפתור) — נשאר כמו שהיה
 * מאזין לכתיבה ב-adminPushRequests
 */
exports.sendConstraintsReminder = onValueCreated(
    {
      ref: "/adminPushRequests/{requestId}",
      region: "europe-west1",
    },
    async (event) => {
      try {
        const request = event.data.val();

        if (!request || request.type !== "constraints_reminder") {
          return null;
        }

        console.log("Processing constraints reminder request:", request);

        const db = getDatabase();
        const tokensSnapshot = await db.ref("/pushTokens").once("value");
        const tokensData = tokensSnapshot.val();

        if (!tokensData) {
          console.log("No push tokens found");
          return null;
        }

        const tokenEntries = Object.entries(tokensData)
            .filter(([_, token]) => token && typeof token === "string")
            .map(([key, token]) => ({key, token}));

        if (tokenEntries.length === 0) {
          console.log("No valid tokens to send to");
          return null;
        }

        console.log(`Sending to ${tokenEntries.length} devices`);

        const title = request.title || "תזכורת להזנת אילוצים";
        const body = request.body || "נא להזין אילוצים לשבוע הקרוב במערכת.";
        const url = request.url || "https://crmnick88.github.io/";

        const message = {
          tokens: tokenEntries.map((t) => t.token),
          notification: {
            title: title,
            body: body,
          },
          data: {
            url: url,
          },
          webpush: {
            fcmOptions: {
              link: url,
            },
            notification: {
              icon: "https://crmnick88.github.io/icon-192.png",
              badge: "https://crmnick88.github.io/icon-192.png",
              tag: "constraints_reminder",
              renotify: true,
            },
          },
        };

        const response = await getMessaging().sendEachForMulticast(message);

        console.log(`Successfully sent ${response.successCount} messages`);
        console.log(`Failed to send ${response.failureCount} messages`);

        await event.data.ref.remove();
        console.log("Request deleted after processing");

        return null;
      } catch (error) {
        console.error("Error sending push notifications:", error);
        return null;
      }
    },
);

/**
 * ✅ שליחה אוטומטית — כל יום רביעי ב-10:00 וב-16:00 (שעון ישראל)
 * לא תלוי בכפתור בכלל.
 */
exports.scheduledConstraintsReminder = onSchedule(
    {
      schedule: "0 10,16 * * 3", // Wed at 10:00 and 16:00
      timeZone: "Asia/Jerusalem",
      region: "europe-west1",
    },
    async () => {
      try {
        console.log("Scheduled constraints reminder triggered");

        const db = getDatabase();
        const tokensSnapshot = await db.ref("/pushTokens").once("value");
        const tokensData = tokensSnapshot.val();

        if (!tokensData) {
          console.log("No push tokens found");
          return null;
        }

        const tokenEntries = Object.entries(tokensData)
            .filter(([_, token]) => token && typeof token === "string")
            .map(([key, token]) => ({key, token}));

        if (tokenEntries.length === 0) {
          console.log("No valid tokens to send to");
          return null;
        }

        console.log(`Scheduled sending to ${tokenEntries.length} devices`);

        const title = "תזכורת להזנת אילוצים";
        const body = "נא להזין אילוצים לשבוע הקרוב במערכת.";
        const url = "https://crmnick88.github.io/";

        const message = {
          tokens: tokenEntries.map((t) => t.token),
          notification: {
            title: title,
            body: body,
          },
          data: {
            url: url,
          },
          webpush: {
            fcmOptions: {
              link: url,
            },
            notification: {
              icon: "https://crmnick88.github.io/icon-192.png",
              badge: "https://crmnick88.github.io/icon-192.png",
              tag: "constraints_reminder",
              renotify: true,
            },
          },
        };

        const response = await getMessaging().sendEachForMulticast(message);

        console.log(`Scheduled: Successfully sent ${response.successCount} messages`);
        console.log(`Scheduled: Failed to send ${response.failureCount} messages`);

        return null;
      } catch (error) {
        console.error("Scheduled error sending push notifications:", error);
        return null;
      }
    },
);
