import { createHash, randomUUID } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type KontriMappingRecord = { catalogId: string; apiId: string; ean: string };
export type KontriMappingVersion = {
    version: string;
    hash: string;
    feedDate: string;
    fetchedAt: number;
    recordCount: number;
    chunkCount: number;
};
export type KontriMappingStore = {
    current: () => Promise<{ hash: string; recordCount: number } | null>;
    save: (metadata: KontriMappingVersion, chunks: string[]) => Promise<void>;
    publish: (metadata: KontriMappingVersion) => Promise<boolean>;
    cleanup: () => Promise<void>;
};

export class KontriFeedDropError extends Error {
    constructor(
        public previousCount: number,
        public incomingCount: number,
    ) {
        super("Kontri mapping record count dropped by more than 25 percent.");
    }
}

export function assertKontriMappingCount(previousCount: number, incomingCount: number) {
    if (incomingCount < previousCount * 0.75) throw new KontriFeedDropError(previousCount, incomingCount);
}

export function parseKontriFeed(xml: string): { feedDate: string; records: KontriMappingRecord[] } {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid Kontri XML.");
    const parsed = new XMLParser({ parseTagValue: false, trimValues: true }).parse(xml);
    const feedDate = parsed.ROOT?.DATA;
    if (typeof feedDate !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(feedDate)) throw new Error("Missing Kontri feed date.");
    const records: KontriMappingRecord[] = [];
    const walk = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(walk);
        const fields = value as Record<string, unknown>;
        if ("id_instancji" in fields) {
            const { id_instancji: catalogId, id_instancji_api: apiId, kod_kreskowy: ean } = fields;
            if (
                typeof catalogId !== "string" ||
                !/^[1-9]\d*$/.test(catalogId) ||
                typeof apiId !== "string" ||
                !/^[1-9]\d*$/.test(apiId) ||
                typeof ean !== "string" ||
                !ean
            )
                throw new Error("Incomplete Kontri mapping record.");
            records.push({ catalogId, apiId, ean });
        }
        Object.values(fields).forEach(walk);
    };
    walk(parsed.ROOT?.PRODUKTY);
    if (!records.length) throw new Error("Empty Kontri mapping.");
    for (const field of ["catalogId", "apiId", "ean"] as const) {
        if (new Set(records.map((record) => record[field])).size !== records.length) throw new Error(`Duplicate Kontri ${field}.`);
    }
    records.sort((first, second) => first.catalogId.localeCompare(second.catalogId));
    return { feedDate, records };
}

export function buildMappingChunks(records: KontriMappingRecord[], maxBytes = 250 * 1024): string[] {
    const chunks: string[] = [];
    let items: string[] = [];
    let bytes = 2;
    for (const record of records) {
        const item = JSON.stringify(record);
        const size = Buffer.byteLength(item, "utf8");
        if (size + 2 > maxBytes) throw new Error("Kontri mapping record exceeds chunk limit.");
        if (bytes + size + (items.length ? 1 : 0) > maxBytes) {
            chunks.push(`[${items.join(",")}]`);
            items = [];
            bytes = 2;
        }
        bytes += size + (items.length ? 1 : 0);
        items.push(item);
    }
    if (items.length) chunks.push(`[${items.join(",")}]`);
    return chunks;
}

export async function refreshKontriMapping(xml: string, store: KontriMappingStore) {
    const { records, feedDate } = parseKontriFeed(xml);
    const hash = createHash("sha256").update(JSON.stringify(records)).digest("hex");
    const current = await store.current();
    if (current) assertKontriMappingCount(current.recordCount, records.length);
    const unchanged = current?.hash === hash;
    let rejected = false;
    if (!unchanged) {
        const chunks = buildMappingChunks(records);
        const metadata: KontriMappingVersion = {
            version: randomUUID(),
            hash,
            feedDate,
            fetchedAt: Date.now(),
            recordCount: records.length,
            chunkCount: chunks.length,
        };
        await store.save(metadata, chunks);
        rejected = !(await store.publish(metadata));
    }
    let cleanupFailed = false;
    try {
        await store.cleanup();
    } catch {
        cleanupFailed = true;
    }
    return { hash, recordCount: records.length, unchanged, rejected, cleanupFailed };
}
