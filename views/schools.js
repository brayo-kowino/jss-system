// Platform-level Schools registry - super_admin only.
// Create new schools (each gets its own admin login), see every school on
// the platform, and suspend/reactivate one. Suspend is a hard lock,
// enforced the same way an expired subscription is - see
// firestore.rules' isSubscriptionActive() (server-side, the real
// boundary) and subscription.service.js's getSubscriptionState() (client
// mirror, used by router.js's lock gate and views/subscription-locked.js).
// An already-open session for a school that gets suspended is kicked to
// the lock screen within moments via auth.service.js's live listener on
// the school doc, not just on that tab's next sign-in.
import { listSchools, createSchool, setSchoolStatus } from "../js/services/school.service.js";
import { issueSubscriptionToken, listSubscriptionTokens, revokeSubscription, getSubscriptionState, SUBSCRIPTION_PLANS, SUBSCRIPTION_DURATIONS, REVOKE_REASONS } from "../js/services/subscription.service.js";
import { openModal } from "../js/components/modal.js";
import { el, icon, toast, formatDate, formatDateTime, busyButton } from "../js/utils.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../js/firebase-config.js";

let schools = [];

export async function render({ profile }) {
  schools = await listSchools();

  const wrap = el("div", {});
  wrap.append(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("p", {}, "Every school on the platform. Create a new one to activate its first admin login."),
      ]),
      el("button", { class: "btn btn--primary", id: "new-school-btn" }, [
        el("span", { class: "material-symbols-rounded" }, "add_business"),
        " New School",
      ]),
    ])
  );
  if (!schools.length) {
    wrap.append(el("div", { class: "card empty-state" }, [icon("corporate_fare", "empty-state__icon"), el("h3", {}, "No schools yet"), el("p", {}, "Create the first one to get started.")]));
    return wrap;
  }

  const tableWrap = el("div", { class: "table-wrap table-wrap--responsive card" });
  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "School"), el("th", {}, "Contact"), el("th", {}, "Status"), el("th", {}, "Subscription"), el("th", {}, "Created"), el("th", {}, ""),
    ])),
  ]);
  const tbody = el("tbody");
  for (const s of schools) {
    tbody.append(
      el("tr", {}, [
        el("td", { "data-label": "School" }, [el("strong", {}, s.schoolName || "(unnamed)"), el("div", { class: "text-sm text-muted" }, s.address || "")]),
        el("td", { "data-label": "Contact" }, [el("div", {}, s.email || "N/A"), el("div", { class: "text-sm text-muted" }, s.phone || "")]),
        el("td", { "data-label": "Status" }, el("span", { class: `badge badge--${s.status === "active" ? "success" : "danger"}` }, s.status || "active")),
        el("td", { "data-label": "Subscription" }, subscriptionBadge(s)),
        el("td", { "data-label": "Created" }, s.createdAt ? formatDate(s.createdAt) : "N/A"),
        el("td", { class: "row-actions", "data-label": "Actions", style: "white-space:nowrap;" }, [
          el("button", {
            class: "btn btn--sm btn--ghost",
            onClick: () => openIssueTokenModal(s),
          }, [icon("key"), "Issue subscription"]),
          el("button", {
            class: "btn btn--sm btn--ghost",
            onClick: () => openTokenHistoryModal(s),
          }, [icon("history"), "Token history"]),
          ...(s.subscriptionStatus === "active" ? [
            el("button", {
              class: "btn btn--sm btn--danger",
              onClick: () => openRevokeModal(s),
            }, [icon("money_off"), "Revoke subscription"]),
          ] : []),
          el("button", {
            class: "btn btn--sm btn--ghost",
            onClick: (e) => toggleStatus(profile, s, e.currentTarget),
          }, [icon(s.status === "suspended" ? "play_circle" : "pause_circle"), s.status === "suspended" ? "Reactivate" : "Suspend"]),
        ]),
      ])
    );
  }
  table.append(tbody);
  tableWrap.append(table);
  wrap.append(tableWrap);

  return wrap;
}

