import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { startTour, closeTour, isTourActive } from "../../js/components/tour.js";
import { TOUR_STEPS } from "../../js/tour-steps.js";

describe("Guided System Tour", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="sidebar">
        <div class="sidebar__seal-mount" data-tour="sidebar-logo">Logo</div>
        <div class="nav-group nav-group--collapsed">
          <div class="nav-group__label">
            <span>Academics</span>
            <span class="nav-group__chevron nav-group__chevron--collapsed">expand_more</span>
          </div>
          <div class="nav-group__links">
            <div data-tour="nav-marks">Marks Entry</div>
            <div data-tour="nav-reports">Report Cards</div>
          </div>
        </div>
        <div class="nav-group">
          <div class="nav-group__links">
            <div data-tour="nav-dashboard">Dashboard</div>
            <div data-tour="nav-attendance">Attendance</div>
          </div>
        </div>
      </div>
      <header class="topbar">
        <button class="topbar__collapse-btn" data-tour="sidebar-collapse"></button>
        <button class="topbar__search-trigger" data-tour="topbar-search"></button>
        <div data-tour="topbar-sync"></div>
        <button data-tour="topbar-theme"></button>
        <div data-tour="topbar-user"></div>
        <button data-tour="tour-trigger"></button>
      </header>
    `;
    closeTour();
  });

  afterEach(() => {
    closeTour();
  });

  it("reports inactive initially", () => {
    expect(isTourActive()).toBe(false);
  });

  it("starts tour when valid targets exist in DOM", () => {
    const started = startTour(TOUR_STEPS);
    expect(started).toBe(true);
    expect(isTourActive()).toBe(true);

    const overlay = document.querySelector(".tour-overlay");
    expect(overlay).not.toBeNull();

    const card = document.querySelector(".tour-card");
    expect(card).not.toBeNull();

    const spotlight = document.querySelector(".tour-spotlight");
    expect(spotlight).not.toBeNull();
  });

  it("renders rich step details with category, title and shortcut", () => {
    startTour(TOUR_STEPS);
    const card = document.querySelector(".tour-card");
    expect(card).not.toBeNull();

    const title = card.querySelector(".tour-card__title");
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("Welcome to Eeskia ERP");

    const category = card.querySelector(".tour-card__category");
    expect(category).not.toBeNull();
    expect(category.textContent).toBe("Welcome");
  });

  it("automatically uncollapses parent nav-group when spotlighting a child nav item", () => {
    const customSteps = [
      {
        target: '[data-tour="nav-marks"]',
        title: "CBC Marks Entry",
        category: "Daily Tasks",
        shortcut: "Ctrl+M",
        body: "Enter scores here.",
      },
    ];

    const collapsedGroup = document.querySelector(".nav-group--collapsed");
    expect(collapsedGroup).not.toBeNull();

    startTour(customSteps);

    // Parent group should be uncollapsed so target is visible
    expect(collapsedGroup.classList.contains("nav-group--collapsed")).toBe(false);
  });

  it("advances to next step on Enter or ArrowRight", () => {
    startTour(TOUR_STEPS);
    const card = document.querySelector(".tour-card");
    const firstTitle = card.querySelector(".tour-card__title").textContent;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    const secondTitle = card.querySelector(".tour-card__title").textContent;
    expect(secondTitle).not.toBe(firstTitle);
  });

  it("navigates back to previous step on ArrowLeft", () => {
    startTour(TOUR_STEPS);
    const card = document.querySelector(".tour-card");
    const firstTitle = card.querySelector(".tour-card__title").textContent;

    // Advance
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(card.querySelector(".tour-card__title").textContent).not.toBe(firstTitle);

    // Go back
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(card.querySelector(".tour-card__title").textContent).toBe(firstTitle);
  });

  it("closes tour on Escape key press", () => {
    startTour(TOUR_STEPS);
    expect(isTourActive()).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(isTourActive()).toBe(false);
    expect(document.querySelector(".tour-overlay")).toBeNull();
  });

  it("closes tour when close button or skip is clicked", () => {
    startTour(TOUR_STEPS);
    const closeBtn = document.querySelector(".tour-card__close-btn");
    expect(closeBtn).not.toBeNull();

    closeBtn.click();
    expect(isTourActive()).toBe(false);
    expect(document.querySelector(".tour-overlay")).toBeNull();
  });
});
