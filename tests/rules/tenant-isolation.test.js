import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getTestEnv, authedDb, seedDoc, schoolFactory, userFactory, studentFactory, teacherFactory, markFactory, feeFactory, assessmentFactory, SCHOOL_A_ID, SCHOOL_B_ID } from './helpers.js';

describe('Tenant Isolation Rules', () => {
  let env;

  beforeAll(async () => {
    env = await getTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      
      // Seed schools
      await seedDoc(adminDb, 'schools', SCHOOL_A_ID, schoolFactory());
      await seedDoc(adminDb, 'schools', SCHOOL_B_ID, schoolFactory());
      
      // Seed users
      await seedDoc(adminDb, 'users', 'admin-a', userFactory('admin', SCHOOL_A_ID));
      await seedDoc(adminDb, 'users', 'admin-b', userFactory('admin', SCHOOL_B_ID));
      
      // Seed cross-tenant data
      await seedDoc(adminDb, 'students', 'student-b', studentFactory(SCHOOL_B_ID));
      await seedDoc(adminDb, 'teachers', 'teacher-b', teacherFactory(SCHOOL_B_ID));
      await seedDoc(adminDb, 'marks', 'mark-b', markFactory(SCHOOL_B_ID, 'assessment-b'));
      await seedDoc(adminDb, 'fees', 'fee-b', feeFactory(SCHOOL_B_ID));
      await seedDoc(adminDb, 'assessments', 'assessment-b', assessmentFactory(SCHOOL_B_ID));
      await seedDoc(adminDb, 'audit_logs', 'audit-b', { schoolId: SCHOOL_B_ID, action: 'test' });
    });
  });

  it('denies School A admin reading School B students', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(getDoc(doc(db, 'students', 'student-b')));
  });

  it('denies School A admin writing students with School B schoolId', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(setDoc(doc(db, 'students', 'new-student'), studentFactory(SCHOOL_B_ID)));
  });

  it('denies School A admin reading School B teachers', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(getDoc(doc(db, 'teachers', 'teacher-b')));
  });

  it('denies School A admin reading School B marks', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(getDoc(doc(db, 'marks', 'mark-b')));
  });

  it('denies School A admin reading School B fees', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(getDoc(doc(db, 'fees', 'fee-b')));
  });

  it('denies School A admin reading School B assessments', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(getDoc(doc(db, 'assessments', 'assessment-b')));
  });

  it('denies School A admin reading School B audit logs', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(getDoc(doc(db, 'audit_logs', 'audit-b')));
  });

  it('denies School A admin updating School B student even if reassigning schoolId', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(setDoc(doc(db, 'students', 'student-b'), studentFactory(SCHOOL_A_ID), { merge: true }));
  });

  it('denies School A admin creating a super_admin user', async () => {
    const db = authedDb(env, 'admin-a');
    await assertFails(setDoc(doc(db, 'users', 'rogue-super-admin'), userFactory('super_admin', SCHOOL_A_ID)));
  });

  it('denies School A admin overwriting School B school_public doc', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await seedDoc(context.firestore(), 'school_public', 'school-b-slug', { schoolId: SCHOOL_B_ID, name: 'School B' });
    });
    const db = authedDb(env, 'admin-a');
    await assertFails(setDoc(doc(db, 'school_public', 'school-b-slug'), { schoolId: SCHOOL_A_ID, name: 'Hijacked' }, { merge: true }));
  });
});
