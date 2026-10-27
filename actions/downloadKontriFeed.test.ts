import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), mail: vi.fn(), store: {} }));
vi.mock("@/db/kontriMapping", () => ({ kontriMappingStore: mocks.store }));
vi.mock("@/utils/kontriFeed", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/utils/kontriFeed")>()),
    refreshKontriMapping: mocks.refresh,
}));
vi.mock("./sendMail", () => ({ sendMail: mocks.mail }));
import { downloadKontriFeed } from "./downloadKontriFeed";
import { KontriFeedDropError } from "@/utils/kontriFeed";

describe("downloadKontriFeed", () => {
    beforeEach(() => {
        vi.stubEnv("KONTRI_FEED_LOGIN", "test-login");
        vi.stubEnv("KONTRI_FEED_PASSWORD", "test-password");
        mocks.refresh.mockReset();
        mocks.mail.mockReset().mockResolvedValue({ messageId: "test" });
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });
    it("does not fetch without credentials", async () => {
        vi.stubEnv("KONTRI_FEED_PASSWORD", "");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect((await downloadKontriFeed()).status).toBe("error");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it("authenticates without caching and saves the downloaded XML", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response("<ROOT/>"));
        vi.stubGlobal("fetch", fetchMock);
        mocks.refresh.mockResolvedValue({ unchanged: false, recordCount: 3 });
        expect((await downloadKontriFeed()).status).toBe("success");
        expect(fetchMock.mock.calls[0][0]).toBe("https://xml.kontri.pl/mobilhit/");
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
            cache: "no-store",
            redirect: "error",
            headers: { Authorization: `Basic ${Buffer.from("test-login:test-password").toString("base64")}` },
        });
        expect(mocks.refresh).toHaveBeenCalledWith("<ROOT/>", mocks.store);
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("does not write an HTTP error response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 401 })));
        expect((await downloadKontriFeed()).status).toBe("error");
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("HTTP 401") }));
    });
    it("does not expose credentials or internal errors", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test-password internal detail")));
        const result = await downloadKontriFeed();
        expect(result.status).toBe("error");
        expect(result.message).not.toContain("test-password");
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(JSON.stringify(mocks.mail.mock.calls)).not.toContain("test-password");
    });
    it("reports validation or database failure", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid")));
        mocks.refresh.mockRejectedValue(new Error("invalid feed"));
        expect((await downloadKontriFeed()).status).toBe("error");
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
    it("reports and emails the rejected record count drop", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<ROOT/>")));
        mocks.refresh.mockRejectedValue(new KontriFeedDropError(100, 74));
        const result = await downloadKontriFeed();
        expect(result.status).toBe("error");
        expect(result.message).toContain("100 → 74");
        expect(result.message).toContain("25 %");
        expect(mocks.mail).toHaveBeenCalledOnce();
        expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("100 → 74") }));
    });
    it("reports rejected publication without claiming the downloaded count is active", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<ROOT/>")));
        mocks.refresh.mockResolvedValue({ unchanged: false, rejected: true, recordCount: 999 });
        const result = await downloadKontriFeed();
        expect(result.status).toBe("info");
        expect(result.message).toContain("nebylo aktivováno");
        expect(result.message).not.toContain("aktuální");
        expect(result.message).not.toContain("999");
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("reports unchanged content without sending an email", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<ROOT/>")));
        mocks.refresh.mockResolvedValue({ unchanged: true, rejected: false, recordCount: 3 });
        expect(await downloadKontriFeed()).toMatchObject({ status: "success", message: expect.stringContaining("aktuální: 3 variant") });
        expect(mocks.mail).not.toHaveBeenCalled();
    });
    it("notifies about cleanup failure without reporting publication as failed", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<ROOT/>")));
        mocks.refresh.mockResolvedValue({ unchanged: false, recordCount: 3, cleanupFailed: true });
        expect((await downloadKontriFeed()).status).toBe("success");
        expect(mocks.mail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Úklid") }));
    });
    it.each(["reject", "undefined"])("preserves the original error when notification fails: %s", async (failure) => {
        vi.stubEnv("KONTRI_FEED_PASSWORD", "");
        if (failure === "reject") mocks.mail.mockRejectedValue(new Error("mail failure"));
        else mocks.mail.mockResolvedValue(undefined);
        const result = await downloadKontriFeed();
        expect(result.status).toBe("error");
        expect(result.message).toContain("Chybí přihlašovací údaje");
        expect(result.message).toContain("E-mailové upozornění se nepodařilo odeslat");
        expect(mocks.mail).toHaveBeenCalledOnce();
    });
});
