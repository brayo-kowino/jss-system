// ==========================================================================
// One-time backfill: grant deviceApprovedUntil to every account that
// already has at least one trusted device on record.
// ==========================================================================
// Run this ONCE, after deploying the updated netlify/edge-functions/* but
// BEFORE deploying the updated firestore.rules. If you deploy the rules
// first, every account - including yours - loses access immediately,
// because nobody has deviceApprovedUntil yet.
//
// twoFactorVerified is deliberately NOT backfilled here. It's meant to be
// re-proven on the next real sign-in (that's the whole point of it having
// a short TTL) - anyone with 2FA enabled will just see the 2FA prompt once
// after rollout, which is the expected/desired behavior, not a bug.
//
// USAGE:
//   GOOGLE_SERVICE_ACCOUNT_KEY='<json>' deno run --allow-net --allow-env scripts/backfill-device-claims.ts
//
// Requires the same service account as the edge functions, with the
// "Firebase Authentication Admin" IAM role (needed for accounts:update,
// same requirement noted in lib/firestore-rest.ts).
// ==========================================================================

const PROJECT_ID = "jss-management-system";
const DEVICE_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // keep in sync with device-register.ts

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const raw = atob(clean);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = new TextEncoder();
  const unsigned = base64UrlEncode(enc.encode(JSON.stringify(header))) + "." + base64UrlEncode(enc.encode(JSON.stringify(claims)));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", pemToPkcs8(serviceAccount.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function listAllUserIds(accessToken: string): Promise<string[]> {
  const uids: string[] = [];
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users`;
  let pageToken: string | undefined;
  do {
    const url = new URL(base);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`List users failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const doc of data.documents || []) {
      uids.push(doc.name.split("/").pop());
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return uids;
}

async function hasAnyTrustedDevice(accessToken: string, uid: string): Promise<boolean> {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/trusted_devices?pageSize=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`List trusted_devices failed for ${uid}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data.documents) && data.documents.length > 0;
}

async function grantDeviceClaim(accessToken: string, uid: string): Promise<void> {
  const lookupRes = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: [uid] }),
  });
  if (!lookupRes.ok) throw new Error(`accounts:lookup failed for ${uid}: ${lookupRes.status}`);
  const lookupData = await lookupRes.json();
  const user = lookupData.users && lookupData.users[0];
  const current = user?.customAttributes ? JSON.parse(user.customAttributes) : {};
  const merged = { ...current, deviceApprovedUntil: new Date(Date.now() + DEVICE_CLAIM_TTL_MS).toISOString() };

  const updateRes = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:update", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(merged) }),
  });
  if (!updateRes.ok) throw new Error(`accounts:update failed for ${uid}: ${updateRes.status} ${await updateRes.text()}`);
}

async function main() {
  const rawKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!rawKey) {
    console.error("Set GOOGLE_SERVICE_ACCOUNT_KEY before running this script.");
    Deno.exit(1);
  }
  const serviceAccount = JSON.parse(rawKey);
  const accessToken = await getAccessToken(serviceAccount);

  console.log("Listing users...");
  const uids = await listAllUserIds(accessToken);
  console.log(`Found ${uids.length} user docs.`);

  let granted = 0;
  let skipped = 0;
  let failed = 0;

  for (const uid of uids) {
    try {
      const hasDevice = await hasAnyTrustedDevice(accessToken, uid);
      if (!hasDevice) {
        console.log(`SKIP  ${uid} - no trusted_devices on record, leaving ungated (will hit the normal approval flow on next login).`);
        skipped++;
        continue;
      }
      await grantDeviceClaim(accessToken, uid);
      console.log(`GRANT ${uid}`);
      granted++;
    } catch (err) {
      console.error(`FAIL  ${uid}:`, err);
      failed++;
    }
  }

  console.log(`\nDone. Granted: ${granted}, Skipped (no device): ${skipped}, Failed: ${failed}.`);
  if (failed > 0) {
    console.error("Some accounts failed - re-run the script (it's idempotent) before deploying firestore.rules, or those accounts get locked out.");
  }
}

main();