// Renders a school's subscription state as a badge + "N days left"/"expired
// N days ago"/"revoked" caption. Pure display - getSubscriptionState() is
// the single shared definition of "active" (also used by
// school-settings.js's activation panel and the router's lock gate).
function subscriptionBadge(school) {
  const { active, daysRemaining, revoked, revokeReason } = getSubscriptionState(school);
  const wrapEl = el("div", {});
  if (revoked) {
    wrapEl.append(
      el("span", { class: "badge badge--danger" }, "Revoked"),
      el("div", { class: "text-sm text-muted" }, REVOKE_REASONS.find((r) => r.value === revokeReason)?.label || "Unspecified reason")
    );
    return wrapEl;
  }
  if (school.subscriptionStatus === "inactive" || !school.subscriptionExpiresAt) {
    wrapEl.append(el("span", { class: "badge badge--muted" }, "Not activated"));
    return wrapEl;
  }
  if (active) {
    wrapEl.append(
      el("span", { class: `badge badge--${daysRemaining <= 7 ? "gold" : "success"}` }, `${SUBSCRIPTION_PLANS.find((p) => p.value === school.subscriptionPlan)?.label || school.subscriptionPlan || "Active"}`),
      el("div", { class: "text-sm text-muted" }, `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`)
    );
  } else {
    wrapEl.append(
      el("span", { class: "badge badge--danger" }, "Expired"),
      el("div", { class: "text-sm text-muted" }, school.subscriptionExpiresAt ? `Lapsed ${formatDate(school.subscriptionExpiresAt)}` : "")
    );
  }
  return wrapEl;
}

export function init({ profile }) {
  document.getElementById("new-school-btn")?.addEventListener("click", () => openNewSchoolModal(profile));
}

function openNewSchoolModal(profile) {
  const form = el("form", {}, [
    el("h4", { style: "margin:4px 0 12px;" }, "School details"),
    field("s-name", "School Name"),
    field("s-address", "Address"),
    field("s-phone", "Phone"),
    field("s-email", "School Email", "email"),
    el("h4", { style: "margin:20px 0 12px;" }, "First admin login"),
    field("a-name", "Admin Full Name"),
    field("a-email", "Admin Email", "email"),
    field("a-pass", "Temporary Password", "text"),
    el("button", { type: "submit", class: "btn btn--primary", style: "margin-top:8px;" }, [icon("add_business"), "Create school"]),
  ]);

  const close = openModal("New School", form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Creating…");
    try {
      await createSchool(profile.uid, {
        name: val("s-name"),
        address: val("s-address"),
        phone: val("s-phone"),
        email: val("s-email"),
        adminFullName: val("a-name"),
        adminEmail: val("a-email"),
        tempPassword: val("a-pass"),
      });
      toast("School created - share the admin login with them.", "success");
      close();
      const { navigate } = await import("../js/router.js");
      navigate("/schools");
      // Force a re-render since navigate() no-ops on same-path hash changes.
      const { renderRoute } = await import("../js/router.js");
      renderRoute();
    } catch (err) {
      toast(err.message || "Couldn't create school.", "error");
      restore();
    }
  });
}

// Two-step modal: pick plan/duration and issue a token, then show that
// token in a copyable field once the server returns it. The token itself
// is never generated or held client-side before this - issueSubscriptionToken()
// is the only source of a real one.
function openIssueTokenModal(school) {
  const durationSelect = el("select", { id: "sub-duration" },
    SUBSCRIPTION_DURATIONS.map((d) => el("option", { value: d.value }, d.label))
  );
  const customDateField = el("div", { class: "field", id: "sub-custom-date-field", style: "display:none;" }, [
    el("label", { for: "sub-custom-date" }, "Expiry date"),
    el("input", { id: "sub-custom-date", type: "date" }),
  ]);
  durationSelect.addEventListener("change", () => {
    customDateField.style.display = durationSelect.value === "custom" ? "" : "none";
  });

  const form = el("form", {}, [
    el("p", { class: "text-sm text-muted" }, `Issuing a token for ${school.schoolName || "this school"}. Hand it to their school administrator to paste into Settings \u2192 Subscription - it's single-use and only works for this school.`),
    el("div", { class: "field" }, [
      el("label", { for: "sub-plan" }, "Plan"),
      el("select", { id: "sub-plan" }, SUBSCRIPTION_PLANS.map((p) => el("option", { value: p.value }, p.label))),
    ]),
    el("div", { class: "field" }, [el("label", { for: "sub-duration" }, "Duration"), durationSelect]),
    customDateField,
    el("button", { type: "submit", class: "btn btn--primary", style: "margin-top:8px;" }, [icon("key"), "Issue token"]),
  ]);

  const close = openModal("Issue subscription token", form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Issuing…");
    try {
      const duration = document.getElementById("sub-duration").value;
      const result = await issueSubscriptionToken({
        schoolId: school.id,
        plan: document.getElementById("sub-plan").value,
        duration,
        customExpiresAt: duration === "custom" ? document.getElementById("sub-custom-date").value : undefined,
      });
      showIssuedTokenModal(school, result);
      close();
    } catch (err) {
      toast(err.message || "Couldn't issue a token.", "error");
      restore();
    }
  });
}

