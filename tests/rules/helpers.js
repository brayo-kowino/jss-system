import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const SCHOOL_A_ID = 'school-a';
export const SCHOOL_B_ID = 'school-b';
export const ALL_STAFF_ROLES = [
  'admin',
  'principal',
  'deputy_principal',
  'academic_master',
  'bursar',
  'class_teacher',
  'subject_teacher',
  'registrar'
];

export async function getTestEnv() {
  const projectId = 'jss-test-project';
  const rulesPath = resolve(__dirname, '../../firestore.rules');
  const rules = readFileSync(rulesPath, 'utf8');

  return await initializeTestEnvironment({
    projectId,
    firestore: { rules, host: '127.0.0.1', port: 8080 }
  });
}

export function authedDb(env, uid) {
  return env.authenticatedContext(uid).firestore();
}

export function unauthDb(env) {
  return env.unauthenticatedContext().firestore();
}

export async function seedDoc(firestoreDb, collectionPath, docId, data) {
  const docRef = doc(firestoreDb, collectionPath, docId);
  await setDoc(docRef, data);
}

export function schoolFactory(overrides = {}) {
  return {
    name: 'Test School',
    slug: 'test-school',
    status: 'active',
    subscriptionStatus: 'active',
    subscriptionPlan: 'growth',
    subscriptionExpiresAt: Timestamp.fromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)),
    subscriptionActivatedAt: Timestamp.fromDate(new Date()),
    createdAt: Timestamp.fromDate(new Date()),
    ...overrides
  };
}

export function userFactory(role, schoolId, overrides = {}) {
  return {
    fullName: 'Test User',
    email: 'test@example.com',
    role,
    schoolId,
    status: 'active',
    mustChangePassword: false,
    createdAt: Timestamp.fromDate(new Date()),
    ...overrides
  };
}

export function studentFactory(schoolId, overrides = {}) {
  return {
    schoolId,
    fullName: 'John Doe',
    admissionNumber: '1234',
    grade: 'Grade 7',
    stream: 'A',
    status: 'active',
    ...overrides
  };
}

export function teacherFactory(schoolId, overrides = {}) {
  return {
    schoolId,
    userId: 'some-user-id',
    fullName: 'Jane Smith',
    teacherNumber: 'T001',
    tscNumber: '12345',
    subjectCodes: ['MATH'],
    classAssignments: [],
    status: 'active',
    ...overrides
  };
}

export function assessmentFactory(schoolId, overrides = {}) {
  return {
    schoolId,
    title: 'Mid Term Exam',
    term: 'Term 1',
    year: new Date().getFullYear(),
    status: 'draft',
    ...overrides
  };
}

export function markFactory(schoolId, assessmentId, overrides = {}) {
  return {
    schoolId,
    assessmentId,
    studentId: 'student-id',
    subjectId: 'subject-id',
    score: 85,
    ...overrides
  };
}

export function resultFactory(schoolId, overrides = {}) {
  return {
    schoolId,
    studentId: 'student-id',
    term: 'Term 1',
    academicYear: '2026',
    grade: 'Grade 7',
    totalMarks: 400,
    teacherRemark: '',
    principalRemark: '',
    ...overrides
  };
}

export function feeFactory(schoolId, overrides = {}) {
  return {
    schoolId,
    title: 'Term 1 Fees',
    amount: 10000,
    dueDate: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
    ...overrides
  };
}

export function feePaymentFactory(schoolId, overrides = {}) {
  return {
    schoolId,
    studentId: 'student-id',
    amount: 5000,
    paymentDate: Timestamp.fromDate(new Date()),
    receiptNumber: 'REC-1234',
    ...overrides
  };
}
