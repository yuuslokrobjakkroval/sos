import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { localAuthService } from "./localAuthService";
import type { AuthService, User } from "./types";

interface AuthValue {
  user: User | null;
  ready: boolean;
  signUp: AuthService["signUp"];
  signIn: AuthService["signIn"];
  signOut: () => Promise<void>;
  forgotPassword: AuthService["forgotPassword"];
  resetPassword: AuthService["resetPassword"];
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  children,
  service = localAuthService,
}: {
  children: ReactNode;
  /** Defaults to the local demo. Pass another AuthService to use a real backend. */
  service?: AuthService;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    service
      .currentUser()
      .then((next) => {
        if (alive) setUser(next);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [service]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      ready,
      signUp: async (input) => {
        const next = await service.signUp(input);
        setUser(next);
        return next;
      },
      signIn: async (input) => {
        const next = await service.signIn(input);
        setUser(next);
        return next;
      },
      signOut: async () => {
        await service.signOut();
        setUser(null);
      },
      forgotPassword: (email) => service.forgotPassword(email),
      resetPassword: (input) => service.resetPassword(input),
    }),
    [ready, service, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
