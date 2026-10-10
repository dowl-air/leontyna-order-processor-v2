import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import config from "@/vercel.json";

const mocks = vi.hoisted(() => ({ download: vi.fn(), auth: vi.fn() }));
vi.mock("@/actions/downloadKontriFeed", () => ({ downloadKontriFeed: mocks.download }));
vi.mock("next/headers", () => ({ headers: () => ({ get: mocks.auth }) }));
import { GET } from "./route";

describe("daily Kontri feed cron", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-11T03:55:00Z"));
        vi.stubEnv("CRON_SECRET", "test-secret");
        mocks.auth.mockReturnValue("Bearer test-secret");
        mocks.download.mockResolvedValue({ status: "success", message: "updated" });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });
    it("keeps the order cron and schedules both UTC candidates for Prague 05:55", () => {
        expect(config.crons).toContainEqual({ path: "/api/cron", schedule: "*/10 * * * *" });
        expect(config.crons).toContainEqual({ path: "/api/cron/kontri-feed", schedule: "55 3,4 * * *" });
    });
    it.each(["2026-07-11T03:55:12Z", "2026-01-11T04:55:12Z", "2026-10-25T04:55:00Z", "2026-03-29T03:55:00Z"])(
        "updates at Prague 05:55 on %s",
        async (date) => {
            vi.setSystemTime(new Date(date));
            const response = await GET();
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ status: "success", results: { kontriFeed: { message: "updated" } } });
            expect(mocks.download).toHaveBeenCalledOnce();
        },
    );
    it.each(["2026-07-11T04:55:00Z", "2026-01-11T03:55:00Z", "2026-10-11T03:54:00Z"])(
        "skips the other UTC candidate or wrong minute on %s",
        async (date) => {
            vi.setSystemTime(new Date(date));
            const response = await GET();
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ status: "skipped" });
            expect(mocks.download).not.toHaveBeenCalled();
        },
    );
    it("requires a configured secret and valid authorization even outside the time window", async () => {
        mocks.auth.mockReturnValue("Bearer wrong");
        expect((await GET()).status).toBe(401);
        vi.stubEnv("CRON_SECRET", "");
        mocks.auth.mockReturnValue("Bearer ");
        expect((await GET()).status).toBe(401);
        expect(mocks.download).not.toHaveBeenCalled();
    });
    it.each(["error", "throw", "invalid"])("returns HTTP 500 for %s without exception details", async (mode) => {
        if (mode === "throw") mocks.download.mockRejectedValue(new Error("secret detail"));
        else mocks.download.mockResolvedValue(mode === "invalid" ? undefined : { status: "error", message: "failed" });
        const response = await GET();
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain("secret detail");
    });
    it("reports a nonfatal publication rejection as info", async () => {
        mocks.download.mockResolvedValue({ status: "info", message: "not published" });
        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ status: "info", results: { kontriFeed: { status: "info" } } });
    });
});
