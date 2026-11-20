/**
 * DEMO / MOCK auth. Not a security boundary.
 *
 * Users, sessions, and reset tokens live in localStorage / sessionStorage.
 * Passwords are hashed with SHA-256 plus a per-user salt so the demo does
 * not store them in clear text. SHA-256 is not a password hash (no stretching).
 * Do not reuse this for a real account system.
 *
 * The video engine never sees these accounts. To plug in a backend, implement
 * `AuthService` (see ./types.ts) with Supabase, Firebase, or your own API and
 * pass it to `<AuthProvider service={...}>`. The default export of this file
 * is the only thing that needs to change.
 */
import { AuthError, type AuthService, type User } from "./types";

const USERS_KEY = "automate.auth.users";
const SESSION_KEY = "automate.auth.session";
const RESET_KEY = "automate.auth.resets";
const RESET_MS = 60 * 60 * 1000;

interface StoredUser extends User {
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface Session {
  userId: string;
}

interface ResetToken {
  token: string;
  email: string;
  expiresAt: number;
}

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage, key: string, value: unknown) {
  storage.setItem(key, JSON.stringify(value));
}

function users(): StoredUser[] {
  const parsed = readJson<StoredUser[]>(localStorage, USERS_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveUsers(next: StoredUser[]) {
  writeJson(localStorage, USERS_KEY, next);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(size = 16): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256(`${salt}:${password}`);
}

function publicUser(user: StoredUser): User {
  return { id: user.id, name: user.name, email: user.email };
}

function readSession(): Session | null {
  const fromSession = readJson<Session | null>(sessionStorage, SESSION_KEY, null);
  if (fromSession?.userId) return fromSession;
  const fromLocal = readJson<Session | null>(localStorage, SESSION_KEY, null);
  return fromLocal?.userId ? fromLocal : null;
}

function writeSession(session: Session, remember: boolean) {
  if (remember) {
    sessionStorage.removeItem(SESSION_KEY);
    writeJson(localStorage, SESSION_KEY, session);
  } else {
    localStorage.removeItem(SESSION_KEY);
    writeJson(sessionStorage, SESSION_KEY, session);
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const localAuthService: AuthService = {
  async signUp(input) {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (name.length < 2) throw new AuthError("name");
    if (!validEmail(email)) throw new AuthError("email");
    if (input.password.length < 8) throw new AuthError("password");
    const existing = users();
    if (existing.some((user) => user.email === email)) throw new AuthError("taken");
    const salt = randomHex();
    const user: StoredUser = {
      id: crypto.randomUUID?.() ?? randomHex(16),
      name,
      email,
      salt,
      passwordHash: await hashPassword(input.password, salt),
      createdAt: new Date().toISOString(),
    };
    saveUsers([user, ...existing]);
    writeSession({ userId: user.id }, true);
    return publicUser(user);
  },

  async signIn(input) {
    const email = input.email.trim().toLowerCase();
    const user = users().find((item) => item.email === email);
    if (!user) throw new AuthError("credentials");
    const hash = await hashPassword(input.password, user.salt);
    if (hash !== user.passwordHash) throw new AuthError("credentials");
    writeSession({ userId: user.id }, input.remember);
    return publicUser(user);
  },

  async signOut() {
    clearSession();
  },

  async forgotPassword(email) {
    const normalized = email.trim().toLowerCase();
    const user = users().find((item) => item.email === normalized);
    if (!user) return { demoResetUrl: null };
    const token = randomHex(24);
    const tokens = readJson<ResetToken[]>(localStorage, RESET_KEY, []).filter(
      (item) => item.expiresAt > Date.now() && item.email !== normalized,
    );
    tokens.push({ token, email: normalized, expiresAt: Date.now() + RESET_MS });
    writeJson(localStorage, RESET_KEY, tokens);
    return { demoResetUrl: `/reset-password?token=${token}` };
  },

  async resetPassword(input) {
    if (input.password.length < 8) throw new AuthError("password");
    const tokens = readJson<ResetToken[]>(localStorage, RESET_KEY, []);
    const match = tokens.find((item) => item.token === input.token && item.expiresAt > Date.now());
    if (!match) throw new AuthError("token");
    const next = users();
    const user = next.find((item) => item.email === match.email);
    if (!user) throw new AuthError("token");
    user.salt = randomHex();
    user.passwordHash = await hashPassword(input.password, user.salt);
    saveUsers(next);
    writeJson(
      localStorage,
      RESET_KEY,
      tokens.filter((item) => item.token !== input.token),
    );
  },

  async currentUser() {
    const session = readSession();
    if (!session) return null;
    const user = users().find((item) => item.id === session.userId);
    if (!user) {
      clearSession();
      return null;
    }
    return publicUser(user);
  },
};
