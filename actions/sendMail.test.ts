import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), send: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ verify: mocks.verify, sendMail: mocks.send }) } }));

describe("sendMail", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubEnv("SMTP_SERVER_USERNAME", "test@example.com");
        vi.stubEnv("SMTP_SERVER_PASSWORD", "smtp-test-secret");
        vi.stubEnv("SITE_MAIL_RECIEVER", "recipient@example.com");
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });
    it("does not log credentials or send after verification failure", async () => {
        mocks.verify.mockRejectedValue(new Error("smtp-test-secret"));
        const { sendMail } = await import("./sendMail");
        expect(await sendMail({ subject: "test", text: "test" })).toBeUndefined();
        expect(mocks.send).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledOnce();
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("smtp-test-secret");
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("test@example.com");
    });
    it("returns delivery result and uses the configured recipient", async () => {
        mocks.verify.mockResolvedValue(true);
        mocks.send.mockResolvedValue({ messageId: "mail-1" });
        const { sendMail } = await import("./sendMail");
        expect(await sendMail({ subject: "test", text: "test" })).toEqual({ messageId: "mail-1" });
        expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "recipient@example.com" }));
    });
});
