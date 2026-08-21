// ==========================================================================
// Two-Factor Authentication Service (TOTP)
// ==========================================================================
// Provides TOTP (RFC 6238) two-factor authentication using the otpauth library.
// 
// IMPORTANT: This is a client-side implementation where the TOTP secret is
// stored in Firestore and verified on the client. For production-grade 2FA,
// verification should be handled by a Cloud Function (server-side) to ensure
// the secret never leaves the server.
//
// 2FA data is stored on the user's Firestore doc (users/{uid}) as fields:
// - twoFactorEnabled: boolean
// - twoFactorSecret: string (base32-encoded TOTP secret)
// - twoFactorBackupCodes: string[] (array of hashed backup codes)
// - twoFactorEnabledAt: Timestamp
// ==========================================================================

import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { logAction } from "./audit.service.js";

let OTPAuth = null;
async function loadOTPAuth() {
  if (OTPAuth) return OTPAuth;
  OTPAuth = await import("https://cdn.jsdelivr.net/npm/otpauth@9/dist/otpauth.esm.min.js");
  return OTPAuth;
}

/**
 * Generates a new TOTP secret using otpauth.
 * Does NOT save to Firestore yet — saving happens only after verification.
 */
export async function generate2FASetup(uid, email) {
  const otpauth = await loadOTPAuth();
  
  // Generate a random base32 secret
  const secret = new otpauth.Secret({ size: 20 });
  const secretString = secret.base32;
  
  const totp = new otpauth.TOTP({
    issuer: 'Eeskia',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: secret
  });
  
  return {
    secret: secretString,
    otpauthUri: totp.toString()
  };
}

/**
 * Verifies a 6-digit code against a base32 secret string.
 * Uses a window of 1 (allows ±30 seconds drift).
 * Pure function — no Firestore reads.
 */
export async function verify2FACode(secret, code) {
  const otpauth = await loadOTPAuth();
  const totp = new otpauth.TOTP({
    issuer: 'Eeskia',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: otpauth.Secret.fromBase32(secret)
  });
  
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/**
 * Generates 10 random 8-character alphanumeric backup codes.
 */
export function generateBackupCodes() {
  const codes = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < 10; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    codes.push(code);
  }
  return codes;
}

/**
 * Simple hash of a backup code for storage.
 * FNV-1a hash implementation.
 */
export function hashBackupCode(code) {
  let hash = 2166136261;
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

/**
 * First verifies the code against the secret. If valid, writes the secret,
 * twoFactorEnabled=true, and generates 10 backup codes to the user doc.
 * Returns the backup codes array (plaintext). Throws if code is invalid.
 */
export async function enable2FA(uid, secret, verificationCode) {
  const isValid = await verify2FACode(secret, verificationCode);
  if (!isValid) {
    throw new Error("Invalid verification code.");
  }

  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = backupCodes.map(hashBackupCode);

  await setDoc(doc(db, "users", uid), {
    twoFactorEnabled: true,
    twoFactorSecret: secret,
    twoFactorBackupCodes: hashedBackupCodes,
    twoFactorEnabledAt: serverTimestamp()
  }, { merge: true });

  await logAction(uid, "enable_2fa", "users", uid);

  return backupCodes;
}

/**
 * Reads the stored secret, verifies the code (or checks if it matches a backup code),
 * then clears all 2FA fields from the user doc. Throws if code is invalid.
 */
export async function disable2FA(uid, verificationCode) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("User not found.");
  
  const data = snap.data();
  if (!data.twoFactorEnabled || !data.twoFactorSecret) {
    throw new Error("2FA is not enabled.");
  }

  const isValidTOTP = await verify2FACode(data.twoFactorSecret, verificationCode);
  
  let isValidBackup = false;
  if (!isValidTOTP && data.twoFactorBackupCodes && data.twoFactorBackupCodes.length > 0) {
    const hashedCode = hashBackupCode(verificationCode);
    isValidBackup = data.twoFactorBackupCodes.includes(hashedCode);
  }

  if (!isValidTOTP && !isValidBackup) {
    throw new Error("Invalid verification code.");
  }

  await updateDoc(doc(db, "users", uid), {
    twoFactorEnabled: null,
    twoFactorSecret: null,
    twoFactorBackupCodes: null,
    twoFactorEnabledAt: null
  });

  await logAction(uid, "disable_2fa", "users", uid);
}

/**
 * Reads user doc, returns boolean (twoFactorEnabled === true)
 */
export async function is2FAEnabled(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return false;
  return snap.data().twoFactorEnabled === true;
}

/**
 * Reads stored secret from user doc, verifies the code.
 * If the code matches a backup code instead, consume it.
 * Returns boolean.
 */
export async function validate2FALogin(uid, code) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return false;
  
  const data = snap.data();
  if (!data.twoFactorEnabled || !data.twoFactorSecret) return false;

  const isValidTOTP = await verify2FACode(data.twoFactorSecret, code);
  if (isValidTOTP) return true;

  if (data.twoFactorBackupCodes && data.twoFactorBackupCodes.length > 0) {
    const hashedCode = hashBackupCode(code);
    const codeIndex = data.twoFactorBackupCodes.indexOf(hashedCode);
    
    if (codeIndex !== -1) {
      // Consume backup code
      const updatedCodes = [...data.twoFactorBackupCodes];
      updatedCodes.splice(codeIndex, 1);
      
      await updateDoc(doc(db, "users", uid), {
        twoFactorBackupCodes: updatedCodes
      });
      
      await logAction(uid, "use_2fa_backup_code", "users", uid);
      return true;
    }
  }

  return false;
}
