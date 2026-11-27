import { el, formatDate, toDate } from "../utils.js";
import { CERTIFICATE_TYPES } from "./alumni.service.js";
import { positionScopeLabel, reportModeLabel } from "./grading.service.js";
import { downloadElementAsPdf, renderReportVectorPdfBlob, triggerBlobDownload } from "./pdf.util.js";

const issueDate = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Nairobi",
});

export function formatCertificateDate(timestamp) {
  const date = toDate(timestamp);
  return date ? issueDate.format(date) : "Date unavailable";
}

export function certificateArtwork(certificate) {
  const details = [
    ["Admission number", certificate.admissionNumber],
    ["Class at graduation", [certificate.grade, certificate.stream].filter(Boolean).join(" · ")],
    ["Graduation year", certificate.graduationYear],
  ].filter(([, value]) => value !== "" && value != null);
  return el("article", { class: "alumni-certificate" }, [
    el("header", {}, [
      el("p", { class: "alumni-certificate__school" }, certificate.schoolName),
      el("h1", {}, CERTIFICATE_TYPES[certificate.type]),
    ]),
    el("div", { class: "alumni-certificate__identity" }, [
      el("p", {}, certificate.type === "leaving"
        ? "The school confirms that the learner named below has left as a graduate."
        : "The school confirms that the learner named below is recorded as having graduated."),
      el("p", { class: "alumni-certificate__name" }, certificate.fullName),
    ]),
    el("dl", {}, details.map(([label, value]) => el("div", {}, [el("dt", {}, label), el("dd", {}, String(value))]))),
    el("footer", {}, [
      el("span", {}, "Authorized signature"),
      el("span", {}, "School stamp"),
    ]),
    el("div", { class: "alumni-certificate__reference" }, [
      el("span", {}, "Certificate No. " + certificate.number), el("span", {}, "Issued " + formatCertificateDate(certificate.issuedAt)),
    ]),
  ]);
}

export async function downloadAlumniCertificate(certificate) {
  const page = el("div", { class: "landscape" }, certificateArtwork(certificate));
  const mount = el("div", { class: "alumni-certificate-mount", "aria-hidden": "true" }, page);
  document.body.append(mount);
  try {
    await downloadElementAsPdf(page, certificate.number + ".pdf", { scale: 2 });
  } finally {
    mount.remove();
  }
}

export async function downloadSavedAlumniReport(result, settings) {
  const isStreamView = Boolean(result.stream);
  const report = await renderReportVectorPdfBlob({
    ...result, _reportModeLabel: reportModeLabel(result.reportMode), _positionScopeLabel: positionScopeLabel(isStreamView),
    _isStreamView: isStreamView, _formatDate: formatDate,
  }, {
    ...settings, closingDate: "", openingDate: "", teacherSignatureUrl: "", principalName: "", principalSignatureUrl: "",
  }, { historical: true });
  triggerBlobDownload(report, `${result.admissionNumber || result.studentId}_${result.term}_${result.academicYear}_${result.reportMode || "average"}.pdf`);
}
