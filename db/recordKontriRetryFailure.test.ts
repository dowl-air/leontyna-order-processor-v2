import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopOrder from "@/types/ShopOrder";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("./init", () => ({ db: { app: {} } }));
vi.mock("firebase/firestore", () => ({
    getFirestore: () => ({}),
    doc: (...parts: unknown[]) => parts,
    runTransaction: mocks.transaction,
}));
import { recordKontriRetryFailure } from "./recordKontriRetryFailure";

const products = [{ fID: "first" }, { fID: "second" }] as ShopOrder[];
const snapshot = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });

describe("recordKontriRetryFailure", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.get.mockResolvedValue(snapshot({ RefNumber: "stable", AltumOrderID: "stable", kontriStatusCode: 90 }));
        mocks.transaction.mockImplementation(async (_database, callback) => callback({ get: mocks.get, update: mocks.update }));
    });
    it("counts the failure on every product without changing the reference or request", async () => {
        mocks.get.mockResolvedValueOnce(snapshot({ RefNumber: "stable", kontriStatusCode: 90, kontriRetryFailures: 1 }));
        expect(await recordKontriRetryFailure(products, "stable", 0)).toEqual({ failures: 2, escalated: false });
        expect(mocks.update).toHaveBeenCalledTimes(2);
        for (const [, fields] of mocks.update.mock.calls) expect(fields).toEqual({ kontriRetryFailures: 2, kontriLastErrorCode: 0 });
        expect(Math.max(...mocks.get.mock.invocationCallOrder)).toBeLessThan(Math.min(...mocks.update.mock.invocationCallOrder));
    });
    it("moves the group to manual review on the third failure", async () => {
        mocks.get.mockResolvedValue(snapshot({ RefNumber: "stable", kontriStatusCode: 90, kontriRetryFailures: 2 }));
        expect(await recordKontriRetryFailure(products, "stable", -1)).toEqual({ failures: 3, escalated: true });
        expect(mocks.update).toHaveBeenCalledWith([{}, "products", "first"], {
            kontriRetryFailures: 3,
            kontriLastErrorCode: -1,
            kontriStatusCode: 120,
            kontriStatusName: "Ruční kontrola",
        });
    });
    it.each([
        { RefNumber: "other", kontriStatusCode: 90 },
        { RefNumber: "stable", kontriStatusCode: 100 },
        { RefNumber: "stable", kontriStatusCode: 120 },
    ])("does not write when a product changed concurrently (%o)", async (data) => {
        mocks.get.mockResolvedValueOnce(snapshot(data));
        expect(await recordKontriRetryFailure(products, "stable", 0)).toBeNull();
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
