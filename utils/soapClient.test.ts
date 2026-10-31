import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), call: vi.fn() }));
vi.mock("soap", () => ({ createClient: mocks.createClient, BasicAuthSecurity: class {} }));

describe("Kontri SOAP client", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.resetAllMocks();
        vi.useFakeTimers();
        const client = {
            setSecurity: vi.fn(),
            GetOrderStatusByRefNumber: (args: object, callback: (error: unknown, result: unknown) => void) => {
                mocks.call(args);
                callback(null, { ok: true });
            },
        };
        mocks.createClient.mockImplementation((_url: string, _options: object, callback: (error: unknown, client: unknown) => void) =>
            callback(null, client),
        );
    });
    afterEach(() => vi.useRealTimers());

    it("loads the WSDL once and spaces every Kontri request", async () => {
        const { getOrderStatusByRefNumber } = await import("./soapClient");
        const first = getOrderStatusByRefNumber("first");
        await vi.advanceTimersByTimeAsync(2199);
        expect(mocks.call).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(await first).toEqual({ ok: true });
        const second = getOrderStatusByRefNumber("second");
        await vi.advanceTimersByTimeAsync(2200);
        expect(await second).toEqual({ ok: true });
        expect(mocks.createClient).toHaveBeenCalledOnce();
        expect(mocks.call.mock.calls).toEqual([[{ RefNumber: "first" }], [{ RefNumber: "second" }]]);
    });

    it("retries WSDL loading after a failed attempt", async () => {
        const { checkService } = await import("./soapClient");
        mocks.createClient.mockImplementationOnce((_url: string, _options: object, callback: (error: unknown) => void) =>
            callback(new Error("down")),
        );
        await expect(checkService()).rejects.toThrow("down");
        const retry = checkService().catch((error: Error) => error.message);
        await vi.runAllTimersAsync();
        await retry;
        expect(mocks.createClient).toHaveBeenCalledTimes(2);
    });
});
