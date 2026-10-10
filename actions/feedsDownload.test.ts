import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ add: vi.fn(), latest: vi.fn(), fetch: vi.fn() }));
vi.mock("@/db/addProduct", () => ({ addProduct: mocks.add }));
vi.mock("@/db/getLatestDate", () => ({ getLatestDate: mocks.latest }));
vi.mock("@/utils/formatDate", () => ({ formatDateShoptet: () => "2026-10-11%2005:00:00" }));

describe("Shoptet feed transport", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.resetModules();
        vi.stubEnv("SHOPTET_URL", "https://example.test/cz?token=test");
        vi.stubEnv("SHOPTET_URL_SK", "https://example.test/sk?token=test");
        vi.stubGlobal("fetch", mocks.fetch);
        mocks.latest.mockResolvedValue(new Date("2026-10-11T05:00:00Z"));
        mocks.add.mockResolvedValue(undefined);
        mocks.fetch.mockImplementation(
            async () =>
                new Response(
                    "orderItemType,orderItemCode,orderItemSupplier,field13\nproduct,AK-5-100,Kontri.pl,remove\nservice,AK-5-101,Kontri.pl,remove\nproduct,OTHER-5,Kontri.pl,remove\nproduct,AK-5-102,Other,remove\n",
                ),
        );
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });
    it("fetches both feeds through the native transport and preserves row filters", async () => {
        const { feedsDownload } = await import("./feedsDownload");
        expect((await feedsDownload()).status).toBe("success");
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
        expect(mocks.fetch).toHaveBeenCalledWith("https://example.test/cz?token=test&updateTimeFrom=2026-10-11%2005:00:00", { cache: "no-store" });
        expect(mocks.add).toHaveBeenCalledTimes(2);
        expect(mocks.add).toHaveBeenCalledWith({ orderItemType: "product", orderItemCode: "AK-5-100", orderItemSupplier: "Kontri.pl" });
    });
    it.each(["http", "network", "empty-body"])("reports %s transport failure", async (mode) => {
        if (mode === "network") mocks.fetch.mockRejectedValue(new Error("network"));
        else mocks.fetch.mockResolvedValue(new Response(mode === "empty-body" ? null : "error", { status: mode === "http" ? 503 : 200 }));
        const { feedsDownload } = await import("./feedsDownload");
        expect((await feedsDownload()).status).toBe("error");
        expect(mocks.add).not.toHaveBeenCalled();
    });
    it("preserves the existing behavior for a failed individual product write", async () => {
        mocks.add.mockRejectedValue(new Error("write failed"));
        const { feedsDownload } = await import("./feedsDownload");
        expect((await feedsDownload()).status).toBe("success");
    });
    it("returns an import error when the response stream is interrupted", async () => {
        mocks.fetch.mockImplementation(
            async () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.error(new Error("stream interrupted"));
                        },
                    }),
                ),
        );
        const { feedsDownload } = await import("./feedsDownload");
        expect((await feedsDownload()).status).toBe("error");
    });
});
