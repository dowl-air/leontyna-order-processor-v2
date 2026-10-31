import { doc, getFirestore, runTransaction } from "firebase/firestore";
import ShopOrder from "@/types/ShopOrder";
import { db } from "./init";

export const KONTRI_RETRY_FAILURE_LIMIT = 3;
export const KONTRI_MANUAL_REVIEW_STATUS = 120;

export async function recordKontriRetryFailure(products: ShopOrder[], refNumber: string, code: number) {
    if (!products.length || products.length > 450 || !refNumber) throw new Error("Invalid Kontri retry failure group.");
    const database = getFirestore(db.app);
    const references = products.map((product) => doc(database, "products", product.fID ?? `${product.code}_${product.orderItemCode}`));
    return runTransaction(database, async (transaction) => {
        const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
        const current = snapshots.map((snapshot) => snapshot.data());
        if (current.some((data) => !data || data.RefNumber !== refNumber || ![undefined, 0, 90].includes(data.kontriStatusCode))) return null;
        const failures = Math.max(...current.map((data) => (Number.isInteger(data!.kontriRetryFailures) ? data!.kontriRetryFailures : 0))) + 1;
        const escalated = failures >= KONTRI_RETRY_FAILURE_LIMIT;
        references.forEach((reference) =>
            transaction.update(reference, {
                kontriRetryFailures: failures,
                kontriLastErrorCode: code,
                ...(escalated ? { kontriStatusCode: KONTRI_MANUAL_REVIEW_STATUS, kontriStatusName: "Ruční kontrola" } : {}),
            }),
        );
        return { failures, escalated };
    });
}
