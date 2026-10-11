import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getDocs: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
    mapping: vi.fn(),
    block: vi.fn(),
    mail: vi.fn(),
    event: vi.fn(),
    error: vi.fn(),
}));
vi.mock("./updateProduct", () => ({ updateProduct: mocks.block }));
vi.mock("@/actions/sendMail", () => ({ sendMail: mocks.mail }));
vi.mock("@/utils/kontriDiagnostics", () => ({ logKontriEvent: mocks.event, logKontriError: mocks.error }));
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
import { getNewOrder, prepareKontriRetry } from "./getNewOrder";

const product = { code: "order", orderItemCode: "AK-5-100", orderItemEan: "00123", orderItemAmount: 2, AltumOrderID: null };
const document = (data = product) => ({ id: "original-document", data: () => data });

describe("getNewOrder preparation", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.mail.mockResolvedValue({ messageId: "sent" });
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
                kontriRequestJson: expect.any(String),
            }),
        );
        expect(product.orderItemCode).toBe("AK-5-100");
    });
    it("does not read the cache when there are no new products", async () => {
        mocks.getDocs.mockResolvedValue({ empty: true, docs: [] });
        expect(await getNewOrder()).toBeNull();
        expect(mocks.mapping).not.toHaveBeenCalled();
    });
    it("blocks only the EAN mismatch, emails it and prepares the remaining products", async () => {
        const mismatch = { ...product, code: "bad-order", orderItemEan: "00456" };
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document(), { id: "bad-document", data: () => mismatch }] });
        const order = await getNewOrder();
        expect(order?.products.map((item) => item.fID)).toEqual(["original-document"]);
        expect(order?.OrderedItems).toEqual([{ AltumArticleId: 900, Amount: 2, ClientOrderNumber: "order" }]);
        expect(mocks.block).toHaveBeenCalledWith(expect.objectContaining({ fID: "bad-document" }), { kontriEanBlocked: true });
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(mocks.mail.mock.calls[0][0].text).toContain("bad-order");
        expect(mocks.mail.mock.calls[0][0].text).toContain("00456");
        expect(mocks.mail.mock.calls[0][0].text).toContain("00123");
        expect(mocks.mapping).toHaveBeenCalledOnce();
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.event).toHaveBeenCalledWith(
            "mapping.eanBlocked",
            "",
            expect.objectContaining({ productId: "bad-document", sourceEan: "00456" }),
        );
        const fields = mocks.update.mock.calls[0][1];
        expect(JSON.parse(fields.kontriRequestJson).OrderedItems).toEqual(order?.OrderedItems);
        expect(fields.kontriRequestProductIds).toEqual(["original-document"]);
    });
    it("returns no request when all products are newly EAN-blocked and skips them next run", async () => {
        const mismatch = { ...product, orderItemEan: "00456" };
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document(mismatch)] });
        expect(await getNewOrder()).toBeNull();
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(mocks.transaction).not.toHaveBeenCalled();
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document({ ...mismatch, kontriEanBlocked: true } as typeof product)] });
        mocks.mapping.mockClear();
        expect(await getNewOrder()).toBeNull();
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(mocks.block).toHaveBeenCalledOnce();
        expect(mocks.mapping).not.toHaveBeenCalled();
    });
    it("continues with eligible products after the mismatch notification fails", async () => {
        mocks.getDocs.mockResolvedValue({
            empty: false,
            docs: [document(), { id: "bad-document", data: () => ({ ...product, orderItemEan: "00456" }) }],
        });
        mocks.mail.mockRejectedValue(new Error("SMTP failure"));
        expect((await getNewOrder())?.products).toHaveLength(1);
        expect(mocks.block).toHaveBeenCalledOnce();
        expect(mocks.error).toHaveBeenCalledWith("mapping.notification", "", expect.any(Error));
    });
    it("skips previously blocked products while preparing other new products", async () => {
        mocks.getDocs.mockResolvedValue({
            empty: false,
            docs: [document(), { id: "blocked", data: () => ({ ...product, kontriEanBlocked: true, orderItemEan: "00456" }) }],
        });
        expect((await getNewOrder())?.products.map((item) => item.fID)).toEqual(["original-document"]);
        expect(mocks.block).not.toHaveBeenCalled();
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("sends one email for each newly blocked product", async () => {
        const mismatch = { ...product, orderItemEan: "00456" };
        mocks.getDocs.mockResolvedValue({
            empty: false,
            docs: [document(mismatch), { id: "second", data: () => ({ ...mismatch, code: "second-order" }) }],
        });
        expect(await getNewOrder()).toBeNull();
        expect(mocks.block).toHaveBeenCalledTimes(2);
        expect(mocks.mail).toHaveBeenCalledTimes(2);
    });
    it("does not repeat a failed notification after persisting the block", async () => {
        const mismatch = { ...product, orderItemEan: "00456" };
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document(mismatch)] });
        mocks.mail.mockResolvedValue(undefined);
        expect(await getNewOrder()).toBeNull();
        expect(mocks.event).toHaveBeenCalledWith("mapping.notification.failed", "", expect.anything());
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document({ ...mismatch, kontriEanBlocked: true } as typeof product)] });
        expect(await getNewOrder()).toBeNull();
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it("does not email or prepare if saving the EAN block fails", async () => {
        mocks.getDocs.mockResolvedValue({ empty: false, docs: [document({ ...product, orderItemEan: "00456" })] });
        mocks.block.mockRejectedValue(new Error("write failed"));
        await expect(getNewOrder()).rejects.toThrow("write failed");
        expect(mocks.mail).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
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
    it("prepares historical products with corrected API IDs and the same reference", async () => {
        const historical = { ...product, fID: "original-document", RefNumber: "old-reference", kontriStatusCode: 0 };
        mocks.get.mockResolvedValue({ exists: () => true, data: () => historical });
        const request = await prepareKontriRetry([historical] as any, "old-reference");
        expect(request.RefNumber).toBe("old-reference");
        expect(request.OrderedItems[0].AltumArticleId).toBe(900);
        expect(mocks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kontriRequestJson: expect.any(String) }));
    });
    it("replays the exact stored payload without reading a changed mapping", async () => {
        const first = { ...product, fID: "original-document", RefNumber: "old-reference" };
        mocks.get.mockResolvedValue({ exists: () => true, data: () => first });
        await prepareKontriRetry([first] as any, "old-reference");
        const stored = { ...first, ...mocks.update.mock.calls[0][1] };
        const original = JSON.parse(stored.kontriRequestJson);
        original.ShipmentCity = "Original city";
        stored.kontriRequestJson = JSON.stringify(original);
        mocks.get.mockResolvedValue({ exists: () => true, data: () => stored });
        mocks.mapping.mockClear();
        const replay = await prepareKontriRetry([stored], "old-reference");
        const { products, ...payload } = replay;
        expect(payload).toEqual(original);
        expect(mocks.mapping).not.toHaveBeenCalled();
    });
    it("rejects retry after an order has been confirmed", async () => {
        const historical = { ...product, fID: "original-document", RefNumber: "old-reference" };
        mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ ...historical, AltumOrderID: "999", kontriStatusCode: 100 }) });
        await expect(prepareKontriRetry([historical] as any, "old-reference")).rejects.toThrow();
        expect(mocks.update).not.toHaveBeenCalled();
    });
    it("rejects a group whose persisted payload leader is missing", async () => {
        const remaining = { ...product, fID: "remaining", RefNumber: "stable", kontriRequestLeaderId: "missing" };
        await expect(prepareKontriRetry([remaining] as any, "stable")).rejects.toThrow();
        expect(mocks.mapping).not.toHaveBeenCalled();
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
