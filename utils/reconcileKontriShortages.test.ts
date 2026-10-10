import { describe, expect, it } from "vitest";
import ShopOrder from "@/types/ShopOrder";
import { createKontriOrder } from "./createKontriOrder";
import { reconcileKontriShortages } from "./reconcileKontriShortages";

const products = [
    { fID: "first", code: "older", date: "2026-10-09", kontriApiId: "900", kontriOrderedAmount: 2, RefNumber: "stable" },
    { fID: "second", code: "newer", date: "2026-10-10", kontriApiId: "900", kontriOrderedAmount: 3, RefNumber: "stable" },
] as ShopOrder[];
function group() {
    const { products: internal, ...payload } = createKontriOrder(products, "stable");
    return products.map((product, index) => ({
        ...product,
        kontriRequestLeaderId: "first",
        ...(index === 0 ? { kontriRequestJson: JSON.stringify(payload), kontriRequestProductIds: ["first", "second"] } : {}),
    }));
}
const response = { Code: 200, Status: "Nowe", AltumOrderID: 123, Message: "", Articles: { Article: [{ AltumArticleID: 900, Quantity: 5 }] } };

describe("reconcileKontriShortages", () => {
    it("confirms zero shortages when summed quantities match", () => {
        expect([...reconcileKontriShortages(group(), "stable", response as any)!.values()]).toEqual([0, 0]);
    });
    it("allocates shared deficits once with older-order priority", () => {
        const result = reconcileKontriShortages(group(), "stable", {
            ...response,
            Articles: { Article: [{ AltumArticleID: 900, Quantity: 1 }] },
        } as any);
        expect([...result!.values()]).toEqual([1, 3]);
    });
    it("sums duplicate article rows", () => {
        const result = reconcileKontriShortages(group(), "stable", {
            ...response,
            Articles: {
                Article: [
                    { AltumArticleID: 900, Quantity: 2 },
                    { AltumArticleID: 900, Quantity: 3 },
                ],
            },
        } as any);
        expect([...result!.values()]).toEqual([0, 0]);
    });
    it("handles a missing requested ID as a full shortage when an explicit article list exists", () => {
        expect([...reconcileKontriShortages(group(), "stable", { ...response, Articles: { Article: [] } } as any)!.values()]).toEqual([2, 3]);
    });
    it.each(["Anulowane/zagregowane", "Kompletowane", "Przygotowane do wysylki", "Wyslane"])("does not calculate for %s", (Status) => {
        expect(reconcileKontriShortages(group(), "stable", { ...response, Status } as any)).toBeNull();
    });
    it.each([
        { ...response, Code: 500 },
        { ...response, Articles: undefined },
        { ...response, Articles: { Article: [{ AltumArticleID: 999, Quantity: 1 }] } },
        { ...response, Articles: { Article: [{ AltumArticleID: 900, Quantity: 6 }] } },
        { ...response, Articles: { Article: [{ AltumArticleID: 900, Quantity: -1 }] } },
        { ...response, Articles: { Article: [{ AltumArticleID: 900, Quantity: null }] } },
        { ...response, Articles: { Article: [{ AltumArticleID: 900, Quantity: "" }] } },
        { ...response, Articles: { Article: [{ AltumArticleID: 900, Quantity: true }] } },
    ])("leaves inconsistent article responses unknown", (invalid) => {
        expect(reconcileKontriShortages(group(), "stable", invalid as any)).toBeNull();
    });
    it("does not calculate with missing snapshots or incomplete membership", () => {
        expect(reconcileKontriShortages(products, "stable", response as any)).toBeNull();
        expect(reconcileKontriShortages(group().slice(0, 1), "stable", response as any)).toBeNull();
        const changed = group();
        changed[1].kontriOrderedAmount = 4;
        expect(reconcileKontriShortages(changed, "stable", response as any)).toBeNull();
    });
    it("does not contradict already confirmed shortages within the group", () => {
        const known = group();
        known[0].kontriReconciliationRequired = false;
        known[0].kontriStatusCode = 100;
        known[0].shortage = 1;
        expect(reconcileKontriShortages(known, "stable", response as any)).toBeNull();
    });
});
