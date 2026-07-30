# JSS Manager — School Management System (MVP, Phase 1 & 2)

Vanilla JS SPA + Firebase, built in the order from the spec:
**Auth & Roles → School Settings → Student/Parent/Teacher Management →
Classes/Streams/Subjects → Assessments → Marks → CBC Grading & Report Cards →
Attendance → Fees → Timetable → (next: Reports/Dashboard →
Notifications/Audit)**

## What's working right now

- Hash-based SPA router with auth + per-role route guards
- Firebase Auth (email/password) — login, forgot password, session persistence
- Role-based sidebar/topbar shell (10 roles from the spec)
- Admin: create user accounts with a role (`auth.service.js:createUserAccount`)
- School Settings: profile, logo upload, academic year/term, CBC grading scale
- **Student Management**: admissions form (photo, medical info, parent
  linking), search/filter by name/grade/status, edit, transfer, promote,
  suspend/reinstate, archive
- **Parent Module**: add/edit parents, see which students are linked to each
  one (linking itself happens from the student form's checklist)
- **Teacher Module**: register teachers, assign subjects and classes via
  checklists, optionally create a login for them on the spot
  (`class_teacher` if they have class assignments, else `subject_teacher`)
- **Classes & Streams**: add/delete grades, add/rename/remove streams within
  a grade, all with usage guards — you can't delete a grade or stream while
  students are still enrolled in it, or delete a grade a teacher is still
  assigned to (`academic.service.js`, `views/academics.js`)
- **Subject Management**: add/edit/delete subjects with code, name,
  department, and CBC pathway; delete is blocked while any teacher is still
  assigned to teach that subject (`views/subjects.js`). Same
  `academic.service.js` still seeds default Grades 7–9 (with streams) and the
  9 CBC subjects on first load so nothing's empty on day one.
- **Assessment Management**: create CATs, assignments, midterms, endterms,
  and projects with a weight (%), date, term/academic year, and which
  grade(s) they apply to; lock/reopen to gate Marks Entry, and deletion is
  blocked once mark records exist against it (`assessment.service.js`,
  `views/assessments.js`). Subject teachers get read-only visibility; only
  admins and the academic master can create/edit/lock.
- **Marks Entry**: class → subject → assessment cascade, autosaving score
  inputs (0–100), a "Save All" for anything left unsaved, and a paste-in bulk
  fill (`admission_no, score` per line) that populates the table for review
  before saving. Subject/class teachers only see the subjects on their own
  teacher record (matched via a new `getTeacherByUserId`/`getTeacherByEmail`
  lookup — teacher records created with a login now store that login's `uid`
  so this match works); admins and the academic master see everything.
  Entry is blocked the moment an assessment is locked, and Lock/Reopen is
  available right from this screen for admins/academic master
  (`marks.service.js`, `views/marks.js`).
- **CBC Grading & Position Engine**: pick a class + academic year + term,
  and it weight-averages every subject's assessments (CAT/Midterm/Endterm/
  etc, using each assessment's weight %) into a score, grades it against the
  school's CBC grading scale (now with a Points column, e.g. EE1=8…BE2=1),
  and ranks students — per subject and overall — with standard competition
  ranking (ties share a rank). Each student's detail view also breaks down
  points/percentage by pathway (STEM/Social Sciences/Arts & Sports Science,
  using the pathway already assigned per subject) and, once a prior term has
  been saved, shows the deviation in mean marks/points against it. "Compute"
  is a read-only preview; "Save Results" (admin/academic master) persists one
  doc per student to a new `results` collection so the Report Card Generator
  can read it back without recomputing (`grading.service.js`, `views/grading.js`).
- **Report Card Generator**: pick a class + term with saved results, get a
  ranked list, then open any student's report card — school letterhead
  (logo/name/motto/address), student photo, performance summary (total,
  mean, mean grade, total points, overall position), the pathway breakdown,
  a full subject table (score/grade/points/position/remark), Performance
  History pulled from that student's other saved terms, editable Class
  Teacher / Principal remarks (role-gated — class teacher & academic
  master edit the former, principal & deputy the latter), a Fee Balance
  line (now backed by real fee structures/payments — see below), and the
  term's closing/opening dates (editable in School Settings). **Print** uses
  the browser's print dialog (a dedicated `@media print` rule hides
  everything but the card); **Download PDF** rasterizes the card with
  html2canvas + jsPDF, both loaded from a CDN only when clicked
  (`grading.service.js`'s `results` docs, `fee.service.js`, `pdf.util.js`,
  `views/reports.js`).
- **Attendance**: one doc per class per day, marked via a Present/Absent/
  Late/Excused segmented control per student (plus a "mark all present"
  shortcut); class teachers only see their own assigned class(es), admins/
  principal see every class. A running term summary shows each student's
  present/late/absent/excused counts and attendance % once at least one day
  is marked (`attendance.service.js`, `views/attendance.js`).
- **Fee Management**: set a fee structure (amount) per grade/academic year/
  term, look up any class's expected/paid/balance per student, record
  payments (amount, method, reference, date), and print/download a
  letterhead receipt for any payment — reusing the same `pdf.util.js`
  downloader as the report card (`fee.service.js`, `views/fees.js`).
