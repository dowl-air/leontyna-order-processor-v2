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
import { blockKontriEanMismatch } from "@/actions/blockKontriEanMismatch";

export const getNewOrder = async (): Promise<KontriOrder | null> => {
    const q = query(collection(db, "products"), where("AltumOrderID", "==", null));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return null;

    const products = querySnapshot.docs
        .map((document) => {
            const data = document.data();
            return { ...data, fID: document.id, date: formatToUTC(data.date as Timestamp) } as ShopOrder;
        })
        .filter((product) => !product.kontriEanBlocked);
    if (!products.length) return null;
    if (products.length > 450) throw new Error("Too many products for atomic Kontri preparation; manual review required.");
    if (products.some((product) => product.RefNumber))
        throw new Error("Historical Kontri references require reconciliation before a new submission.");
    if (products.some((product) => product.kontriStatusCode !== undefined && product.kontriStatusCode !== 0))
        throw new Error("Only new Kontri products can be prepared.");
    const mapping = await readKontriMapping();
    const lookup = createKontriLookup(mapping.records);
    const eligible: ShopOrder[] = [];
    for (const product of products) {
        const resolution = resolveKontriProduct(product, lookup);
        if (resolution.status === "blocked" && resolution.reason === "eanMismatch") {
            const identifier = /^AK-[^-]+-([1-9]\d*)$/.exec(product.orderItemCode)![1];
            const candidates = [...new Set([...(lookup.catalog.get(identifier) ?? []), ...(lookup.api.get(identifier) ?? [])])];
            await blockKontriEanMismatch(product, candidates, mapping.version);
        } else {
            if (resolution.status !== "matched") throw new Error(`Blocked Kontri mapping: ${resolution.reason}.`);
            eligible.push(product);
        }
    }
    if (!eligible.length) return null;
    return prepareOrder(eligible, uuidv4().replace(/-/g, "").slice(0, 16), false, mapping);
};

export const prepareKontriRetry = async (products: ShopOrder[], refNumber: string): Promise<KontriOrder> => {
    return prepareOrder(products, refNumber, true);
};

const prepareOrder = async (
    input: ShopOrder[],
    refNumber: string,
    retry: boolean,
    activeMapping?: Awaited<ReturnType<typeof readKontriMapping>>,
): Promise<KontriOrder> => {
    if (!input.length || input.length > 450 || !refNumber || refNumber.length > 16) throw new Error("Invalid Kontri preparation group.");
    const products = [...input].sort((first, second) => first.fID!.localeCompare(second.fID!));
    if (new Set(products.map((product) => product.fID)).size !== products.length || products.some((product) => !product.fID))
        throw new Error("Invalid Kontri product documents.");
    const stored = products.filter((product) => product.kontriRequestJson);
    if (
        products.some((product) => product.kontriRequestLeaderId) &&
        (stored.length !== 1 || products.some((product) => product.kontriRequestLeaderId !== stored[0].fID))
    )
        throw new Error("Kontri request leader is missing or inconsistent.");
    let prepared: ShopOrder[];
    let order: KontriOrder;
    if (stored.length) {
        if (!retry || stored.length !== 1) throw new Error("Conflicting Kontri request snapshots.");
        const payload = JSON.parse(stored[0].kontriRequestJson!);
        const ids = stored[0].kontriRequestProductIds;
        if (payload.RefNumber !== refNumber || !Array.isArray(ids) || JSON.stringify(ids) !== JSON.stringify(products.map((product) => product.fID)))
            throw new Error("Kontri request group changed.");
        prepared = products;
        const expected = createKontriOrder(prepared, refNumber);
        if (JSON.stringify(payload.OrderedItems) !== JSON.stringify(expected.OrderedItems)) throw new Error("Kontri request items changed.");
        order = { ...payload, products: prepared };
    } else {
        const mapping = activeMapping ?? (await readKontriMapping());
        const lookup = createKontriLookup(mapping.records);
        prepared = products.map((product) => {
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
        order = createKontriOrder(prepared, refNumber);
    }
    const { products: requestProducts, ...payload } = order;
    const requestJson = JSON.stringify(payload);
    if (Buffer.byteLength(requestJson, "utf8") > 250 * 1024) throw new Error("Kontri request snapshot is too large.");
    const database = getFirestore(db.app);
    await runTransaction(database, async (transaction) => {
        const references = products.map((product) => doc(database, "products", product.fID!));
        const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
        snapshots.forEach((snapshot, index) => {
            const current = snapshot.data();
            const product = products[index];
            if (
                !snapshot.exists() ||
                !current ||
                !!current.kontriEanBlocked ||
                (retry ? current?.AltumOrderID !== null && current?.AltumOrderID !== refNumber : current?.AltumOrderID !== null) ||
                (retry ? current.RefNumber !== refNumber : !!current.RefNumber) ||
                (retry
                    ? ![undefined, 0, 90].includes(current.kontriStatusCode)
                    : current.kontriStatusCode !== undefined && current.kontriStatusCode !== 0) ||
                current.kontriRequestJson !== product.kontriRequestJson ||
                current.kontriRequestLeaderId !== product.kontriRequestLeaderId ||
                JSON.stringify(current.kontriRequestProductIds) !== JSON.stringify(product.kontriRequestProductIds) ||
                current.kontriApiId !== product.kontriApiId ||
                current.kontriMappingVersion !== product.kontriMappingVersion ||
                current.kontriOrderedAmount !== product.kontriOrderedAmount ||
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
                kontriRequestLeaderId: products[0].fID!,
                ...(index === 0 ? { kontriRequestJson: requestJson, kontriRequestProductIds: products.map((item) => item.fID!) } : {}),
            }),
        );
    });

    return order;
};
