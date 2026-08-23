# Deploy order (do not skip or reorder)

1. Grant the service account the **Firebase Authentication Admin** IAM role
   in GCP (Console -> IAM -> find the service account -> Add role). The
   existing `datastore` scope alone won't authorize claim writes.

2. Add all files in this package to your repo (overwrite existing) and
   deploy to Netlify. This includes the client-side token-refresh fix
   (`js/services/device.service.js`, `login-approval.service.js`,
   `two-factor.service.js`), so the browser actually picks up a granted
   claim within seconds instead of waiting up to an hour for its natural
   refresh. Do **not** deploy `firestore.rules` yet.

3. Run the backfill script once, using the same
   `GOOGLE_SERVICE_ACCOUNT_KEY` your edge functions use:
   ```
   GOOGLE_SERVICE_ACCOUNT_KEY='<json>' deno run --allow-net --allow-env scripts/backfill-device-claims.ts
   ```
   This grants `deviceApprovedUntil` (30-day expiry) to every account that
   already has a trusted device on record, so they aren't locked out the
   moment the rules go live. Accounts with zero trusted devices are left
   alone on purpose - they'll just go through the normal approval flow on
   next login, same as today.

4. Deploy `firestore.rules`.

5. Smoke-test right after: sign in on an already-trusted device (should
   work with no extra prompt), sign in on a brand-new device (should hit
   the approval-wait screen, then work once approved), and if 2FA is
   enabled on your own account, confirm a fresh sign-in actually asks for
   a code again (that's TWO_FACTOR_CLAIM_TTL_MS - 12h - doing its job,
   not a bug).

# What this does and doesn't close

- Closes: direct Firestore SDK/REST access using a token from an account
  that was never approved, was revoked, or is stale past its claim expiry.
- Bounds, doesn't eliminate: a stolen token from an account currently in
  good standing is still valid until `deviceApprovedUntil` /
  `twoFactorVerifiedUntil` expire (30 days / 12 hours), because Firebase
  custom claims are account-wide, not per-device or per-session. Fully
  closing that needs a Firebase Auth Blocking Function (new infra: Cloud
  Functions + Identity Platform) - say the word if you want that built too.
