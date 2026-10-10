import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ feeds: vi.fn(), send: vi.fn(), newOrders: vi.fn(), aggregated: vi.fn(), auth: vi.fn() }));
vi.mock("@/actions/feedsDownload", () => ({ feedsDownload: mocks.feeds }));
vi.mock("@/actions/triggerOrdersSend", () => ({ sendOrders: mocks.send }));
vi.mock("@/actions/updateOrdersState", () => ({ updateNewOrdersState: mocks.newOrders, updateAggregatedOrdersState: mocks.aggregated }));
vi.mock("next/headers", () => ({ headers: () => ({ get: mocks.auth }) }));
import { GET } from "./route";

describe("cron result reporting", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubEnv("CRON_SECRET", "test-secret");
        mocks.auth.mockReturnValue("Bearer test-secret");
        mocks.feeds.mockResolvedValue({ status: "success", message: "imported" });
        mocks.send.mockResolvedValue({ status: "info", message: "no new orders" });
        mocks.newOrders.mockResolvedValue({ status: "success", message: "checked", checkedCount: 3, failedCount: 0 });
        mocks.aggregated.mockResolvedValue({ status: "success", message: "checked", checkedCount: 2, failedCount: 0 });
    });
    afterEach(() => vi.unstubAllEnvs());

    it("returns all four actual results on success in workflow order", async () => {
        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            status: "success",
            results: {
                feeds: { message: "imported" },
                sendOrders: { status: "info" },
                newOrders: { checkedCount: 3 },
                aggregatedOrders: { checkedCount: 2 },
            },
        });
        const calls = [mocks.feeds, mocks.send, mocks.newOrders, mocks.aggregated].map((mock) => mock.mock.invocationCallOrder[0]);
        expect(calls).toEqual([...calls].sort((first, second) => first - second));
    });

    it.each(["returned", "thrown"])("skips sending on a %s import failure but still checks states", async (mode) => {
        if (mode === "returned") mocks.feeds.mockResolvedValue({ status: "error", message: "import failed" });
        else mocks.feeds.mockRejectedValue(new Error("sensitive detail"));
        const response = await GET();
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({
            status: "error",
            results: {
                feeds: { status: "error" },
                sendOrders: { status: "skipped" },
                newOrders: { status: "success" },
                aggregatedOrders: { status: "success" },
            },
        });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it.each(["send", "newOrders", "aggregated"] as const)("reports a returned %s failure without skipping independent checks", async (step) => {
        mocks[step].mockResolvedValue({ status: "error", message: "failed", failedCount: 1 });
        const response = await GET();
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.status).toBe("error");
        expect(mocks.newOrders).toHaveBeenCalledOnce();
        expect(mocks.aggregated).toHaveBeenCalledOnce();
        expect(Object.values(body.results)).toContainEqual(expect.objectContaining({ status: "error", message: "failed" }));
    });

    it.each(["send", "newOrders", "aggregated"] as const)("handles a thrown %s failure without leaking exceptions", async (step) => {
        mocks[step].mockRejectedValue(new Error("sensitive detail"));
        const response = await GET();
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain("sensitive detail");
        expect(mocks.newOrders).toHaveBeenCalledOnce();
        expect(mocks.aggregated).toHaveBeenCalledOnce();
    });

    it("rejects an invalid operation result instead of reporting success", async () => {
        mocks.feeds.mockResolvedValue(undefined);
        expect((await GET()).status).toBe(500);
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("does not execute without valid authorization or a configured secret", async () => {
        mocks.auth.mockReturnValue("Bearer wrong");
        expect((await GET()).status).toBe(401);
        vi.stubEnv("CRON_SECRET", "");
        mocks.auth.mockReturnValue("Bearer ");
        expect((await GET()).status).toBe(401);
        expect(mocks.feeds).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();
    });
});
