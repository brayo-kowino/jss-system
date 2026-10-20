/**
 * Smart Remarks Engine v4.0
 * Compositional NLG for JSS / CBC report cards. Zero dependencies, offline, deterministic.
 *
 * Voices: getSmartTeacherRemark, getSmartPrincipalRemark, getSmartSubjectRemark, getSmartParentRemark
 * Class-level: generateClassRemarks (guarantees phrase variety inside a class)
 * QA:          lintRemark (use it in tests; see smartRemarks.test.mjs)
 *
 * INPUT (all optional except enough marks/grades to judge performance):
 *   result = {
 *     admissionNumber | studentId, fullName | name, preferredName | firstName, gender,
 *     meanGrade ("EE1" | "ME" | legacy "B+" ...), meanMarks,
 *     subjects: [{ name, average, grade }],
 *     previousMeanGrade, previousMeanMarks,
 *     classPosition | overallPosition, classSize | streamClassSize,
 *     previousClassPosition | previousOverallPosition, previousClassSize | previousStreamClassSize,
 *     attendanceRate (0-100)
 *   }
 *
 * OPTIONS (all optional):
 *   {
 *     bands,              // override DEFAULT_BANDS (VERIFY against your school / KNEC table)
 *     nameOrder,          // "firstFirst" (default) | "surnameFirst"  (used only when no preferredName/firstName)
 *     reportContext,      // "end-of-term" (default) | "mid-term"
 *     includePosition,    // default false. Rank is opt-in and only ever used positively (EE, upper ME, or improvement)
 *     includeAttendance,  // default true
 *     maxWords,           // teacher default 80, principal default 60
 *     fallback,           // returned when there is not enough data (default "" so the UI can leave the box for manual entry)
 *     slotPicker          // internal hook used by generateClassRemarks
 *   }
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * 8-level CBC bands (inclusive minimum mark). These follow the commonly published KNEC JSS table
 * as far as I know, but schools differ: VERIFY and override via options.bands if needed.
 */
export const DEFAULT_BANDS = [
  { code: "EE1", min: 63 },
  { code: "EE2", min: 54 },
  { code: "ME1", min: 45 },
  { code: "ME2", min: 36 },
  { code: "AE1", min: 27 },
  { code: "AE2", min: 18 },
  { code: "BE1", min: 9 },
  { code: "BE2", min: 1 },
];

const RANK = { BE: 0, AE: 1, ME: 2, EE: 3 };

const CONTEXTS = {
  "end-of-term": { ahead: "next term", breakWord: "the holiday" },
  "mid-term": { ahead: "in the weeks ahead", breakWord: "the mid-term break" },
};

/** Synonyms are written as {token} inside templates and resolved last, so grammar can't break. */
export const SYNONYMS = {
  effort: ["diligence", "effort", "application", "commitment"],
  excellence: ["excellence", "outstanding mastery", "a high standard of work", "strong all-round mastery"],
  commendable: ["commendable", "creditable", "admirable", "noteworthy", "encouraging"],
};

const CLUSTER_LABELS = {
  stem: "STEM",
  languages: "language",
  humanities: "humanities",
  arts: "creative arts",
  applied: "applied-skills",
};

// Order matters: specific patterns first so "Home Science" never falls into Integrated Science.
const SUBJECT_MAP = [
  { pattern: /\b(christian|c\.?r\.?e)\b/i, name: "Christian Religious Education", cluster: "humanities" },
  { pattern: /\b(islamic|i\.?r\.?e)\b/i, name: "Islamic Religious Education", cluster: "humanities" },
  { pattern: /\b(hindu|h\.?r\.?e)\b/i, name: "Hindu Religious Education", cluster: "humanities" },
  { pattern: /\b(agric\w*|nutrition|home\s*science)\b/i, name: "Agriculture & Nutrition", cluster: "applied" },
  { pattern: /\b(social\s*(studies|science)|history|geography|citizenship)\b/i, name: "Social Studies", cluster: "humanities" },
  { pattern: /\b(pre[\s-]*tech\w*|business|computer)\b/i, name: "Pre-Technical Studies", cluster: "stem" },
  { pattern: /\b(integrated\s*science|science|biology|chemistry|physics)\b/i, name: "Integrated Science", cluster: "stem" },
  { pattern: /\b(maths?|mathematics)\b/i, name: "Mathematics", cluster: "stem" },
  { pattern: /\b(creative|arts?|sports?|p\.?h\.?e|physical)\b/i, name: "Creative Arts & Sports", cluster: "arts" },
  { pattern: /\b(english|eng)\b/i, name: "English", cluster: "languages" },
  { pattern: /\b(kiswahili|kisw|lugha|fasihi)\b/i, name: "Kiswahili", cluster: "languages" },
];

