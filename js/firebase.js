import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeFirestore, doc, getDoc, getDocFromServer, setDoc, updateDoc, onSnapshot, collection, addDoc, query, where, getDocs, serverTimestamp, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, GAME_ID } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);

// Mais robusto em celulares/Wi-Fi compartilhado: o Firestore detecta quando
// WebChannel está demorando ou sendo bloqueado e alterna automaticamente para
// long polling. Isso reduz o caso de o PRIMEIRO evento só chegar após refresh.
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
});

const gameRef = doc(db,"games",GAME_ID);

export {db,gameRef,GAME_ID,doc,getDoc,getDocFromServer,setDoc,updateDoc,onSnapshot,collection,addDoc,query,where,getDocs,serverTimestamp,runTransaction,writeBatch};
