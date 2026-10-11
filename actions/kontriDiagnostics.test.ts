import { afterEach, describe, expect, it, vi } from "vitest";
import type { KontriOrderToSend } from "@/types/KontriOrder";
const mocks = vi.hoisted(() => ({ reference: vi.fn(), order: vi.fn() }));
vi.mock("@/utils/soapClient", () => ({ getOrderStatusByRefNumber: mocks.reference, getOrderStatus: mocks.order }));
import { sendOrder } from "./sendOrder";
import { checkOrderByRefNumber } from "./checkOrderRefNumber";
import { checkOrder } from "./checkOrder";

describe("Kontri integration diagnostics", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    it("logs the actual HTTP status and rejected submission response", async () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => {});
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ result: { Code: 80, Message: "Unavailable" } }) }));
        await sendOrder({ RefNumber: "reference", OrderedItems: [{ AltumArticleId: 522299, Amount: 1 }] } as KontriOrderToSend);
        expect(log).toHaveBeenCalledWith("Kontri diagnostic", expect.objectContaining({ event: "submit.http", httpStatus: 200 }));
        expect(log).toHaveBeenCalledWith(
            "Kontri diagnostic",
            expect.objectContaining({ event: "submit.response", reference: "reference", code: 80, message: "Unavailable" }),
        );
    });
    it("logs an empty SOAP lookup message and preserves the returned code", async () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => {});
        mocks.reference.mockResolvedValue({ GetOrderStatusByRefNumberResult: { Code: 404, Message: "" } });
        expect(await checkOrderByRefNumber("reference")).toEqual({ Code: 404, Message: "" });
        expect(log).toHaveBeenCalledWith(
            "Kontri diagnostic",
            expect.objectContaining({ event: "lookup.reference.response", code: 404, message: "[empty]" }),
        );
    });
    it("logs order ID lookup exceptions without dumping transport configuration", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.order.mockRejectedValue(Object.assign(new Error("Unavailable"), { config: { password: "private" } }));
        expect((await checkOrder("123")).Code).toBe(500);
        expect(log).toHaveBeenCalledWith(
            "Kontri diagnostic",
            expect.objectContaining({ event: "lookup.orderId.error", reference: "123", message: "Unavailable" }),
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    });
});
