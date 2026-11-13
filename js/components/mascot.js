// ==========================================================================
// Centralized Eeskia Assistant Mascot Component
// Generates SVG mascots for dashboards and views with optimized geometry.
// ==========================================================================

function getPropsForType(type) {
  switch (type) {
    case "academics":
      return `
        <!-- Left Hand Holding CBC Chalkboard Slate -->
        <g class="academics-mascot__slate">
          <path d="M84,128 C72,134 70,146 80,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <rect x="50" y="122" width="34" height="28" rx="3" fill="#1E293B" stroke="#8C6F12" stroke-width="1.6" transform="rotate(-6 67 136)" />
          <text x="67" y="136" fill="#F8FAFC" font-size="8.5" font-weight="bold" text-anchor="middle" font-family="system-ui, sans-serif" transform="rotate(-6 67 136)">CBC</text>
          <line x1="56" y1="142" x2="78" y2="139.5" stroke="#FDE68A" stroke-width="1" stroke-dasharray="2,2" />
          <circle cx="80" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
        <!-- Right Arm Holding Teaching Pointer Wand -->
        <g class="academics-mascot__pointer">
          <path d="M136,128 C146,134 154,122 150,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <line x1="150" y1="110" x2="168" y2="78" stroke="#C9A227" stroke-width="3" stroke-linecap="round" />
          <circle cx="150" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
          <polygon class="academics-mascot__star" points="168,73 170,77 175,77 171,80 173,85 168,82 163,85 165,80 161,77 166,77" fill="#F59E0B" />
        </g>
      `;
    case "analytics":
      return `
        <!-- Analytics Chart Board -->
        <g class="analytics-mascot__chart">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <rect x="52" y="120" width="34" height="28" rx="3" fill="#0B2545" stroke="#14538A" stroke-width="1.2" transform="rotate(-4 69 134)" />
          <polyline points="56,140 64,133 72,136 82,125" fill="none" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="rotate(-4 69 134)" />
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
        <!-- Right Hand Magnifying Glass -->
        <g class="analytics-mascot__glass">
          <path d="M136,128 C146,134 152,124 148,114" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="156" cy="104" r="8" fill="none" stroke="#C9A227" stroke-width="2" />
          <line x1="150" y1="110" x2="144" y2="116" stroke="#8C6F12" stroke-width="2.5" stroke-linecap="round" />
          <circle cx="148" cy="114" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
      `;
    case "fees":
      return `
        <!-- Left Arm Holding Finance Ledger -->
        <g class="fees-mascot__ledger">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <rect x="52" y="122" width="30" height="34" rx="3" fill="#047857" stroke="#065F46" stroke-width="1.2" transform="rotate(-6 67 139)" />
          <text x="67" y="142" fill="#FFFFFF" font-size="9" font-weight="bold" text-anchor="middle" font-family="system-ui, sans-serif" transform="rotate(-6 67 139)">KES</text>
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
        <!-- Right Arm Holding Golden Coin -->
        <g class="fees-mascot__coin">
          <path d="M136,128 C146,134 152,124 148,114" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <circle cx="154" cy="108" r="9" fill="#F59E0B" stroke="#D97706" stroke-width="1.5" />
          <text x="154" y="112" fill="#78350F" font-size="9" font-weight="bold" text-anchor="middle" font-family="system-ui, sans-serif">¢</text>
          <circle cx="148" cy="114" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
      `;
    case "marks":
    case "assessments":
    case "grading":
      return `
        <!-- Left Arm Holding Scorecard Clipboard -->
        <g class="marks-mascot__clipboard">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <rect x="54" y="122" width="30" height="36" rx="3" fill="#9A3412" stroke="#7C2D12" stroke-width="1.2" transform="rotate(-6 69 140)" />
          <rect x="57" y="125" width="24" height="30" rx="2" fill="#FFFFFF" transform="rotate(-6 69 140)" />
          <rect x="63" y="121" width="12" height="5" rx="1.5" fill="#C9A227" transform="rotate(-6 69 140)" />
          <line x1="60" y1="131" x2="74" y2="129.5" stroke="#10B981" stroke-width="1.4" stroke-linecap="round" />
          <line x1="60" y1="137" x2="75" y2="135.5" stroke="#10B981" stroke-width="1.4" stroke-linecap="round" />
          <line x1="60" y1="143" x2="72" y2="141.5" stroke="#10B981" stroke-width="1.4" stroke-linecap="round" />
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
        <!-- Right Arm Holding Grading Pen -->
        <g class="marks-mascot__pen">
          <path d="M136,128 C146,134 154,120 148,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <line x1="148" y1="110" x2="162" y2="82" stroke="#DC2626" stroke-width="3" stroke-linecap="round" />
          <circle cx="148" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
      `;
    case "students":
    case "reports":
    case "teachers":
    case "parents":
    case "subjects":
    case "timetable":
    case "support":
    case "issues":
    case "notifications":
    default:
      return `
        <!-- Left Arm Holding Portfolio Folio -->
        <g class="students-mascot__folio">
          <path d="M84,128 C74,136 74,148 85,152" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <rect x="52" y="124" width="32" height="26" rx="3" fill="#0B2545" stroke="#14538A" stroke-width="1.2" transform="rotate(-6 68 137)" />
          <rect x="56" y="128" width="18" height="3" rx="1" fill="#C9A227" transform="rotate(-6 68 137)" />
          <rect x="56" y="133" width="22" height="2" rx="1" fill="#93C5FD" opacity="0.8" transform="rotate(-6 68 137)" />
          <polygon points="76,140 77.5,143 81,143.5 78.5,146 79,149.5 76,148 73,149.5 73.5,146 71,143.5 74.5,143" fill="#F59E0B" transform="rotate(-6 68 137)" />
          <circle cx="85" cy="150" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
        <!-- Right Arm Raising Rolled Diploma -->
        <g class="students-mascot__diploma">
          <path d="M136,128 C146,134 154,120 148,110" stroke="#14538A" stroke-width="6.5" stroke-linecap="round" fill="none" />
          <rect x="144" y="90" width="10" height="24" rx="2" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" transform="rotate(25 149 102)" />
          <rect x="142" y="99" width="14" height="4" rx="1" fill="#DC2626" transform="rotate(25 149 102)" />
          <circle cx="148" cy="110" r="4.5" fill="#FAF6F0" stroke="#14538A" stroke-width="1.2" />
        </g>
      `;
  }
}

