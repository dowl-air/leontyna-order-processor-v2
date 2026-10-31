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

    it("stops at the first unchanged group without fixed pauses", async () => {
        mocks.ordered.mockResolvedValue(["first", "second", "third"].map((RefNumber) => ({ RefNumber, kontriStatusCode: 100 })));
        mocks.check.mockResolvedValueOnce({ Code: 200, Status: "Wyslane" }).mockResolvedValueOnce({ Code: 200, Status: "Nowe" });
        const result = await updateNewOrdersState();
        expect(mocks.check.mock.calls.map(([refNumber]) => refNumber)).toEqual(["first", "second"]);
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ status: "success", checkedCount: 2, failedCount: 0 });
        expect(result.message).toContain("2/3 groups checked");
        expect(result.message).toContain("stopped at the first unchanged group");
    });

    it("checks every group after an unchanged one during a full sweep", async () => {
        mocks.ordered.mockResolvedValue(["first", "second", "third"].map((RefNumber) => ({ RefNumber, kontriStatusCode: 100 })));
        mocks.check.mockResolvedValueOnce({ Code: 200, Status: "Nowe" });
        const result = await updateNewOrdersState({ fullSweep: true });
        expect(mocks.check).toHaveBeenCalledTimes(3);
        expect(mocks.update).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ status: "success", checkedCount: 3, failedCount: 0 });
        expect(result.message).not.toContain("stopped");
    });

    it("checks every aggregated group and skips writes for groups already at the computed state", async () => {
        mocks.aggregated.mockResolvedValue([
            { RefNumber: "first", kontriStatusCode: 301 },
            { RefNumber: "second", kontriStatusCode: 300 },
            { RefNumber: "third", kontriStatusCode: 300 },
        ]);
        mocks.check
            .mockResolvedValueOnce({ Code: 200, Status: "Kompletowane", Articles: { Article: [{}] } })
            .mockResolvedValueOnce({ Code: 200, Status: "Anulowane/zagregowane" })
            .mockResolvedValueOnce({ Code: 200, Status: "Wyslane" });
        const result = await updateAggregatedOrdersState();
        expect(mocks.check).toHaveBeenCalledTimes(3);
        expect(mocks.update).toHaveBeenCalledOnce();
        expect(mocks.update).toHaveBeenCalledWith({ RefNumber: "third", kontriStatusCode: 300 }, { kontriStatusCode: 400 });
        expect(result).toMatchObject({ status: "success", checkedCount: 3 });
    });

    it("stops the new-order pass at the first group still Nowe", async () => {
        mocks.ordered.mockResolvedValue([
            { RefNumber: "first", kontriStatusCode: 100 },
            { RefNumber: "second", kontriStatusCode: 100 },
        ]);
        mocks.check.mockResolvedValue({ Code: 200, Status: "Nowe" });
        expect(await updateNewOrdersState()).toMatchObject({ checkedCount: 1 });
        expect(mocks.check).toHaveBeenCalledOnce();
    });

    it("continues after a thrown check or failed write and reports failures", async () => {
        mocks.ordered.mockResolvedValue(["first", "second", "third"].map((RefNumber) => ({ RefNumber })));
        mocks.check.mockRejectedValueOnce(new Error("network"));
        mocks.update.mockRejectedValueOnce(new Error("storage"));
        expect(await updateNewOrdersState()).toMatchObject({ status: "error", checkedCount: 3, failedCount: 2 });
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
