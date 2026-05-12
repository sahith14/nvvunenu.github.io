import jwt from "jsonwebtoken";

const SECRET   = process.env.JWT_SECRET   || "dev_secret_change_me";
const ISSUER   = process.env.JWT_ISSUER   || "bondsync";
const AUDIENCE = process.env.JWT_AUDIENCE || "bondsync-client";

export function signUserToken(userId, extras = {}) {
  return jwt.sign(
    { sub: userId, ...extras },
    SECRET,
    { issuer: ISSUER, audience: AUDIENCE, expiresIn: "30d" }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET, { issuer: ISSUER, audience: AUDIENCE });
}

// Express middleware
export function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "NO_TOKEN" });
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, tier: payload.tier || "free" };
    next();
  } catch {
    return res.status(401).json({ error: "BAD_TOKEN" });
  }
}

// Socket.IO middleware
export function socketAuth(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return next(new Error("NO_TOKEN"));
  try {
    const payload = verifyToken(token);
    socket.data.userId = payload.sub;
    socket.data.tier   = payload.tier || "free";
    next();
  } catch {
    next(new Error("BAD_TOKEN"));
  }
}
