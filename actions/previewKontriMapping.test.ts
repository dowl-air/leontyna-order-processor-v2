import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ products: vi.fn(), mapping: vi.fn() }));
vi.mock("@/db/getPendingProducts", () => ({ getPendingProducts: mocks.products }));
vi.mock("@/db/readKontriMapping", () => ({ readKontriMapping: mocks.mapping }));
import { previewKontriMapping } from "./previewKontriMapping";

describe("previewKontriMapping", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.products.mockResolvedValue([
            { fID: "order_AK-5-100", code: "order", orderItemCode: "AK-5-100", orderItemEan: "00123", orderItemName: "Product", orderItemAmount: 2 },
            { fID: "order_AK-5-999", code: "order", orderItemCode: "AK-5-999", orderItemEan: "missing", orderItemName: "Other", orderItemAmount: 1 },
        ]);
        mocks.mapping.mockResolvedValue({ version: "active", records: [{ catalogId: "100", apiId: "900", ean: "00123" }] });
    });
    it("returns a read-only preview with matched and blocked counts", async () => {
        const originals = JSON.stringify(await mocks.products());
        mocks.products.mockClear();
        const result = await previewKontriMapping();
        expect(result).toMatchObject({ status: "success", version: "active", matchedCount: 1, blockedCount: 1 });
        if (result.status !== "success") throw new Error("Expected preview.");
        expect(result.rows[0]).toMatchObject({ fID: "order_AK-5-999", resolution: { status: "blocked", reason: "notFound" } });
        expect(result.rows[1]).toMatchObject({ fID: "order_AK-5-100", resolution: { status: "matched", apiId: "900" } });
        expect(mocks.products).toHaveBeenCalledOnce();
        expect(mocks.mapping).toHaveBeenCalledOnce();
        expect(JSON.stringify(await mocks.products())).toBe(originals);
    });
    it("returns an empty preview without requiring a mapping cache", async () => {
        mocks.products.mockResolvedValue([]);
        expect(await previewKontriMapping()).toMatchObject({ status: "success", rows: [], matchedCount: 0, blockedCount: 0 });
        expect(mocks.mapping).not.toHaveBeenCalled();
    });
    it.each(["products", "mapping"] as const)("does not expose internal %s errors", async (dependency) => {
        mocks[dependency].mockRejectedValue(new Error("secret internal detail"));
        const result = await previewKontriMapping();
        expect(result.status).toBe("error");
        expect(JSON.stringify(result)).not.toContain("secret");
    });
});
