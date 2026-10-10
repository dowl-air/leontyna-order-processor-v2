"use server";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { formatToUTC } from "@/utils/formatDate";

export type UnconfirmedKontriOrder = { RefNumber: string; products: ShopOrder[] };

export const getUnconfirmedOrders = async (): Promise<UnconfirmedKontriOrder[]> => {
    const uncertain = await getDocs(query(collection(db, "products"), where("kontriStatusCode", "==", 90)));
    const pending = await getDocs(query(collection(db, "products"), where("AltumOrderID", "==", null)));
    const documents = new Map(
        [...uncertain.docs, ...pending.docs.filter((document) => document.data().RefNumber)].map((document) => [document.id, document]),
    );
    const groups = new Map<string, ShopOrder[]>();
    for (const document of documents.values()) {
        const data = document.data();
        if (typeof data.RefNumber !== "string" || !data.RefNumber) throw new Error("Unconfirmed Kontri order has no reference.");
        const product = { ...data, fID: document.id, date: formatToUTC(data.date as Timestamp) } as ShopOrder;
        groups.set(data.RefNumber, [...(groups.get(data.RefNumber) ?? []), product]);
    }
    return [...groups].map(([RefNumber, products]) => ({ RefNumber, products }));
};
