// In-memory presence. Swap for Redis (pub/sub + sets) at Phase 2.
const userSockets = new Map();   // userId -> Set<socketId>
const socketUser  = new Map();   // socketId -> userId

export function addSocket(userId, socketId) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
  socketUser.set(socketId, userId);
  return userSockets.get(userId).size === 1; // became online
}

export function removeSocket(socketId) {
  const userId = socketUser.get(socketId);
  if (!userId) return { userId: null, wentOffline: false };
  socketUser.delete(socketId);
  const set = userSockets.get(userId);
  if (!set) return { userId, wentOffline: false };
  set.delete(socketId);
  if (set.size === 0) {
    userSockets.delete(userId);
    return { userId, wentOffline: true };
  }
  return { userId, wentOffline: false };
}

export function isOnline(userId) {
  return userSockets.has(userId);
}

export function socketIdsFor(userId) {
  return [...(userSockets.get(userId) || [])];
}
