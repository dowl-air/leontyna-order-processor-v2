import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShopOrder from "@/types/ShopOrder";
import { createKontriOrder } from "@/utils/createKontriOrder";

const mocks = vi.hoisted(() => ({
    newOrder: vi.fn(),
    retry: vi.fn(),
    pending: vi.fn(),
    send: vi.fn(),
    update: vi.fn(),
    persist: vi.fn(),
    mail: vi.fn(),
    check: vi.fn(),
}));
vi.mock("@/db/getNewOrder", () => ({ getNewOrder: mocks.newOrder, prepareKontriRetry: mocks.retry }));
vi.mock("@/db/getUnconfirmedOrders", () => ({ getUnconfirmedOrders: mocks.pending }));
vi.mock("@/db/persistKontriProducts", () => ({ persistKontriProducts: mocks.persist }));
vi.mock("./sendOrder", () => ({ sendOrder: mocks.send }));
vi.mock("./sendMail", () => ({ sendMail: mocks.mail }));
vi.mock("./checkOrderRefNumber", () => ({ checkOrderByRefNumber: mocks.check }));
import { sendOrders } from "./triggerOrdersSend";

const products = [
    { fID: "older", code: "first", date: "2026-10-09", orderItemCode: "AK-5-100", kontriApiId: "900", kontriOrderedAmount: 2, RefNumber: "stable" },
    { fID: "newer", code: "second", date: "2026-10-10", orderItemCode: "AK-5-100", kontriApiId: "900", kontriOrderedAmount: 3, RefNumber: "stable" },
] as ShopOrder[];
const order = createKontriOrder(products, "stable");
async function run() {
    const result = sendOrders();
    await vi.runAllTimersAsync();
    return result;
}

describe("sendOrders with persisted mapping", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        mocks.pending.mockResolvedValue([]);
        mocks.newOrder.mockResolvedValue(order);
        mocks.retry.mockResolvedValue(order);
        mocks.update.mockResolvedValue(undefined);
        mocks.persist.mockImplementation(async (updates: { product: ShopOrder; fields: Partial<ShopOrder> }[]) => {
            for (const update of updates) await mocks.update(update.product, update.fields);
            return true;
        });
        mocks.mail.mockResolvedValue({ messageId: "mock" });
        mocks.send.mockResolvedValue({
            Code: 100,
            AltumOrderID: "123",
            OrderNumber: "K-123",
            Shortages: { Shortages: [{ AltumArticleID: 900, Quantity: 4 }] },
        });
    });
    afterEach(() => vi.useRealTimers());
    it("sends mapped IDs and distributes shortages once by persisted identity", async () => {
        expect((await run()).status).toBe("success");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.persist).toHaveBeenCalledOnce();
        expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("products");
        expect(mocks.send.mock.calls[0][0].OrderedItems[0].AltumArticleId).toBe(900);
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ AltumOrderID: "123", RefNumber: "stable", shortage: 1 }));
        expect(mocks.update).toHaveBeenCalledWith(products[1], expect.objectContaining({ shortage: 3 }));
    });
    it.each([0, 10])("does not claim success or replace the snapshot for response %s", async (Code) => {
        mocks.send.mockResolvedValue({ Code });
        expect((await run()).status).toBe("error");
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it.each([90, 99])("keeps queued response %s available for a later retry without an error email", async (Code) => {
        mocks.send.mockResolvedValue({ Code });
        expect((await run()).status).toBe("info");
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("does not resend after a timeout, and reconciles by the same reference", async () => {
        mocks.send.mockRejectedValue(new Error("network timeout"));
        expect((await run()).status).toBe("error");
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockResolvedValue({ Code: 200, AltumOrderID: 123, AltumOrderNumber: "K-123" });
        expect((await run()).status).toBe("info");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.check).toHaveBeenCalledWith("stable");
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ AltumOrderID: "123", kontriReconciliationRequired: true }));
        expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("shortage");
    });
    it("retries a referenced request after a failed lookup instead of blocking on its reference", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockResolvedValue({ Code: 500, Message: "unknown" });
        expect((await run()).status).toBe("success");
        expect(mocks.retry).toHaveBeenCalledWith(products, "stable");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.send.mock.calls[0][0].RefNumber).toBe("stable");
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("retries after a thrown lookup and stops without replacing a conflicting reference", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.check.mockRejectedValue(new Error("network"));
        mocks.send.mockResolvedValue({ Code: 110 });
        expect((await run()).status).toBe("error");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.newOrder).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ kontriStatusCode: 110 }));
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it("replays after a timeout on a later run when lookup still cannot find the request", async () => {
        mocks.send.mockRejectedValueOnce(new Error("timeout"));
        expect((await run()).status).toBe("error");
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockResolvedValue({ Code: 60 });
        expect((await run()).status).toBe("success");
        expect(mocks.send).toHaveBeenCalledTimes(2);
        expect(mocks.send.mock.calls[1][0]).toEqual(mocks.send.mock.calls[0][0]);
    });
    it("reports a queued retry as info, not confirmed success", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.check.mockResolvedValue({ Code: 60 });
        mocks.send.mockResolvedValue({ Code: 99 });
        mocks.newOrder.mockResolvedValue(null);
        expect((await run()).status).toBe("info");
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("does not confirm a status response missing the real Kontri order ID", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "old", products }]);
        mocks.check.mockResolvedValue({ Code: 200 });
        expect((await run()).status).toBe("error");
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();
    });
    it("does not persist a success response with unmatched shortage IDs", async () => {
        mocks.send.mockResolvedValue({ Code: 100, AltumOrderID: "123", Shortages: { Shortages: [{ AltumArticleID: 100, Quantity: 1 }] } });
        expect((await run()).status).toBe("error");
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("does not claim success after confirmation persistence fails", async () => {
        mocks.persist.mockRejectedValue(new Error("commit failed"));
        expect((await run()).status).toBe("error");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it.each([100, 101])("keeps shortage certainty unknown for confirmed response %s without shortage details", async (Code) => {
        mocks.send.mockResolvedValue({ Code, AltumOrderID: "123", OrderNumber: "K-123", Shortages: null });
        expect((await run()).status).toBe("info");
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ AltumOrderID: "123", kontriReconciliationRequired: true }));
        expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("shortage");
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it("treats an explicit empty shortage list as confirmed zero", async () => {
        mocks.send.mockResolvedValue({ Code: 100, AltumOrderID: "123", Shortages: { Shortages: [] } });
        expect((await run()).status).toBe("success");
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ shortage: 0, kontriReconciliationRequired: false }));
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("preserves the original operation error when email delivery fails", async () => {
        mocks.newOrder.mockRejectedValue(new Error("internal secret"));
        mocks.mail.mockRejectedValue(new Error("SMTP secret"));
        const result = await run();
        expect(result.status).toBe("error");
        expect(JSON.stringify(result)).not.toContain("secret");
    });
});
