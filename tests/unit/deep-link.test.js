import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseDeepLink,
  buildDeepLink,
  copyDeepLink,
  findBestRouteMatch,
  renderAlienNotFound,
} from "../../js/services/deep-link.service.js";

describe("Deep Linking Engine & Cosmic Alien 404", () => {
  const routes = {
    "/dashboard": { title: "Dashboard", roles: ["admin", "teacher"] },
    "/students": { title: "Student Directory", roles: ["admin", "teacher"] },
    "/attendance": { title: "Attendance Tracking", roles: ["admin", "teacher"] },
    "/marks": { title: "Marks Entry & Review", roles: ["admin", "teacher"] },
    "/timetable": { title: "Master Timetable", roles: ["admin", "teacher"] },
    "/fees": { title: "Fee Accounts", roles: ["admin", "accountant"] },
    "/settings": { title: "System Settings", roles: ["admin"] },
  };

  describe("parseDeepLink", () => {
    it("parses empty or root hash as root path with empty params", () => {
      const res = parseDeepLink("");
      expect(res.path).toBe("/");
      expect(res.params).toEqual({});

      const resSlash = parseDeepLink("#/");
      expect(resSlash.path).toBe("/");
      expect(resSlash.params).toEqual({});
    });

    it("parses simple route without parameters", () => {
      const res = parseDeepLink("#/timetable");
      expect(res.path).toBe("/timetable");
      expect(res.params).toEqual({});
    });

    it("parses single query parameter from hash", () => {
      const res = parseDeepLink("#/students?id=stu_abc123");
      expect(res.path).toBe("/students");
      expect(res.params.id).toBe("stu_abc123");
    });

    it("parses and decodes multiple nested query parameters", () => {
      const res = parseDeepLink("#/marks?grade=Grade+7&stream=Blue&subject=ENG&assessment=ass_midterm");
      expect(res.path).toBe("/marks");
      expect(res.params.grade).toBe("Grade 7");
      expect(res.params.stream).toBe("Blue");
      expect(res.params.subject).toBe("ENG");
      expect(res.params.assessment).toBe("ass_midterm");
    });

    it("handles URL encoded strings with spaces and symbols", () => {
      const res = parseDeepLink("#/students?q=John%20Doe&status=active&action=admit");
      expect(res.path).toBe("/students");
      expect(res.params.q).toBe("John Doe");
      expect(res.params.status).toBe("active");
      expect(res.params.action).toBe("admit");
    });

    it("handles malformed URI components gracefully without throwing", () => {
      const res = parseDeepLink("#/%E0%A4%A");
      expect(res).toBeDefined();
      expect(typeof res.path).toBe("string");
    });
  });

  describe("buildDeepLink", () => {
    it("builds link with bare path", () => {
      const url = buildDeepLink("/timetable");
      expect(url).toContain("#/timetable");
    });

    it("builds link with query parameters", () => {
      const url = buildDeepLink("/marks", {
        grade: "Grade 8",
        stream: "Green",
        subject: "MATH",
      });
      expect(url).toContain("#/marks?");
      expect(url).toContain("grade=Grade+8");
      expect(url).toContain("stream=Green");
      expect(url).toContain("subject=MATH");
    });

    it("omits empty, null, and undefined parameters", () => {
      const url = buildDeepLink("/fees", {
        grade: "Grade 7",
        stream: "",
        academicYear: null,
        term: undefined,
      });
      expect(url).toContain("#/fees?grade=Grade+7");
      expect(url).not.toContain("stream");
      expect(url).not.toContain("academicYear");
      expect(url).not.toContain("term");
    });
  });

  describe("copyDeepLink", () => {
    let originalClipboardDesc;

    beforeEach(() => {
      vi.restoreAllMocks();
      originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    });

    afterEach(() => {
      if (originalClipboardDesc) {
        Object.defineProperty(navigator, "clipboard", originalClipboardDesc);
      } else {
        delete navigator.clipboard;
      }
    });

    it("writes to clipboard when navigator.clipboard is available", async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });

      const success = await copyDeepLink("/students", { id: "stu_1" }, "Student profile");
      expect(success).toBe(true);
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock.mock.calls[0][0]).toContain("#/students?id=stu_1");
    });

    it("falls back to execCommand if navigator.clipboard is absent", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const execMock = vi.fn().mockReturnValue(true);
      document.execCommand = execMock;

      const success = await copyDeepLink("/timetable", { day: "Monday" }, "Monday Schedule");
      expect(success).toBe(true);
      expect(execMock).toHaveBeenCalledWith("copy");
    });
  });

  describe("findBestRouteMatch", () => {
    it("suggests /timetable for /timetabl typo", () => {
      const match = findBestRouteMatch("/timetabl", routes);
      expect(match).not.toBeNull();
      expect(match.path).toBe("/timetable");
      expect(match.title).toBe("Master Timetable");
    });

    it("suggests /students for /studnt typo", () => {
      const match = findBestRouteMatch("/studnt", routes);
      expect(match).not.toBeNull();
      expect(match.path).toBe("/students");
    });

    it("suggests /marks for /mark prefix", () => {
      const match = findBestRouteMatch("/mark", routes);
      expect(match).not.toBeNull();
      expect(match.path).toBe("/marks");
    });

    it("suggests /fees for /fee prefix", () => {
      const match = findBestRouteMatch("/fee", routes);
      expect(match).not.toBeNull();
      expect(match.path).toBe("/fees");
    });

    it("returns null for completely unrelated or distant gibberish", () => {
      const match = findBestRouteMatch("/galaxy-super-station-999", routes);
      expect(match).toBeNull();
    });
  });

  describe("renderAlienNotFound", () => {
    let container;

    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
    });

    afterEach(() => {
      container.remove();
    });

    it("renders the cosmic alien 404 container and UFO illustration", () => {
      renderAlienNotFound(container, {
        badRoute: "/nonexistent-page",
        routes,
        authed: true,
      });

      const alienContainer = container.querySelector(".alien-404-container");
      expect(alienContainer).not.toBeNull();

      const ufo = container.querySelector(".alien-404__ufo");
      expect(ufo).not.toBeNull();

      const title = container.querySelector(".alien-404__title");
      expect(title.textContent).toContain("Aliens might have eaten that page");

      const badPathCode = container.querySelector(".alien-bad-path");
      expect(badPathCode.textContent).toBe("/nonexistent-page");
    });

    it("shows radar suggestion when close route exists", () => {
      const onNavigate = vi.fn();
      renderAlienNotFound(container, {
        badRoute: "/timetabl",
        routes,
        authed: true,
        onNavigate,
      });

      const suggestion = container.querySelector(".alien-404__suggestion");
      expect(suggestion).not.toBeNull();
      expect(suggestion.textContent).toContain("Master Timetable");

      const beamBtn = suggestion.querySelector("button");
      expect(beamBtn).not.toBeNull();
      beamBtn.click();
      expect(onNavigate).toHaveBeenCalledWith("/timetable");
    });

    it("filters and displays live routes from teleport search box", () => {
      const onNavigate = vi.fn();
      renderAlienNotFound(container, {
        badRoute: "/somewhere-lost",
        routes,
        authed: true,
        onNavigate,
      });

      const searchInput = container.querySelector(".alien-404__search-input");
      const resultsMount = container.querySelector(".alien-404__search-results");
      expect(searchInput).not.toBeNull();
      expect(resultsMount).not.toBeNull();

      searchInput.value = "atten";
      searchInput.dispatchEvent(new Event("input"));

      const searchItems = container.querySelectorAll(".alien-search-item");
      expect(searchItems.length).toBeGreaterThan(0);
      expect(searchItems[0].textContent).toContain("Attendance");

      searchItems[0].click();
      expect(onNavigate).toHaveBeenCalledWith("/attendance");
    });

    it("renders quick teleport pills (Dashboard, Students, Timetable, Marks)", () => {
      const onNavigate = vi.fn();
      renderAlienNotFound(container, {
        badRoute: "/lost-path",
        routes,
        authed: true,
        onNavigate,
      });

      const teleports = container.querySelector(".alien-404__teleports");
      expect(teleports).not.toBeNull();

      const buttons = teleports.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThanOrEqual(5);

      // Test Beam to Dashboard button
      buttons[0].click();
      expect(onNavigate).toHaveBeenCalledWith("/dashboard");

      // Test Students teleport button
      buttons[1].click();
      expect(onNavigate).toHaveBeenCalledWith("/students");
    });
  });
});
