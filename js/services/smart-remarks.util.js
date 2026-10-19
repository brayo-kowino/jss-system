/**
 * Smart Remarks Engine for JSS / CBC Student Report Cards.
 * Generates highly contextual, professional, and personalized remarks for Class Teachers
 * and Heads of Institution without external AI API calls or rate limits.
 *
 * Evaluates:
 * - Learner's first name & gender pronouns
 * - Overall performance tier (Exceeding, Meeting, Approaching, Below Expectations)
 * - Standout strength subjects
 * - Lagging subjects needing attention / remediation
 * - Phrasing variations to ensure adjacent learners have distinct comments
 */

function cleanSubjectName(name) {
  if (!name) return "Core Subjects";
  let clean = name.trim();
  // Strip parenthetical codes like "(C.R.E)" or "(P.H.E)"
  clean = clean.replace(/\s*\([A-Z0-9.\s-]+\)\s*$/i, "").trim();
  // Common cleanups
  const lower = clean.toLowerCase();
  if (lower.includes("christian") || /\bcre\b/i.test(clean)) return "Christian Religious Education";
  if (lower.includes("islamic") || /\bire\b/i.test(clean)) return "Islamic Religious Education";
  if (lower.includes("creative")) return "Creative Arts & Sports";
  if (lower.includes("pre-technical") || lower.includes("pre technical")) return "Pre-Technical Studies";
  if (lower.includes("integrated science")) return "Integrated Science";
  if (lower.includes("social studies")) return "Social Studies";
  if (lower.includes("agriculture")) return "Agriculture";
  return clean;
}

function getLearnerProfile(result) {
  const rawName = (result.fullName || "").trim();
  const firstName = rawName.split(/\s+/)[0] || "The learner";
  const capitalizedFirst = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

  const g = (result.gender || "").toLowerCase().trim();
  const isBoy = g === "male" || g === "boy" || g === "m";
  const isGirl = g === "female" || g === "girl" || g === "f";

  const pronoun = isBoy ? "he" : isGirl ? "she" : "the learner";
  const Pronoun = isBoy ? "He" : isGirl ? "She" : "The learner";
  const possessive = isBoy ? "his" : isGirl ? "her" : "their";
  const Possessive = isBoy ? "His" : isGirl ? "Her" : "Their";
  const objPronoun = isBoy ? "him" : isGirl ? "her" : "them";

  // Subjects breakdown
  const rawSubjects = Array.isArray(result.subjects) ? result.subjects : [];
  const validSubjects = rawSubjects
    .filter((s) => s && typeof s.average === "number" && !isNaN(s.average))
    .map((s) => ({
      name: cleanSubjectName(s.name),
      average: s.average,
      grade: (s.grade || "").toUpperCase().trim(),
    }))
    .sort((a, b) => b.average - a.average);

  const bestSubject = validSubjects[0] || null;
  const secondBest = validSubjects[1] || null;
  const lowestSubject = validSubjects.length > 1 ? validSubjects[validSubjects.length - 1] : null;
  const secondLowest = validSubjects.length > 2 ? validSubjects[validSubjects.length - 2] : null;

  // Determine overall performance tier (CBC precedence before traditional letter grades)
  const meanGrade = (result.meanGrade || "").toUpperCase().trim();
  const meanMarks = typeof result.meanMarks === "number" ? result.meanMarks : 50;

  let tier = "ME"; // Default Meeting Expectations
  if (meanGrade.startsWith("EE")) {
    tier = "EE";
  } else if (meanGrade.startsWith("BE")) {
    tier = "BE";
  } else if (meanGrade.startsWith("ME")) {
    tier = "ME";
  } else if (meanGrade.startsWith("AE")) {
    tier = "AE";
  } else if (meanGrade.startsWith("A") || meanMarks >= 75) {
    tier = "EE";
  } else if (meanGrade.startsWith("B") || meanGrade === "C+" || meanMarks >= 50) {
    tier = "ME";
  } else if (meanGrade.startsWith("C") || meanGrade === "D+" || meanMarks >= 35) {
    tier = "AE";
  } else {
    tier = "BE";
  }

  // Determine if lowest subject genuinely trails or needs focused attention
  let needsAttention = false;
  if (lowestSubject) {
    const gap = meanMarks - lowestSubject.average;
    const isLowGrade = lowestSubject.grade.startsWith("AE") || lowestSubject.grade.startsWith("BE") || lowestSubject.average < 50;
    if (gap >= 8 || isLowGrade || tier === "AE" || tier === "BE") {
      needsAttention = true;
    }
  }

  // Deterministic seed variant (0, 1, or 2) based on admission number or name
  const seedStr = String(result.admissionNumber || result.studentId || rawName || "0");
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) % 1000;
  }
  const variant = Math.abs(hash) % 3;

  return {
    firstName: capitalizedFirst,
    pronoun,
    Pronoun,
    possessive,
    Possessive,
    objPronoun,
    tier,
    bestSubject,
    secondBest,
    lowestSubject,
    secondLowest,
    needsAttention,
    variant,
  };
}

