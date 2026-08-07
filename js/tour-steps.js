// ==========================================================================
// System Tour content.
//
// One flat list covers every role: the tour engine (components/tour.js)
// silently skips any step whose [data-tour] target isn't in the DOM, and
// the sidebar only ever renders the nav links a given role can see. So this
// file doesn't need its own role branching - it just describes what each
// possible hook is, in the order a new user should meet them.
// ==========================================================================

export const TOUR_STEPS = [
  {
    target: '[data-tour="sidebar-logo"]',
    title: "Welcome to JSS Manager",
    body: "This quick tour points out where everything lives. You can replay it anytime from the help icon in the top bar.",
  },
  {
    target: '[data-tour="sidebar-search"]',
    title: "Find a page fast",
    body: "Type here to filter the menu on the left down to matching pages - handy once you know the system and just want to jump straight in.",
  },
  {
    target: '[data-tour="nav-dashboard"]',
    title: "Dashboard",
    body: "Your home screen: enrolment, attendance, fee collection and recent activity at a glance, updated live.",
  },
  {
    target: '[data-tour="nav-attendance"]',
    title: "Attendance",
    body: "Mark a class Present, Absent, Late or Excused for the day, and track each student's attendance percentage for the term.",
  },
  {
    target: '[data-tour="nav-marks"]',
    title: "Marks Entry",
    body: "Enter scores for a class, subject and assessment. Everything autosaves, and you can paste in a whole list of scores at once.",
  },
  {
    target: '[data-tour="nav-timetable"]',
    title: "Timetable",
    body: "See the weekly lesson schedule by class or by teacher.",
  },
  {
    target: '[data-tour="nav-notifications"]',
    title: "Notifications",
    body: "Announcements and alerts relevant to you show up here.",
  },
  {
    target: '[data-tour="nav-students"]',
    title: "Student Management",
    body: "Admit new students, search and filter the roll, and handle transfers, promotions or suspensions.",
  },
  {
    target: '[data-tour="nav-teachers"]',
    title: "Staff & Logins",
    body: "Register teachers, assign the subjects and classes they teach, and create their system logins.",
  },
  {
    target: '[data-tour="nav-parents"]',
    title: "Parents",
    body: "Manage parent/guardian records and see which students each one is linked to.",
  },
  {
    target: '[data-tour="nav-assessments"]',
    title: "Assessments",
    body: "Set up CATs, assignments, midterms, endterms and projects, each with its own weight toward the final grade.",
  },
  {
    target: '[data-tour="nav-grading"]',
    title: "Grading & Positions",
    body: "Computes CBC grades and class rankings automatically from the marks that have been entered.",
  },
  {
    target: '[data-tour="nav-reports"]',
    title: "Report Cards",
    body: "Generate, print or download a full report card for any student once results are saved.",
  },
  {
    target: '[data-tour="nav-analytics"]',
    title: "School Analytics",
    body: "Trends across the whole school - performance, attendance and fee collection over time.",
  },
  {
    target: '[data-tour="nav-academics"]',
    title: "Classes & Streams",
    body: "Set up grades and the streams within them, e.g. Grade 8 East and Grade 8 West.",
  },
  {
    target: '[data-tour="nav-subjects"]',
    title: "Subjects",
    body: "Manage the subjects taught at the school, including their CBC pathway.",
  },
  {
    target: '[data-tour="nav-fees"]',
    title: "Fees",
    body: "Set fee amounts per grade and term, record payments, and print receipts.",
  },
  {
    target: '[data-tour="nav-settings"]',
    title: "School Settings",
    body: "The school's profile, logo, brand colours, academic year/term and CBC grading scale all live here.",
  },
  {
    target: '[data-tour="nav-audit"]',
    title: "Audit Trail",
    body: "A record of who did what and when - useful for accountability and troubleshooting.",
  },
  {
    target: '[data-tour="nav-schools"]',
    title: "Schools",
    body: "As a platform admin, this is where you create and manage every school on this deployment.",
  },
  {
    target: '[data-tour="topbar-user"]',
    title: "Your account",
    body: "Your name and role are shown here. Use Sign out when you're done, especially on a shared computer.",
  },
  {
    target: '[data-tour="tour-trigger"]',
    title: "Need this tour again?",
    body: "Click this help icon anytime to replay the tour - it always shows the pages your account can currently access.",
  },
];
