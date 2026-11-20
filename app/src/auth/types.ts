export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Swap this implementation for Supabase, Firebase, or the Rust API.
 * `AuthProvider` depends only on this interface.
 *
 * `forgotPassword` returns `demoResetUrl` so the local demo can be tried
 * without email. A production adapter sends mail and returns null.
 */
export interface AuthService {
  signUp(input: { name: string; email: string; password: string }): Promise<User>;
  signIn(input: { email: string; password: string; remember: boolean }): Promise<User>;
  signOut(): Promise<void>;
  forgotPassword(email: string): Promise<{ demoResetUrl: string | null }>;
  resetPassword(input: { token: string; password: string }): Promise<void>;
  currentUser(): Promise<User | null>;
}

export type AuthErrorCode =
  | "name"
  | "email"
  | "password"
  | "confirm"
  | "mismatch"
  | "taken"
  | "credentials"
  | "token";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
}
