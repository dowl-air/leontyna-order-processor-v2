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
    recordFailure: vi.fn(),
    service: vi.fn(),
}));
vi.mock("@/db/getNewOrder", () => ({ getNewOrder: mocks.newOrder, prepareKontriRetry: mocks.retry }));
vi.mock("@/db/getUnconfirmedOrders", () => ({ getUnconfirmedOrders: mocks.pending }));
vi.mock("@/db/persistKontriProducts", () => ({ persistKontriProducts: mocks.persist }));
vi.mock("./sendOrder", () => ({ sendOrder: mocks.send }));
vi.mock("./sendMail", () => ({ sendMail: mocks.mail }));
vi.mock("./checkOrderRefNumber", () => ({ checkOrderByRefNumber: mocks.check }));
vi.mock("@/db/recordKontriRetryFailure", () => ({ KONTRI_RETRY_FAILURE_LIMIT: 3, recordKontriRetryFailure: mocks.recordFailure }));
vi.mock("@/utils/soapClient", () => ({ checkService: mocks.service }));
import { sendOrders } from "./triggerOrdersSend";

const products = [
    { fID: "older", code: "first", date: "2026-10-09", orderItemCode: "AK-5-100", kontriApiId: "900", kontriOrderedAmount: 2, RefNumber: "stable" },
    { fID: "newer", code: "second", date: "2026-10-10", orderItemCode: "AK-5-100", kontriApiId: "900", kontriOrderedAmount: 3, RefNumber: "stable" },
] as ShopOrder[];
const order = createKontriOrder(products, "stable");
function quantityGroup() {
    const sorted = [...products].sort((first, second) => first.fID!.localeCompare(second.fID!));
    const { products: internal, ...payload } = createKontriOrder(sorted, "stable");
    return sorted.map((product, index) => ({
        ...product,
        AltumOrderID: "123",
        kontriStatusCode: 100,
        kontriReconciliationRequired: true,
        kontriRequestLeaderId: sorted[0].fID,
        ...(index === 0 ? { kontriRequestJson: JSON.stringify(payload), kontriRequestProductIds: sorted.map((item) => item.fID!) } : {}),
    }));
}
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
        mocks.recordFailure.mockResolvedValue({ failures: 1, escalated: false });
        mocks.service.mockResolvedValue({ CheckStatusResult: "OK" });
        mocks.send.mockResolvedValue({
            Code: 100,
            AltumOrderID: "123",
            OrderNumber: "K-123",
            Shortages: { Shortages: [{ AltumArticleID: 900, Quantity: 4 }] },
        });
    });
    afterEach(() => vi.useRealTimers());
    it.each([1, 2])("records full saved shortages for code 80 with %s products", async (count) => {
        const rejected = products.slice(0, count).map((product) => ({ ...product, orderItemAmount: 99 }));
        mocks.newOrder.mockResolvedValue(createKontriOrder(rejected, "stable"));
        mocks.send.mockResolvedValue({ Code: 80, Message: "" });
        const result = await run();
        for (const product of rejected) {
            expect(mocks.update).toHaveBeenCalledWith(product, {
                kontriStatusCode: 80,
                kontriStatusName: "Nedostupné",
                shortage: product.kontriOrderedAmount,
                kontriReconciliationRequired: false,
            });
        }
        expect(mocks.persist).toHaveBeenCalledWith(expect.any(Array), "stable", false, true);
        expect(mocks.mail).toHaveBeenCalledTimes(1);
        expect(mocks.mail).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: "[Kontri objednávky] Nedostatky",
                text: expect.stringContaining("nevznikla"),
            }),
        );
        const text = mocks.mail.mock.calls[0][0].text;
        expect(text).toContain(`Celkem chybí: ${count === 1 ? 2 : 5} ks`);
        expect(text).toContain("stable");
        expect(text).not.toContain("Altum ID");
        expect(result.message).not.toContain("Vyžaduje ruční kontrolu");
    });
    it("does not email shortages when code 80 persistence makes no writes", async () => {
        mocks.send.mockResolvedValue({ Code: 80 });
        mocks.persist.mockResolvedValue(false);
        expect((await run()).message).toContain("nebyly zapsány");
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("keeps saved code 80 shortages after SMTP failure without another POST", async () => {
        mocks.send.mockResolvedValue({ Code: 80 });
        mocks.mail.mockRejectedValue(new Error("SMTP failure"));
        expect((await run()).message).toContain("E-mailové upozornění se nepodařilo odeslat");
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ shortage: 2, kontriReconciliationRequired: false }));
        expect(mocks.send).toHaveBeenCalledTimes(1);
        expect(mocks.mail).toHaveBeenCalledTimes(1);
    });
    it.each([5, 1])("automatically reconciles a found Nowe order accepting %s units without POST", async (quantity) => {
        const group = quantityGroup();
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products: group }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockResolvedValue({
            Code: 200,
            Status: "Nowe",
            AltumOrderID: 123,
            Articles: {
                Article: [
                    { AltumArticleID: 900, Quantity: quantity },
                    { AltumArticleID: 53086, Quantity: 1 },
                ],
            },
        });
        expect((await run()).status).toBe("success");
        expect(mocks.send).not.toHaveBeenCalled();
        if (quantity === 5) expect(mocks.mail).not.toHaveBeenCalled();
        else
            expect(mocks.mail).toHaveBeenCalledWith(
                expect.objectContaining({ subject: "[Kontri objednávky] Nedostatky", text: expect.stringContaining("Celkem chybí: 4 ks") }),
            );
        expect(mocks.update).toHaveBeenCalledWith(
            expect.objectContaining({ fID: "older" }),
            expect.objectContaining({ shortage: quantity === 5 ? 0 : 1, kontriReconciliationRequired: false }),
        );
        expect(mocks.update).toHaveBeenCalledWith(
            expect.objectContaining({ fID: "newer" }),
            expect.objectContaining({ shortage: quantity === 5 ? 0 : 3, kontriReconciliationRequired: false }),
        );
    });
    it("never retries a confirmed order when its quantity lookup fails", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products: quantityGroup() }]);
        mocks.check.mockResolvedValue({ Code: 500 });
        mocks.newOrder.mockResolvedValue(null);
        expect((await run()).status).toBe("info");
        expect(mocks.retry).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("leaves aggregated quantities unknown even when article quantities match", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products: quantityGroup() }]);
        mocks.check.mockResolvedValue({
            Code: 200,
            Status: "Kompletowane",
            AltumOrderID: 123,
            Articles: { Article: [{ AltumArticleID: 900, Quantity: 5 }] },
        });
        mocks.newOrder.mockResolvedValue(null);
        expect((await run()).status).toBe("info");
        expect(mocks.update.mock.calls[0][1]).not.toHaveProperty("shortage");
        expect(mocks.update.mock.calls[0][1].kontriReconciliationRequired).toBe(true);
    });
    it.each([true, false])("includes exact diagnostic details even when persistence returns %s", async (updated) => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products: quantityGroup() }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.persist.mockResolvedValue(updated);
        mocks.check.mockResolvedValue({
            Code: 200,
            Status: "Nowe",
            AltumOrderID: 123,
            Articles: { Article: [{ AltumArticleID: 999, Quantity: 1 }] },
        });
        const result = await run();
        expect(result.message).toContain("UNEXPECTED_API_ID");
        expect(result.message).toContain("API ID 999");
        expect(mocks.send).not.toHaveBeenCalled();
    });
    it("sends mapped IDs and distributes shortages once by persisted identity", async () => {
        expect((await run()).status).toBe("success");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.persist).toHaveBeenCalledOnce();
        expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("products");
        expect(mocks.send.mock.calls[0][0].OrderedItems[0].AltumArticleId).toBe(900);
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ AltumOrderID: "123", RefNumber: "stable", shortage: 1 }));
        expect(mocks.update).toHaveBeenCalledWith(products[1], expect.objectContaining({ shortage: 3 }));
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(mocks.mail).toHaveBeenCalledWith(
            expect.objectContaining({
                subject: "[Kontri objednávky] Nedostatky",
                text: expect.stringContaining("first | AK-5-100 | API 900 | chybí 1 ks"),
            }),
        );
    });
    it("retains confirmation and reports a failed shortage email without retry", async () => {
        mocks.mail.mockRejectedValue(new Error("SMTP failure"));
        const result = await run();
        expect(result.status).toBe("info");
        expect(result.message).toContain("E-mailové upozornění se nepodařilo odeslat");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.persist).toHaveBeenCalledOnce();
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it("does not notify shortages when reconciliation persistence makes no writes", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products: quantityGroup() }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.persist.mockResolvedValue(false);
        mocks.check.mockResolvedValue({
            Code: 200,
            Status: "Nowe",
            AltumOrderID: 123,
            Articles: { Article: [{ AltumArticleID: 900, Quantity: 1 }] },
        });
        await run();
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("does not send a shortage email for a confirmed empty shortage list", async () => {
        mocks.send.mockResolvedValue({ Code: 100, AltumOrderID: "123", Shortages: { Shortages: [] } });
        expect((await run()).status).toBe("success");
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("reports failed reconciliation email while retaining saved shortages", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products: quantityGroup() }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockResolvedValue({
            Code: 200,
            Status: "Nowe",
            AltumOrderID: 123,
            Articles: { Article: [{ AltumArticleID: 900, Quantity: 1 }] },
        });
        mocks.mail.mockResolvedValue(undefined);
        const result = await run();
        expect(result.status).toBe("info");
        expect(result.message).toContain("E-mailové upozornění se nepodařilo odeslat");
        expect(mocks.persist).toHaveBeenCalledOnce();
        expect(mocks.send).not.toHaveBeenCalled();
        expect(mocks.mail).toHaveBeenCalledOnce();
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
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ subject: "[Kontri objednávky] Nedostatky" }));
    });
    it("retries after a thrown lookup and keeps a conflicting reference without counting a retry failure", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockRejectedValue(new Error("network"));
        mocks.send.mockResolvedValue({ Code: 110 });
        expect((await run()).status).toBe("error");
        expect(mocks.send).toHaveBeenCalledOnce();
        expect(mocks.newOrder).toHaveBeenCalledOnce();
        expect(mocks.recordFailure).not.toHaveBeenCalled();
        expect(mocks.service).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledWith(products[0], expect.objectContaining({ kontriStatusCode: 110 }));
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it("records a failed retry and still submits new products when the Kontri service responds", async () => {
        const other = products.map((product) => ({ ...product, RefNumber: "other" }));
        mocks.pending.mockResolvedValue([
            { RefNumber: "stable", products },
            { RefNumber: "other", products: other },
        ]);
        mocks.check.mockResolvedValue({ Code: 0, Message: "Error connecting to database." });
        mocks.retry.mockImplementation(async (group: ShopOrder[], refNumber: string) => createKontriOrder(group, refNumber));
        mocks.send
            .mockResolvedValueOnce({ Code: 0, Message: "Error connecting to database." })
            .mockResolvedValueOnce({ Code: 0, Message: "Error connecting to database." })
            .mockResolvedValueOnce({ Code: 100, AltumOrderID: "123", Shortages: { Shortages: [] } });
        const result = await run();
        expect(result.status).toBe("error");
        expect(mocks.send).toHaveBeenCalledTimes(3);
        expect(mocks.send.mock.calls[2][0].RefNumber).toBe("stable");
        expect(mocks.newOrder).toHaveBeenCalledOnce();
        expect(mocks.recordFailure).toHaveBeenCalledWith(products, "stable", 0);
        expect(mocks.recordFailure).toHaveBeenCalledWith(other, "other", 0);
        expect(mocks.service).toHaveBeenCalledOnce();
        expect(result.message).toContain("Neúspěšný pokus 1/3");
        expect(result.message).toContain("byla potvrzena (123)");
        expect(mocks.mail).toHaveBeenCalledTimes(2);
    });
    it.each([null, { CheckStatusResult: "" }, new Error("down")])(
        "blocks new submission after a failed retry when the service check fails (%s)",
        async (service) => {
            mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
            mocks.check.mockResolvedValue({ Code: 0 });
            mocks.send.mockResolvedValue({ Code: 0 });
            if (service instanceof Error) mocks.service.mockRejectedValue(service);
            else mocks.service.mockResolvedValue(service);
            const result = await run();
            expect(result.status).toBe("error");
            expect(result.message).toContain("nové produkty nebyly odeslány");
            expect(mocks.newOrder).not.toHaveBeenCalled();
            expect(mocks.send).toHaveBeenCalledOnce();
        },
    );
    it("escalates to manual review on the limit with a dedicated email", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockResolvedValue({ Code: 0 });
        mocks.send.mockResolvedValue({ Code: 0 });
        mocks.recordFailure.mockResolvedValue({ failures: 3, escalated: true });
        const result = await run();
        expect(result.status).toBe("error");
        expect(result.message).toContain("převedena na ruční kontrolu");
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ subject: "[Kontri objednávky] Ruční kontrola" }));
        expect(mocks.newOrder).toHaveBeenCalledOnce();
    });
    it("reports an unrecorded retry failure without blocking other work", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "stable", products }]);
        mocks.newOrder.mockResolvedValue(null);
        mocks.check.mockResolvedValue({ Code: 0 });
        mocks.send.mockResolvedValue({ Code: -1 });
        mocks.recordFailure.mockRejectedValue(new Error("commit failed"));
        const result = await run();
        expect(result.status).toBe("error");
        expect(result.message).toContain("Počet neúspěšných pokusů se nepodařilo zapsat");
        expect(mocks.newOrder).toHaveBeenCalledOnce();
    });
    it("does not count a failed first submission as a retry failure", async () => {
        mocks.send.mockResolvedValue({ Code: 0 });
        const result = await run();
        expect(result.status).toBe("error");
        expect(result).not.toHaveProperty("retryableCode");
        expect(mocks.recordFailure).not.toHaveBeenCalled();
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
        expect(mocks.recordFailure).not.toHaveBeenCalled();
    });
    it("does not confirm a status response missing the real Kontri order ID", async () => {
        mocks.pending.mockResolvedValue([{ RefNumber: "old", products }]);
        mocks.check.mockResolvedValue({ Code: 200 });
        mocks.newOrder.mockResolvedValue(null);
        expect((await run()).status).toBe("error");
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();
        expect(mocks.retry).not.toHaveBeenCalled();
        expect(mocks.newOrder).toHaveBeenCalledOnce();
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
