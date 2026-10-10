"use server";
import {
    Timestamp,
    QueryConstraint,
    QueryDocumentSnapshot,
    collection,
    documentId,
    limit as flimit,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    where,
} from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { formatToUTC } from "@/utils/formatDate";
import { getOrderHistoryCutoff } from "@/utils/orderHistory";

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

const getUnfinishedProducts = async (...baseConstraints: QueryConstraint[]): Promise<ShopOrder[]> => {
    const products: ShopOrder[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    while (true) {
        const constraints = [...baseConstraints, limit(1000)];
        if (cursor) constraints.push(startAfter(cursor));
        const snapshot = await getDocs(query(collection(db, "products"), ...constraints));
        snapshot.docs.forEach((document) => {
            const data = document.data();
            products.push({ ...data, date: (data.date as Timestamp).toDate(), fID: document.id } as ShopOrder);
        });
        if (snapshot.docs.length < 1000) break;
        cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    return products;
};

export const getOrderedProducts = async (): Promise<ShopOrder[]> => {
    const cutoff = getOrderHistoryCutoff();
    return getUnfinishedProducts(
        where("kontriStatusCode", "==", 100),
        where("date", ">=", cutoff),
        orderBy("date", "asc"),
        orderBy(documentId(), "asc"),
    );
};

export const getNotSentProducts = async (): Promise<ShopOrder[]> => {
    return getUnfinishedProducts(
        where("kontriStatusCode", "in", [300, 301]),
        where("date", ">=", getOrderHistoryCutoff()),
        orderBy("date", "asc"),
        orderBy(documentId(), "asc"),
    );
};
