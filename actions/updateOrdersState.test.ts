import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ordered: vi.fn(), aggregated: vi.fn(), check: vi.fn(), update: vi.fn() }));
vi.mock("@/db/getProducts", () => ({ getOrderedProducts: mocks.ordered, getNotSentProducts: mocks.aggregated }));
vi.mock("./checkOrderRefNumber", () => ({ checkOrderByRefNumber: mocks.check }));
vi.mock("@/db/updateProduct", () => ({ updateProduct: mocks.update }));
import { updateAggregatedOrdersState, updateNewOrdersState } from "./updateOrdersState";

describe("order status checks", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        mocks.ordered.mockResolvedValue([{ RefNumber: "first", kontriStatusCode: 100 }]);
        mocks.aggregated.mockResolvedValue([{ RefNumber: "first", kontriStatusCode: 300 }]);
        mocks.check.mockResolvedValue({ Code: 200, Status: "Wyslane" });
        mocks.update.mockResolvedValue(undefined);
    });
    afterEach(() => vi.useRealTimers());

    it.each([{ Code: 500 }, { Code: 200 }, { Code: 200, Status: "unknown" }])("does not write an invalid response %j", async (response) => {
        mocks.check.mockResolvedValue(response);
        const result = await updateAggregatedOrdersState();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(result).toMatchObject({ status: "error", checkedCount: 1, failedCount: 1 });
    });

    it("checks subsequent references after an unchanged order with constant spacing", async () => {
        mocks.ordered.mockResolvedValue(["first", "second", "third"].map((RefNumber) => ({ RefNumber })));
        mocks.check.mockResolvedValueOnce({ Code: 200, Status: "Nowe" });
        const pending = updateNewOrdersState();
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.check).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2500);
        expect(mocks.check).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2500);
        expect(mocks.check).toHaveBeenCalledTimes(3);
        expect(await pending).toMatchObject({ status: "success", checkedCount: 3, failedCount: 0 });
        expect(mocks.update).toHaveBeenCalledTimes(2);
    });

    it("continues after a thrown check or failed write and reports failures", async () => {
        mocks.ordered.mockResolvedValue(["first", "second", "third"].map((RefNumber) => ({ RefNumber })));
        mocks.check.mockRejectedValueOnce(new Error("network"));
        mocks.update.mockRejectedValueOnce(new Error("storage"));
        const pending = updateNewOrdersState();
        await vi.runAllTimersAsync();
        expect(await pending).toMatchObject({ status: "error", checkedCount: 3, failedCount: 2 });
        expect(mocks.check).toHaveBeenCalledTimes(3);
    });

    it("accepts numeric SOAP codes represented as strings and advances state 301", async () => {
        mocks.aggregated.mockResolvedValue([{ RefNumber: "first", kontriStatusCode: 301 }]);
        mocks.check.mockResolvedValue({ Code: "200", Status: "Wyslane" });
        expect(await updateAggregatedOrdersState()).toMatchObject({ status: "success" });
        expect(mocks.update).toHaveBeenCalledWith(expect.anything(), { kontriStatusCode: 400 });
    });

    it("does not regress an aggregated order on a Nowe response", async () => {
        mocks.check.mockResolvedValue({ Code: 200, Status: "Nowe" });
        await updateAggregatedOrdersState();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it("retains the existing article-count heuristic", async () => {
        mocks.check.mockResolvedValue({ Code: 200, Status: "Kompletowane", Articles: { Article: [{}, {}, {}] } });
        await updateNewOrdersState();
        expect(mocks.update).toHaveBeenCalledWith(expect.anything(), { kontriStatusCode: 300 });
        mocks.update.mockClear();
        mocks.check.mockResolvedValue({ Code: 200, Status: "Kompletowane", Articles: { Article: [{}] } });
        await updateNewOrdersState();
        expect(mocks.update).toHaveBeenCalledWith(expect.anything(), { kontriStatusCode: 301 });
    });

    it("reports missing references and product-read errors", async () => {
        mocks.ordered.mockResolvedValue([{}]);
        expect(await updateNewOrdersState()).toMatchObject({ status: "error", failedCount: 1 });
        expect(mocks.check).not.toHaveBeenCalled();
        mocks.ordered.mockRejectedValue(new Error("read"));
        expect(await updateNewOrdersState()).toMatchObject({ status: "error" });
    });
});
