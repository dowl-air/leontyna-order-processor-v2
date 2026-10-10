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
    it.each([5, 1])("ignores supplemental article 53086 while reconciling %s accepted product units", (quantity) => {
        const result = reconcileKontriShortages(group(), "stable", {
            ...response,
            Articles: {
                Article: [
                    { AltumArticleID: 900, Quantity: quantity },
                    { AltumArticleID: 53086, Quantity: 1 },
                ],
            },
        } as any);
        expect([...result!.values()]).toEqual(quantity === 5 ? [0, 0] : [1, 3]);
    });
    it("still blocks other unexpected IDs alongside supplemental article 53086", () => {
        const reasons: { code: string; detail: string }[] = [];
        expect(
            reconcileKontriShortages(
                group(),
                "stable",
                {
                    ...response,
                    Articles: {
                        Article: [
                            { AltumArticleID: 900, Quantity: 5 },
                            { AltumArticleID: 53086, Quantity: 1 },
                            { AltumArticleID: 999, Quantity: 1 },
                        ],
                    },
                } as any,
                (diagnostic) => reasons.push(diagnostic),
            ),
        ).toBeNull();
        expect(reasons[0]).toMatchObject({ code: "UNEXPECTED_API_ID" });
        expect(reasons[0].detail).toContain("999");
    });
    it("does not ignore article 53086 when explicitly requested", () => {
        const saved = group().map((product) => ({ ...product, kontriApiId: "53086" }));
        const { products: internal, ...payload } = createKontriOrder(saved, "stable");
        saved[0].kontriRequestJson = JSON.stringify(payload);
        const result = reconcileKontriShortages(saved, "stable", {
            ...response,
            Articles: { Article: [{ AltumArticleID: 53086, Quantity: 1 }] },
        } as any);
        expect([...result!.values()]).toEqual([1, 3]);
    });
    it("rejects malformed supplemental article quantities", () => {
        expect(
            reconcileKontriShortages(group(), "stable", {
                ...response,
                Articles: {
                    Article: [
                        { AltumArticleID: 900, Quantity: 5 },
                        { AltumArticleID: 53086, Quantity: -1 },
                    ],
                },
            } as any),
        ).toBeNull();
    });
    it("validates membership in the saved request order rather than a newly sorted order", () => {
        const reversed = [...products].reverse();
        const { products: internal, ...payload } = createKontriOrder(reversed, "stable");
        const saved = reversed.map((product, index) => ({
            ...product,
            kontriRequestLeaderId: "second",
            ...(index === 0 ? { kontriRequestJson: JSON.stringify(payload), kontriRequestProductIds: ["second", "first"] } : {}),
        }));
        expect(reconcileKontriShortages(saved, "stable", response as any)).not.toBeNull();
    });
    it("accepts equivalent snapshot items with different JSON key order", () => {
        const saved = group();
        const payload = JSON.parse(saved[0].kontriRequestJson!);
        payload.OrderedItems = payload.OrderedItems.map((item: { Amount: number; AltumArticleId: number; ClientOrderNumber: string }) => ({
            ClientOrderNumber: item.ClientOrderNumber,
            Amount: item.Amount,
            AltumArticleId: item.AltumArticleId,
        }));
        saved[0].kontriRequestJson = JSON.stringify(payload);
        expect(reconcileKontriShortages(saved, "stable", response as any)).not.toBeNull();
    });
    it.each([
        [{ ...response, Status: "Kompletowane" }, "ORDER_STATUS"],
        [{ ...response, Articles: undefined }, "ARTICLES_MISSING"],
        [{ ...response, Articles: { Article: [{ AltumArticleID: 999, Quantity: 1 }] } }, "UNEXPECTED_API_ID"],
        [{ ...response, Articles: { Article: [{ AltumArticleID: 900, Quantity: 6 }] } }, "EXCESS_QUANTITY"],
    ])("reports the specific response rejection reason", (invalid, code) => {
        const reasons: { code: string; detail: string }[] = [];
        expect(reconcileKontriShortages(group(), "stable", invalid as any, (diagnostic) => reasons.push(diagnostic))).toBeNull();
        expect(reasons).toHaveLength(1);
        expect(reasons[0].code).toBe(code);
        expect(reasons[0].detail.length).toBeGreaterThan(0);
    });
    it("distinguishes missing snapshots from membership mismatches", () => {
        const reasons: { code: string; detail: string }[] = [];
        reconcileKontriShortages(products, "stable", response as any, (diagnostic) => reasons.push(diagnostic));
        reconcileKontriShortages(group().slice(0, 1), "stable", response as any, (diagnostic) => reasons.push(diagnostic));
        expect(reasons.map((reason) => reason.code)).toEqual(["SNAPSHOT_MISSING", "MEMBERSHIP_MISMATCH"]);
    });
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