/**
 * Generates an instructional, subject-aware Class Teacher remark.
 */
export function getSmartTeacherRemark(result) {
  if (!result) return "Good performance. Keep working hard.";
  const p = getLearnerProfile(result);

  const bestName = p.bestSubject ? p.bestSubject.name : "core subjects";
  const secondBestName = p.secondBest ? p.secondBest.name : "learning activities";
  const lowestName = p.lowestSubject ? p.lowestSubject.name : "weaker areas";

  switch (p.tier) {
    case "EE": // Exceeding Expectations
      if (p.needsAttention && p.lowestSubject) {
        if (p.variant === 0) {
          return `${p.firstName} has demonstrated outstanding mastery this term, particularly in ${bestName}. With consistent dedication in ${lowestName}, ${p.pronoun} will easily sustain an all-round stellar performance.`;
        } else if (p.variant === 1) {
          return `Remarkable results across the curriculum. ${p.firstName} excels in ${bestName}; putting a little extra study time into ${lowestName} will make ${p.possessive} achievement truly unbeatable.`;
        } else {
          return `${p.firstName} possesses strong academic potential and has performed brilliantly in ${bestName}. Extra focus in ${lowestName} will guarantee an all-round top grade.`;
        }
      } else {
        if (p.variant === 0) {
          return `An exemplary performance by ${p.firstName}. ${p.Pronoun} exhibits superior intellectual curiosity and mastery in ${bestName} and ${secondBestName}. Commended for consistent academic excellence.`;
        } else if (p.variant === 1) {
          return `${p.firstName} has maintained exceptionally high standards throughout the term, displaying commendable mastery across all learning areas, especially ${bestName}. Keep it up!`;
        } else {
          return `Outstanding work this term! ${p.firstName} continues to show exemplary discipline and top-tier competence in ${bestName}. A model learner in the class.`;
        }
      }

    case "ME": // Meeting Expectations
      if (p.needsAttention && p.lowestSubject) {
        if (p.variant === 0) {
          return `${p.firstName} has performed well this term with commendable effort in ${bestName}. However, more focused revision and homework practice in ${lowestName} are required to boost ${p.possessive} overall grade.`;
        } else if (p.variant === 1) {
          return `A solid and encouraging performance. ${p.firstName} shows great promise in ${bestName}; paying closer attention to challenging concepts in ${lowestName} will unlock higher grades.`;
        } else {
          return `${p.firstName} exhibits a good grasp of concepts, particularly in ${bestName}. Putting more consistent study hours into ${lowestName} will yield noticeable improvement next term.`;
        }
      } else {
        if (p.variant === 0) {
          return `${p.firstName} has posted commendable results this term, demonstrating steady competence in ${bestName} and ${secondBestName}. Regular revision will help ${p.objPronoun} reach the top tier.`;
        } else if (p.variant === 1) {
          return `Good academic progress shown by ${p.firstName}. ${p.Pronoun} participates actively and has maintained good standing in ${bestName}. Keep aiming for greater heights.`;
        } else {
          return `A steady and satisfactory term. ${p.firstName} has shown commendable dedication in ${bestName}. Strive for even higher targets next term.`;
        }
      }

    case "AE": // Approaching Expectations
      if (p.needsAttention && p.lowestSubject) {
        if (p.variant === 0) {
          return `Fair effort, but ${p.firstName} is capable of much better. While ${p.possessive} performance in ${bestName} is encouraging, urgent attention and remedial revision are needed in ${lowestName}.`;
        } else if (p.variant === 1) {
          return `${p.firstName} shows promising ability in ${bestName}, but inconsistent preparation has pulled down ${p.possessive} scores in ${lowestName}. Daily revision is strongly recommended.`;
        } else {
          return `Below ${p.possessive} true potential. Encouraging attempt in ${bestName}, but targeted revision and homework supervision in ${lowestName} are vital for progress.`;
        }
      } else {
        if (p.variant === 0) {
          return `${p.firstName} has achieved a fair performance, but needs to embrace a more disciplined study schedule. Consistent completion of class assignments will bring improvement.`;
        } else if (p.variant === 1) {
          return `An average term's work. ${p.firstName} must avoid complacency, seek teacher guidance in challenging areas, and practice daily to raise ${p.possessive} academic standing.`;
        } else {
          return `${p.firstName} has the potential to do well, but needs to focus more during class and complete homework promptly. Improvement is expected next term.`;
        }
      }

    case "BE": // Below Expectations
    default:
      if (p.needsAttention && p.lowestSubject) {
        if (p.variant === 0) {
          return `${p.firstName} is currently performing below expected competencies. Serious dedication, daily remedial sessions, and close homework monitoring in ${lowestName} are urgently needed.`;
        } else if (p.variant === 1) {
          return `Critical academic intervention is necessary. ${p.firstName} must establish strict study routines, with immediate focus on understanding foundational concepts in ${lowestName}.`;
        } else {
          return `Well below standard for ${p.firstName}. While an initial attempt was made in ${bestName}, comprehensive remedial intervention in ${lowestName} is essential before next term.`;
        }
      } else {
        if (p.variant === 0) {
          return `Unsatisfactory progress this term. ${p.firstName} requires close supervision at home and dedicated remedial support at school to bridge learning gaps.`;
        } else if (p.variant === 1) {
          return `${p.firstName} has struggled to meet curriculum benchmarks this term. Immediate consultation between parent and teacher is advised to support recovery.`;
        } else {
          return `Needs urgent academic awakening and stricter supervision. ${p.firstName} must take studies more seriously to avoid falling further behind.`;
        }
      }
  }
}

