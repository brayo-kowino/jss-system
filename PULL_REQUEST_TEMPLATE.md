# UI: Command Center dashboard — KPIs, trends, realtime activity & chat

This PR implements the Phase 1 Command Center dashboard for the JSS Management System.

What's included
- A modern, responsive command-center dashboard layout with KPI chips, trend charts, a recent activity feed, an upcoming events timeline, quick actions, AI insights (rule-based), and a lightweight communication hub (chat).
- Skeleton loaders and fade-in transitions for smooth perceived performance.
- Real-time listeners to Firestore collections: `activity`, `events`, and `chats` (limited queries). Please ensure these collections exist and Firestore security rules are set up.
- Chart.js loaded dynamically from CDN for client-side trend charts (no package install required).

Files changed
- css/base.css — Material Symbols font import.
- css/components.css — skeleton styles and fade-in utilities.
- css/dashboard.css — new styles for the command center layout.
- views/dashboard.js — new command-center dashboard implementation using existing services and Firestore realtime listeners.

Notes & considerations
- The dashboard uses Firestore onSnapshot subscriptions and will consume read operations; monitor usage and adjust query limits or add pagination as needed.
- Trend data is currently mocked/demo series where no server-side aggregations exist. I can add client-side aggregation or minimal cloud functions to precompute time series.
- If you'd like Chart.js added as a dependency instead of using the CDN, I can update package.json accordingly.

Follow-ups
- Replace demo trend data with real aggregated time-series.
- Add drill-down charts, CSV/PDF export, and permission-aware quick actions.
- Optionally migrate to a component framework for easier feature expansion.

Screenshots
- I recommend viewing the branch locally or on a preview deployment to inspect the UI.

---

Please review and let me know if you'd like any changes; I can update the branch and push amendments.