function showIssuedTokenModal(school, result) {
  const tokenBox = el("textarea", {
    readonly: "true",
    rows: "4",
    style: "width:100%;font-family:monospace;font-size:0.85rem;resize:vertical;",
  });
  tokenBox.value = result.token;

  const body = el("div", {}, [
    el("p", { class: "text-sm text-muted" }, `Expires ${formatDate(result.expiresAt)}. Share this token with ${school.schoolName || "the school"}'s administrator - it's only shown once.`),
    tokenBox,
    el("button", {
      type: "button", class: "btn btn--sm btn--ghost", style: "margin-top:8px;",
      onClick: async (e) => {
        try {
          await navigator.clipboard.writeText(result.token);
          toast("Token copied.", "success");
        } catch {
          tokenBox.select();
          toast("Couldn't auto-copy - select and copy manually.", "error");
        }
      },
    }, [icon("content_copy"), "Copy token"]),
  ]);
  openModal("Subscription token issued", body);
}

async function toggleStatus(profile, school, button) {
  const next = school.status === "suspended" ? "active" : "suspended";
  const restore = button ? busyButton(button) : () => {};
  try {
    await setSchoolStatus(profile.uid, school.id, next);
    toast(`${school.schoolName || "School"} ${next === "suspended" ? "suspended" : "reactivated"}.`, "success");
    const { renderRoute } = await import("../js/router.js");
    renderRoute();
  } catch (err) {
    toast(err.message || "Couldn't update school status.", "error");
    restore();
  }
}

// Cuts an already-active, not-yet-expired subscription short - distinct
// from Suspend (see the file header): this is billing-family (non-payment,
// chargeback, fraud, contract default, or correcting a mis-issued token),
// requires a reason, and is lifted by issuing a fresh token rather than
// clicking Reactivate. Only offered in the row actions while
// subscriptionStatus === "active" - nothing to revoke otherwise.
function openRevokeModal(school) {
  const reasonSelect = el("select", { id: "revoke-reason" },
    REVOKE_REASONS.map((r) => el("option", { value: r.value }, r.label))
  );
  const noteField = el("div", { class: "field field--full" }, [
    el("label", { for: "revoke-note" }, "Note (required for \u201cOther\u201d)"),
    el("textarea", { id: "revoke-note", rows: "3", placeholder: "Internal note - not shown to the school's staff/parents, only kept in the audit trail.", maxlength: "500" }),
  ]);

  const form = el("form", {}, [
    el("p", { class: "text-sm text-muted" }, `This immediately cuts off ${school.schoolName || "this school"}'s access, even with time left on their current term. They'll see \u201cSubscription revoked\u201d and need a fresh token from you to come back.`),
    el("div", { class: "field" }, [el("label", { for: "revoke-reason" }, "Reason"), reasonSelect]),
    noteField,
    el("button", { type: "submit", class: "btn btn--danger", style: "margin-top:8px;" }, [icon("money_off"), "Revoke subscription"]),
  ]);

  const close = openModal(`Revoke subscription \u2014 ${school.schoolName || "School"}`, form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const restore = busyButton(e.submitter, "Revoking\u2026");
    try {
      await revokeSubscription({
        schoolId: school.id,
        reason: document.getElementById("revoke-reason").value,
        note: document.getElementById("revoke-note").value.trim(),
      });
      toast(`${school.schoolName || "School"}'s subscription revoked.`, "success");
      close();
      const { renderRoute } = await import("../js/router.js");
      renderRoute();
    } catch (err) {
      toast(err.message || "Couldn't revoke the subscription.", "error");
      restore();
    }
  });
}

