import { verifyFirebaseIdToken, getAccessToken, runFsQuery, getFsDoc, deleteFsDoc, jsonResponse } from "./lib/firestore-rest.ts";
import { checkRateLimit, rateLimitedResponse } from "./lib/rate-limit.ts";

export default async function handler(req: Request) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Missing token" }, 401);
  const idToken = authHeader.split(" ")[1];
  
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "Invalid token" }, 401);

  // Rate limit: 10 push dispatches per 5 minutes per user
  const rl = await checkRateLimit(`dispatch-push:uid:${uid}`, 10, 300);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { title, message, schoolId, isPlatformAnnouncement } = body || {};
  if (!title || !message) return jsonResponse({ error: "Missing title or message" }, 400);

  const accessToken = await getAccessToken();

  // Role & school authorization check
  const user = await getFsDoc(accessToken, `users/${uid}`);
  if (!user || user.status === "suspended") {
    return jsonResponse({ error: "Account is unauthorized or suspended" }, 403);
  }

  if (isPlatformAnnouncement) {
    if (user.role !== "super_admin") {
      return jsonResponse({ error: "Forbidden: Super admin required for platform announcements" }, 403);
    }
  } else if (schoolId) {
    const isSuper = user.role === "super_admin";
    const isAuthorizedStaff = user.schoolId === schoolId && ["admin", "principal", "deputy_principal", "academic_master"].includes(user.role);
    if (!isSuper && !isAuthorizedStaff) {
      return jsonResponse({ error: "Forbidden: Not authorized to dispatch notifications for this school" }, 403);
    }
  } else {
    return jsonResponse({ error: "Must specify schoolId or isPlatformAnnouncement" }, 400);
  }

  let tokens: any[] = [];
  if (isPlatformAnnouncement) {
    tokens = await runFsQuery(accessToken, "fcm_tokens", []);
  } else if (schoolId) {
    tokens = await runFsQuery(accessToken, "fcm_tokens", [["schoolId", "EQUAL", schoolId]]);
  }

  const fcmDocs = tokens.filter(t => t.token);
  if (fcmDocs.length === 0) return jsonResponse({ success: true, count: 0 }, 200);

  // Send pushes in parallel
  const sendPromises = fcmDocs.map(async (docItem) => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/jss-management-system/messages:send`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: {
            token: docItem.token,
            notification: { title, body: message },
            data: { url: "/app/#/notifications" }
          }
        })
      });

      // Stale token cleanup: If FCM says UNREGISTERED or 404, delete the token
      if (res.status === 404 || res.status === 410) {
        if (docItem.id) {
          deleteFsDoc(accessToken, `fcm_tokens/${docItem.id}`).catch(() => {});
        }
      }
      return res.ok;
    } catch {
      return false;
    }
  });

  await Promise.allSettled(sendPromises);

  return jsonResponse({ success: true, count: fcmDocs.length }, 200);
}

export const config = { path: "/api/dispatch-push" };
