import { collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./init";

export type PendingKontriProduct = {
    fID: string;
    code: string;
    orderItemCode: string;
    orderItemEan: string;
    orderItemName: string;
    orderItemAmount: number;
};

export async function getPendingProducts(): Promise<PendingKontriProduct[]> {
    const snapshot = await getDocs(query(collection(db, "products"), where("AltumOrderID", "==", null)));
    return snapshot.docs.map((document) => {
        const data = document.data();
        return {
            fID: document.id,
            code: String(data.code ?? ""),
            orderItemCode: String(data.orderItemCode ?? ""),
            orderItemEan: String(data.orderItemEan ?? ""),
            orderItemName: String(data.orderItemName ?? ""),
            orderItemAmount: Number(data.orderItemAmount ?? 0),
        };
    });
}
