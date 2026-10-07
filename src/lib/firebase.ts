"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { initializeFirestore, getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";

/**
 * Firebase web config. These values are not secrets (they identify the
 * project); access is controlled by Firebase Auth plus the security rules.
 * Copy .env.example to .env.local and fill them in from the Firebase console.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** Region the Cloud Functions are deployed to (must match functions/src/config.ts). */
export const FUNCTIONS_REGION = process.env.NEXT_PUBLIC_FUNCTIONS_REGION || "asia-southeast1";

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function firebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured. Copy .env.example to .env.local and fill in your project's web app config.");
  }
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function auth(): Auth {
  return getAuth(firebaseApp());
}

export function firestore(): Firestore {
  if (!db) {
    try {
      db = initializeFirestore(firebaseApp(), { ignoreUndefinedProperties: true });
    } catch {
      db = getFirestore(firebaseApp());
    }
  }
  return db;
}

export function storage(): FirebaseStorage {
  return getStorage(firebaseApp());
}

export function functions(): Functions {
  return getFunctions(firebaseApp(), FUNCTIONS_REGION);
}
