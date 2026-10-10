import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDocs: vi.fn(), get: vi.fn(), update: vi.fn(), transaction: vi.fn(), mapping: vi.fn() }));
vi.mock("./init", () => ({ db: { app: {} } }));
vi.mock("firebase/firestore/lite", () => ({
    collection: (...parts: unknown[]) => parts,
    query: (...parts: unknown[]) => parts,
    where: (...parts: unknown[]) => parts,
    getDocs: mocks.getDocs,
}));
vi.mock("firebase/firestore", () => ({
    getFirestore: () => ({}),
    doc: (...parts: unknown[]) => parts,
    runTransaction: mocks.transaction,
}));
vi.mock("./readKontriMapping", () => ({ readKontriMapping: mocks.mapping }));
vi.mock("@/utils/formatDate", () => ({ formatToUTC: () => "2026-10-10" }));
vi.mock("uuid", () => ({ v4: () => "12345678-1234-1234-1234-123456789012" }));
import { getNewOrder } from "./getNewOrder";

const product = { code: "order", orderItemCode: "AK-5-100", orderItemEan: "00123", orderItemAmount: 2, AltumOrderID: null };
const document = (data = product) => ({ id: "original-document", data: () => data });

describe("getNewOrder preparation", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document()] });
        mocks.mapping.mockResolvedValue({ version: "mapping-version", records: [{ catalogId: "100", apiId: "900", ean: "00123" }] });
        mocks.get.mockResolvedValue({ exists: () => true, data: () => product });
        mocks.transaction.mockImplementation(async (_database, callback) => callback({ get: mocks.get, update: mocks.update }));
    });
    it("persists ID, quantity and reference atomically before returning a request", async () => {
        const order = await getNewOrder();
        expect(order?.OrderedItems[0]).toEqual({ AltumArticleId: 900, Amount: 2, ClientOrderNumber: "order" });
        expect(mocks.transaction).toHaveBeenCalledOnce();
        expect(mocks.update).toHaveBeenCalledWith(
            [{}, "products", "original-document"],
            expect.objectContaining({
                kontriApiId: "900",
                kontriMappingVersion: "mapping-version",
                kontriOrderedAmount: 2,
                RefNumber: "1234567812341234",
                AltumOrderID: "1234567812341234",
                kontriStatusCode: 90,
                kontriReconciliationRequired: true,
            }),
        );
        expect(product.orderItemCode).toBe("AK-5-100");
    });
    it("does not read the cache when there are no new products", async () => {
        mocks.getDocs.mockResolvedValue({ empty: true, docs: [] });
        expect(await getNewOrder()).toBeNull();
        expect(mocks.mapping).not.toHaveBeenCalled();
    });
    it("does not persist anything when mapping is blocked", async () => {
        mocks.mapping.mockResolvedValue({ version: "version", records: [] });
        await expect(getNewOrder()).rejects.toThrow();
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it("blocks historical references rather than silently replacing them", async () => {
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document({ ...product, RefNumber: "old-reference" } as typeof product)] });
        await expect(getNewOrder()).rejects.toThrow();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it.each([80, 100, 400])("does not prepare a product in non-new status %s", async (kontriStatusCode) => {
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document({ ...product, kontriStatusCode } as typeof product)] });
        await expect(getNewOrder()).rejects.toThrow();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("blocks an order claimed by a concurrent sender", async () => {
        mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ ...product, RefNumber: "other", AltumOrderID: "other" }) });
        await expect(getNewOrder()).rejects.toThrow();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("blocks products changed after mapping was resolved", async () => {
        mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ ...product, orderItemAmount: 3 }) });
        await expect(getNewOrder()).rejects.toThrow();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("does not return a sendable request when transaction persistence fails", async () => {
        mocks.transaction.mockRejectedValue(new Error("write failed"));
        await expect(getNewOrder()).rejects.toThrow("write failed");
    });
    it("blocks oversized groups before mapping or persistence", async () => {
        mocks.getDocs.mockResolvedValue({ empty: false, docs: Array.from({ length: 451 }, () => document()) });
        await expect(getNewOrder()).rejects.toThrow("Too many");
        expect(mocks.mapping).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
    });
    it("does not write any product when another product in the group changed", async () => {
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document(), { id: "second-document", data: () => product }] });
        mocks.get.mockResolvedValueOnce({ exists: () => true, data: () => product });
        mocks.get.mockResolvedValueOnce({ exists: () => true, data: () => ({ ...product, orderItemAmount: 3 }) });
        await expect(getNewOrder()).rejects.toThrow("changed");
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
