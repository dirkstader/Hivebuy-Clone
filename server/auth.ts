import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { storage } from "./storage";
import type { Role, User } from "@shared/schema";

// No cookies/localStorage/sessionStorage — the target runtime blocks them (see README).
// Sessions are therefore opaque Bearer tokens kept in-memory on the server, matching the
// client's in-memory-only auth state (a full page reload logs out on both sides).
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const sessions = new Map<string, { userId: number; expiresAt: number }>();

export function createSession(userId: number): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

function getSessionUserId(token: string): number | undefined {
  const session = sessions.get(token);
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return session.userId;
}

export function sanitizeUser(user: User): Omit<User, "password"> {
  const { password, ...rest } = user;
  return rest;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const userId = token ? getSessionUserId(token) : undefined;
  if (!userId) {
    return res.status(401).json({ message: "Nicht angemeldet oder Sitzung abgelaufen." });
  }
  const user = await storage.getUser(userId);
  if (!user) {
    return res.status(401).json({ message: "Nicht angemeldet oder Sitzung abgelaufen." });
  }
  req.user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role as Role)) {
      return res.status(403).json({ message: "Für diese Aktion fehlt die Berechtigung." });
    }
    next();
  };
}
