import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/readKontriMapping", () => ({ readKontriMapping: vi.fn() }));
import { readKontriMapping } from "@/db/readKontriMapping";
import { getKontriProductMapping } from "./getKontriProductMapping";

const mapping = {
    version: "active-version",
    feedDate: "2026-10-11 05:55",
    records: [
        { catalogId: "100", apiId: "900", ean: "00123" },
        { catalogId: "900", apiId: "901", ean: "00456" },
    ],
};

describe("getKontriProductMapping", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(readKontriMapping).mockResolvedValue(mapping);
    });
    it("looks up only the catalog ID and returns one record with active feed metadata", async () => {
        expect(await getKontriProductMapping("AK-5-900")).toEqual({
            status: "matched",
            itemId: "900",
            record: mapping.records[1],
            version: mapping.version,
            feedDate: mapping.feedDate,
        });
        expect(readKontriMapping).toHaveBeenCalledOnce();
    });
    it("reports an unknown catalog ID without API-ID fallback", async () => {
        expect(await getKontriProductMapping("AK-5-901")).toEqual({
            status: "notFound",
            itemId: "901",
            record: null,
            version: mapping.version,
            feedDate: mapping.feedDate,
        });
    });
    it("reports duplicate catalog IDs without selecting the first record", async () => {
        vi.mocked(readKontriMapping).mockResolvedValue({
            ...mapping,
            records: [...mapping.records, { catalogId: "100", apiId: "902", ean: "00789" }],
        });
        expect(await getKontriProductMapping("AK-5-100")).toMatchObject({ status: "ambiguous", record: null });
    });
    it("rejects malformed codes before reading the cache", async () => {
        expect(await getKontriProductMapping("AK-5-100-extra")).toEqual({ status: "invalidCode" });
        expect(readKontriMapping).not.toHaveBeenCalled();
    });
    it("returns a safe error without exposing cache exceptions", async () => {
        vi.mocked(readKontriMapping).mockRejectedValue(new Error("private transport detail"));
        expect(await getKontriProductMapping("AK-5-100")).toEqual({ status: "error" });
    });
});
