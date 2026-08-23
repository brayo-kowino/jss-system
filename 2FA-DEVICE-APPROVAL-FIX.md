# 2FA / Device-Approval Bypass Fix

## The bug

`signInWithEmailAndPassword` fully authenticated the user *before* any 2FA
or device-approval check ran. Those checks only ever lived in client-side
JavaScript, and `firestore.rules` let a signed-in user write their own
`trusted_devices` and `login_approvals` docs directly — so a valid session
(stolen token, XSS, or just devtools) could self-approve a device or flip
`twoFactorEnabled` off, skipping both gates entirely.

## The fix

Every write that used to grant trust now happens only inside a Netlify
edge function, using the service-account credential that bypasses
`firestore.rules` — the client can no longer perform any of these writes
itself.

| Edge function | Replaces |
|---|---|
| `two-factor-verify.ts` | Client-side TOTP/backup-code check |
| `two-factor-enable.ts` | Client write of `twoFactorEnabled`/`twoFactorSecret` |
| `two-factor-disable.ts` | Same, for disabling (requires a fresh step-up token) |
| `device-register.ts` | Client write to `trusted_devices` (requires a recent `auth_time` or genuine first-device bootstrap) |
| `login-approval-approve.ts` | Client write of `login_approvals.status` (requires caller to already be on a trusted device, + step-up token if 2FA is on) |
| `login-approval-redeem.ts` | The waiting device turning an approved request into a trusted-device record |

`firestore.rules` now denies client writes to `trusted_devices` (except a
narrow `lastSeenAt`-only update) and to `login_approvals.status`, and no
longer lets a client self-write the 2FA fields on `users/{uid}`.

## Required deployment step

Add one new environment variable in the Netlify dashboard (Site
configuration → Environment variables), alongside your existing
`GOOGLE_SERVICE_ACCOUNT_KEY`:

```
STEP_UP_TOKEN_SECRET = <a long random string, e.g. `openssl rand -hex 32`>
```

This signs the short-lived tokens that let `two-factor-verify.ts` prove to
`two-factor-disable.ts` / `login-approval-approve.ts` that a code was just
checked. Use a different value than `SUBSCRIPTION_TOKEN_SECRET` so
rotating one doesn't affect the other.

Deploy `firestore.rules` and the new `netlify/edge-functions/*` files
together — deploying the rules first without the edge functions live would
break enable/disable/approve flows client-side (expected: it should fail
closed, not open).

## Known follow-ups (not yet done, flagged for awareness)

- `twoFactorSecret` is still stored as a plain field on `users/{uid}` and
  is still readable by the account owner's own session (needed today for
  no reason at setup time, but not re-read anywhere else). Consider moving
  it to a separate collection with `allow read: if false` for extra
  defense-in-depth against a compromised session reading it back out.
- `login-approval-approve.ts` requires a step-up token for both approve
  *and* deny when 2FA is on. That's simpler and consistent, but if it's too
  much friction for "deny," it would be reasonable to only require it for
  approve.

## Update: router-level gating (closes the "Edge saw its own approve/deny prompt" bug)

Root cause: Firebase Auth's session goes fully live the instant
`signInWithEmailAndPassword` resolves, regardless of your app's own
device-trust/2FA concept. `onAuthStateChanged` fires globally and
`router.js` would mount the full shell for ANY authenticated session -
the `needsApproval`/`needs2FA` handling only lived in `login.js`'s one-time
form-submit branch, so a page refresh, a slow render, or the router's own
independent render cycle could reach the dashboard (and the pending
approval's own modal) on a device that was never actually approved.

Fixed by:

- **`auth.service.js`: `getAuthGateStatus(profile)`** - single source of
  truth for "is this session allowed past the gate," now called both by
  `login()` (once, at sign-in) and by `router.js` (on every protected-route
  render/refresh/navigation). Previously `login()` had its own private copy
  of this logic; now there's exactly one.
- **`router.js`** calls it right after the `mustChangePassword` check and,
  if it returns non-null, renders the approval-wait or 2FA screen *instead
  of* the shell - so an unapproved/unverified device can no longer reach
  the dashboard by any path, not just by clicking through the login form.
- **`js/components/auth-gate.js`** - the approval-wait and 2FA screens,
  extracted out of `login.js` into a shared component so `router.js` and
  `login.js` render the exact same UI rather than two copies that could
  drift apart.
- **2FA session tracking**: `two-factor.service.js` now marks a
  `sessionStorage` flag once a code is verified, so the router doesn't
  re-prompt for a code on every navigation within the same sign-in. This
  is a UX-only marker - it grants nothing by itself. Every privileged
  server call (disable 2FA, approve a login) still independently requires
  its own fresh step-up token from `/two-factor-verify`.
- Also fixed in passing: the approval doc's `deviceFingerprint` field was
  never actually being set (the field the request was created with never
  included it), weakening `login-approval-redeem.ts`'s device-match check.

With this in place: Chrome (trusted) still sees the approve/deny modal, as
intended. Edge (untrusted) now never reaches the shell at all until its
request is approved and redeemed - it stays on the waiting screen, and if
2FA is enabled, is prompted for a code immediately after redemption, before
`onDone()` ever lets it into the dashboard.
