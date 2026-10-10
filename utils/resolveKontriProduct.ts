import type { KontriMappingRecord } from "./kontriFeed";

export type KontriResolution =
    | { status: "matched"; apiId: string; catalogId: string; source: "catalogId" | "apiId" | "ean" }
    | { status: "blocked"; reason: "invalidCode" | "notFound" | "eanMismatch" | "ambiguous" };

export function createKontriLookup(records: KontriMappingRecord[]) {
    const catalog = new Map<string, KontriMappingRecord[]>();
    const api = new Map<string, KontriMappingRecord[]>();
    const ean = new Map<string, KontriMappingRecord[]>();
    for (const record of records) {
        for (const [index, key] of [
            [catalog, record.catalogId],
            [api, record.apiId],
            [ean, record.ean],
        ] as const) {
            index.set(key, [...(index.get(key) ?? []), record]);
        }
    }
    return { catalog, api, ean };
}

export function resolveKontriProduct(
    product: { orderItemCode: string; orderItemEan: string },
    lookup: ReturnType<typeof createKontriLookup>,
): KontriResolution {
    const identifier = /^AK-[^-]+-([1-9]\d*)$/.exec(product.orderItemCode ?? "")?.[1];
    if (!identifier) return { status: "blocked", reason: "invalidCode" };
    const barcode = String(product.orderItemEan ?? "").trim();
    const candidates = [...new Set([...(lookup.catalog.get(identifier) ?? []), ...(lookup.api.get(identifier) ?? [])])];
    const matches = candidates.length
        ? candidates.filter((record) => !barcode || record.ean === barcode)
        : barcode
          ? (lookup.ean.get(barcode) ?? [])
          : [];
    if (!matches.length) return { status: "blocked", reason: candidates.length && barcode ? "eanMismatch" : "notFound" };
    if (matches.length !== 1) return { status: "blocked", reason: "ambiguous" };
    const record = matches[0];
    return {
        status: "matched",
        apiId: record.apiId,
        catalogId: record.catalogId,
        source: !candidates.length ? "ean" : record.catalogId === identifier ? "catalogId" : "apiId",
    };
}
