import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

// TODO: Replace with your Firebase project configuration
// Get these values from Firebase Console > Project Settings > General > Your apps > SDK setup and configuration
const firebaseConfig = {
    apiKey: "AIzaSyC4a56z2TrcklmZ-FGcCukbc_jE5v8Xm0U",
    authDomain: "hangout-app-4e887.firebaseapp.com",
    projectId: "hangout-app-4e887",
    storageBucket: "hangout-app-4e887.firebasestorage.app",
    messagingSenderId: "730853963213",
    appId: "1:730853963213:web:1c29bcf96e78213c028084"
  };

import { Platform } from 'react-native';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication with platform-appropriate persistence
let auth: any;
if (Platform.OS === 'web') {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });
  } catch (e) {
    auth = getAuth(app);
  }
}

// Initialize Firestore
const db = getFirestore(app);

// Initialize Storage
const storage = getStorage(app);

export { app, auth, db, storage };

