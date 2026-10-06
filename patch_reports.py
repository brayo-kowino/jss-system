
import re

with open("views/reports.js", "r", encoding="utf-8") as f:
    content = f.read()

notice_code = """
function renderArrearsNotice(amountOwed) {
  const formattedAmount = amountOwed ? ` (KES ${amountOwed.toLocaleString()})` : "";
  return el("div", { class: "card", style: "padding: 40px 20px; text-align: center; border-top: 4px solid var(--color-danger-500); margin: 20px 0;" }, [
    el("div", { class: "icon-halo icon-halo--danger", style: "margin: 0 auto 16px;" }, [
      icon("block", "text-xl")
    ]),
    el("h2", { style: "color: var(--color-ink-hard); margin-bottom: 12px; font-size: 1.5rem;" }, "Action Required: Subscription Arrears"),
    el("p", { class: "text-muted", style: "max-width: 500px; margin: 0 auto 16px; font-size: 1rem; line-height: 1.5;" }, 
      `Your marks and assessments are securely saved and verified on our servers. However, report generation and result computation cannot proceed due to uncleared yearly subscription arrears${formattedAmount}.`
    ),
    el("p", { class: "text-muted", style: "max-width: 500px; margin: 0 auto 24px; font-size: 1rem; line-height: 1.5;" },
      "Please settle the outstanding balance to immediately restore these features."
    ),
    el("div", { style: "background: var(--color-surface-soft); padding: 16px; border-radius: 8px; max-width: 400px; margin: 0 auto; text-align: left;" }, [
      el("h4", { style: "margin: 0 0 8px; font-size: 0.9rem;" }, "Platform Support & Billing Contacts"),
      el("div", { style: "display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 0.95rem;" }, [
        icon("email", "text-sm", "style: color:var(--color-primary-600);"),
        el("a", { href: "mailto:iskify360.tech@gmail.com", style: "color: var(--color-primary-700); text-decoration: none;" }, "iskify360.tech@gmail.com")
      ])
    ])
  ]);
}
"""

content = content.replace("async function loadList(bodyMount, profile) {", notice_code + "\nasync function loadList(bodyMount, profile) {\n    const school = getCurrentSchool();\n    if (school && school.canComputeOrGenerate === false) {\n      bodyMount.innerHTML = \"\";\n      bodyMount.append(renderArrearsNotice(school.amountOwed));\n      return;\n    }")

with open("views/reports.js", "w", encoding="utf-8") as f:
    f.write(content)

