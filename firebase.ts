// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDVBW-iAw88wVRLEIzlusLMAgWRciLy9OY",
  authDomain: "compsocrates.firebaseapp.com",
  projectId: "compsocrates",
  storageBucket: "compsocrates.firebasestorage.app",
  messagingSenderId: "990124408522",
  appId: "1:990124408522:web:b0ac4d0340b767c64f7e33"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);