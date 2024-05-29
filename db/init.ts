import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from 'firebase/firestore/lite';

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY!,
    authDomain: "leontyna-kontri.firebaseapp.com",
    projectId: "leontyna-kontri",
    storageBucket: "leontyna-kontri.appspot.com",
    messagingSenderId: "375779697189",
    appId: "1:375779697189:web:442cbbe905bae2a90615cc"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
