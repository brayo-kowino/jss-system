import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getTestEnv, authedDb, unauthDb, seedDoc, schoolFactory, userFactory, SCHOOL_A_ID, SCHOOL_B_ID } from './helpers.js';

describe('Users Collection Rules', () => {
  let env;

  beforeAll(async () => {
    env = await getTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    // Seed common school
    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await seedDoc(adminDb, 'schools', SCHOOL_A_ID, schoolFactory());
      await seedDoc(adminDb, 'schools', SCHOOL_B_ID, schoolFactory());
    });
  });

  describe('Read access', () => {
    it('allows a user to read their own profile', async () => {
      const uid = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', uid, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, uid);
      await assertSucceeds(getDoc(doc(db, 'users', uid)));
    });

    it('allows an admin to read any user in their school', async () => {
      const adminId = 'admin-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertSucceeds(getDoc(doc(db, 'users', userId)));
    });

    it('allows a principal to read any user in their school', async () => {
      const principalId = 'principal-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', principalId, userFactory('principal', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, principalId);
      await assertSucceeds(getDoc(doc(db, 'users', userId)));
    });

    it('denies an admin reading users from a different school', async () => {
      const adminId = 'admin-a';
      const userBId = 'user-b';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userBId, userFactory('subject_teacher', SCHOOL_B_ID));
      });
      const db = authedDb(env, adminId);
      await assertFails(getDoc(doc(db, 'users', userBId)));
    });

    it('denies a subject_teacher reading other users profiles', async () => {
      const teacherId = 'teacher-1';
      const otherId = 'other-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', teacherId, userFactory('subject_teacher', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', otherId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, teacherId);
      await assertFails(getDoc(doc(db, 'users', otherId)));
    });

    it('allows a super_admin to read any user', async () => {
      const superId = 'super-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', superId, userFactory('super_admin', null));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, superId);
      await assertSucceeds(getDoc(doc(db, 'users', userId)));
    });

    it('denies unauthenticated users reading any profile', async () => {
      const db = unauthDb(env);
      await assertFails(getDoc(doc(db, 'users', 'some-id')));
    });
  });

  describe('Create access', () => {
    it('allows super_admin to create any user', async () => {
      const superId = 'super-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', superId, userFactory('super_admin', null));
      });
      const db = authedDb(env, superId);
      await assertSucceeds(setDoc(doc(db, 'users', 'new-user'), userFactory('admin', SCHOOL_A_ID)));
    });

    it('allows admin to create users in their own school', async () => {
      const adminId = 'admin-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertSucceeds(setDoc(doc(db, 'users', 'new-user'), userFactory('subject_teacher', SCHOOL_A_ID)));
    });

    it('denies admin creating users in a different school', async () => {
      const adminId = 'admin-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertFails(setDoc(doc(db, 'users', 'new-user'), userFactory('subject_teacher', SCHOOL_B_ID)));
    });

    it('allows principal to create class_teacher and subject_teacher in their school', async () => {
      const principalId = 'principal-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', principalId, userFactory('principal', SCHOOL_A_ID));
      });
      const db = authedDb(env, principalId);
      await assertSucceeds(setDoc(doc(db, 'users', 'new-teacher1'), userFactory('class_teacher', SCHOOL_A_ID)));
      await assertSucceeds(setDoc(doc(db, 'users', 'new-teacher2'), userFactory('subject_teacher', SCHOOL_A_ID)));
    });

    it('denies principal creating admin or bursar roles', async () => {
      const principalId = 'principal-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', principalId, userFactory('principal', SCHOOL_A_ID));
      });
      const db = authedDb(env, principalId);
      await assertFails(setDoc(doc(db, 'users', 'new-admin'), userFactory('admin', SCHOOL_A_ID)));
      await assertFails(setDoc(doc(db, 'users', 'new-bursar'), userFactory('bursar', SCHOOL_A_ID)));
    });

    it('denies class_teacher creating users', async () => {
      const teacherId = 'teacher-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', teacherId, userFactory('class_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, teacherId);
      await assertFails(setDoc(doc(db, 'users', 'new-user'), userFactory('student', SCHOOL_A_ID)));
    });
  });

  describe('Update access', () => {
    it('allows super_admin to update any user', async () => {
      const superId = 'super-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', superId, userFactory('super_admin', null));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, superId);
      await assertSucceeds(updateDoc(doc(db, 'users', userId), { fullName: 'Updated Name' }));
    });

    it('allows admin to update users in their own school', async () => {
      const adminId = 'admin-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertSucceeds(updateDoc(doc(db, 'users', userId), { fullName: 'Updated Name' }));
    });

    it('denies admin updating users in a different school', async () => {
      const adminId = 'admin-1';
      const userId = 'user-b';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_B_ID));
      });
      const db = authedDb(env, adminId);
      await assertFails(updateDoc(doc(db, 'users', userId), { fullName: 'Updated Name' }));
    });

    it('allows a user to update their own mustChangePassword and updatedAt fields only', async () => {
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, userId);
      await assertSucceeds(updateDoc(doc(db, 'users', userId), { 
        mustChangePassword: true,
        updatedAt: serverTimestamp() 
      }));
    });

    it('denies a user updating their own role field', async () => {
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, userId);
      await assertFails(updateDoc(doc(db, 'users', userId), { role: 'admin' }));
    });
  });

  describe('Delete access', () => {
    it('allows super_admin to delete any user', async () => {
      const superId = 'super-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', superId, userFactory('super_admin', null));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, superId);
      await assertSucceeds(deleteDoc(doc(db, 'users', userId)));
    });

    it('allows admin to delete users in their own school', async () => {
      const adminId = 'admin-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertSucceeds(deleteDoc(doc(db, 'users', userId)));
    });

    it('denies admin deleting users in a different school', async () => {
      const adminId = 'admin-1';
      const userId = 'user-b';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_B_ID));
      });
      const db = authedDb(env, adminId);
      await assertFails(deleteDoc(doc(db, 'users', userId)));
    });

    it('denies class_teacher deleting users', async () => {
      const teacherId = 'teacher-1';
      const userId = 'user-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', teacherId, userFactory('class_teacher', SCHOOL_A_ID));
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, teacherId);
      await assertFails(deleteDoc(doc(db, 'users', userId)));
    });
  });

  describe('Suspension Enforcement', () => {
    it('denies suspended admin creating new users', async () => {
      const adminId = 'suspended-admin';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID, { status: 'suspended' }));
      });
      const db = authedDb(env, adminId);
      await assertFails(setDoc(doc(db, 'users', 'new-user'), userFactory('subject_teacher', SCHOOL_A_ID)));
    });

    it('denies suspended admin reading other users', async () => {
      const adminId = 'suspended-admin';
      const otherId = 'other-user';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID, { status: 'suspended' }));
        await seedDoc(context.firestore(), 'users', otherId, userFactory('subject_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertFails(getDoc(doc(db, 'users', otherId)));
    });

    it('allows suspended user to read only their own profile doc', async () => {
      const userId = 'suspended-user';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', userId, userFactory('subject_teacher', SCHOOL_A_ID, { status: 'suspended' }));
      });
      const db = authedDb(env, userId);
      await assertSucceeds(getDoc(doc(db, 'users', userId)));
    });
  });
});
