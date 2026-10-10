import { describe, expect, it } from "vitest";
import ShopOrder from "@/types/ShopOrder";
import { createKontriOrder } from "./createKontriOrder";

const product = { code: "order", orderItemCode: "AK-5-100", orderItemAmount: 2, kontriApiId: "900", kontriOrderedAmount: 2 } as unknown as ShopOrder;

describe("createKontriOrder", () => {
    it("uses the persisted API ID and amount instead of the original code", () => {
        const order = createKontriOrder([{ ...product, orderItemAmount: 5 }], "reference");
        expect(order.OrderedItems).toEqual([{ AltumArticleId: 900, Amount: 2, ClientOrderNumber: "order" }]);
        expect(order.RefNumber).toBe("reference");
        expect(order.products[0].orderItemCode).toBe("AK-5-100");
    });
    it.each([undefined, "0", "abc", "2147483648", "9007199254740992"])("rejects missing or unsafe API IDs: %s", (kontriApiId) => {
        expect(() => createKontriOrder([{ ...product, kontriApiId } as ShopOrder], "reference")).toThrow();
    });
    it.each([undefined, 0, -1, NaN, Infinity])("rejects missing or invalid persisted quantities: %s", (kontriOrderedAmount) => {
        expect(() => createKontriOrder([{ ...product, kontriOrderedAmount } as ShopOrder], "reference")).toThrow();
    });
    it("rejects missing references", () => {
        expect(() => createKontriOrder([product], "")).toThrow();
    });
    it("rejects references longer than the documented 16 characters", () => {
        expect(() => createKontriOrder([product], "12345678901234567")).toThrow();
    });
});
