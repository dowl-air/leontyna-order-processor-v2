import { describe, expect, it, vi } from "vitest";
import { buildMappingChunks, parseKontriFeed, refreshKontriMapping } from "./kontriFeed";

const instance = (id = "196901", api = "542275", ean = "054912126") =>
    `<INSTANCJA><id_instancji>${id}</id_instancji><id_instancji_api>${api}</id_instancji_api><kod_kreskowy>${ean}</kod_kreskowy></INSTANCJA>`;
const feed = (items = instance()) => `<ROOT><DATA>2026-10-10 12:24</DATA><PRODUKTY><PRODUKT><WARIANT>${items}</WARIANT></PRODUKT></PRODUKTY></ROOT>`;

describe("Kontri feed", () => {
    it("preserves string identifiers and leading zeros in EAN", () => {
        expect(parseKontriFeed(feed()).records).toEqual([{ catalogId: "196901", apiId: "542275", ean: "054912126" }]);
    });
    it.each(["<ROOT>", feed(""), feed(instance("0")), feed(instance("1", "")), feed(instance("1", "2", "")), "<!DOCTYPE ROOT><ROOT/>"])(
        "rejects invalid feeds",
        (xml) => {
            expect(() => parseKontriFeed(xml)).toThrow();
        },
    );
    it("rejects conflicting identifiers", () => {
        expect(() => parseKontriFeed(feed(instance() + instance("196901", "42", "123")))).toThrow();
    });
    it("splits according to UTF-8 bytes and keeps every record", () => {
        const records = parseKontriFeed(feed(instance() + instance("2", "3", "123"))).records;
        const chunks = buildMappingChunks(records, 100);
        expect(chunks.length).toBe(2);
        expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 100)).toBe(true);
        expect(chunks.flatMap((chunk) => JSON.parse(chunk))).toEqual(records);
    });
    it("publishes only after successful storage", async () => {
        const save = vi.fn().mockRejectedValue(new Error("write failed"));
        const publish = vi.fn();
        await expect(refreshKontriMapping(feed(), { current: async () => null, save, publish, cleanup: vi.fn() })).rejects.toThrow("write failed");
        expect(publish).not.toHaveBeenCalled();
    });
    it("does not store unchanged content", async () => {
        const store = { current: vi.fn().mockResolvedValue(null), save: vi.fn(), publish: vi.fn().mockResolvedValue(true), cleanup: vi.fn() };
        const first = await refreshKontriMapping(feed(), store);
        store.current.mockResolvedValue({ hash: first.hash });
        store.save.mockClear();
        store.cleanup.mockClear();
        expect((await refreshKontriMapping(feed(), store)).unchanged).toBe(true);
        expect(store.save).not.toHaveBeenCalled();
        expect(store.cleanup).toHaveBeenCalledOnce();
    });
    it("rejects a drop above 25 percent before storing or publishing", async () => {
        const store = { current: async () => ({ hash: "old", recordCount: 2 }), save: vi.fn(), publish: vi.fn(), cleanup: vi.fn() };
        await expect(refreshKontriMapping(feed(), store)).rejects.toMatchObject({ previousCount: 2, incomingCount: 1 });
        expect(store.save).not.toHaveBeenCalled();
        expect(store.publish).not.toHaveBeenCalled();
    });
    it.each([3, 4, 5])("allows at most a 25 percent drop or growth: %s records", async (count) => {
        const items = Array.from({ length: count }, (_, index) => instance(String(index + 1), String(index + 10), String(index + 100))).join("");
        const store = {
            current: async () => ({ hash: "old", recordCount: 4 }),
            save: vi.fn(),
            publish: vi.fn().mockResolvedValue(true),
            cleanup: vi.fn(),
        };
        expect(await refreshKontriMapping(feed(items), store)).toMatchObject({ unchanged: false, rejected: false, recordCount: count });
        expect(store.publish).toHaveBeenCalledOnce();
    });
    it("distinguishes rejected publication from unchanged content", async () => {
        const store = { current: async () => null, save: vi.fn(), publish: vi.fn().mockResolvedValue(false), cleanup: vi.fn() };
        expect(await refreshKontriMapping(feed(), store)).toMatchObject({ unchanged: false, rejected: true });
        expect(store.cleanup).toHaveBeenCalledOnce();
    });
    it("reports cleanup failure without hiding successful publication", async () => {
        const result = await refreshKontriMapping(feed(), {
            current: async () => null,
            save: vi.fn(),
            publish: vi.fn().mockResolvedValue(true),
            cleanup: vi.fn().mockRejectedValue(new Error("cleanup")),
        });
        expect(result.cleanupFailed).toBe(true);
        expect(result.cleanupError).toBe("Error: cleanup");
    });
});