- **Timetable**: admins/academic master manage the daily periods (with a
  sensible 8-period + break/lunch default seeded on first load), then build
  each class's weekly grid by assigning subject + teacher (+ optional room)
  to a day/period cell — saving is blocked if that teacher or room is
  already booked elsewhere at the same day/period. A separate Teacher
  Timetable view cross-references every class's slots for one teacher
  (auto-scoped to yourself if you're a subject/class teacher, freely
  selectable for admin/academic master/principal/deputy)
  (`timetable.service.js`, `views/timetable.js`).
- Dashboard: live counts from `students`/`teachers`/`parents`, plus real
  "Attendance Today" and "Fees Collected (Term)" stats
- Audit logging on login/logout/settings/admissions/transfers/teacher changes
- Every module further down the build order is stubbed ("coming soon") so the
  app is fully navigable while we build the rest.

## 1. Create the Firebase project

1. Go to console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (start in production mode).
4. **Build → Storage → Get started** (for the school logo and, later, student photos).
5. **Project settings → General → Your apps → Web (`</>`)** → register an app →
   copy the `firebaseConfig` object.

Paste that object into `js/firebase-config.js`, replacing the `REPLACE_ME` values.

## 2. Deploy Firestore rules

`firestore.rules` in this folder enforces: admins manage users/settings, any
staff role can read/write the operational collections (tighten this per
collection as each module ships — e.g. teachers should only touch marks for
their own subject/class once Marks Entry is built).

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # point it at this project, keep the existing firestore.rules
firebase deploy --only firestore:rules
```

## 3. Create the first admin account

The app can't create its own first user (there's no admin yet to do it). Do
this once, manually:

1. Firebase Console → Authentication → **Add user** (email + password).
2. Firestore → start collection **`users`** → doc ID = that user's **UID**
   (copy it from the Authentication tab) → fields:
   ```
   fullName: "Your Name"
   email: "you@school.ac.ke"
   role: "admin"
   status: "active"
   ```
3. Log in with that email/password — you now have a working Super Admin who
   can create every other account from inside the app.

## 4. Run it locally

Because this uses native ES modules, open it through a local server (not
`file://`):

```bash
npx serve .
# or
python3 -m http.server 5500
```

Then visit the printed localhost URL.

## Folder structure

```
index.html
css/          variables.css (design tokens), base.css, layout.css, components.css
js/
  firebase-config.js   Firebase app/auth/db/storage init
  app.js               bootstraps auth listener + router
  router.js            hash routes, per-role guards
  utils.js             toast, DOM helpers, formatting
  services/
    auth.service.js     login/logout/reset/create-user, roles list
    audit.service.js    append-only audit_logs writer/reader
    settings.service.js school_settings doc + grading scale + logo upload
    student.service.js  admission/edit/transfer/promote/suspend/archive
    parent.service.js   CRUD + link/unlink students
    teacher.service.js  CRUD + subject/class assignment + login-uid lookup
    academic.service.js classes/streams + subjects CRUD, usage guards, seeds defaults
    assessment.service.js CATs/exams CRUD, lock/reopen, delete guard once marks exist
    marks.service.js    per-student score upsert (single + bulk), locked-assessment guard
    grading.service.js  weighted subject averages → CBC grade/points, subject &
                         overall position ranking, pathway breakdown, save/read
                         results/ docs for report-card reuse
    fee.service.js       fee structures (per grade/year/term) + payment
                         recording/listing, plus the expected-vs-paid
                         balance lookup the report card's Fee Balance line
                         and dashboard's "Fees Collected" stat both use
    attendance.service.js daily present/absent/late/excused per class,
                         roll-ups into per-student and per-class %,
                         plus the dashboard's "Attendance Today" stat
    timetable.service.js periods CRUD + per-class day/period slot
                         assignment with teacher/room conflict checks,
                         class & teacher timetable lookups
    pdf.util.js         on-demand html2canvas + jsPDF loader for Download PDF
  components/
    shell.js            sidebar + topbar shared across authenticated views
    modal.js             generic modal used by Students/Parents/Teachers forms
views/
  login.js, dashboard.js, school-settings.js
  students.js, parents.js, teachers.js
  academics.js            Classes & Streams (grade cards, stream chips)
  subjects.js             Subject Management (code/name/department/pathway)
  assessments.js          Assessment Management (CATs, exams, weight/date/class, lock)
  marks.js                Marks Entry (class/subject/assessment cascade, autosave)
  grading.js              CBC Grading & Position Engine (compute/save class results)
  reports.js              Report Card Generator (class picker → print/PDF report card)
  attendance.js           Attendance (class/date picker, roster status, term summary)
  fees.js                 Fee Management (structures, class balances, payments, receipts)
  timetable.js            Timetable (periods manager, class grid, teacher grid)
  coming-soon.js         stub for not-yet-built modules
```

Each view module exports `render(ctx)` (returns a DOM node) and `init(ctx)`
(wires up event listeners after the node is in the document) — follow that
pattern for every new module.

## Next build step

Classes, Streams, Subjects, Assessment Management, Marks Entry, the CBC
Grading & Position Engine, the Report Card Generator, Attendance, Fee
Management, and Timetable are all done. Per the recommended order, next up
is **Reports & Dashboard** (Student List, Top Students, Subject/Class
Analysis, Fee Report, Attendance Report, Teacher Workload, Promotion List,
Exam Report — most of the raw data these need already exists in Firestore
from the modules above), then **Notifications & Audit Logs** (an in-app
notification system; the audit trail already logs actions, it just needs a
dedicated `views/audit.js` to read `audit_logs` back instead of the
`coming-soon` stub).
