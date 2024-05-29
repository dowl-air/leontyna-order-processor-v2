"use server";
import { collection, getDocs, limit, orderBy, query, Timestamp } from "firebase/firestore/lite"
import { db } from "./init";

export const getLatestDate = async () => {
    const q = query(collection(db, "products"), orderBy("date", "desc"), limit(1));
    const querySnapshot = await getDocs(q);
    let date = new Date();
    querySnapshot.forEach((doc) => {
        const tm = doc.data().date as Timestamp;
        date = tm.toDate();
    });
    return date;
}