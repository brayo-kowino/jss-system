import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("PWA Offline Assets & Service Worker Precache", () => {
  const swPath = resolve(process.cwd(), "public/sw.js");
  const manifestPath = resolve(process.cwd(), "public/site.webmanifest");

  it("ensures public/sw.js exists and is readable", () => {
    expect(existsSync(swPath)).toBe(true);
    const content = readFileSync(swPath, "utf8");
    expect(content.length).toBeGreaterThan(100);
  });

  it("precaches all essential self-hosted fonts and branding assets during install", () => {
    const content = readFileSync(swPath, "utf8");
    
    // Core fonts must be precached
    expect(content).toContain("/fonts/material-symbols-rounded.woff2");
    expect(content).toContain("/fonts/manrope-latin.woff2");
    expect(content).toContain("/fonts/lora-latin.woff2");

    // Core icons and branding assets must be precached
    expect(content).toContain("/assets/logo.png");
    expect(content).toContain("/assets/learning-journey.png");
    expect(content).toContain("/assets/learning-journey-192.png");
    expect(content).toContain("/site.webmanifest");
    expect(content).toContain("/waving-hand.png");
  });

  it("contains graceful offline fallback SVGs for broken or offline images & avatars", () => {
    const content = readFileSync(swPath, "utf8");

    // Detection logic
    expect(content).toContain("isImageRequest");
    expect(content).toContain("isAvatarRequest");

    // Offline fallback handlers
    expect(content).toContain("offlineAvatarFallbackResponse");
    expect(content).toContain("offlineImageFallbackResponse");
    expect(content).toContain('"Content-Type": "image/svg+xml"');

    // Avatar SVG structure
    expect(content).toContain("<svg");
    expect(content).toContain("viewBox");
  });

  it("allows critical cross-origin hosts (Cloudinary, Firebase SDK, jsDelivr CDN)", () => {
    const content = readFileSync(swPath, "utf8");
    expect(content).toContain("res.cloudinary.com");
    expect(content).toContain("www.gstatic.com");
    expect(content).toContain("cdn.jsdelivr.net");
  });

  it("validates site.webmanifest configuration for standalone PWA installation", () => {
    expect(existsSync(manifestPath)).toBe(true);
    const raw = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    expect(manifest.name).toBe("Eeskia");
    expect(manifest.short_name).toBe("Eeskia");
    expect(manifest.start_url).toBe("/app/");
    expect(manifest.scope).toBe("/app/");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });
});
