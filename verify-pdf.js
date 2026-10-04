import { Window } from 'happy-dom';
import fs from 'fs';

const window = new Window({ url: 'http://localhost' });
global.window = window;
global.document = window.document;
global.Image = window.Image;

// Mock URL.createObjectURL
global.URL.createObjectURL = () => 'blob:http://localhost/mock';

// Dynamic import of the utility
import('./js/services/pdf-vector.util.js').then(async (module) => {
  const { renderReportCardVectorPdf } = module;
  
  const mockSettings = {
    schoolName: "Test Verification Academy",
    motto: "Aiming for Excellence",
    address: "123 Verification St",
    phone: "+254 700 000 000",
    principalName: "Jane Doe",
    principalTitle: "Chief Principal"
  };

  const mockReportData = {
    fullName: "John Smith",
    admissionNumber: "ADM/2026/001",
    grade: "Grade 7",
    stream: "Blue",
    gender: "Male",
    kcpeNumber: "123456789",
    term: "Term 1",
    academicYear: "2026",
    _reportModeLabel: "Average",
    _positionScopeLabel: "Overall Position",
    _isStreamView: false,
    totalMarks: 450.5,
    totalOutOf: 500,
    meanMarks: 90.1,
    meanGrade: "EE1",
    totalPoints: 45,
    overallPosition: 1,
    classSize: 100,
    subjects: [
      { name: "Mathematics", average: 92.5, grade: "EE1", points: 10, position: 2, computedRemark: "Excellent", teacherInitials: "M.T." },
      { name: "English", average: 88.0, grade: "EE2", points: 9, position: 5, computedRemark: "Very Good", teacherInitials: "E.T." }
    ],
    pathwayBreakdown: [
      { pathway: "STEM", percentage: 91, points: 19 }
    ],
    teacherRemark: "A brilliant performance.",
    principalRemark: "Keep it up.",
    _formatKES: (val) => "KES " + val,
    _formatDate: (val) => val,
    _feeSummary: { balance: 1500 }
  };

  try {
    const blob = await renderReportCardVectorPdf(mockReportData, mockSettings);
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync('verification-sample.pdf', buffer);
    console.log('SUCCESS: PDF generated successfully! Saved to verification-sample.pdf');
    process.exit(0);
  } catch (err) {
    console.error('ERROR generating PDF:', err);
    process.exit(1);
  }
}).catch(err => {
  console.error('ERROR loading module:', err);
  process.exit(1);
});