/**
 * Universal mascot SVG builder.
 */
export function buildMascotSvg({ type = "academics", width = 165, height = 150, label = "Eeskia Assistant" } = {}) {
  const propsHtml = getPropsForType(type);

  return `
    <svg class="support-mascot-svg ${type}-mascot-svg" viewBox="0 0 220 200" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" aria-label="${label}">
      <!-- Ground Shadow -->
      <ellipse class="support-mascot__shadow" cx="110" cy="190" rx="55" ry="7" fill="rgba(20, 83, 138, 0.15)" />

      <!-- Floating Mascot Body -->
      <g class="support-mascot__body">
        <!-- Educational Textbooks Stack Base -->
        <g class="support-mascot__books">
          <rect x="54" y="174" width="112" height="13" rx="3" fill="#14538A" stroke="#0D3559" stroke-width="1.2" />
          <rect x="58" y="177" width="104" height="2" fill="#93C5FD" opacity="0.85" />
          <rect x="60" y="161" width="100" height="13" rx="3" fill="#059669" stroke="#047857" stroke-width="1.2" />
          <rect x="64" y="164" width="92" height="2" fill="#A7F3D0" opacity="0.9" />
          <rect x="66" y="148" width="88" height="13" rx="3" fill="#C9A227" stroke="#8C6F12" stroke-width="1.2" />
          <rect x="70" y="151" width="80" height="2" fill="#FDE68A" opacity="0.9" />
        </g>

        <!-- Academic Scholar Robe -->
        <path d="M84,124 C78,142 76,154 80,160 L140,160 C144,154 142,142 136,124 Z" fill="#14538A" stroke="#0D3559" stroke-width="1.5" />
        <!-- Gold Sash -->
        <path d="M96,124 L110,150 L124,124 L118,124 L110,138 L102,124 Z" fill="#C9A227" />

        ${propsHtml}

        <!-- Head -->
        <circle cx="110" cy="92" r="31" fill="#FAF6F0" stroke="#14538A" stroke-width="2.2" />
        <ellipse cx="88" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />
        <ellipse cx="132" cy="99" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.65" />

        <!-- Cheerful Eyebrows -->
        <path d="M89,76 Q97,71 103,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M131,76 Q123,71 117,75" stroke="#8C6F12" stroke-width="2.2" stroke-linecap="round" fill="none" />

        <!-- Animated Blinking Eyes -->
        <g class="support-mascot__eyes">
          <ellipse cx="98" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <ellipse cx="122" cy="90" rx="7" ry="8.5" fill="#FFFFFF" stroke="#14538A" stroke-width="1.4" />
          <circle cx="98" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="122" cy="92" r="4.4" fill="#0B2545" />
          <circle cx="96.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="99" cy="93.5" r="0.8" fill="#FFFFFF" />
          <circle cx="120.5" cy="89.5" r="1.8" fill="#FFFFFF" />
          <circle cx="123" cy="93.5" r="0.8" fill="#FFFFFF" />
        </g>

        <!-- Warm Smile -->
        <path d="M102,106 Q110,114 118,106" stroke="#0B2545" stroke-width="2.4" stroke-linecap="round" fill="none" />

        <!-- Graduation Cap (Mortarboard) -->
        <g transform="rotate(-5 110 58)">
          <rect x="95" y="56" width="30" height="13" rx="4" fill="#8C6F12" />
          <polygon points="110,36 154,50 110,61 66,50" fill="#C9A227" stroke="#8C6F12" stroke-width="1.5" />
          <circle cx="110" cy="48.5" r="3" fill="#FAF6F0" />
          <path class="support-mascot__tassel" d="M110,48.5 C126,52 136,64 133,80" stroke="#FAF6F0" stroke-width="1.8" fill="none" />
          <circle cx="133" cy="81" r="2.5" fill="#FAF6F0" />
        </g>
      </g>
    </svg>
  `;
}

