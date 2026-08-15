import { activateSubscription, getSubscriptionState, REVOKE_REASONS } from "../js/services/subscription.service.js";
import { refreshCurrentSchool, logout } from "../js/services/auth.service.js";
import { navigate, renderRoute } from "../js/router.js";
import { el, icon, toast, busyButton } from "../js/utils.js";

// ===========================================================================
// Subscription-expired lock screen.
// Rendered directly by router.js (not through the normal route table) any
// time the signed-in profile's school has a lapsed subscriptionExpiresAt -
// same "fully replaces the shell, no sidebar, no nav" pattern as
// change-password.js's forced password-change gate. Every role in the
// school lands here, parent/student portals included - firestore.rules'
// isSubscriptionActive() would block their reads/writes anyway, this is
// just what they see instead of a wall of failed requests.
//
// The one exception: a school's own admin can activate a token right on
// this screen (without full app/nav access) rather than being locked out
// of the one action that would unlock everything else. Every other role
// only sees the "contact your platform administrator" message.
// ===========================================================================

export async function render({ profile, school } = {}) {
  const wrap = el("div", { class: "not-found-page" });
  const { daysRemaining, suspended, revoked, revokeReason } = getSubscriptionState(school || {});
  const neverActivated = !school?.subscriptionExpiresAt;
  const revokeReasonLabel = revoked ? REVOKE_REASONS.find((r) => r.value === revokeReason)?.label || "Unspecified" : null;

  wrap.append(
    el("span", { class: "material-symbols-rounded icon empty-state__icon" }, suspended ? "block" : revoked ? "money_off" : "lock_clock"),
    el("h2", {}, suspended ? "Access suspended" : revoked ? "Subscription revoked" : "Subscription expired"),
    el(
      "p",
      { class: "text-muted", style: "max-width:480px;margin:0 auto;" },
      suspended
        ? "We've suspended this school's access. This isn't a subscription/token issue - only we can restore it."
        : revoked
        ? `This school's subscription was revoked (${revokeReasonLabel}). A new subscription token is needed to restore access.`
        : neverActivated
        ? "This school doesn't have an active subscription yet."
        : `This school's subscription expired ${Math.abs(daysRemaining ?? 0)} day${Math.abs(daysRemaining ?? 0) === 1 ? "" : "s"} ago.`
    )
  );

  // A suspension is a platform-admin override, not something a
  // subscription token can lift - so unlike the revoked/expired cases
  // below, no admin (including the school's own) gets the token-paste
  // form here. Only the Schools page's Reactivate button clears it.
  // Revoked and plain-expired both share the same way out - a fresh
  // token - so both fall through to the same admin form below.
  if (suspended) {
    wrap.append(
      el("p", { class: "text-muted", style: "max-width:480px;margin:12px auto 0;" }, "Contact us at support@iskify360.com to have access restored.")
    );
  } else if (profile?.role === "admin") {
    const card = el("div", { class: "card", style: "max-width:420px;margin:20px auto 0;text-align:left;" }, [
      el("p", { class: "text-sm text-muted" }, "Paste the token we gave you to restore access."),
      el("form", { id: "lock-activate-form" }, [
        el("div", { class: "field field--full" }, [
          el("label", { for: "lock-sub-token" }, "Subscription token"),
          el("textarea", { id: "lock-sub-token", rows: "3", placeholder: "Paste token here", style: "width:100%;font-family:monospace;font-size:0.85rem;" }),
        ]),
        el("button", { type: "submit", class: "btn btn--primary", style: "margin-top:12px;width:100%;" }, [icon("key"), "Activate subscription"]),
      ]),
    ]);
    wrap.append(card);
  } else {
    wrap.append(
      el("p", { class: "text-muted", style: "max-width:480px;margin:12px auto 0;" }, "Contact us at support@iskify360.com to renew access.")
    );
  }

  wrap.append(
    el("button", { class: "btn btn--ghost", id: "lock-signout-btn", style: "margin-top:20px;" }, [icon("logout"), "Sign out"])
  );

  return wrap;
}

export async function init({ profile } = {}) {
  document.getElementById("lock-signout-btn")?.addEventListener("click", async () => {
    await logout();
    navigate("/login");
  });

  const form = document.getElementById("lock-activate-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Activating…");
    try {
      const token = document.getElementById("lock-sub-token").value.trim();
      if (!token) throw new Error("Paste the token you were given first.");
      await activateSubscription(token);
      await refreshCurrentSchool();
      toast("Subscription activated.", "success");
      renderRoute();
    } catch (err) {
      toast(err.message || "Couldn't activate that token.", "error");
      restore();
    }
  });
}