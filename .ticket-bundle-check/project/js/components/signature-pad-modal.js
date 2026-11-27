import { el, icon, toast, busyButton } from "../utils.js";
import { openModal } from "./modal.js";
import { saveSchoolSettings } from "../services/settings.service.js";
import { invalidateSchoolSettingsCache } from "./shell.js";

/**
 * Mobile-first touchscreen signature collection modal for Principal & Class Teacher signatures.
 * Supports Android/iOS touch drawing, mouse input, photo upload, and one-click cursive generation.
 */
export function openSignaturePadModal({ settings, profile, activeRole = "principal", onSaved }) {
  let currentRole = activeRole; // "principal" or "teacher"
  let isDrawing = false;
  let hasStrokes = false;
  let canvas, ctx;
  let previewImg;

  const content = el("div", { class: "sig-modal-wrap" });

  // 1. Role Toggle Tabs
  const roleTabs = el("div", { class: "sig-role-tabs" });
  const principalTabBtn = el(
    "button",
    {
      type: "button",
      class: `sig-role-tab ${currentRole === "principal" ? "sig-role-tab--active" : ""}`,
      onClick: () => switchRole("principal"),
    },
    [icon("military_tech"), "School Head / Principal"]
  );

  const teacherTabBtn = el(
    "button",
    {
      type: "button",
      class: `sig-role-tab ${currentRole === "teacher" ? "sig-role-tab--active" : ""}`,
      onClick: () => switchRole("teacher"),
    },
    [icon("school"), "Class Teacher"]
  );

  roleTabs.append(principalTabBtn, teacherTabBtn);
  content.append(roleTabs);

  // 2. Info / Signer Name Tag
  const signerInfo = el("div", { class: "sig-signer-badge" });
  content.append(signerInfo);

  // 3. Canvas Container (Touchscreen optimized)
  const canvasCard = el("div", { class: "sig-canvas-card" });
  canvas = el("canvas", { class: "sig-canvas" });
  const baselineGuide = el("div", { class: "sig-baseline-guide" }, "Sign on the line above");
  canvasCard.append(canvas, baselineGuide);
  content.append(canvasCard);

  // 4. Action Toolbar under canvas
  const actionsRow = el("div", { class: "sig-toolbar" });

  const clearBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn--outline btn--sm",
      onClick: () => clearCanvas(),
    },
    [icon("restart_alt"), "Clear"]
  );

  const cursiveBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn--ghost btn--sm",
      onClick: () => generateCursiveToCanvas(),
    },
    [icon("stylus"), "Generate Cursive"]
  );

  const fileInput = el("input", {
    type: "file",
    accept: "image/*",
    style: "display:none;",
    onChange: (e) => handleFileUpload(e),
  });

  const uploadBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn--ghost btn--sm",
      onClick: () => fileInput.click(),
    },
    [icon("upload_file"), "Upload Photo"]
  );

  actionsRow.append(clearBtn, cursiveBtn, uploadBtn, fileInput);
  content.append(actionsRow);

  // 5. Saved Signature Preview Strip
  const previewStrip = el("div", { class: "sig-preview-strip" });
  previewImg = el("img", { class: "sig-preview-img", alt: "Current signature" });
  const previewDesc = el("span", { class: "sig-preview-desc" }, "Currently saved signature");
  previewStrip.append(previewImg, previewDesc);
  content.append(previewStrip);

  // 6. Save Button Container
  const footerRow = el("div", { class: "sig-footer-actions" });
  const saveBtn = el(
    "button",
    {
      type: "button",
      class: "btn btn--primary sig-save-btn",
      onClick: async (e) => await handleSaveSignature(e),
    },
    [icon("check_circle"), "Save Signature for Report Cards"]
  );
  footerRow.append(saveBtn);
  content.append(footerRow);

  // Open the modal
  const closeModal = openModal("Digital Signature Studio", content, "modal--signature");

  // Initialize Canvas
  setTimeout(() => {
    initCanvas();
    updateSignerInfo();
    updatePreview();
  }, 50);

  function switchRole(role) {
    currentRole = role;
    principalTabBtn.classList.toggle("sig-role-tab--active", currentRole === "principal");
    teacherTabBtn.classList.toggle("sig-role-tab--active", currentRole === "teacher");
    clearCanvas();
    updateSignerInfo();
    updatePreview();
  }

  function getSignerName() {
    if (currentRole === "principal") {
      return settings?.principalName || "School Principal";
    }
    return "Class Teacher";
  }

  function getCurrentSignatureUrl() {
    return currentRole === "principal" ? settings?.principalSignatureUrl : settings?.teacherSignatureUrl;
  }

  function updateSignerInfo() {
    signerInfo.innerHTML = "";
    const isP = currentRole === "principal";
    signerInfo.append(
      icon(isP ? "military_tech" : "school"),
      el("span", { style: "font-weight:600;" }, isP ? `Principal: ${getSignerName()}` : "Class Teacher Signature"),
      el("span", { class: "text-muted text-xs", style: "margin-left:auto;" }, "Touch, stylus, or mouse")
    );
  }

  function updatePreview() {
    const existing = getCurrentSignatureUrl();
    if (existing) {
      previewImg.src = existing;
      previewStrip.style.display = "flex";
    } else {
      previewStrip.style.display = "none";
    }
  }

  function initCanvas() {
    const rect = canvasCard.getBoundingClientRect();
    const width = Math.floor(rect.width || 480);
    const height = 180;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#14538A"; // Deep navy ink
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    setupTouchEvents();
  }

  function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  function setupTouchEvents() {
    function start(e) {
      if (e.cancelable && e.type.startsWith("touch")) e.preventDefault();
      isDrawing = true;
      hasStrokes = true;
      const { x, y } = getCoordinates(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    }

    function move(e) {
      if (!isDrawing) return;
      if (e.cancelable && e.type.startsWith("touch")) e.preventDefault();
      const { x, y } = getCoordinates(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    function stop(e) {
      if (isDrawing) {
        if (e.cancelable && e.type.startsWith("touch")) e.preventDefault();
        isDrawing = false;
        ctx.closePath();
      }
    }

    // Touch events for mobile/Android
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", stop, { passive: false });
    canvas.addEventListener("touchcancel", stop, { passive: false });

    // Mouse events for desktop
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }

  function clearCanvas() {
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    hasStrokes = false;
  }

  function generateCursiveToCanvas() {
    clearCanvas();
    const rect = canvas.getBoundingClientRect();
    const name = getSignerName();

    ctx.save();
    ctx.font = "italic 46px 'Dancing Script', 'Brush Script MT', 'Caveat', cursive";
    ctx.fillStyle = "#14538A";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Slight angle for authentic signature look
    ctx.translate(rect.width / 2, rect.height / 2 + 10);
    ctx.rotate(-0.06);
    ctx.fillText(name, 0, 0);

    // Decorative underline flourish
    const metrics = ctx.measureText(name);
    const lineW = Math.min(rect.width - 60, metrics.width * 1.05);
    ctx.beginPath();
    ctx.moveTo(-lineW / 2, 22);
    ctx.bezierCurveTo(-lineW / 4, 30, lineW / 4, 16, lineW / 2, 26);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "#14538A";
    ctx.stroke();

    ctx.restore();
    hasStrokes = true;
  }

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        clearCanvas();
        const rect = canvas.getBoundingClientRect();
        // Scale to fit canvas nicely
        const scale = Math.min((rect.width - 40) / img.width, (rect.height - 40) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (rect.width - w) / 2;
        const y = (rect.height - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        hasStrokes = true;
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Crop excess whitespace from canvas to produce a clean, compact transparent PNG
  function getTrimmedSignatureDataUrl() {
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    let foundPixel = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const alpha = data[(y * w + x) * 4 + 3];
        if (alpha > 10) {
          foundPixel = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!foundPixel) return null;

    // Add small padding around stroke
    const pad = 12 * (window.devicePixelRatio || 1);
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(w - cropX, maxX - minX + pad * 2);
    const cropH = Math.min(h - cropY, maxY - minY + pad * 2);

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = cropW;
    tempCanvas.height = cropH;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return tempCanvas.toDataURL("image/png");
  }

  async function handleSaveSignature(e) {
    if (!hasStrokes) {
      toast("Please draw a signature, click 'Generate Cursive', or upload an image.", "error");
      return;
    }

    const dataUrl = getTrimmedSignatureDataUrl();
    if (!dataUrl) {
      toast("The canvas appears blank. Please sign on the pad.", "error");
      return;
    }

    const restore = busyButton(e.currentTarget, "Saving signature…");
    try {
      const fieldName = currentRole === "principal" ? "principalSignatureUrl" : "teacherSignatureUrl";
      await saveSchoolSettings(profile.uid, {
        [fieldName]: dataUrl,
      });

      if (settings) {
        settings[fieldName] = dataUrl;
      }
      invalidateSchoolSettingsCache();

      toast(`${currentRole === "principal" ? "Head of Institution" : "Class Teacher"} signature saved.`, "success");
      updatePreview();
      onSaved?.({ role: currentRole, dataUrl });
      closeModal();
    } catch (err) {
      console.error("Save signature error:", err);
      toast(err.message || "Failed to save signature.", "error");
    } finally {
      restore();
    }
  }

  return closeModal;
}
