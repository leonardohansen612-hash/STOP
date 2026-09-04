import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, query, where, getDocs, serverTimestamp, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, GAME_ID } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const gameRef = doc(db,"games",GAME_ID);

export {db,gameRef,GAME_ID,doc,getDoc,setDoc,updateDoc,onSnapshot,collection,addDoc,query,where,getDocs,serverTimestamp,runTransaction,writeBatch};
