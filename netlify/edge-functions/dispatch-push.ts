import { verifyFirebaseIdToken, getAccessToken, runFsQuery, jsonResponse } from "./lib/firestore-rest.ts";

export default async function handler(req: Request) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Missing token" }, 401);
  const idToken = authHeader.split(" ")[1];
  
  const uid = await verifyFirebaseIdToken(idToken);
  if (!uid) return jsonResponse({ error: "Invalid token" }, 401);

  const body = await req.json();
  const { title, message, schoolId, isPlatformAnnouncement } = body;
  
  if (!title || !message) return jsonResponse({ error: "Missing title or message" }, 400);

  const accessToken = await getAccessToken();

  let tokens: any[] = [];
  if (isPlatformAnnouncement) {
    // Platform announcement: broadcast to all fcm_tokens
    // (This uses an empty filter. In a massive scale app, this might need chunking, 
    // but for the current size, 1000 limit in runFsQuery is okay or we fetch all pages.)
    tokens = await runFsQuery(accessToken, "fcm_tokens", []);
  } else if (schoolId) {
    // School-specific notification
    tokens = await runFsQuery(accessToken, "fcm_tokens", [["schoolId", "EQUAL", schoolId]]);
  } else {
    return jsonResponse({ error: "Must specify schoolId or isPlatformAnnouncement" }, 400);
  }

  const fcmTokens = tokens.map(t => t.token).filter(Boolean);
  if (fcmTokens.length === 0) return jsonResponse({ success: true, count: 0 }, 200);

  // Send pushes in parallel
  const sendPromises = fcmTokens.map(token => {
    return fetch(`https://fcm.googleapis.com/v1/projects/jss-management-system/messages:send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body: message },
          data: { url: "/app/#!/notifications" }
        }
      })
    });
  });

  await Promise.allSettled(sendPromises);

  return jsonResponse({ success: true, count: fcmTokens.length }, 200);
}

export const config = { path: "/api/dispatch-push" };
