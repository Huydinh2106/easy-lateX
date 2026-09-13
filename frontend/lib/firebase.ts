import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
];

export const isFirebaseConfigured = requiredConfig.every(Boolean);

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase Authentication is not configured");
  }

  if (!firebaseApp) {
    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  if (!firebaseAuth) firebaseAuth = getAuth(firebaseApp);
  return firebaseAuth;
}
