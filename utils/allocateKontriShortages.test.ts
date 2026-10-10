import { describe, expect, it } from "vitest";
import ShopOrder from "@/types/ShopOrder";
import { allocateKontriShortages } from "./allocateKontriShortages";

const products = [
    { fID: "older", code: "first", date: "2026-10-09", kontriApiId: "900", kontriOrderedAmount: 2 },
    { fID: "newer", code: "second", date: "2026-10-10", kontriApiId: "900", kontriOrderedAmount: 3 },
] as ShopOrder[];

describe("allocateKontriShortages", () => {
    it("allocates a shortage once and gives older orders priority", () => {
        expect([...allocateKontriShortages(products, [{ AltumArticleID: 900, Quantity: 4 }])]).toEqual([
            ["older", 1],
            ["newer", 3],
        ]);
    });
    it("is independent of input order", () => {
        const result = allocateKontriShortages([...products].reverse(), [{ AltumArticleID: 900, Quantity: 2 }]);
        expect(result.get("older")).toBe(0);
        expect(result.get("newer")).toBe(2);
    });
    it("sets zero shortages when none are returned", () => {
        expect([...allocateKontriShortages(products, [])]).toEqual([
            ["older", 0],
            ["newer", 0],
        ]);
    });
    it.each(
        [
            [{ AltumArticleID: 100, Quantity: 1 }],
            [{ AltumArticleID: 900, Quantity: 6 }],
            [{ AltumArticleID: 900, Quantity: -1 }],
            [{ AltumArticleID: 900, Quantity: NaN }],
            [
                { AltumArticleID: 900, Quantity: 1 },
                { AltumArticleID: 900, Quantity: 1 },
            ],
        ].map((shortages) => ({ shortages })),
    )("rejects inconsistent shortage responses: $shortages", ({ shortages }) => {
        expect(() => allocateKontriShortages(products, shortages)).toThrow();
    });
});
