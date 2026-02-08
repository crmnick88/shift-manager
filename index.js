const {onValueCreated} = require("firebase-functions/v2/database");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getMessaging} = require("firebase-admin/messaging");

initializeApp();

/**
 * Collect tokens from both formats:
 * 1) Old: pushTokens/{name} = "tokenString"
 * 2) New: pushTokens/{name}/{pushId} = { token: "...", updatedAt: ..., ua: ... }
 * @param {object|null} tokensData snapshot.val()
 * @return {Array<{path: string, token: string}>} token entries
 */
function collectAllTokenEntries(tokensData) {
  const entries = [];

  if (!tokensData || typeof tokensData !== "object") {
    return entries;
  }

  for (const [userKey, userNode] of Object.entries(tokensData)) {
    // OLD format: /pushTokens/HAI = "token"
    if (typeof userNode === "string") {
      entries.push({path: `/pushTokens/${userKey}`, token: userNode});
      continue;
    }

    // NEW format: /pushTokens/HAI/{pushId} = { token: "..." }
    if (userNode && typeof userNode === "object") {
      for (const [childKey, childVal] of Object.entries(userNode)) {
        if (
          childVal &&
          typeof childVal === "object" &&
          typeof childVal.token === "string" &&
          childVal.token.length > 20
        ) {
          entries.push({path: `/pushTokens/${userKey}/${childKey}`, token: childVal.token});
        }
      }
    }
  }

  return entries;
}

/**
 * Builds a WebPush multicast message (Option A - webpush.notification).
 * @param {{tokens: string[], title: string, body: string, url: string, iconUrl: string}} params
 * @return {object} multicast message
 */
function buildWebpushMessage(params) {
  const {tokens, title, body, url, iconUrl} = params;

  // ✅ Data-only payload: the Service Worker will render the notification consistently
  return {
    tokens,
    data: {
      title,
      body,
      url,
      icon: iconUrl,
      tag: "constraints_reminder",
    },
    webpush: {
      // Still keep link for browsers that use it (optional)
      fcmOptions: {
        link: url,
      },
    },
  };
}

/**
 * Removes invalid tokens from DB based on FCM response.
 * @param {Array<{path: string, token: string}>} tokenEntries
 * @param {object} response FCM batch response.
 * @return {Promise<void>}
 */
async function cleanupInvalidTokens(tokenEntries, response) {
  const db = getDatabase();
  const removals = [];

  response.responses.forEach((r, idx) => {
    if (r.success) return;

    const errCode = r.error && r.error.code ? String(r.error.code) : "";
    // Common invalid token errors
    const shouldRemove =
      errCode.includes("registration-token-not-registered") ||
      errCode.includes("invalid-argument") ||
      errCode.includes("invalid-registration-token");

    if (shouldRemove) {
      const entry = tokenEntries[idx];
      const path = entry && entry.path ? entry.path : null;
      if (path) {
        console.log("Removing invalid token at:", path, "error:", errCode);
        removals.push(db.ref(path).remove());
      }
    } else {
      console.log("Send failed (not removing):", errCode);
    }
  });

  await Promise.allSettled(removals);
}

/**
 * Sends push to all stored tokens.
 * @param {{title: string, body: string, url: string}} params
 * @return {Promise<void>}
 */
async function sendToAllTokens(params) {
  const db = getDatabase();
  const tokensSnapshot = await db.ref("/pushTokens").once("value");
  const tokensData = tokensSnapshot.val();

  const tokenEntries = collectAllTokenEntries(tokensData);

  if (tokenEntries.length === 0) {
    console.log("No valid tokens found in /pushTokens");
    return;
  }

  const uniqueTokens = Array.from(new Set(tokenEntries.map((t) => t.token)));

  console.log(`Sending to ${uniqueTokens.length} unique devices`);

  const message = buildWebpushMessage({
    tokens: uniqueTokens,
    title: params.title,
    body: params.body,
    url: params.url,
    // ✅ שים פה את הקישור התקין שלך לאייקון (כבר תיקנת אצלך)
    iconUrl: params.iconUrl,
  });

  const response = await getMessaging().sendEachForMulticast(message);

  console.log(`Successfully sent ${response.successCount} messages`);
  console.log(`Failed to send ${response.failureCount} messages`);

  // Cleanup invalid tokens (will remove from either old or new paths)
  await cleanupInvalidTokens(tokenEntries, response);
}

/**
 * ✅ Manual send: listens to /adminPushRequests/{requestId}
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

        const title = request.title || "תזכורת להזנת אילוצים";
        const body = request.body || "נא להזין אילוצים לשבוע הקרוב במערכת.";
        const url = request.url || "https://crmnick88.github.io/shift-manager/";
        const iconUrl = request.iconUrl || "https://crmnick88.github.io/shift-manager/icon-192.png";

        await sendToAllTokens({title, body, url, iconUrl});

        await event.data.ref.remove();
        return null;
      } catch (error) {
        console.error("Error sending push notifications:", error);
        return null;
      }
    },
);

/**
 * ✅ Scheduled send: every Wednesday at 10:00 and 16:00 (Israel time)
 */
exports.scheduledConstraintsReminder = onSchedule(
    {
      schedule: "0 10,16 * * 3",
      timeZone: "Asia/Jerusalem",
      region: "europe-west1",
    },
    async () => {
      try {
        const title = "תזכורת להזנת אילוצים";
        const body = "נא להזין אילוצים לשבוע הקרוב במערכת.";
        const url = "https://crmnick88.github.io/shift-manager/";
        const iconUrl = "https://crmnick88.github.io/shift-manager/icon-192.png";

        await sendToAllTokens({title, body, url, iconUrl});
        return null;
      } catch (error) {
        console.error("Scheduled error sending push notifications:", error);
        return null;
      }
    },
);
