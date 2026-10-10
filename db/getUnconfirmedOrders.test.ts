import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock("./init", () => ({ db: {} }));
vi.mock("firebase/firestore/lite", () => ({
    collection: (...parts: unknown[]) => parts,
    query: (...parts: unknown[]) => parts,
    where: (...parts: unknown[]) => parts,
    getDocs: mocks.getDocs,
}));
vi.mock("@/utils/formatDate", () => ({ formatToUTC: () => "2026-10-10" }));
import { getUnconfirmedOrders } from "./getUnconfirmedOrders";

const document = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

describe("getUnconfirmedOrders", () => {
    beforeEach(() => vi.resetAllMocks());
    it("groups uncertain and historical products by stable reference without rebuilding requests", async () => {
        mocks.getDocs.mockResolvedValueOnce({ docs: [document("first", { RefNumber: "same", AltumOrderID: "placeholder", kontriStatusCode: 90 })] });
        mocks.getDocs.mockResolvedValueOnce({
            docs: [document("legacy", { RefNumber: "same", AltumOrderID: null }), document("new", { AltumOrderID: null })],
        });
        const groups = await getUnconfirmedOrders();
        expect(groups).toHaveLength(1);
        expect(groups[0].RefNumber).toBe("same");
        expect(groups[0].products.map((product) => product.fID)).toEqual(["first", "legacy"]);
        expect(groups[0]).not.toHaveProperty("OrderedItems");
    });
    it("rejects an uncertain order without a reference rather than inventing one", async () => {
        mocks.getDocs.mockResolvedValueOnce({ docs: [document("bad", { kontriStatusCode: 90 })] });
        mocks.getDocs.mockResolvedValueOnce({ docs: [] });
        await expect(getUnconfirmedOrders()).rejects.toThrow();
    });
});
