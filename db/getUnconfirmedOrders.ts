"use server";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { formatToUTC } from "@/utils/formatDate";
import { getOrderHistoryCutoff } from "@/utils/orderHistory";
import { KONTRI_MANUAL_REVIEW_STATUS } from "./recordKontriRetryFailure";

export type UnconfirmedKontriOrder = { RefNumber: string; products: ShopOrder[] };

export const getUnconfirmedOrders = async (): Promise<UnconfirmedKontriOrder[]> => {
    const cutoff = getOrderHistoryCutoff();
    const uncertain = await getDocs(query(collection(db, "products"), where("kontriStatusCode", "==", 90), where("date", ">=", cutoff)));
    const pending = await getDocs(query(collection(db, "products"), where("AltumOrderID", "==", null), where("date", ">=", cutoff)));
    const documents = new Map(
        [...uncertain.docs, ...pending.docs.filter((document) => document.data().RefNumber)].map((document) => [document.id, document]),
    );
    const unknown = await getDocs(query(collection(db, "products"), where("kontriReconciliationRequired", "==", true), where("date", ">=", cutoff)));
    const references = new Set(
        unknown.docs.filter((document) => document.data().kontriStatusCode === 100).map((document) => document.data().RefNumber),
    );
    for (const reference of references) {
        if (typeof reference !== "string" || !reference) throw new Error("Unknown Kontri quantities have no reference.");
        const group = await getDocs(query(collection(db, "products"), where("RefNumber", "==", reference), where("date", ">=", cutoff)));
        group.docs.forEach((document) => documents.set(document.id, document));
    }
    const groups = new Map<string, ShopOrder[]>();
    for (const document of documents.values()) {
        const data = document.data();
        if (typeof data.RefNumber !== "string" || !data.RefNumber) throw new Error("Unconfirmed Kontri order has no reference.");
        const product = { ...data, fID: document.id, date: formatToUTC(data.date as Timestamp) } as ShopOrder;
        groups.set(data.RefNumber, [...(groups.get(data.RefNumber) ?? []), product]);
    }
    return [...groups]
        .filter(([RefNumber, products]) => {
            if (products.some((product) => product.kontriStatusCode === KONTRI_MANUAL_REVIEW_STATUS)) {
                console.warn("Kontri request excluded: manual review required", { refNumber: RefNumber });
                return false;
            }
            if (!products.some((product) => product.kontriRequestLeaderId || product.kontriRequestJson)) return true;
            const leaders = products.filter((product) => product.kontriRequestJson);
            const ids = leaders[0]?.kontriRequestProductIds;
            const complete =
                leaders.length === 1 &&
                Array.isArray(ids) &&
                ids.length === products.length &&
                new Set(ids).size === ids.length &&
                products.every((product) => ids.includes(product.fID!) && product.kontriRequestLeaderId === leaders[0].fID);
            if (!complete) console.warn("Kontri request excluded from five-day history: incomplete group", { refNumber: RefNumber });
            return complete;
        })
        .map(([RefNumber, products]) => ({ RefNumber, products }));
};