export function parseSubjectMeta(rawName) {
  if (!rawName) return { name: "core learning areas", cluster: "general" };
  const clean = String(rawName).trim().replace(/\s*\([A-Z0-9.\s-]+\)\s*$/i, "").trim();
  for (const item of SUBJECT_MAP) {
    if (item.pattern.test(clean)) return { name: item.name, cluster: item.cluster };
  }
  return { name: clean || "core learning areas", cluster: "general" };
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** FNV-1a seed -> mulberry32 PRNG. Independent draws, stable for a fixed call order. */
export function createRng(seedStr) {
  let h = 2166136261;
  const str = String(seedStr ?? "seed");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createPicker(seedStr, slotPicker) {
  const rng = createRng(seedStr);
  // Always consume one draw so the sequence stays stable even when a class-level override is used.
  const pick = (slot, arr) => {
    if (!arr || arr.length === 0) return "";
    const r = rng();
    let idx = Math.floor(r * arr.length);
    if (typeof slotPicker === "function") {
      const o = slotPicker(slot, arr);
      if (Number.isInteger(o) && o >= 0 && o < arr.length) idx = o;
    }
    return arr[idx];
  };
  const free = (arr) => arr[Math.floor(rng() * arr.length)];
  return { pick, free };
}

/** Shuffle-bag: each phrase in a slot is used once before any repeats. */
function createSlotBag(seed) {
  const rng = createRng(seed);
  const bags = new Map();
  return (slot, arr) => {
    const key = `${slot}|${arr.length}`;
    let bag = bags.get(key);
    if (!bag || bag.length === 0) {
      bag = Array.from({ length: arr.length }, (_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      bags.set(key, bag);
    }
    return bag.pop();
  };
}

// ---------------------------------------------------------------------------
// Grammar helpers
// ---------------------------------------------------------------------------

function makeVerb(plural) {
  const irregular = { be: ["is", "are"], have: ["has", "have"], do: ["does", "do"] };
  return (base) => {
    if (irregular[base]) return irregular[base][plural ? 1 : 0];
    if (plural) return base;
    if (/(s|sh|ch|x|z|o)$/.test(base)) return base + "es";
    if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + "ies";
    return base + "s";
  };
}

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[-'\s])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

function joinNames(a, b) {
  return b ? `${a} and ${b}` : a;
}

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const firstNum = (...vals) => vals.find(isNum) ?? null;
const countWords = (t) => t.split(/\s+/).filter(Boolean).length;

function normalizeGender(g) {
  const x = String(g ?? "").toLowerCase().trim();
  if (["male", "boy", "m"].includes(x)) return "m";
  if (["female", "girl", "f"].includes(x)) return "f";
  return null;
}

// ---------------------------------------------------------------------------
// Levels (EE/ME/AE/BE + sub-level)
// ---------------------------------------------------------------------------

export function parseLevel(grade) {
  const g = String(grade ?? "").toUpperCase().trim();
  if (!g) return null;
  const m = g.match(/^(EE|ME|AE|BE)\s*([12])?/);
  if (m) return { tier: m[1], sub: m[2] ? Number(m[2]) : null };
  if (/^A/.test(g)) return { tier: "EE", sub: null }; // legacy letters
  if (/^(B|C\+)/.test(g)) return { tier: "ME", sub: null };
  if (/^(C|D\+)/.test(g)) return { tier: "AE", sub: null };
  if (/^[DE]/.test(g)) return { tier: "BE", sub: null };
  return null;
}

export function levelFromMarks(marks, bands = DEFAULT_BANDS) {
  for (const b of bands) {
    if (marks >= b.min) return { tier: b.code.slice(0, 2), sub: Number(b.code[2]) };
  }
  return { tier: "BE", sub: 2 };
}

function resolveLevel(grade, marks, bands) {
  const parsed = parseLevel(grade);
  const fromMarks = isNum(marks) ? levelFromMarks(marks, bands) : null;
  if (parsed) {
    const sub = parsed.sub ?? (fromMarks && fromMarks.tier === parsed.tier ? fromMarks.sub : 2);
    return { tier: parsed.tier, sub };
  }
  return fromMarks;
}

// ---------------------------------------------------------------------------
// Learner profile
// ---------------------------------------------------------------------------

function resolveFirstName(result, options) {
  const explicit = String(result.preferredName || result.firstName || "").trim();
  let token = "";
  if (explicit) {
    token = explicit.split(/\s+/)[0];
  } else {
    const tokens = String(result.fullName || result.name || "").trim().split(/\s+/).filter(Boolean);
    token = options.nameOrder === "surnameFirst" ? tokens[1] || tokens[0] || "" : tokens[0] || "";
  }
  if (!token || token.toLowerCase() === "learner") return { firstName: "The learner", hasName: false };
  return { firstName: titleCase(token), hasName: true };
}

export function getLearnerProfile(result, options = {}) {
  if (!result || typeof result !== "object") return null;
  const bands = Array.isArray(options.bands) && options.bands.length ? options.bands : DEFAULT_BANDS;
  const ctx = CONTEXTS[options.reportContext] || CONTEXTS["end-of-term"];

  const { firstName } = resolveFirstName(result, options);
  const gender = normalizeGender(result.gender);
  const plural = gender === null;
  const pronoun = gender === "m" ? "he" : gender === "f" ? "she" : "they";
  const Pronoun = pronoun[0].toUpperCase() + pronoun.slice(1);
  const possessive = gender === "m" ? "his" : gender === "f" ? "her" : "their";
  const Possessive = possessive[0].toUpperCase() + possessive.slice(1);
  const objPronoun = gender === "m" ? "him" : gender === "f" ? "her" : "them";
  const v = makeVerb(plural);

  // Subjects
  const rawSubjects = Array.isArray(result.subjects) ? result.subjects : [];
  const validSubjects = rawSubjects
    .filter((s) => s && isNum(s.average))
    .map((s) => {
      const meta = parseSubjectMeta(s.name);
      const lvl = resolveLevel(s.grade, s.average, bands);
      return { name: meta.name, cluster: meta.cluster, average: s.average, tier: lvl.tier };
    })
    .sort((a, b) => b.average - a.average);

  const count = validSubjects.length;
  const calcMean = count ? validSubjects.reduce((sum, s) => sum + s.average, 0) / count : null;
  const meanMarks = isNum(result.meanMarks) ? result.meanMarks : calcMean;

  const level = resolveLevel(result.meanGrade, meanMarks, bands);
  if (!level) return null; // not enough data to say anything honest
  const tier = level.tier;
  const subTier = level.sub;
  const overallRank = RANK[tier];

  // Previous term (optional)
  const prevLevel = resolveLevel(result.previousMeanGrade, result.previousMeanMarks, bands);
  const tierChange = prevLevel
    ? RANK[tier] > RANK[prevLevel.tier] ? "up" : RANK[tier] < RANK[prevLevel.tier] ? "down" : "same"
    : null;
  let trend = "steady";
  let markDelta = null;
  if (isNum(result.previousMeanMarks) && isNum(meanMarks)) {
    markDelta = meanMarks - result.previousMeanMarks;
    if (markDelta >= 3.5) trend = "rising";
    else if (markDelta <= -3.5) trend = "dropping";
  }
  if (trend === "steady" && tierChange === "up") trend = "rising";
  if (trend === "steady" && tierChange === "down") trend = "dropping";

  // Strengths and gaps (judged by CBC level, not raw mark gap)
  const bestSubject = count ? validSubjects[0] : null;
  const secondBest = count > 1 ? validSubjects[1] : null;
  const rawLowest = count > 1 ? validSubjects[count - 1] : null;
  const rawSecondLowest = count > 3 ? validSubjects[count - 2] : null;
  const scoreSpread = bestSubject && rawLowest ? bestSubject.average - rawLowest.average : 0;
  const lowestSubject = rawLowest && scoreSpread >= 3 ? rawLowest : null;

  const isWeak = (s) =>
    !!s && (RANK[s.tier] < overallRank || (overallRank <= 1 && bestSubject.average - s.average >= 6));
  const needsAttention = isWeak(lowestSubject);
  const secondLowest =
    needsAttention && rawSecondLowest && rawSecondLowest !== secondBest && isWeak(rawSecondLowest) &&
    bestSubject.average - rawSecondLowest.average >= 5
      ? rawSecondLowest
      : null;

  let stdDev = 0;
  if (count > 1) {
    stdDev = Math.sqrt(validSubjects.reduce((acc, s) => acc + (s.average - calcMean) ** 2, 0) / count);
  }
  const consistency = stdDev < 5.5 ? "consistent" : stdDev > 14 || scoreSpread >= 25 ? "polarized" : "balanced";

  const strengthSecond = secondBest && !(needsAttention && secondBest === lowestSubject) ? secondBest.name : null;
  const strengths = bestSubject ? joinNames(bestSubject.name, strengthSecond) : null;
  const strengthsPair = !!strengthSecond;
  const pairWeak = secondLowest && (overallRank <= 1 || consistency === "polarized");
  const weak = needsAttention ? joinNames(lowestSubject.name, pairWeak ? secondLowest.name : null) : null;

  const clusterAffinity =
    bestSubject && secondBest && bestSubject.cluster !== "general" && bestSubject.cluster === secondBest.cluster
      ? bestSubject.cluster
      : null;
  const aff = clusterAffinity
    ? `, pointing to a particular strength in the ${CLUSTER_LABELS[clusterAffinity]} learning areas`
    : "";

  // Position (only comparable when class size is the same across terms)
  const total = firstNum(result.streamClassSize, result.classSize);
  let position = firstNum(result.classPosition, result.overallPosition);
  if (position !== null && (position < 1 || (total !== null && position > total))) position = null;
  const prevPos = firstNum(result.previousClassPosition, result.previousOverallPosition);
  const prevTotal = firstNum(result.previousStreamClassSize, result.previousClassSize);
  const positionDelta =
    position !== null && prevPos !== null && (prevTotal === null || prevTotal === total) ? prevPos - position : null;

  const attendanceRate = isNum(result.attendanceRate)
    ? Math.round(Math.max(0, Math.min(100, result.attendanceRate)))
    : null;

  const bestKey = bestSubject ? bestSubject.name.replace(/\s+/g, "").slice(0, 6) : "None";
  const id = result.admissionNumber || result.studentId || result.fullName || result.name || "0";
  const seed = `${id}|${Math.round((meanMarks ?? 0) * 10)}|${bestKey}|${tier}${subTier}|${options.reportContext || "eot"}`;
  const { pick, free } = createPicker(seed, options.slotPicker);

  return {
    firstName, pronoun, Pronoun, possessive, Possessive, objPronoun, v, ctx,
    tier, subTier, tierChange, trend, markDelta, consistency,
    meanMarks, bestSubject, secondBest, lowestSubject, secondLowest, needsAttention,
    best: bestSubject ? bestSubject.name : null,
    strengths, strengthsPair, weak, aff, clusterAffinity,
    position, total, positionDelta, attendanceRate,
    pick, free,
  };
}

/** Resolve {tokens} (synonyms) last, then tidy whitespace. */
function finalize(p, text) {
  return text
    .replace(/\{(\w+)\}/g, (m, k) => (SYNONYMS[k] ? p.free(SYNONYMS[k]) : m))
    .replace(/\s{2,}/g, " ")
    .trim();
}

function assemble(p, parts, dropOrder, maxWords) {
  let list = parts.filter(([, t]) => t);
  const words = (l) => l.reduce((s, [, t]) => s + countWords(t), 0);
  for (const key of dropOrder) {
    if (words(list) <= maxWords) break;
    list = list.filter(([k]) => k !== key);
  }
  return finalize(p, list.map(([, t]) => t).join(" "));
}

// ---------------------------------------------------------------------------
// Optional clauses
// ---------------------------------------------------------------------------

function getPositionClause(p, options) {
  if (!options.includePosition || p.position === null || p.total === null) return null;
  const { position: pos, total, firstName: n, pronoun: he, Possessive: His, objPronoun: him, v } = p;
  const ord = getOrdinal(pos);

  if (p.positionDelta !== null && p.positionDelta >= 3 && p.trend !== "dropping") {
    return p.pick("teacher.position.up", [
      `${p.Pronoun} ${v("have")} climbed ${p.positionDelta} places to position ${pos} out of ${total}.`,
      `This is a ${p.positionDelta}-place improvement, placing ${him} ${ord} out of ${total}.`,
    ]);
  }
  if (p.tier === "EE") {
    if (pos <= 3) {
      return p.pick("teacher.position.eeTop", [
        `Ranking ${ord} out of ${total}, ${he} ${v("be")} among the top achievers in the class.`,
        `Position ${pos} out of ${total} places ${him} among the class leaders.`,
      ]);
    }
    return p.pick("teacher.position.ee", [
      `Placed ${ord} out of ${total}, ${he} ${v("be")} among the leading achievers.`,
      `A position of ${pos} out of ${total} confirms ${p.possessive} strong results.`,
    ]);
  }
  if (p.tier === "ME" && pos <= Math.ceil(total * 0.35)) {
    return p.pick("teacher.position.me", [
      `Placed ${ord} out of ${total}, ${he} ${v("hold")} a healthy standing in the class.`,
      `${His} position of ${pos} out of ${total} is a good base to build on.`,
    ]);
  }
  return null; // never print a low rank on a child's report
}

function getAttendanceClause(p, options) {
  if (options.includeAttendance === false || p.attendanceRate === null) return null;
  const r = p.attendanceRate;
  const him = p.objPronoun;
  if (r >= 96) {
    return p.pick("teacher.attendance.high", [
      `${p.Possessive} excellent attendance (${r}%) supports steady progress.`,
      `Regular attendance (${r}%) has helped ${him} keep up with lessons.`,
    ]);
  }
  if (r < 80) {
    return p.pick("teacher.attendance.low", [
      `Attendance this term was ${r}%; catching up on any missed work will help ${him} secure better results.`,
      `Missed lessons (attendance ${r}%) may have affected some results, so catching up on missed work is recommended.`,
    ]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Teacher remark
// ---------------------------------------------------------------------------

function teacherOpenings(p) {
  const { firstName: n, possessive: his, pronoun: he, v } = p;
  const defs = {
    EE: {
      base: [
        `${n} has achieved an outstanding result this term.`,
        `${n} has delivered an exemplary, well-rounded performance.`,
        `Excellent mastery of the curriculum competencies is evident in ${n}'s results.`,
        `${n} has set a high academic standard this term.`,
        `Exceptional {effort} is reflected in ${n}'s results this term.`,
        `${n}'s results this term reflect {excellence}.`,
      ],
      up: [
        `${n} has moved up into the Exceeding Expectations band this term, a pleasing achievement.`,
        `Impressive progress: ${n} has reached the Exceeding Expectations band this term.`,
      ],
      rising: [
        `${n} has built further on a strong performance, with higher results than last term.`,
        `${n}'s average is higher than last term, which is excellent to see.`,
      ],
      dropping: [
        `${n} remains in the Exceeding Expectations band, though ${his} average is slightly lower than last term.`,
        `A very good term for ${n}, with an average slightly below last term's peak.`,
      ],
    },
    ME: {
      base: [
        `${n} has produced a solid performance this term.`,
        `${n} has posted encouraging results this term.`,
        `${n} shows a good grasp of the core curriculum competencies.`,
        `${n}'s results show {commendable} effort across most learning areas.`,
        `${n} has maintained a respectable standing across the learning areas.`,
        `${n} has had a constructive term, with steady progress in the competencies assessed.`,
      ],
      up: [
        `${n} has moved up into the Meeting Expectations band this term, which is encouraging.`,
        `Encouraging progress: ${n} is now meeting expectations, up from last term.`,
      ],
      rising: [
        `${n} has improved noticeably on last term's results.`,
        `Encouraging progress: ${n}'s average is higher than last term.`,
      ],
      dropping: [
        `${n}'s average is slightly lower than last term, though ${he} ${v("remain")} within the Meeting Expectations band.`,
        `A slight dip from last term's average, but ${n} is still meeting expectations overall.`,
      ],
    },
    AE: {
      base: [
        `${n} has made a fair effort this term and has clear room to grow.`,
        `${n} shows promise but has posted mixed results across the learning areas.`,
        `${n} is building towards the expected level and needs more consistent practice to get there.`,
        `With more regular practice, ${n} can reach the expected competency level.`,
        `${n} has not yet reached the expected level in several learning areas but can get there with support.`,
      ],
      up: [`${n} has moved up into the Approaching Expectations band, showing clear progress.`],
      rising: [
        `Signs of improvement are visible; ${n} is gradually closing the gaps seen last term.`,
        `${n} has improved on last term's results, and this is a good base to build on.`,
      ],
      dropping: [
        `${n}'s results are lower than last term, and extra support is needed to get back on track.`,
        `${n} has slipped slightly since last term, and a renewed revision routine will help.`,
      ],
    },
    BE: {
      base: [
        `${n} is still building the foundational competencies for this level and needs extra support.`,
        `This has been a challenging term for ${n}, and targeted support will help ${p.objPronoun} progress.`,
        `${n}'s results are currently below the expected level, and a focused support plan is needed.`,
        `${n} needs closer guidance to strengthen foundational skills in the learning areas assessed.`,
        `${n} will benefit from structured, step-by-step support to build confidence and skills.`,
      ],
      rising: [
        `${n} has shown some improvement this term, which gives a good base to build on.`,
        `There are early signs of progress for ${n}, and steady support will help this continue.`,
      ],
      dropping: [
        `${n}'s results have dropped since last term, and prompt support is needed.`,
        `${n} has found this term harder than the last, and extra support should begin early.`,
      ],
    },
  };
  const def = defs[p.tier];
  if (p.tierChange === "up" && def.up) return { key: "up", pool: def.up };
  if (p.trend === "dropping" && def.dropping) return { key: "dropping", pool: def.dropping };
  if (p.trend === "rising" && def.rising) return { key: "rising", pool: def.base.concat(def.rising) };
  return { key: "base", pool: def.base };
}

function teacherDiagnostics(p) {
  const { firstName: n, Pronoun: He, pronoun: he, possessive: his, Possessive: His, objPronoun: him, v } = p;
  const S = p.strengths;
  const W = p.weak;
  const aff = p.aff;
  const pair = p.strengthsPair;

  if (!p.best) {
    const generic = {
      EE: [`${His} overall average reflects a strong command of the curriculum.`],
      ME: [`${His} overall average shows steady competence across the curriculum.`],
      AE: [`Regular revision across all learning areas will help consolidate key concepts.`],
      BE: [`Step-by-step guidance across all learning areas will help build a stronger foundation.`],
    };
    return { key: "generic", pool: generic[p.tier] };
  }

  const pools = {
    EE: {
      att: [
        `${He} ${v("excel")} in ${S}; giving a little more practice time to ${W} will round off ${his} profile.`,
        `${His} work in ${S} is top-tier, and strengthening ${W} is the next milestone.`,
        `${He} ${v("show")} excellent command of ${S}; steady practice in ${W} will help ${him} reach the top band across the board.`,
        `${He} ${v("perform")} best in ${S}, while ${W} offers the greatest room for further growth.`,
      ],
      flat: [
        `${He} ${v("show")} strong command across the learning areas, especially ${S}${aff}.`,
        `${His} results are strong across the subjects, led by ${S}.`,
        `${His} marks in ${S} reflect a thorough understanding of the key concepts.`,
        `${S} ${pair ? "stand" : "stands"} out as ${his} strongest ${pair ? "areas" : "area"}${aff}.`,
      ],
    },
    ME: {
      att: [
        `${His} results in ${S} are encouraging; extra practice in ${W} will help raise ${his} overall level.`,
        `While ${his} scores in ${S} are good, ${W} pulled down ${his} average this term.`,
        `${He} ${v("perform")} comfortably in ${S}; regular practice in ${W}, with teacher support, is recommended.`,
        `${S} ${pair ? "show" : "shows"} real strength, and focusing on ${W} next will help unlock the next performance band.`,
      ],
      flat: [
        `${He} ${v("show")} balanced competence, particularly in ${S}${aff}.`,
        `${His} results are steady across the learning areas, led by ${S}.`,
        `${His} balanced results, led by ${p.best}, provide a good foundation to build on.`,
        `${p.best} is ${his} strongest area, supported by steady work in other subjects.`,
      ],
    },
    AE: {
      att: [
        `${His} results in ${S} are encouraging, but ${W} now needs focused practice.`,
        `${He} ${v("do")} best in ${S}; ${W} needs extra support to consolidate the basic concepts.`,
        `Progress in ${S} shows what ${he} can do; with regular practice, ${W} can follow.`,
        `${S} ${pair ? "are" : "is"} a good base to build on, while key concepts in ${W} need to be revisited.`,
      ],
      flat: [
        `${His} results are similar across subjects, so a regular revision routine covering all learning areas will help.`,
        `${He} ${v("show")} some strength in ${p.best}, and the same approach can be applied to the other learning areas.`,
        `Regular practice and completing all assignments will help consolidate learning across subjects.`,
        `A steady revision routine across all subjects will help strengthen key concepts.`,
      ],
    },
    BE: {
      att: [
        `${His} best result is in ${p.best}, a good place to build confidence; ${W} needs focused, step-by-step support.`,
        `Targeted support in ${W} is needed, alongside regular practice in ${p.best}.`,
        `Core concepts in ${W} should be revisited with short daily practice sessions.`,
      ],
      flat: [
        `${He} ${v("need")} step-by-step guidance and regular practice across the learning areas to build confidence.`,
        `Short, regular practice sessions in all subjects will help build a stronger foundation.`,
        `Foundational concepts across the learning areas should be revisited with teacher support.`,
        `Daily reading and number practice will help strengthen core skills.`,
      ],
    },
  };
  const key = p.needsAttention ? "att" : "flat";
  return { key, pool: pools[p.tier][key] };
}

function teacherClosings(p) {
  const { firstName: n, objPronoun: him, possessive: his, ctx } = p;
  if (p.tier === "EE") {
    return [
      `Keep up this excellent standard ${ctx.ahead}.`,
      `Continue aiming high and taking on more challenging tasks.`,
      `A strong example of consistent effort; keep it up!`,
      `Extension work and wider reading will help ${him} keep growing ${ctx.ahead}.`,
    ];
  }
  if (p.tier === "ME") {
    const band =
      p.subTier === 1
        ? `${n} is close to the Exceeding Expectations band; a little more focus will get ${him} there ${ctx.ahead}.`
        : `Consistent revision will help ${n} move towards the upper part of the Meeting Expectations band ${ctx.ahead}.`;
    return [
      band,
      `Keep setting higher personal targets.`,
      `Regular revision and extra reading will unlock even better results.`,
      `Keep up the effort and aim for the next performance band.`,
    ];
  }
  if (p.tier === "AE") {
    return [
      `Regular practice at home and consultation with subject teachers will bring clear improvement.`,
      `Checking homework regularly and taking an active part in lessons are recommended.`,
      `Focused revision during ${ctx.breakWord} will help bridge the learning gaps.`,
      `With steady practice, moving into the Meeting Expectations band is achievable.`,
    ];
  }
  return [
    `Close cooperation between home and school will support ${his} progress.`,
    `Extra support sessions with teachers and short daily practice at home are recommended.`,
    `We recommend a meeting with parents or guardians to agree on a support plan.`,
    `Encouragement, daily reading and regular follow-up at home will make a big difference.`,
    `Early support and regular practice will help restore ${his} confidence and progress.`,
  ];
}

export function getSmartTeacherRemark(result, options = {}) {
  const p = getLearnerProfile(result, options);
  if (!p) return options.fallback ?? "";

  const op = teacherOpenings(p);
  const dg = teacherDiagnostics(p);
  const opening = p.pick(`teacher.opening.${p.tier}.${op.key}`, op.pool);
  const diagnostic = p.pick(`teacher.diagnostic.${p.tier}.${dg.key}`, dg.pool);
  const closing = p.pick(`teacher.closing.${p.tier}`, teacherClosings(p));
  const attendance = getAttendanceClause(p, options);
  const position = getPositionClause(p, options);

  return assemble(
    p,
    [
      ["opening", opening],
      ["attendance", attendance],
      ["diagnostic", diagnostic],
      ["position", position],
      ["closing", closing],
    ],
    ["position", "attendance"],
    options.maxWords || 80
  );
}

// ---------------------------------------------------------------------------
// Principal remark
// ---------------------------------------------------------------------------

export function getSmartPrincipalRemark(result, options = {}) {
  const p = getLearnerProfile(result, options);
  if (!p) return options.fallback ?? "";
  const { firstName: n, pronoun: he, possessive: his, ctx } = p;
  const best = p.best;

  const openings = {
    EE: [
      `Excellent achievement!`,
      `Outstanding results this term.`,
      `Exemplary performance this term.`,
      `Distinguished academic progress.`,
      `Superb results across the curriculum.`,
    ],
    ME: [
      `Commendable results this term.`,
      `A solid and encouraging performance.`,
      `Good progress across the learning areas.`,
      `An encouraging set of results.`,
      `Steady, satisfactory progress.`,
    ],
    AE: [
      `Fair results this term, with room to grow.`,
      `A fair attempt, and ${n} is capable of more.`,
      `Progress is evident in places, with more to achieve.`,
      `Moderate results that can improve with regular practice.`,
    ],
    BE: [
      `Results are currently below the expected level.`,
      `This term's results show that extra support is needed.`,
      `${n} needs focused support to reach the expected level.`,
      `Support is needed to help ${n} progress.`,
    ],
  };

  const anchors = best
    ? {
        EE: [
          `Particularly strong in ${best}.`,
          `Especially notable results in ${best}.`,
          `Outstanding work in ${best} sets a high standard.`,
        ],
        ME: [
          `${best} is a clear strength to build on.`,
          `Good results in ${best} show what ${he} can achieve.`,
          `Strong work in ${best} provides a firm base for further growth.`,
        ],
        AE: [
          `${best} is a good base to build on.`,
          `Encouraging results in ${best} show what regular effort can achieve.`,
          `Progress in ${best} shows potential in other subjects too.`,
        ],
        BE: [
          `${best} is the best starting point for rebuilding confidence.`,
          `Support should begin with ${best} and extend to the basics in all learning areas.`,
          `A step-by-step plan, starting with ${best}, is recommended.`,
        ],
      }
    : null;

  const directives = {
    EE: [
      `${n} is warmly commended for this excellent performance.`,
      `Congratulations to ${n} on a term of excellent results; keep up the momentum ${ctx.ahead}.`,
      `The school is proud of ${n}'s results; keep up the good work ${ctx.ahead}.`,
      `${n} is encouraged to keep aiming high and to support classmates where possible.`,
    ],
    ME: [
      `With a little more focus in the weaker areas, ${n} can reach the top band.`,
      `${n} is encouraged to keep going and aim higher ${ctx.ahead}.`,
      `Regular revision and higher personal targets will help ${n} reach even better results.`,
      `Sustained effort will help ${n} move into the Exceeding Expectations band.`,
    ],
    AE: [
      `${n} can achieve more with regular study at home and focused practice in the weaker subjects.`,
      `Improvement is expected ${ctx.ahead}; regular practice and teacher consultation will help.`,
      `Prompt completion of assignments and targeted revision in the weaker subjects are recommended.`,
      `${n} is encouraged to make full use of teacher support ${ctx.ahead}.`,
    ],
    BE: [
      `Parents or guardians are invited to meet the school so that a support plan can be agreed for ${n}.`,
      `Regular support at school and close follow-up at home are recommended.`,
      `Working together, home and school can help ${n} build the foundational competencies.`,
      `${n} will benefit from extra support sessions and regular supervised practice at home.`,
    ],
  };

  const part1 = p.pick(`principal.opening.${p.tier}`, openings[p.tier]);
  const anchor = anchors ? p.pick(`principal.anchor.${p.tier}`, anchors[p.tier]) : "";
  const part2 = p.pick(`principal.directive.${p.tier}`, directives[p.tier]);

  return assemble(p, [["opening", part1], ["anchor", anchor], ["directive", part2]], ["anchor"], options.maxWords || 60);
}

// ---------------------------------------------------------------------------
// Subject remark (short, pronoun-free, grade-first)
// ---------------------------------------------------------------------------

export function getSmartSubjectRemark(result, subjectResult, options = {}) {
  if (!subjectResult || typeof subjectResult !== "object" || !isNum(subjectResult.average)) {
    return options.fallback ?? "";
  }
  const bands = Array.isArray(options.bands) && options.bands.length ? options.bands : DEFAULT_BANDS;
  const s = parseSubjectMeta(subjectResult.name).name;
  const lvl = resolveLevel(subjectResult.grade, subjectResult.average, bands);
  const id = (result && (result.admissionNumber || result.studentId || result.fullName || result.name)) || "0";
  const { pick } = createPicker(`${id}|${s}|${Math.round(subjectResult.average)}`, options.slotPicker);

  const pools = {
    EE: [
      `Excellent grasp of the key concepts in ${s}.`,
      `Thorough understanding and strong results in ${s}.`,
      `Very strong work in ${s}.`,
      `Demonstrates a thorough grasp of ${s}.`,
    ],
    ME: [
      `Good understanding of the key strands of ${s}.`,
      `Solid competence in ${s}, with potential for higher results.`,
      `Steady progress in ${s}; regular practice will raise results further.`,
      `Meets the expected level in ${s}.`,
    ],
    AE: [
      `Developing understanding in ${s}; more regular practice is needed.`,
      `Shows potential in ${s}, but some key concepts need revision.`,
      `More practice on challenging topics in ${s} will help.`,
      `Approaching the expected level in ${s}; regular exercises are recommended.`,
    ],
    BE: [
      `Needs extra support to build the basic concepts in ${s}.`,
      `Step-by-step guidance and regular practice in ${s} are recommended.`,
      `Foundational concepts in ${s} should be revisited with teacher support.`,
      `Still building basic skills in ${s}; extra support will help.`,
    ],
  };
  return pick(`subject.${lvl.tier}`, pools[lvl.tier]);
}

// ---------------------------------------------------------------------------
// Parent remark (speaks to the parent/guardian, plain language, actions at home)
// ---------------------------------------------------------------------------

export function getSmartParentRemark(result, options = {}) {
  const p = getLearnerProfile(result, options);
  if (!p) return options.fallback ?? "";
  const { firstName: n, possessive: his, objPronoun: him, ctx } = p;
  const strongIn = p.best ? `with particularly strong results in ${p.best}` : `with strong results across the learning areas`;
  const W = p.needsAttention ? p.lowestSubject.name : null;

  const pools = {
    EE: [
      `${n} has had an excellent term, ${strongIn}. At home, you can keep ${his} curiosity alive with interesting books and problem-solving activities.`,
      `Congratulations on ${n}'s excellent results this term, ${strongIn}. Praising ${his} effort and keeping a balance between study, rest and play will help ${him} stay motivated.`,
      `${n} has performed with great distinction. Celebrate ${his} achievement, and keep providing quiet study time and access to books and learning resources at home.`,
    ],
    ME: [
      `${n} has had a solid term, ${strongIn}.${W ? ` Setting aside about 30 minutes a day to revise ${W} at home will help ${him} move up.` : ` A regular evening revision routine will help ${him} reach even higher results.`}`,
      `We are pleased with ${n}'s steady progress, ${strongIn}.${W ? ` You can help by checking ${his} homework in ${W} and encouraging short daily practice.` : ` Reviewing assignments together and offering encouragement will build ${his} confidence.`}`,
      `${n} is meeting expectations, ${strongIn}.${W ? ` Working together to monitor practice in ${W} will make a noticeable difference.` : ` Your continued encouragement will help keep ${his} progress going.`}`,
    ],
    AE: [
      `${n} shows promise${p.best ? `, especially in ${p.best}` : ""}, but needs more support${W ? ` in ${W}` : ""}. A quiet, regular home study timetable and checking that homework is completed will help.`,
      `${n} has made a fair effort this term. To help ${him} reach ${his} potential, please encourage daily revision and regular reading${W ? `, with extra practice in ${W}` : ""}, and limit distractions during study time.`,
      `There is clear room for ${n} to improve, and with support at home this is achievable. Encouraging ${him} to review class notes daily and to ask teachers about difficult topics will build confidence ${ctx.ahead}.`,
    ],
    BE: [
      `${n} found this term challenging and needs extra support. We kindly invite you to meet us so that we can agree on a support plan together, and to encourage short daily study sessions at home.`,
      `We want the best for ${n}. The results show that foundational skills need strengthening. Daily reading and number practice at home, together with support sessions at school, will help.`,
      `${n} will benefit from close support from both home and school to rebuild confidence in the core competencies. Please work with ${his} teachers to follow up on homework and offer steady encouragement.`,
    ],
  };
  return finalize(p, p.pick(`parent.${p.tier}`, pools[p.tier]));
}

// ---------------------------------------------------------------------------
// Class-level generation (no repeated phrase in a slot until the pool is used up)
// ---------------------------------------------------------------------------

/**
 * Pass the whole class. Output array matches the input order.
 * Learners are processed in a stable sorted order (by admission number), so re-running the same
 * roster gives the same text. Adding or removing learners can change who gets which phrase.
 */
export function generateClassRemarks(results, options = {}) {
  const list = Array.isArray(results) ? results : [];
  const idOf = (r) => String(r?.admissionNumber ?? r?.studentId ?? r?.fullName ?? r?.name ?? "");
  const order = list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => idOf(a.r).localeCompare(idOf(b.r), "en", { numeric: true }) || a.i - b.i);

  const slotPicker = createSlotBag(options.classSeed || "class");
  const opts = { ...options, slotPicker };
  const out = new Array(list.length);

  for (const { r, i } of order) {
    out[i] = {
      teacher: getSmartTeacherRemark(r, opts),
      principal: getSmartPrincipalRemark(r, opts),
      parent: getSmartParentRemark(r, opts),
      subjects: (Array.isArray(r?.subjects) ? r.subjects : []).map((s) => ({
        name: s?.name,
        remark: getSmartSubjectRemark(r, s, opts),
      })),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// QA
// ---------------------------------------------------------------------------

/** Returns a list of problems found in generated text (empty array = clean). */
export function lintRemark(text) {
  const issues = [];
  const t = String(text ?? "");
  if (/\$\{/.test(t)) issues.push("unresolved template placeholder");
  if (/\{\w+\}/.test(t)) issues.push("unresolved synonym token");
  if (/undefined|NaN|null/.test(t)) issues.push("undefined/NaN/null in text");
  if (/\b(\w+)\s+\1\b/i.test(t)) issues.push("repeated word");
  if (/\b(\w+) (?:and|or) \1\b/i.test(t)) issues.push("same word on both sides of and/or");
  if (/\s{2,}/.test(t)) issues.push("double space");
  if (/\b[Tt]hey (?:is|has|\w+[^s\W]s)\b/.test(t) || /\b[Tt]hey (?:excels|shows|performs|needs|demonstrates|does)\b/.test(t)) {
    issues.push("possible singular verb after 'they'");
  }
  if (/\d+\.\d{2,}%/.test(t)) issues.push("unrounded percentage");
  if (/(^|[.!?]\s)[a-z]/.test(t)) issues.push("sentence starts lowercase");
  return issues;
}