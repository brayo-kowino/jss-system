let jsPDFPromise = null;
function loadJsPDF() {
  if (!jsPDFPromise) {
    jsPDFPromise = import("jspdf").then(m => m.jsPDF || m.default);
  }
  return jsPDFPromise;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}

export async function renderReportCardVectorPdf(reportData, settings, opts = {}) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
  
  // Define crispness/styling defaults
  doc.setLineWidth(0.75); // Makes table borders thicker and more defined (default is ~0.56)

  const A4_W = 595.28;
  const A4_H = 841.89;
  const MARGIN_X = 28;
  const MARGIN_TOP = 28;
  const MARGIN_BOT = 20;
  
  let currentY = MARGIN_TOP;
  const primaryColor = hexToRgb("#14538A");     // Backgrounds (Banner)
  const headerTextColor = hexToRgb("#0D3559");  // Text (Darker Navy for higher contrast/crispness)
  const goldColor = hexToRgb("#C9A227");

  // 1. School Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(headerTextColor.r, headerTextColor.g, headerTextColor.b);
  
  // Try to load and add logo
  if (settings.logoUrl) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = settings.logoUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        setTimeout(reject, 3000);
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      
      // Preserve aspect ratio to prevent stretching/blurring
      const aspect = img.width / img.height;
      let w = 40; let h = 40;
      if (aspect > 1) { h = w / aspect; } else { w = h * aspect; }
      
      doc.addImage(dataUrl, "PNG", MARGIN_X, currentY + (40 - h) / 2, w, h);
    } catch (e) {
      // ignore logo errors
    }
  }

  const textCenterX = A4_W / 2;
  doc.text(settings.schoolName || "School Name", textCenterX, currentY + 14, { align: "center" });
  
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(settings.motto || "", textCenterX, currentY + 28, { align: "center" });
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text([settings.address, settings.phone].filter(Boolean).join(" · "), textCenterX, currentY + 40, { align: "center" });
  
  currentY += 56;
  
  // 2. Term Banner
  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(MARGIN_X, currentY, A4_W - MARGIN_X * 2, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  const bannerText = `${reportData.term} ${reportData.academicYear}: ${reportData._reportModeLabel}`;
  doc.text(bannerText, textCenterX, currentY + 14, { align: "center" });
  
  currentY += 32;
  
  // 3. Student Info Table
  doc.setTextColor(0, 0, 0);
  const infoWidth = A4_W - MARGIN_X * 2;
  const colW = infoWidth / 4;
  const rowH = 16;
  
  const drawInfoRow = (l1, v1, l2, v2, y) => {
    doc.setFont("helvetica", "bold");
    doc.text(l1, MARGIN_X + 4, y + 12);
    doc.setFont("helvetica", "normal");
    doc.text(String(v1), MARGIN_X + colW + 4, y + 12);
    doc.setFont("helvetica", "bold");
    doc.text(l2, MARGIN_X + colW * 2 + 4, y + 12);
    doc.setFont("helvetica", "normal");
    doc.text(String(v2), MARGIN_X + colW * 3 + 4, y + 12);
    
    doc.setDrawColor(200, 200, 200);
    doc.rect(MARGIN_X, y, infoWidth, rowH);
    doc.line(MARGIN_X + colW, y, MARGIN_X + colW, y + rowH);
    doc.line(MARGIN_X + colW * 2, y, MARGIN_X + colW * 2, y + rowH);
    doc.line(MARGIN_X + colW * 3, y, MARGIN_X + colW * 3, y + rowH);
  };
  
  doc.setFontSize(9);
  drawInfoRow("Name", reportData.fullName || "N/A", "Adm No", reportData.admissionNumber || "N/A", currentY);
  currentY += rowH;
  drawInfoRow("Class", `${reportData.grade}${reportData.stream ? " " + reportData.stream : ""}`, "Gender", reportData.gender || "N/A", currentY);
  currentY += rowH;
  drawInfoRow("Exam", reportData._reportModeLabel, "Assessment No", reportData.kcpeNumber || "N/A", currentY);
  currentY += rowH + 16;
  
  // 4. Performance Summary
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(headerTextColor.r, headerTextColor.g, headerTextColor.b);
  doc.text("Performance Summary", MARGIN_X, currentY);
  currentY += 8;
  
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  const sumCols = 5;
  const sumColW = infoWidth / sumCols;
  const sumHeaders = ["Total Marks", "Mean Marks", "Mean Grade", "Total Pts", reportData._positionScopeLabel];
  const cardPos = reportData._isStreamView ? reportData.classPosition : reportData.overallPosition;
  const cardSize = reportData._isStreamView ? reportData.streamClassSize : reportData.classSize;
  const sumValues = [
    `${(reportData.totalMarks || 0).toFixed(1)}/${reportData.totalOutOf}`,
    `${(reportData.meanMarks || 0).toFixed(2)}%`,
    reportData.meanGrade || "N/A",
    String(reportData.totalPoints),
    `${cardPos}/${cardSize}`
  ];
  
  // Header row
  doc.setFillColor(240, 245, 250);
  doc.rect(MARGIN_X, currentY, infoWidth, rowH, "F");
  doc.setFont("helvetica", "bold");
  sumHeaders.forEach((h, i) => doc.text(h, MARGIN_X + i * sumColW + 4, currentY + 12));
  currentY += rowH;
  
  // Value row
  doc.setFont("helvetica", "normal");
  doc.setDrawColor(200, 200, 200);
  doc.rect(MARGIN_X, currentY - rowH, infoWidth, rowH * 2);
  sumValues.forEach((v, i) => {
    doc.text(v, MARGIN_X + i * sumColW + 4, currentY + 12);
    if (i > 0) {
      doc.line(MARGIN_X + i * sumColW, currentY - rowH, MARGIN_X + i * sumColW, currentY + rowH);
    }
  });
  currentY += rowH + 16;
  
  // 5. Subject Performance Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(headerTextColor.r, headerTextColor.g, headerTextColor.b);
  doc.text("Subject Performance", MARGIN_X, currentY);
  currentY += 8;
  
  const showMidEnd = (reportData.reportMode || "average") === "average";
  
  let subjHeaders = ["Subject"];
  if (showMidEnd) subjHeaders.push("Midt", "End");
  subjHeaders.push("Score", "Grade", "Pts", "Rank", "Remarks", "Teacher");
  
  const sCount = subjHeaders.length;
  // Let Subject and Remarks take more space
  const subjColWs = [];
  const remW = infoWidth - 280;
  let remainingW = infoWidth;
  
  if (showMidEnd) {
    subjColWs.push(110); // Subject
    subjColWs.push(35); // Midt
    subjColWs.push(35); // End
    subjColWs.push(40); // Score
    subjColWs.push(40); // Grade
    subjColWs.push(30); // Pts
    subjColWs.push(40); // Rank
    subjColWs.push(infoWidth - 110 - 35 - 35 - 40 - 40 - 30 - 40 - 45); // Remarks
    subjColWs.push(45); // Teacher
  } else {
    subjColWs.push(150); // Subject
    subjColWs.push(40); // Score
    subjColWs.push(40); // Grade
    subjColWs.push(30); // Pts
    subjColWs.push(40); // Rank
    subjColWs.push(infoWidth - 150 - 40 - 40 - 30 - 40 - 45); // Remarks
    subjColWs.push(45); // Teacher
  }

  doc.setFillColor(240, 245, 250);
  doc.rect(MARGIN_X, currentY, infoWidth, rowH, "F");
  doc.setDrawColor(200, 200, 200);
  doc.rect(MARGIN_X, currentY, infoWidth, rowH);
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  
  let cx = MARGIN_X;
  subjHeaders.forEach((h, i) => {
    doc.text(h, cx + 4, currentY + 12);
    if (i > 0) doc.line(cx, currentY, cx, currentY + rowH);
    cx += subjColWs[i];
  });
  currentY += rowH;
  
  const subjects = [...(reportData.subjects || [])].sort((a, b) => a.name.localeCompare(b.name));
  doc.setFont("helvetica", "normal");
  subjects.forEach(s => {
    if (currentY > A4_H - 100) {
      doc.addPage();
      currentY = MARGIN_TOP;
    }
    
    doc.rect(MARGIN_X, currentY, infoWidth, rowH);
    cx = MARGIN_X;
    
    let vals = [s.name];
    if (showMidEnd) {
      vals.push(s.midtScore == null ? "" : s.midtScore.toFixed(1));
      vals.push(s.endScore == null ? "" : s.endScore.toFixed(1));
    }
    vals.push(s.average == null ? "" : s.average.toFixed(1));
    vals.push(s.grade || "");
    vals.push(String(s.points || "0"));
    vals.push(reportData._isStreamView ? `${s.classPosition}/${cardSize}` : `${s.position}/${cardSize}`);
    vals.push(s.computedRemark || "");
    vals.push(s.teacherInitials || "");
    
    vals.forEach((v, i) => {
      if (i > 0) doc.line(cx, currentY, cx, currentY + rowH);
      doc.text(v.substring(0, 30), cx + 4, currentY + 12);
      cx += subjColWs[i];
    });
    
    currentY += rowH;
  });
  currentY += 16;
  
  // 6. Remarks Section
  const drawRemarkBox = (title, content, signer, titleRole) => {
    if (currentY > A4_H - 120) { doc.addPage(); currentY = MARGIN_TOP; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(headerTextColor.r, headerTextColor.g, headerTextColor.b);
    doc.text(title, MARGIN_X, currentY);
    currentY += 6;
    
    const boxH = 48;
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(250, 250, 250);
    doc.rect(MARGIN_X, currentY, infoWidth, boxH, "FD");
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const splitText = doc.splitTextToSize(content || "No remarks recorded.", infoWidth - 8);
    doc.text(splitText, MARGIN_X + 4, currentY + 12);
    
    currentY += boxH + 12;
    doc.text("Sign: .......................................   Date: .......................", MARGIN_X, currentY);
    doc.setFont("helvetica", "bold");
    if (signer) {
      doc.text(`${signer}, ${titleRole}`, MARGIN_X, currentY + 12);
    } else {
      doc.text(titleRole, MARGIN_X, currentY + 12);
    }
    currentY += 24;
  };
  
  drawRemarkBox("Class Teacher Remarks", reportData.teacherRemark, reportData._classTeacherName || "", "Class Teacher");
  drawRemarkBox("Principal Remarks", reportData.principalRemark, settings.principalName || "", settings.principalTitle || "Principal");
  
  // 7. Fee Balance Line
  if (reportData._feeSummary) {
    if (currentY > A4_H - 40) { doc.addPage(); currentY = MARGIN_TOP; }
    doc.setFont("helvetica", "bold");
    doc.text(`Fee Balance: ${reportData._formatKES(reportData._feeSummary.balance)}`, MARGIN_X, currentY);
    currentY += 16;
  }
  
  // 8. Term Dates
  if (settings.closingDate || settings.openingDate) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const dates = [];
    if (settings.closingDate) dates.push(`School Closes On: ${reportData._formatDate(settings.closingDate)}`);
    if (settings.openingDate) dates.push(`Next Term Begins: ${reportData._formatDate(settings.openingDate)}`);
    doc.text(dates.join("   |   "), MARGIN_X, currentY);
  }
  
  return doc.output("blob");
}