// Resolves a uid to a display name for the token-history modal below.
// subscription_tokens only ever stores issuedBy/consumedBy as uids (see
// subscription-issue.ts/subscription-activate.ts) - super_admin can read
// any users/{uid} doc directly per firestore.rules, so this reads straight
// from Firestore rather than needing another edge-function round trip.
// Cached at module scope since issuedBy in particular is almost always
// the same super_admin, repeated across many tokens/schools.
const userNameCache = new Map();
async function resolveUserName(uid) {
  if (!uid) return "\u2014";
  if (userNameCache.has(uid)) return userNameCache.get(uid);
  let name = uid;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) name = snap.data().fullName || snap.data().email || uid;
  } catch {
    // Fall back to the raw uid rather than blocking the whole history list.
  }
  userNameCache.set(uid, name);
  return name;
}

// Every token this platform has ever issued for one school - the only
// window into subscription_tokens (otherwise unreadable by any client, see
// firestore.rules), via subscription-tokens-list.ts.
async function openTokenHistoryModal(school) {
  const body = el("div", {}, [el("p", { class: "text-sm text-muted" }, "Loading\u2026")]);
  openModal(`Token history for ${school.schoolName || "School"}`, body);

  let tokens;
  try {
    ({ tokens } = await listSubscriptionTokens(school.id));
  } catch (err) {
    body.innerHTML = "";
    body.append(el("p", { class: "text-sm" }, err.message || "Couldn't load token history."));
    return;
  }

  body.innerHTML = "";
  if (!tokens.length) {
    body.append(el("p", { class: "text-sm text-muted" }, "No tokens have been issued for this school yet."));
    return;
  }

  const tbody = el("tbody");
  body.append(
    el("div", { class: "table-wrap table-wrap--responsive" }, [
      el("table", {}, [
        el("thead", {}, el("tr", {}, [
          el("th", {}, "Plan"), el("th", {}, "Expires"), el("th", {}, "Issued"), el("th", {}, "Status"), el("th", {}, "Consumed"),
        ])),
        tbody,
      ]),
    ])
  );

  for (const t of tokens) {
    const row = el("tr", {}, [
      el("td", { "data-label": "Plan" }, SUBSCRIPTION_PLANS.find((p) => p.value === t.plan)?.label || t.plan || "\u2014"),
      el("td", { "data-label": "Expires" }, formatDate(t.expiresAt)),
      el("td", { "data-label": "Issued" }, [el("div", {}, formatDateTime(t.issuedAt)), el("div", { class: "text-sm text-muted", "data-issued-by": "true" }, "\u2026")]),
      el("td", { "data-label": "Status" }, t.consumedAt
        ? el("span", { class: "badge badge--success" }, "Used")
        : el("span", { class: "badge badge--muted" }, "Unused")),
      el("td", { "data-label": "Consumed" }, t.consumedAt
        ? [el("div", {}, formatDateTime(t.consumedAt)), el("div", { class: "text-sm text-muted", "data-consumed-by": "true" }, "\u2026")]
        : "\u2014"),
    ]);
    tbody.append(row);

    // Resolve names after the row's already visible, so the modal isn't
    // stuck on "Loading…" while a handful of extra reads trickle in.
    resolveUserName(t.issuedBy).then((name) => {
      const cell = row.querySelector("[data-issued-by]");
      if (cell) cell.textContent = name;
    });
    if (t.consumedBy) {
      resolveUserName(t.consumedBy).then((name) => {
        const cell = row.querySelector("[data-consumed-by]");
        if (cell) cell.textContent = name;
      });
    }
  }
}

function field(id, label, type = "text") {
  return el("div", { class: "field" }, [el("label", { for: id }, label), el("input", { id, type, required: "true" })]);
}

function val(id) {
  return document.getElementById(id).value.trim();
}