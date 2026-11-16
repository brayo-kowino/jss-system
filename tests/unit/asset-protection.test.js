import { describe, it, expect } from "vitest";
import { preloadSplashBasics, preloadPrivateEngines, preloadAllAppAssets } from "../../js/services/asset-preloader.js";

describe("Asset Protection & Two-Tier Preloader", () => {
  describe("1. Preloader Exports & Structure", () => {
    it("exports preloadSplashBasics, preloadPrivateEngines, and backward-compatible preloadAllAppAssets", () => {
      expect(typeof preloadSplashBasics).toBe("function");
      expect(typeof preloadPrivateEngines).toBe("function");
      expect(typeof preloadAllAppAssets).toBe("function");
    });
  });

  describe("2. Edge Server Asset Protection Logic", () => {
    function isAllowedOriginOrReferer(rawHost, currentHost) {
      if (!rawHost) return false;
      const host = rawHost.toLowerCase().split(":")[0];
      const current = currentHost.toLowerCase().split(":")[0];
      if (host === current) return true;
      if (host === "localhost" || host === "127.0.0.1") return true;
      if (host.endsWith(".netlify.app") || host.endsWith(".iskify360.tech") || host === "iskify360.tech") return true;
      return false;
    }

    function checkAssetAccess({ pathname, secFetchSite, origin, referer, secFetchDest, currentHost = "eeskia.iskify360.tech" }) {
      if (!pathname.startsWith("/assets/")) return { status: 200 };

      if (secFetchSite === "cross-site") {
        return { status: 403, reason: "cross-site" };
      }

      if (origin) {
        try {
          const originHost = new URL(origin).host;
          if (!isAllowedOriginOrReferer(originHost, currentHost)) {
            return { status: 403, reason: "unauthorized_origin" };
          }
        } catch {
          return { status: 403, reason: "malformed_origin" };
        }
      }

      if (referer) {
        try {
          const refererHost = new URL(referer).host;
          if (!isAllowedOriginOrReferer(refererHost, currentHost)) {
            return { status: 403, reason: "external_hotlinking" };
          }
        } catch {}
      }

      if (pathname.endsWith(".js") && secFetchDest === "document") {
        return { status: 403, reason: "direct_js_navigation" };
      }

      return { status: 200 };
    }

    it("allows genuine same-origin in-app script downloads", () => {
      const res = checkAssetAccess({
        pathname: "/assets/timetable-GgXVGx2J.js",
        secFetchSite: "same-origin",
        secFetchDest: "script",
        referer: "https://eeskia.iskify360.tech/app/",
        currentHost: "eeskia.iskify360.tech",
      });
      expect(res.status).toBe(200);
    });

    it("allows dynamic chunk imports triggered from legitimate Netlify previews", () => {
      const res = checkAssetAccess({
        pathname: "/assets/marks-BOB-aYrw.js",
        secFetchSite: "same-origin",
        secFetchDest: "empty",
        referer: "https://beta--eeskia.netlify.app/app/",
        currentHost: "beta--eeskia.netlify.app",
      });
      expect(res.status).toBe(200);
    });

    it("blocks cross-site asset fetches", () => {
      const res = checkAssetAccess({
        pathname: "/assets/marks-BOB-aYrw.js",
        secFetchSite: "cross-site",
        secFetchDest: "script",
        referer: "https://attacker-domain.com/",
        currentHost: "eeskia.iskify360.tech",
      });
      expect(res.status).toBe(403);
      expect(res.reason).toBe("cross-site");
    });

    it("blocks requests with unauthorized external origin headers", () => {
      const res = checkAssetAccess({
        pathname: "/assets/app-123.js",
        secFetchSite: "same-site",
        origin: "https://unauthorized-school-site.com",
        currentHost: "eeskia.iskify360.tech",
      });
      expect(res.status).toBe(403);
      expect(res.reason).toBe("unauthorized_origin");
    });

    it("blocks hotlinked script references with external referers", () => {
      const res = checkAssetAccess({
        pathname: "/assets/marks-123.js",
        referer: "https://pirated-portal.net/login",
        currentHost: "eeskia.iskify360.tech",
      });
      expect(res.status).toBe(403);
      expect(res.reason).toBe("external_hotlinking");
    });

    it("blocks direct URL-bar address navigation to internal JavaScript chunk files", () => {
      const res = checkAssetAccess({
        pathname: "/assets/timetable-GgXVGx2J.js",
        secFetchDest: "document",
        currentHost: "eeskia.iskify360.tech",
      });
      expect(res.status).toBe(403);
      expect(res.reason).toBe("direct_js_navigation");
    });

    it("allows direct navigation to images (e.g. logo or hero)", () => {
      const res = checkAssetAccess({
        pathname: "/assets/logo.png",
        secFetchDest: "document",
        currentHost: "eeskia.iskify360.tech",
      });
      expect(res.status).toBe(200);
    });
  });
});