/**
 * Generates an executive, institutional remark for the Head of Institution / Principal.
 */
export function getSmartPrincipalRemark(result) {
  if (!result) return "Commendable results. Keep aiming higher.";
  const p = getLearnerProfile(result);

  switch (p.tier) {
    case "EE":
      if (p.variant === 0) {
        return `Exceptional achievement. ${p.firstName} is warmly commended for academic excellence, discipline, and exemplary leadership. Keep up the high standard!`;
      } else if (p.variant === 1) {
        return `Outstanding results! A stellar performance that reflects dedication and hard work. Congratulations on being among our top scholars.`;
      } else {
        return `Exemplary academic progress. ${p.firstName} continues to set a worthy pace for others. Maintain this standard of excellence.`;
      }

    case "ME":
      if (p.variant === 0) {
        return `Commendable results. With slightly more discipline and dedication in weaker learning areas, ${p.firstName} can easily reach the top band.`;
      } else if (p.variant === 1) {
        return `Good performance. ${p.firstName} shows commendable industry and potential. Keep striving for higher academic milestones.`;
      } else {
        return `A very encouraging outcome. Maintain this positive momentum and aim for distinction next term.`;
      }

    case "AE":
      if (p.variant === 0) {
        return `Average performance. ${p.firstName} has the ability to achieve much more with structured study at home and active engagement in class.`;
      } else if (p.variant === 1) {
        return `Fair attempt, but substantial improvement is required. ${p.firstName} must embrace academic discipline and step up effort next term.`;
      } else {
        return `Below the school's expected target. Greater focus, punctuality with assignments, and regular revision are strongly advised.`;
      }

    case "BE":
    default:
      if (p.variant === 0) {
        return `Unsatisfactory results. Parent/guardian is requested to schedule an academic review meeting to formulate a recovery plan.`;
      } else if (p.variant === 1) {
        return `Well below acceptable institutional benchmark. Strict academic monitoring and targeted remedial intervention are mandatory.`;
      } else {
        return `Substandard performance. Urgent intervention at school and home is required to help ${p.firstName} meet foundational competencies.`;
      }
  }
}
