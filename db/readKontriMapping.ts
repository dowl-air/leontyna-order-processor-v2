import { createHash } from "node:crypto";
import { collection, doc, getDoc, getDocs, getFirestore } from "firebase/firestore";
import type { KontriMappingRecord } from "@/utils/kontriFeed";
import { db } from "./init";

export async function readKontriMapping(): Promise<{ version: string; records: KontriMappingRecord[] }> {
    const database = getFirestore(db.app);
    const pointer = await getDoc(doc(database, "kontriMappingState", "current"));
    if (!pointer.exists()) throw new Error("Missing active Kontri mapping.");
    const { version, chunkCount, recordCount, hash } = pointer.data();
    if (
        typeof version !== "string" ||
        !version ||
        !Number.isInteger(chunkCount) ||
        chunkCount < 1 ||
        !Number.isInteger(recordCount) ||
        recordCount < 1 ||
        typeof hash !== "string"
    )
        throw new Error("Invalid mapping metadata.");
    const chunks = await getDocs(collection(database, "kontriMappings", version, "chunks"));
    if (chunks.docs.length !== chunkCount) throw new Error("Incomplete mapping chunks.");
    const ordered = new Map(chunks.docs.map((chunk) => [chunk.id, chunk.data().data]));
    const records: KontriMappingRecord[] = [];
    for (let index = 0; index < chunkCount; index++) {
        const data = ordered.get(String(index));
        if (typeof data !== "string") throw new Error("Missing mapping chunk.");
        const entries: unknown = JSON.parse(data);
        if (!Array.isArray(entries)) throw new Error("Invalid mapping chunk.");
        for (const entry of entries) {
            if (
                !entry ||
                typeof entry.catalogId !== "string" ||
                !/^[1-9]\d*$/.test(entry.catalogId) ||
                typeof entry.apiId !== "string" ||
                !/^[1-9]\d*$/.test(entry.apiId) ||
                typeof entry.ean !== "string" ||
                !entry.ean
            )
                throw new Error("Invalid mapping record.");
            records.push({ catalogId: entry.catalogId, apiId: entry.apiId, ean: entry.ean });
        }
    }
    if (records.length !== recordCount || createHash("sha256").update(JSON.stringify(records)).digest("hex") !== hash)
        throw new Error("Invalid mapping contents.");
    for (const field of ["catalogId", "apiId", "ean"] as const) {
        if (new Set(records.map((record) => record[field])).size !== records.length) throw new Error("Duplicate mapping records.");
    }
    return { version, records };
}
