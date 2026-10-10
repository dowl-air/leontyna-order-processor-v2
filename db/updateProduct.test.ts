import { describe, expect, it, vi } from "vitest";
import ShopOrder from "@/types/ShopOrder";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("./init", () => ({ db: "database" }));
vi.mock("firebase/firestore/lite", () => ({ doc: (...parts: unknown[]) => parts, updateDoc: mocks.update }));
import { updateProduct } from "./updateProduct";

describe("updateProduct", () => {
    it("updates the actual document ID without reconstructing identity", async () => {
        await updateProduct({ fID: "actual-document", code: "order", orderItemCode: "AK-5-100" } as ShopOrder, { shortage: 1 });
        expect(mocks.update).toHaveBeenLastCalledWith(["database", "products", "actual-document"], { shortage: 1 });
    });
    it("retains the existing key convention when no document ID is supplied", async () => {
        await updateProduct({ code: "order", orderItemCode: "AK-5-100" } as ShopOrder, { shortage: 0 });
        expect(mocks.update).toHaveBeenLastCalledWith(["database", "products", "order_AK-5-100"], { shortage: 0 });
    });
});
