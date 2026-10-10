import { doc, getFirestore, runTransaction } from "firebase/firestore";
import ShopOrder from "@/types/ShopOrder";
import { db } from "./init";

export async function persistKontriProducts(
    updates: { product: ShopOrder; fields: Partial<ShopOrder> }[],
    refNumber: string,
    reconciliation = false,
    calculatedShortages = false,
) {
    if (!updates.length || updates.length > 450 || !refNumber) throw new Error("Invalid Kontri persistence group.");
    const database = getFirestore(db.app);
    const ids = updates.map(({ product }) => product.fID ?? `${product.code}_${product.orderItemCode}`);
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate Kontri persistence documents.");
    const references = ids.map((id) => doc(database, "products", id));
    return runTransaction(database, async (transaction) => {
        const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
        if (calculatedShortages && snapshots.some((snapshot) => snapshot.data()?.kontriStatusCode >= 300)) return false;
        const writable = snapshots.map((snapshot, index) => {
            const current = snapshot.data();
            const fields = updates[index].fields;
            if (!snapshot.exists() || current?.RefNumber !== refNumber || (fields.RefNumber && fields.RefNumber !== refNumber))
                throw new Error("Kontri product reference changed.");
            if (calculatedShortages) {
                const product = updates[index].product;
                if (
                    current.kontriApiId !== product.kontriApiId ||
                    current.kontriOrderedAmount !== product.kontriOrderedAmount ||
                    current.kontriRequestJson !== product.kontriRequestJson ||
                    current.kontriRequestLeaderId !== product.kontriRequestLeaderId ||
                    JSON.stringify(current.kontriRequestProductIds) !== JSON.stringify(product.kontriRequestProductIds)
                )
                    throw new Error("Kontri quantity snapshot changed.");
            }
            if (
                fields.AltumOrderID &&
                current.AltumOrderID &&
                String(current.AltumOrderID) !== refNumber &&
                String(current.AltumOrderID) !== fields.AltumOrderID
            )
                throw new Error("Conflicting confirmed Kontri order ID.");
            return !(reconciliation && current.kontriStatusCode >= 100 && !current.kontriReconciliationRequired);
        });
        writable.forEach((write, index) => {
            if (!write) return;
            const fields = { ...updates[index].fields };
            const current = snapshots[index].data()!;
            if (fields.kontriStatusCode === 100 && current.kontriStatusCode > 100) {
                fields.kontriStatusCode = current.kontriStatusCode;
                if (typeof current.kontriStatusName === "string") fields.kontriStatusName = current.kontriStatusName;
            }
            transaction.update(references[index], fields);
        });
        return writable.some(Boolean);
    });
}
