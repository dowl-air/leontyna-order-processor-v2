"use server";
import { Timestamp, collection, limit as flimit, getDocs, orderBy, query, startAfter } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";

export const getProducts = async (limit: number, lastDate: Date|null) : Promise<ShopOrder[]> => {
    let q = query(collection(db, "products"), orderBy("date", "desc"), flimit(limit), startAfter(lastDate));
    if (lastDate === null) {
        q = query(collection(db, "products"), orderBy("date", "desc"), flimit(limit));
    }
    const querySnapshot = await getDocs(q);
    const products: ShopOrder[] = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        products.push({...data, date: (data.date as Timestamp).toDate(), fID: doc.id} as ShopOrder);
    });
    return products;
}