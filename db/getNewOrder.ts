"use server";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { KontriOrder } from "@/types/KontriOrder";
import { createKontriOrder } from "@/utils/createKontriOrder";
import { formatToUTC } from "@/utils/formatDate";
import { v4 as uuidv4 } from "uuid";
import { doc, getFirestore, runTransaction } from "firebase/firestore";
import { readKontriMapping } from "./readKontriMapping";
import { createKontriLookup, resolveKontriProduct } from "@/utils/resolveKontriProduct";

export const getNewOrder = async (): Promise<KontriOrder | null> => {
    const q = query(collection(db, "products"), where("AltumOrderID", "==", null));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return null;

    if (querySnapshot.docs.length > 450) throw new Error("Too many products for atomic Kontri preparation; manual review required.");
    const products = querySnapshot.docs.map((document) => {
        const data = document.data();
        return { ...data, fID: document.id, date: formatToUTC(data.date as Timestamp) } as ShopOrder;
    });
    if (products.some((product) => product.RefNumber))
        throw new Error("Historical Kontri references require reconciliation before a new submission.");
    if (products.some((product) => product.kontriStatusCode !== undefined && product.kontriStatusCode !== 0))
        throw new Error("Only new Kontri products can be prepared.");
    const mapping = await readKontriMapping();
    const lookup = createKontriLookup(mapping.records);
    const refNumber = uuidv4().replace(/-/g, "").slice(0, 16);
    const prepared = products.map((product) => {
        const resolution = resolveKontriProduct(product, lookup);
        if (resolution.status !== "matched") throw new Error(`Blocked Kontri mapping: ${resolution.reason}.`);
        return {
            ...product,
            kontriApiId: resolution.apiId,
            kontriMappingVersion: mapping.version,
            kontriOrderedAmount: Number(product.orderItemAmount),
            RefNumber: refNumber,
        };
    });
    const order = createKontriOrder(prepared, refNumber);
    const database = getFirestore(db.app);
    await runTransaction(database, async (transaction) => {
        const references = products.map((product) => doc(database, "products", product.fID!));
        const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
        snapshots.forEach((snapshot, index) => {
            const current = snapshot.data();
            const product = products[index];
            if (
                !snapshot.exists() ||
                current?.AltumOrderID !== null ||
                current.RefNumber ||
                (current.kontriStatusCode !== undefined && current.kontriStatusCode !== 0) ||
                current.code !== product.code ||
                current.orderItemCode !== product.orderItemCode ||
                current.orderItemEan !== product.orderItemEan ||
                Number(current.orderItemAmount) !== Number(product.orderItemAmount)
            )
                throw new Error("Kontri product changed or was claimed by another sender.");
        });
        prepared.forEach((product, index) =>
            transaction.update(references[index], {
                kontriApiId: product.kontriApiId,
                kontriMappingVersion: product.kontriMappingVersion,
                kontriOrderedAmount: product.kontriOrderedAmount,
                RefNumber: refNumber,
                AltumOrderID: refNumber,
                kontriStatusCode: 90,
                kontriStatusName: "Nepotvrzeno",
                kontriReconciliationRequired: true,
            }),
        );
    });

    return order;
};
