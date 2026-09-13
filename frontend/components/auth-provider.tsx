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

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  user: User | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  createAccount: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    const auth = getFirebaseAuth();
    return onIdTokenChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isFirebaseConfigured,
      loading,
      user,
      async signInWithEmail(email, password) {
        await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      },
      async createAccount(name, email, password) {
        const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
        await updateProfile(credential.user, { displayName: name });
        await credential.user.getIdToken(true);
      },
      async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(getFirebaseAuth(), provider);
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(getFirebaseAuth(), email);
      },
      async signOut() {
        await firebaseSignOut(getFirebaseAuth());
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
