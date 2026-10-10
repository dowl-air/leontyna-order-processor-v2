"use server";

import { getPendingProducts } from "@/db/getPendingProducts";
import type { PendingKontriProduct } from "@/db/getPendingProducts";
import { readKontriMapping } from "@/db/readKontriMapping";
import { createKontriLookup, resolveKontriProduct } from "@/utils/resolveKontriProduct";
import type { KontriResolution } from "@/utils/resolveKontriProduct";

export type KontriMappingPreview = {
    status: "success";
    version: string | null;
    matchedCount: number;
    blockedCount: number;
    rows: (PendingKontriProduct & { resolution: KontriResolution })[];
};

export async function previewKontriMapping(): Promise<KontriMappingPreview | { status: "error"; message: string }> {
    try {
        const products = await getPendingProducts();
        if (!products.length) return { status: "success", version: null, rows: [], matchedCount: 0, blockedCount: 0 };
        const mapping = await readKontriMapping();
        const lookup = createKontriLookup(mapping.records);
        const rows = products.map((product) => ({ ...product, resolution: resolveKontriProduct(product, lookup) }));
        rows.sort((first, second) => first.resolution.status.localeCompare(second.resolution.status) || first.code.localeCompare(second.code));
        const matchedCount = rows.filter((row) => row.resolution.status === "matched").length;
        return { status: "success", version: mapping.version, rows, matchedCount, blockedCount: rows.length - matchedCount };
    } catch {
        return { status: "error", message: "Náhled párování se nepodařilo načíst. Ověřte dostupnost produktů a úplnost aktivní Kontri cache." };
    }
}
