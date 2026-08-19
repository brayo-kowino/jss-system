import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { getTestEnv, authedDb, unauthDb, seedDoc, schoolFactory, userFactory, studentFactory, SCHOOL_A_ID, SCHOOL_B_ID } from './helpers.js';

describe('Schools Collection Rules', () => {
  let env;

  beforeAll(async () => {
    env = await getTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    // Seed common schools
    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await seedDoc(adminDb, 'schools', SCHOOL_A_ID, schoolFactory());
      await seedDoc(adminDb, 'schools', SCHOOL_B_ID, schoolFactory());
    });
  });

  describe('Read access', () => {
    it('allows super_admin to read any school', async () => {
      const superId = 'super-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', superId, userFactory('super_admin', null));
      });
      const db = authedDb(env, superId);
      await assertSucceeds(getDoc(doc(db, 'schools', SCHOOL_A_ID)));
      await assertSucceeds(getDoc(doc(db, 'schools', SCHOOL_B_ID)));
    });

    it('allows staff to read their own school', async () => {
      const staffId = 'staff-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', staffId, userFactory('class_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, staffId);
      await assertSucceeds(getDoc(doc(db, 'schools', SCHOOL_A_ID)));
    });

    it('denies staff reading a different school', async () => {
      const staffId = 'staff-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', staffId, userFactory('class_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, staffId);
      await assertFails(getDoc(doc(db, 'schools', SCHOOL_B_ID)));
    });

    it('denies unauthenticated reading schools', async () => {
      const db = unauthDb(env);
      await assertFails(getDoc(doc(db, 'schools', SCHOOL_A_ID)));
    });
  });

  describe('Create access', () => {
    it('allows only super_admin to create schools', async () => {
      const superId = 'super-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', superId, userFactory('super_admin', null));
      });
      const db = authedDb(env, superId);
      await assertSucceeds(setDoc(doc(db, 'schools', 'new-school'), schoolFactory()));
    });

    it('denies admin creating schools', async () => {
      const adminId = 'admin-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertFails(setDoc(doc(db, 'schools', 'new-school'), schoolFactory()));
    });
  });

  describe('Update access', () => {
    it('allows super_admin to update any school', async () => {
      const superId = 'super-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', superId, userFactory('super_admin', null));
      });
      const db = authedDb(env, superId);
      await assertSucceeds(updateDoc(doc(db, 'schools', SCHOOL_A_ID), { name: 'Updated Name' }));
    });

    it('allows admin to update their own school non-subscription fields', async () => {
      const adminId = 'admin-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertSucceeds(updateDoc(doc(db, 'schools', SCHOOL_A_ID), { name: 'Updated Name' }));
    });

    it('denies admin updating subscription fields', async () => {
      const adminId = 'admin-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
      });
      const db = authedDb(env, adminId);
      await assertFails(updateDoc(doc(db, 'schools', SCHOOL_A_ID), { subscriptionStatus: 'active' }));
      await assertFails(updateDoc(doc(db, 'schools', SCHOOL_A_ID), { subscriptionPlan: 'premium' }));
    });

    it('denies class_teacher updating their school', async () => {
      const teacherId = 'teacher-1';
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', teacherId, userFactory('class_teacher', SCHOOL_A_ID));
      });
      const db = authedDb(env, teacherId);
      await assertFails(updateDoc(doc(db, 'schools', SCHOOL_A_ID), { name: 'Updated Name' }));
    });
  });

  describe('Subscription enforcement on operational collections', () => {
    const adminId = 'admin-1';

    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await seedDoc(context.firestore(), 'users', adminId, userFactory('admin', SCHOOL_A_ID));
      });
    });

    it('allows admin to create student when subscription is active', async () => {
      const db = authedDb(env, adminId);
      await assertSucceeds(setDoc(doc(db, 'students', 'new-student'), studentFactory(SCHOOL_A_ID)));
    });

    it('denies admin creating student when subscriptionExpiresAt is in the past', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'schools', SCHOOL_A_ID), {
          subscriptionExpiresAt: Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
        });
      });
      const db = authedDb(env, adminId);
      await assertFails(setDoc(doc(db, 'students', 'new-student'), studentFactory(SCHOOL_A_ID)));
    });

    it('denies admin creating student when subscriptionStatus is expired', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'schools', SCHOOL_A_ID), {
          subscriptionStatus: 'expired'
        });
      });
      const db = authedDb(env, adminId);
      await assertFails(setDoc(doc(db, 'students', 'new-student'), studentFactory(SCHOOL_A_ID)));
    });

    it('denies admin creating student when school status is suspended', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), 'schools', SCHOOL_A_ID), {
          status: 'suspended'
        });
      });
      const db = authedDb(env, adminId);
      await assertFails(setDoc(doc(db, 'students', 'new-student'), studentFactory(SCHOOL_A_ID)));
    });
  });
});
