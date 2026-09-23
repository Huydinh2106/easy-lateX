"use client";

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
}

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  user: AppUser | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createAccount: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const development = process.env.NEXT_PUBLIC_AUTH_MODE === "development";
  const developmentUser: AppUser = useMemo(() => ({
    uid: "development-user", email: "developer@easy-latex.local", displayName: "Development User",
    getIdToken: async () => ""
  }), []);
  const [user, setUser] = useState<AppUser | null>(development ? developmentUser : null);
  const [loading, setLoading] = useState(!development && isFirebaseConfigured);

  useEffect(() => {
    if (development || !isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    const auth = getFirebaseAuth();
    return onIdTokenChanged(auth, (currentUser) => {
      setUser(currentUser as User);
      setLoading(false);
    });
  }, [development]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: development || isFirebaseConfigured,
      loading,
      user,
      async signInWithEmail(email, password) {
        if (!development) await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      },
      async createAccount(name, email, password) {
        if (development) return;
        const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
        await updateProfile(credential.user, { displayName: name });
        await credential.user.getIdToken(true);
      },
      async signInWithGoogle() {
        if (development) return;
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(getFirebaseAuth(), provider);
      },
      async resetPassword(email) {
        if (!development) await sendPasswordResetEmail(getFirebaseAuth(), email);
      },
      async signOut() {
        if (!development) await firebaseSignOut(getFirebaseAuth());
      },
    }),
    [development, loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
