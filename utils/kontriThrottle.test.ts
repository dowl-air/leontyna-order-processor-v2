import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KONTRI_QUEUE_RELEASE_MS, KONTRI_REQUEST_SPACING_MS, resetKontriSpacing, withKontriSpacing } from "./kontriThrottle";

describe("Kontri request spacing", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetKontriSpacing();
    });
    afterEach(() => vi.useRealTimers());

    it("does not delay the first request", async () => {
        const request = vi.fn().mockResolvedValue("ok");
        const pending = withKontriSpacing(request);
        await vi.advanceTimersByTimeAsync(0);
        expect(request).toHaveBeenCalledOnce();
        expect(await pending).toBe("ok");
    });

    it("waits only for the rest of the spacing after the previous response", async () => {
        await withKontriSpacing(async () => "first");
        await vi.advanceTimersByTimeAsync(1000);
        const second = vi.fn().mockResolvedValue("second");
        const pending = withKontriSpacing(second);
        await vi.advanceTimersByTimeAsync(KONTRI_REQUEST_SPACING_MS - 1001);
        expect(second).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(second).toHaveBeenCalledOnce();
        expect(await pending).toBe("second");
    });

    it("measures spacing from the end of a slow or failed request and serializes concurrent calls", async () => {
        const first = withKontriSpacing(() => new Promise((_, reject) => setTimeout(() => reject(new Error("down")), 5000)));
        first.catch(() => undefined);
        const second = vi.fn().mockResolvedValue("second");
        const pending = withKontriSpacing(second);
        await vi.advanceTimersByTimeAsync(5000);
        await expect(first).rejects.toThrow("down");
        expect(second).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(KONTRI_REQUEST_SPACING_MS - 1);
        expect(second).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toBe("second");
    });

    it("does not delay a request made after the spacing has already passed", async () => {
        await withKontriSpacing(async () => "first");
        await vi.advanceTimersByTimeAsync(KONTRI_REQUEST_SPACING_MS);
        const request = vi.fn().mockResolvedValue("ok");
        withKontriSpacing(request);
        await vi.advanceTimersByTimeAsync(0);
        expect(request).toHaveBeenCalledOnce();
    });

    it("releases the queue after a hung request, measured from its start", async () => {
        withKontriSpacing(() => new Promise(() => undefined));
        const queued = [1, 2].map(() => vi.fn().mockResolvedValue("ok"));
        queued.forEach((request) => withKontriSpacing(request));
        await vi.advanceTimersByTimeAsync(KONTRI_QUEUE_RELEASE_MS + KONTRI_REQUEST_SPACING_MS - 1);
        expect(queued[0]).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(queued[0]).toHaveBeenCalledOnce();
        expect(queued[1]).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(KONTRI_REQUEST_SPACING_MS);
        expect(queued[1]).toHaveBeenCalledOnce();
    });
});