// Convenient pre-bound exports for backwards-compatibility with all view files
export const buildAcademicsMascotSvg = (opts) => buildMascotSvg({ type: "academics", width: 165, height: 150, label: "Academics Assistant", ...opts });
export const buildAnalyticsMascotSvg = (opts) => buildMascotSvg({ type: "analytics", width: 125, height: 110, label: "Analytics Assistant", ...opts });
export const buildAssessmentsMascotSvg = (opts) => buildMascotSvg({ type: "assessments", width: 125, height: 110, label: "Assessments Assistant", ...opts });
export const buildFinanceMascotSvg = (opts) => buildMascotSvg({ type: "fees", width: 125, height: 110, label: "Finance Assistant", ...opts });
export const buildGradingMascotSvg = (opts) => buildMascotSvg({ type: "grading", width: 165, height: 150, label: "Grading Assistant", ...opts });
export const buildMarksMascotSvg = (opts) => buildMascotSvg({ type: "marks", width: 165, height: 150, label: "Marks Entry Assistant", ...opts });
export const buildNotificationsMascotSvg = (opts) => buildMascotSvg({ type: "notifications", width: 165, height: 150, label: "Communications Assistant", ...opts });
export const buildParentsMascotSvg = (opts) => buildMascotSvg({ type: "parents", width: 125, height: 110, label: "Parent Module Assistant", ...opts });
export const buildReportsMascotSvg = (opts) => buildMascotSvg({ type: "reports", width: 165, height: 150, label: "Reports Assistant", ...opts });
export const buildIssuesMascotSvg = (opts) => buildMascotSvg({ type: "issues", width: 125, height: 110, label: "Student Care Assistant", ...opts });
export const buildStudentsMascotSvg = (opts) => buildMascotSvg({ type: "students", width: 125, height: 110, label: "Student Registrar Assistant", ...opts });
export const buildSubjectsMascotSvg = (opts) => buildMascotSvg({ type: "subjects", width: 165, height: 150, label: "Curriculum Assistant", ...opts });
export const buildSupportMascotSvg = (opts) => buildMascotSvg({ type: "support", width: 150, height: 140, label: "Support Assistant", ...opts });
export const buildStaffMascotSvg = (opts) => buildMascotSvg({ type: "teachers", width: 125, height: 110, label: "Staff Assistant", ...opts });
export const buildTimetableMascotSvg = (opts) => buildMascotSvg({ type: "timetable", width: 165, height: 150, label: "Timetable Assistant", ...opts });
