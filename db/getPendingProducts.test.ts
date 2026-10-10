import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDocs: vi.fn(), where: vi.fn(() => "pending-filter") }));
vi.mock("./init", () => ({ db: "database" }));
vi.mock("firebase/firestore/lite", () => ({
    collection: (...parts: unknown[]) => parts,
    query: (...parts: unknown[]) => parts,
    where: mocks.where,
    getDocs: mocks.getDocs,
}));
import { getPendingProducts } from "./getPendingProducts";

describe("getPendingProducts", () => {
    it("reads the pending products without creating references or modifying records", async () => {
        const data = {
            code: "order",
            orderItemCode: "AK-5-100",
            orderItemEan: "00123",
            orderItemName: "Product",
            orderItemAmount: "2",
            RefNumber: "keep",
        };
        mocks.getDocs.mockResolvedValue({ docs: [{ id: "document", data: () => data }] });
        expect(await getPendingProducts()).toEqual([
            { fID: "document", code: "order", orderItemCode: "AK-5-100", orderItemEan: "00123", orderItemName: "Product", orderItemAmount: 2 },
        ]);
        expect(mocks.where).toHaveBeenCalledWith("AltumOrderID", "==", null);
        expect(data.RefNumber).toBe("keep");
    });
});
