// Canonical coupleId: deterministic, order-independent.
// Use in EVERY module (chat, memories, gifts, pet, calendar, check-in).
export function makeCoupleId(uid1, uid2) {
  if (!uid1 || !uid2) return null;
  return [uid1, uid2].sort().join("_");
}

export function coupleIdOrSolo(uid, partnerId) {
  return partnerId ? makeCoupleId(uid, partnerId) : uid;
}

// Tolerates both `partnerID` (capital D, written by partnerService) and
// the legacy `partnerId` field used by older modules.
export function getPartnerId(userData) {
  if (!userData) return null;
  return userData.partnerID || userData.partnerId || null;
}
