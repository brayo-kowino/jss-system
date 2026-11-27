import { el, icon } from "../utils.js";
import { navigate } from "../router.js";

export function buildSadMascotSvg() {
  return `
    <svg class="sad-mascot-svg" viewBox="0 0 240 220" width="220" height="200" xmlns="http://www.w3.org/2000/svg">
      <ellipse class="sad-mascot__shadow" cx="120" cy="208" rx="60" ry="8" fill="rgba(20, 83, 138, 0.15)" />
      <g class="sad-mascot__body">
        <g class="sad-mascot__books">
          <rect x="62" y="186" width="116" height="15" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="66" y="189" width="108" height="2" fill="#93C5FD" opacity="0.8" />
          <rect x="68" y="172" width="104" height="15" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="72" y="175" width="96" height="2" fill="#FDE68A" opacity="0.9" />
          <rect x="74" y="158" width="92" height="15" rx="3" fill="#B91C1C" stroke="#7F1D1D" stroke-width="1.2" />
          <rect x="78" y="161" width="84" height="2" fill="#FECACA" opacity="0.8" />
        </g>
        <path class="sad-mascot__robe" d="M92,126 C86,145 84,158 88,164 L152,164 C156,158 154,145 148,126 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <path d="M106,126 L120,154 L134,126 L127,126 L120,142 L113,126 Z" fill="#C9A227" />
        <path d="M92,130 C82,142 82,154 98,158" stroke="#14538A" stroke-width="7" stroke-linecap="round" fill="none" />
        <path d="M148,130 C158,142 158,154 142,158" stroke="#14538A" stroke-width="7" stroke-linecap="round" fill="none" />
        <circle cx="98" cy="158" r="5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        <circle cx="142" cy="158" r="5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        <circle class="sad-mascot__head" cx="120" cy="95" r="33" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="97" cy="103" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.6" />
        <ellipse cx="143" cy="103" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.6" />
        <path d="M98,78 Q106,83 113,81" stroke="#8C6F12" stroke-width="2.5" stroke-linecap="round" fill="none" />
        <path d="M142,78 Q134,83 127,81" stroke="#8C6F12" stroke-width="2.5" stroke-linecap="round" fill="none" />
        <ellipse cx="107" cy="94" rx="7.5" ry="9" fill="#FFFFFF" stroke="#14538A" stroke-width="1.5" />
        <ellipse cx="133" cy="94" rx="7.5" ry="9" fill="#FFFFFF" stroke="#14538A" stroke-width="1.5" />
        <circle cx="107" cy="96" r="4.8" fill="#1F2937" />
        <circle cx="133" cy="96" r="4.8" fill="#1F2937" />
        <circle cx="105.5" cy="93.5" r="2" fill="#FFFFFF" />
        <circle cx="108.5" cy="98" r="0.9" fill="#FFFFFF" />
        <circle cx="131.5" cy="93.5" r="2" fill="#FFFFFF" />
        <circle cx="134.5" cy="98" r="0.9" fill="#FFFFFF" />
        <path d="M99,90 Q107,87 115,93" stroke="#C9A227" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M141,90 Q133,87 125,93" stroke="#C9A227" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path class="sad-mascot__mouth" d="M112,114 Q120,107 128,114" stroke="#8C6F12" stroke-width="2.6" stroke-linecap="round" fill="none" />
        <path class="sad-mascot__tear" d="M138,100 C138,100 142,107 142,110 C142,112.2 140.2,114 138,114 C135.8,114 134,112.2 134,110 C134,107 138,100 138,100 Z" fill="#60A5FA" opacity="0.95" />
        <g class="sad-mascot__cap" transform="rotate(-9 120 62)">
          <rect x="104" y="60" width="32" height="15" rx="5" fill="#8C6F12" />
          <polygon points="120,38 168,54 120,66 72,54" fill="#C9A227" stroke="#8C6F12" stroke-width="1.6" />
          <circle cx="120" cy="52" r="3.5" fill="#FAF6F0" />
          <path d="M120,52 C138,56 150,70 146,88" stroke="#FAF6F0" stroke-width="2" fill="none" />
          <circle cx="146" cy="89" r="3" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

export function renderModuleUpgrade({
  profile,
  badgeText = "Starter Plan",
  title = "This module is not available for this plan",
  description = "Please upgrade your subscription plan to unlock this module.",
  perks = [],
  subject = "Upgrade Plan",
} = {}) {
  const wrap = el("div", { class: "module-upgrade-wrap" });

  const mascotWrap = el("div", { class: "sad-mascot-wrap", "aria-hidden": "true" });
  mascotWrap.innerHTML = buildSadMascotSvg();

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const perksList = el(
    "div",
    { class: "upgrade-perks" },
    perks.map((p) =>
      el("div", { class: "upgrade-perk" }, [
        icon("check_circle"),
        el("span", {}, p),
      ])
    )
  );

  const actions = el("div", { class: "upgrade-actions" });
  if (isAdmin) {
    actions.append(
      el("button", {
        class: "btn btn--primary",
        onClick: () => navigate("/settings"),
      }, [icon("upgrade"), "Upgrade to Growth Plan"]),
      el("a", {
        class: "btn btn--ghost",
        href: `mailto:iskify360.tech@gmail.com?subject=${encodeURIComponent(subject)}`,
        target: "_blank",
      }, [icon("mail"), "Contact Us to Upgrade"])
    );
  } else {
    actions.append(
      el("button", {
        class: "btn btn--ghost",
        onClick: () => navigate("/dashboard"),
      }, [icon("dashboard"), "Back to Dashboard"])
    );
  }

  const card = el("div", { class: "module-upgrade-card" }, [
    mascotWrap,
    el("span", { class: "badge badge--warning", style: "margin-bottom:12px; font-size:11px;" }, badgeText),
    el("h2", { style: "margin: 0 0 10px; font-size: var(--fs-xl); color: var(--color-primary-900);" }, title),
    el("p", { class: "text-muted", style: "max-width: 480px; margin: 0 auto 16px; font-size: var(--fs-sm); line-height: 1.6;" }, description),
    perks.length ? perksList : "",
    !isAdmin ? el("p", { class: "text-xs text-muted", style: "font-style:italic; margin-bottom:16px;" }, "Please contact your school administrator to upgrade your school's plan.") : "",
    actions,
  ]);

  wrap.append(card);
  return wrap;
}