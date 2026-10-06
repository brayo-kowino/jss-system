
import re

with open("views/schools.js", "r", encoding="utf-8") as f:
    content = f.read()

btn_code = """              el("button", {
                class: "btn btn--sm btn--ghost",
                title: "Manage Arrears",
                onClick: () => openArrearsModal(s),
              }, [icon("receipt_long")]),"""

content = content.replace(
    "onClick: () => openTokenHistoryModal(s),\n              }, [icon(\"history\")]),",
    "onClick: () => openTokenHistoryModal(s),\n              }, [icon(\"history\")]),\n" + btn_code
)

modal_code = """
  async function openArrearsModal(school) {
    const isBlocked = school.canComputeOrGenerate === false;
    const amountOwed = school.amountOwed || 0;
    const form = el("form", { id: "arrears-form" }, [
      el("div", { class: "field field--full" }, [
        el("label", {}, "Block Compute & Generate Reports?"),
        el("select", { id: "arrears-block" }, [
          el("option", { value: "false", ...(isBlocked ? {} : { selected: true }) }, "Allow (Not Blocked)"),
          el("option", { value: "true", ...(isBlocked ? { selected: true } : {}) }, "Block (In Arrears)")
        ])
      ]),
      el("div", { class: "field field--full", style: "margin-top:12px;" }, [
        el("label", {}, "Amount Owed (KES)"),
        el("input", { type: "number", id: "arrears-amount", value: amountOwed, placeholder: "e.g. 50000" })
      ]),
      el("button", { type: "submit", class: "btn btn--primary", style: "margin-top: 16px;" }, "Save Arrears Policy")
    ]);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving...";
      try {
        const isNowBlocked = document.getElementById("arrears-block").value === "true";
        const newAmount = parseInt(document.getElementById("arrears-amount").value, 10) || 0;
        
        // This relies on touchesSubscriptionFields allowing this if super_admin updates it.
        const { updateDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const { db } = await import("../js/firebase-config.js");
        await updateDoc(doc(db, "schools", school.id), {
          canComputeOrGenerate: !isNowBlocked,
          amountOwed: newAmount
        });
        toast("Arrears policy saved", "success");
        renderRoute();
        import("../js/components/modal.js").then(m => m.closeModal());
      } catch (err) {
        toast(err.message || "Failed to save arrears policy", "error");
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });

    openModal(`Manage Arrears for ${school.schoolName || "School"}`, form);
  }
"""

content = content + modal_code

with open("views/schools.js", "w", encoding="utf-8") as f:
    f.write(content)

