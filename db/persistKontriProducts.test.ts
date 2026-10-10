import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopOrder from "@/types/ShopOrder";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("./init", () => ({ db: { app: {} } }));
vi.mock("firebase/firestore", () => ({
    getFirestore: () => ({}),
    doc: (...parts: unknown[]) => parts,
    runTransaction: mocks.transaction,
}));
import { persistKontriProducts } from "./persistKontriProducts";

const products = [{ fID: "first" }, { fID: "second" }] as ShopOrder[];
const updates = products.map((product) => ({ product, fields: { AltumOrderID: "123", kontriStatusCode: 100, shortage: 0 } }));

describe("persistKontriProducts", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ RefNumber: "stable", AltumOrderID: "stable", kontriStatusCode: 90 }) });
        mocks.transaction.mockImplementation(async (_database, callback) => callback({ get: mocks.get, update: mocks.update }));
    });
    it("updates the group in one transaction after all reference checks", async () => {
        expect(await persistKontriProducts(updates, "stable")).toBe(true);
        expect(mocks.transaction).toHaveBeenCalledOnce();
        expect(mocks.update).toHaveBeenCalledTimes(2);
        expect(Math.max(...mocks.get.mock.invocationCallOrder)).toBeLessThan(Math.min(...mocks.update.mock.invocationCallOrder));
    });
    it("does not write any result when a product reference changed", async () => {
        mocks.get.mockResolvedValueOnce({ exists: () => true, data: () => ({ RefNumber: "stable" }) });
        mocks.get.mockResolvedValueOnce({ exists: () => true, data: () => ({ RefNumber: "different" }) });
        await expect(persistKontriProducts(updates, "stable")).rejects.toThrow();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("rejects a different previously confirmed real order ID", async () => {
        mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ RefNumber: "stable", AltumOrderID: "456" }) });
        await expect(persistKontriProducts(updates, "stable")).rejects.toThrow();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("does not downgrade known shortages during concurrent reconciliation", async () => {
        mocks.get.mockResolvedValue({
            exists: () => true,
            data: () => ({ RefNumber: "stable", AltumOrderID: "123", kontriStatusCode: 100, kontriReconciliationRequired: false }),
        });
        expect(await persistKontriProducts(updates, "stable", true)).toBe(false);
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("allows the original response to replace uncertain quantity reconciliation", async () => {
        mocks.get.mockResolvedValue({
            exists: () => true,
            data: () => ({ RefNumber: "stable", AltumOrderID: "123", kontriStatusCode: 100, kontriReconciliationRequired: true }),
        });
        expect(await persistKontriProducts(updates, "stable")).toBe(true);
        expect(mocks.update).toHaveBeenCalledTimes(2);
    });
    it("does not regress an advanced order status when the original response arrives late", async () => {
        mocks.get.mockResolvedValue({
            exists: () => true,
            data: () => ({
                RefNumber: "stable",
                AltumOrderID: "123",
                kontriStatusCode: 400,
                kontriStatusName: "Odesláno",
                kontriReconciliationRequired: true,
            }),
        });
        expect(await persistKontriProducts(updates, "stable")).toBe(true);
        expect(mocks.update).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ kontriStatusCode: 400, kontriStatusName: "Odesláno", shortage: 0 }),
        );
    });
    it("propagates a commit failure rather than claiming persistence succeeded", async () => {
        mocks.transaction.mockRejectedValue(new Error("commit failed"));
        await expect(persistKontriProducts(updates, "stable")).rejects.toThrow("commit failed");
    });
});
