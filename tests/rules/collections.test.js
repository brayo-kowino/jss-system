import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore';
import { 
  getTestEnv, authedDb, seedDoc, schoolFactory, userFactory, 
  studentFactory, teacherFactory, assessmentFactory, markFactory, 
  resultFactory, feeFactory, feePaymentFactory, SCHOOL_A_ID 
} from './helpers.js';

describe('Operational Collections Rules', () => {
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
      await seedDoc(adminDb, 'schools', SCHOOL_A_ID, schoolFactory());
    });
  });

  async function seedUser(uid, role) {
    await env.withSecurityRulesDisabled(async (context) => {
      await seedDoc(context.firestore(), 'users', uid, userFactory(role, SCHOOL_A_ID));
    });
    return authedDb(env, uid);
  }

  describe('Students', () => {
    it('allows Admin and Class_teacher to create/update students in own school', async () => {
      const adminDb = await seedUser('admin-1', 'admin');
      const teacherDb = await seedUser('teacher-1', 'class_teacher');
      
      await assertSucceeds(setDoc(doc(adminDb, 'students', 'student-1'), studentFactory(SCHOOL_A_ID)));
      await assertSucceeds(setDoc(doc(teacherDb, 'students', 'student-2'), studentFactory(SCHOOL_A_ID)));
      
      await assertSucceeds(updateDoc(doc(adminDb, 'students', 'student-1'), { firstName: 'Updated' }));
    });

    it('denies Subject_teacher and Bursar creating/updating students', async () => {
      const subjDb = await seedUser('subj-1', 'subject_teacher');
      const bursarDb = await seedUser('bursar-1', 'bursar');
      
      await assertFails(setDoc(doc(subjDb, 'students', 'student-3'), studentFactory(SCHOOL_A_ID)));
      await assertFails(setDoc(doc(bursarDb, 'students', 'student-4'), studentFactory(SCHOOL_A_ID)));
    });

    it('denies anyone from deleting students', async () => {
      const adminDb = await seedUser('admin-1', 'admin');
      await env.withSecurityRulesDisabled(async (ctx) => {
        await seedDoc(ctx.firestore(), 'students', 'student-1', studentFactory(SCHOOL_A_ID));
      });
      
      await assertFails(deleteDoc(doc(adminDb, 'students', 'student-1')));
    });
  });

  describe('Teachers', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await seedDoc(ctx.firestore(), 'teachers', 'teacher-doc', teacherFactory(SCHOOL_A_ID, { userId: 'teacher-uid' }));
      });
    });

    it('allows Admin, Principal, Academic_master to read all teachers in own school', async () => {
      const adminDb = await seedUser('admin-1', 'admin');
      const princDb = await seedUser('princ-1', 'principal');
      const acadDb = await seedUser('acad-1', 'academic_master');
      
      await assertSucceeds(getDoc(doc(adminDb, 'teachers', 'teacher-doc')));
      await assertSucceeds(getDoc(doc(princDb, 'teachers', 'teacher-doc')));
      await assertSucceeds(getDoc(doc(acadDb, 'teachers', 'teacher-doc')));
    });

    it('allows a teacher to read their own record', async () => {
      const db = await seedUser('teacher-uid', 'subject_teacher');
      await assertSucceeds(getDoc(doc(db, 'teachers', 'teacher-doc')));
    });

    it('denies Subject_teacher reading other teachers records', async () => {
      const db = await seedUser('other-teacher', 'subject_teacher');
      await assertFails(getDoc(doc(db, 'teachers', 'teacher-doc')));
    });

    it('allows only admin/principal to create/update teachers', async () => {
      const adminDb = await seedUser('admin-1', 'admin');
      const acadDb = await seedUser('acad-1', 'academic_master');
      
      await assertSucceeds(setDoc(doc(adminDb, 'teachers', 'new-teacher'), teacherFactory(SCHOOL_A_ID)));
      await assertFails(setDoc(doc(acadDb, 'teachers', 'new-teacher-2'), teacherFactory(SCHOOL_A_ID)));
    });

    it('denies anyone from deleting teachers', async () => {
      const adminDb = await seedUser('admin-1', 'admin');
      await assertFails(deleteDoc(doc(adminDb, 'teachers', 'teacher-doc')));
    });
  });

  describe('Assessments', () => {
    it('allows any staff to read assessments in own school', async () => {
      const db = await seedUser('teacher-1', 'subject_teacher');
      await env.withSecurityRulesDisabled(async (ctx) => {
        await seedDoc(ctx.firestore(), 'assessments', 'assess-1', assessmentFactory(SCHOOL_A_ID));
      });
      await assertSucceeds(getDoc(doc(db, 'assessments', 'assess-1')));
    });

    it('allows only admin/academic_master to create/update/delete assessments', async () => {
      const adminDb = await seedUser('admin-1', 'admin');
      const acadDb = await seedUser('acad-1', 'academic_master');
      const teacherDb = await seedUser('teacher-1', 'subject_teacher');
      
      await assertSucceeds(setDoc(doc(adminDb, 'assessments', 'a1'), assessmentFactory(SCHOOL_A_ID)));
      await assertSucceeds(setDoc(doc(acadDb, 'assessments', 'a2'), assessmentFactory(SCHOOL_A_ID)));
      
      await assertFails(setDoc(doc(teacherDb, 'assessments', 'a3'), assessmentFactory(SCHOOL_A_ID)));
    });
  });

  describe('Marks', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await seedDoc(ctx.firestore(), 'assessments', 'open-assessment', assessmentFactory(SCHOOL_A_ID, { status: 'draft' }));
        await seedDoc(ctx.firestore(), 'assessments', 'locked-assessment', assessmentFactory(SCHOOL_A_ID, { status: 'locked' }));
        await seedDoc(ctx.firestore(), 'marks', 'mark-1', markFactory(SCHOOL_A_ID, 'open-assessment'));
      });
    });

    it('allows any staff to read marks in own school', async () => {
      const db = await seedUser('teacher-1', 'subject_teacher');
      await assertSucceeds(getDoc(doc(db, 'marks', 'mark-1')));
    });

    it('allows teachers/admin to create marks when assessment NOT locked', async () => {
      const db = await seedUser('teacher-1', 'subject_teacher');
      await assertSucceeds(setDoc(doc(db, 'marks', 'new-mark'), markFactory(SCHOOL_A_ID, 'open-assessment')));
    });

    it('denies marks being written when parent assessment is locked', async () => {
      const db = await seedUser('teacher-1', 'subject_teacher');
      await assertFails(setDoc(doc(db, 'marks', 'new-mark-2'), markFactory(SCHOOL_A_ID, 'locked-assessment')));
    });

    it('denies bursar writing marks', async () => {
      const db = await seedUser('bursar-1', 'bursar');
      await assertFails(setDoc(doc(db, 'marks', 'new-mark-3'), markFactory(SCHOOL_A_ID, 'open-assessment')));
    });

    it('denies anyone from deleting marks', async () => {
      const db = await seedUser('admin-1', 'admin');
      await assertFails(deleteDoc(doc(db, 'marks', 'mark-1')));
    });
  });

  describe('Results', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await seedDoc(ctx.firestore(), 'results', 'res-1', resultFactory(SCHOOL_A_ID));
      });
    });

    it('allows admin/academic_master to create results', async () => {
      const db = await seedUser('acad-1', 'academic_master');
      await assertSucceeds(setDoc(doc(db, 'results', 'new-res'), resultFactory(SCHOOL_A_ID)));
    });

    it('allows class_teacher to ONLY update teacherRemark on existing results', async () => {
      const db = await seedUser('teacher-1', 'class_teacher');
      await assertSucceeds(updateDoc(doc(db, 'results', 'res-1'), { teacherRemark: 'Good', updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, 'results', 'res-1'), { totalMarks: 500 }));
    });

    it('allows principal to ONLY update principalRemark on existing results', async () => {
      const db = await seedUser('princ-1', 'principal');
      await assertSucceeds(updateDoc(doc(db, 'results', 'res-1'), { principalRemark: 'Excellent', updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(doc(db, 'results', 'res-1'), { totalMarks: 500 }));
    });

    it('denies anyone from deleting results', async () => {
      const db = await seedUser('admin-1', 'admin');
      await assertFails(deleteDoc(doc(db, 'results', 'res-1')));
    });
  });

  describe('Fees & Payments', () => {
    it('allows admin/bursar to create/update fees', async () => {
      const db = await seedUser('bursar-1', 'bursar');
      await assertSucceeds(setDoc(doc(db, 'fees', 'fee-1'), feeFactory(SCHOOL_A_ID)));
    });

    it('denies class_teacher creating fees', async () => {
      const db = await seedUser('teacher-1', 'class_teacher');
      await assertFails(setDoc(doc(db, 'fees', 'fee-2'), feeFactory(SCHOOL_A_ID)));
    });

    it('allows admin/bursar to create fee payments but not update/delete', async () => {
      const db = await seedUser('bursar-1', 'bursar');
      await assertSucceeds(setDoc(doc(db, 'fee_payments', 'pay-1'), feePaymentFactory(SCHOOL_A_ID)));
      await assertFails(updateDoc(doc(db, 'fee_payments', 'pay-1'), { amount: 1000 }));
      await assertFails(deleteDoc(doc(db, 'fee_payments', 'pay-1')));
    });
  });

  describe('Audit Logs', () => {
    it('allows staff to create audit logs but no updates or deletes', async () => {
      const db = await seedUser('teacher-1', 'class_teacher');
      await assertSucceeds(setDoc(doc(db, 'audit_logs', 'log-1'), { schoolId: SCHOOL_A_ID, action: 'test' }));
      await assertFails(updateDoc(doc(db, 'audit_logs', 'log-1'), { action: 'updated' }));
      await assertFails(deleteDoc(doc(db, 'audit_logs', 'log-1')));
    });
  });

  describe('Platform Announcements', () => {
    it('allows super_admin to create announcements', async () => {
      const db = await seedUser('super-1', 'super_admin');
      await assertSucceeds(setDoc(doc(db, 'platform_announcements', 'ann-1'), { title: 'Hello', isPublished: true }));
    });

    it('denies admin creating announcements', async () => {
      const db = await seedUser('admin-1', 'admin');
      await assertFails(setDoc(doc(db, 'platform_announcements', 'ann-2'), { title: 'Hello', isPublished: true }));
    });

    it('allows staff to read announcements', async () => {
      const db = await seedUser('teacher-1', 'class_teacher');
      await env.withSecurityRulesDisabled(async (ctx) => {
        await seedDoc(ctx.firestore(), 'platform_announcements', 'ann-3', { title: 'Hi', isPublished: true });
      });
      await assertSucceeds(getDoc(doc(db, 'platform_announcements', 'ann-3')));
    });
  });

  describe('Denied Collections', () => {
    it('denies read/write to subscription_tokens and lookup_attempts', async () => {
      const db = await seedUser('super-1', 'super_admin');
      await assertFails(getDoc(doc(db, 'subscription_tokens', 'token-1')));
      await assertFails(setDoc(doc(db, 'subscription_tokens', 'token-2'), {}));
      
      await assertFails(getDoc(doc(db, 'lookup_attempts', 'lookup-1')));
      await assertFails(setDoc(doc(db, 'lookup_attempts', 'lookup-2'), {}));
    });
  });

  describe('Default Deny', () => {
    it('denies reading from an unnamed collection', async () => {
      const db = await seedUser('admin-1', 'admin');
      await assertFails(getDoc(doc(db, 'nonexistent_collection', 'doc-1')));
    });
  });
});
