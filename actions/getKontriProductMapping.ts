"use server";

import { readKontriMapping } from "@/db/readKontriMapping";
import type { KontriMappingRecord } from "@/utils/kontriFeed";

export type KontriProductMappingResult =
    | { status: "invalidCode" | "error" }
    | {
          status: "matched" | "notFound" | "ambiguous";
          itemId: string;
          record: KontriMappingRecord | null;
          version: string;
          feedDate: string | null;
      };

export async function getKontriProductMapping(orderItemCode: string): Promise<KontriProductMappingResult> {
    const itemId = typeof orderItemCode === "string" ? /^AK-[^-]+-([1-9]\d*)$/.exec(orderItemCode)?.[1] : undefined;
    if (!itemId) return { status: "invalidCode" };
    try {
        const mapping = await readKontriMapping();
        const matches = mapping.records.filter((record) => record.catalogId === itemId);
        return {
            status: matches.length === 1 ? "matched" : matches.length ? "ambiguous" : "notFound",
            itemId,
            record: matches.length === 1 ? matches[0] : null,
            version: mapping.version,
            feedDate: mapping.feedDate,
        };
    } catch {
        return { status: "error" };
    }
}
