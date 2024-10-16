"use server";
import { Timestamp, collection, limit as flimit, getDocs, limit, orderBy, query, startAfter, where } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { formatToUTC } from "@/utils/formatDate";

export const getProducts = async (limit: number, startIndex: Date | null): Promise<ShopOrder[]> => {
    let q = query(collection(db, "products"), orderBy("date", "desc"), flimit(limit), startAfter(startIndex));
    if (startIndex === null) {
        q = query(collection(db, "products"), orderBy("date", "desc"), flimit(limit));
    }
    const querySnapshot = await getDocs(q);
    const products: ShopOrder[] = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        products.push({ ...data, date: formatToUTC(data.date as Timestamp), fID: doc.id } as ShopOrder);
    });
    return products;
};

export const getOrderedProducts = async (pastDays: number): Promise<ShopOrder[]> => {
    const date = new Date();
    date.setDate(date.getDate() - pastDays);
    const q = query(collection(db, "products"), orderBy("date", "asc"), where("kontriStatusCode", "==", 100), where("date", ">", date), limit(1000));
    const querySnapshot = await getDocs(q);
    const products: ShopOrder[] = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        products.push({ ...data, date: (data.date as Timestamp).toDate(), fID: doc.id } as ShopOrder);
    });
    return products;
};

export const getNotSentProducts = async (): Promise<ShopOrder[]> => {
    const q = query(collection(db, "products"), orderBy("date", "desc"), where("kontriStatusCode", "==", 300), limit(1000));
    const querySnapshot = await getDocs(q);
    const products: ShopOrder[] = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        products.push({ ...data, date: (data.date as Timestamp).toDate(), fID: doc.id } as ShopOrder);
    });
    return products;
};
