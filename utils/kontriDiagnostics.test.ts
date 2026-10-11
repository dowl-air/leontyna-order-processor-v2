import { afterEach, describe, expect, it, vi } from "vitest";
import { logKontriResponse, logKontriError } from "./kontriDiagnostics";

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
});
