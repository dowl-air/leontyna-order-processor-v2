import { afterEach, describe, expect, it, vi } from "vitest";
import { formatKontriError, logKontriResponse, logKontriError } from "./kontriDiagnostics";

describe("Kontri diagnostics", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });
    it("logs rejection code, message and quantities without raw payloads", () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => {});
        logKontriResponse("submit", "reference", {
            Code: 80,
            Message: "Unavailable",
            Shortages: { Shortages: [{ AltumArticleID: 522299, Quantity: 1 }] },
            Customer: "private",
        });
        expect(log).toHaveBeenCalledWith(
            "Kontri diagnostic",
            expect.objectContaining({
                event: "submit.response",
                reference: "reference",
                code: 80,
                message: "Unavailable",
                shortages: [{ apiId: "522299", quantity: 1 }],
            }),
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    });
    it("makes missing messages explicit and redacts secrets, emails and URLs", () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => {});
        vi.stubEnv("KONTRI_API_PASSWORD", "secret-value");
        logKontriResponse("lookup", "reference", { Code: 404, Message: "" });
        expect(log.mock.calls[0][1]).toMatchObject({ code: 404, message: "[empty]" });
        logKontriResponse("lookup", "reference", { Code: 500, Message: "secret-value person@example.com https://host/?token=value" });
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-value|person@example.com|token=value/);
    });
    it("logs safe error fields rather than request or response objects", () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        logKontriError("lookup", "reference", Object.assign(new Error("Failure"), { code: "ECONNRESET", config: { password: "private" } }));
        expect(log).toHaveBeenCalledWith(
            "Kontri diagnostic",
            expect.objectContaining({ event: "lookup.error", reference: "reference", errorCode: "ECONNRESET", message: "Failure" }),
        );
        expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    });
    it("formats error causes and redacts feed authentication, URLs, emails and response content", () => {
        vi.stubEnv("KONTRI_FEED_LOGIN", "feed-login");
        vi.stubEnv("KONTRI_FEED_PASSWORD", "feed-password");
        const encoded = Buffer.from("feed-login:feed-password").toString("base64");
        const error = Object.assign(new TypeError(`fetch failed ${encoded} feed-password feed-login https://host/ person@example.com`), {
            cause: Object.assign(new Error("redirect count exceeded <html>private response</html>"), { code: "NETWORK_ERROR" }),
            response: "private response",
        });
        const result = formatKontriError(error);
        expect(result).toContain("TypeError: fetch failed");
        expect(result).toContain("NETWORK_ERROR: redirect count exceeded");
        for (const secret of [encoded, "feed-password", "feed-login", "https://host/", "person@example.com", "private response"])
            expect(result).not.toContain(secret);
        expect(formatKontriError(new Error('Bad response {"private":"payload"}'))).not.toContain("payload");
    });
    it("handles timeouts, missing errors and bounded cyclic causes", () => {
        expect(formatKontriError(new DOMException("The operation timed out", "TimeoutError"))).toContain("TimeoutError: The operation timed out");
        expect(formatKontriError(undefined)).toBe("Unknown error");
        expect(formatKontriError({})).toBe("Unknown error");
        expect(formatKontriError("failure")).toBe("failure");
        const cyclic = Object.assign(new Error("cycle"), { cause: {} });
        cyclic.cause = cyclic;
        expect(formatKontriError(cyclic).match(/cycle/g)).toHaveLength(3);
        expect(formatKontriError(new Error("failure".repeat(1000))).length).toBeLessThanOrEqual(2000);
    });
});
