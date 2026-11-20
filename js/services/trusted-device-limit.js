export const TRUSTED_DEVICE_LIMIT = 5;

export function shouldBlockNewDevice(existingCount, isAlreadyTrusted = false, limit = TRUSTED_DEVICE_LIMIT) {
  return !isAlreadyTrusted && existingCount >= limit;
}
