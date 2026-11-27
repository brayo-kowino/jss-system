import { el } from "../utils.js";
import { logout } from "../services/auth.service.js";

/**
 * Displays a centered, non-dismissible modal with a rotating spinner
 * informing the user that their session is being securely ended.
 * Returns a teardown function.
 */
export function showSignoutOverlay() {
  const existing = document.querySelector(".signout-modal-backdrop");
  if (existing) return () => existing.remove();

  const backdrop = el("div", { class: "signout-modal-backdrop" });
  const card = el("div", {
    class: "signout-modal-card",
    role: "alertdialog",
    "aria-modal": "true",
    "aria-busy": "true",
  }, [
    el("div", { class: "spinner" }),
    el("h3", { class: "signout-modal-title" }, "Signing you out…"),
    el("p", { class: "signout-modal-sub" }, "Please wait while we securely end your session."),
  ]);

  backdrop.append(card);

  // Non-dismissible: intercept backdrop clicks and keyboard events
  backdrop.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  const blockKeys = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("keydown", blockKeys, true);

  document.body.append(backdrop);

  return () => {
    window.removeEventListener("keydown", blockKeys, true);
    backdrop.remove();
  };
}

/**
 * Signs out the user with the non-dismissible loading pop-up and redirects to /login.
 */
export async function signOutWithFeedback() {
  // Close any open profile dropdown
  for (const dropdown of document.querySelectorAll(".topbar__profile-dropdown.open")) {
    dropdown.classList.remove("open");
  }

  const removeOverlay = showSignoutOverlay();

  try {
    // Run logout and guarantee at least 700ms so user gets clear visual confirmation
    await Promise.all([
      logout(),
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
  } catch (err) {
    console.error("Signout error:", err);
  } finally {
    location.hash = "/login";
    // Clean up overlay once navigation to /login begins
    setTimeout(() => removeOverlay(), 350);
  }
}
