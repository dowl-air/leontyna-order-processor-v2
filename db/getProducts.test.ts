import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), startAfter: vi.fn() }));
vi.mock("./init", () => ({ db: {} }));
vi.mock("firebase/firestore/lite", () => ({
    collection: vi.fn(() => "products"),
    documentId: () => "__name__",
    limit: (value: number) => ({ limit: value }),
    getDocs: mocks.getDocs,
    query: mocks.query,
    where: mocks.where,
    orderBy: mocks.orderBy,
    startAfter: mocks.startAfter,
}));
import { getNotSentProducts, getOrderedProducts } from "./getProducts";

const oldDate = new Date("2020-01-01T00:00:00Z");
const document = (id: string, status: number, RefNumber = "shared") => ({
    id,
    data: () => ({ RefNumber, kontriStatusCode: status, date: { toDate: () => oldDate } }),
});
const snapshot = (docs: ReturnType<typeof document>[]) => ({
    docs,
    forEach: (callback: (doc: ReturnType<typeof document>) => void) => docs.forEach(callback),
});

describe("unfinished order product queries", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
        mocks.getDocs.mockResolvedValue(snapshot([]));
    });
    afterEach(() => vi.useRealTimers());

    it("limits status 100 to the last five days including the cutoff", async () => {
        await getOrderedProducts();
        expect(mocks.where.mock.calls).toEqual([
            ["kontriStatusCode", "==", 100],
            ["date", ">=", new Date("2026-10-05T12:00:00Z")],
        ]);
        expect(mocks.orderBy).toHaveBeenCalledWith("date", "asc");
        expect(mocks.orderBy).toHaveBeenCalledWith("__name__", "asc");
    });

    it("selects both aggregated states 300 and 301", async () => {
        mocks.getDocs.mockResolvedValue(snapshot([document("first", 300), document("second", 301)]));
        const products = await getNotSentProducts();
        expect(mocks.where.mock.calls).toEqual([
            ["kontriStatusCode", "in", [300, 301]],
            ["date", ">=", new Date("2026-10-05T12:00:00Z")],
        ]);
        expect(products.map((product) => product.kontriStatusCode)).toEqual([300, 301]);
        expect(products[0].date).toEqual(oldDate);
    });

    it.each([getOrderedProducts, getNotSentProducts])("collects complete reference groups across page boundaries", async (read) => {
        const firstPage = Array.from({ length: 1000 }, (_, index) => document(`item-${index}`, 100));
        mocks.getDocs.mockResolvedValueOnce(snapshot(firstPage)).mockResolvedValueOnce(snapshot([document("last", 100)]));
        const products = await read();
        expect(products).toHaveLength(1001);
        expect(products.every((product) => product.RefNumber === "shared")).toBe(true);
        expect(mocks.startAfter).toHaveBeenCalledWith(firstPage[999]);
        expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    });
});
