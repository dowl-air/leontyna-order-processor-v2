import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type ShopOrder from "@/types/ShopOrder";

vi.mock("@/actions/getKontriProductMapping", () => ({ getKontriProductMapping: vi.fn() }));
import { getKontriProductMapping, KontriProductMappingResult } from "@/actions/getKontriProductMapping";
import { KontriMappingModal } from "./KontriMappingModal";

const product = { orderItemCode: "AK-5-100", orderItemName: "Product", orderItemEan: "00123" } as ShopOrder;
const matched: KontriProductMappingResult = {
    status: "matched",
    itemId: "100",
    record: { catalogId: "100", apiId: "900", ean: "00123" },
    version: "active-version",
    feedDate: "2026-10-11 05:55",
};

describe("KontriMappingModal", () => {
    let renderer: ReactTestRenderer | undefined;
    const close = vi.fn();
    const showModal = vi.fn();
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal("React", React);
        vi.mocked(getKontriProductMapping).mockResolvedValue(matched);
    });
    afterEach(() => {
        if (renderer) act(() => renderer!.unmount());
        renderer = undefined;
        vi.unstubAllGlobals();
    });
    async function mount(source = product) {
        await act(async () => {
            renderer = create(<KontriMappingModal product={source} onClose={close} />, { createNodeMock: () => ({ showModal }) });
        });
    }
    function text() {
        return JSON.stringify(renderer!.toJSON());
    }
    it("opens the dialog and displays matched EANs in green with catalog/API IDs and feed metadata", async () => {
        await mount();
        expect(showModal).toHaveBeenCalledOnce();
        expect(getKontriProductMapping).toHaveBeenCalledWith("AK-5-100");
        expect(text()).toContain("Shoda EAN");
        expect(text()).toContain("text-green-700");
        expect(text()).toContain("00123");
        expect(text()).toContain("100");
        expect(text()).toContain("900");
        expect(text()).toContain("id_instancji");
        expect(text()).toContain("id_instancji_API");
        expect(text()).not.toContain('"itemId"');
        expect(text()).not.toContain("itemIdApi");
        expect(text()).toContain("active-version");
        expect(text()).toContain("2026-10-11 05:55");
    });
    it("shows mismatching EANs in orange without hiding the catalog match", async () => {
        await mount({ ...product, orderItemEan: "00456" });
        expect(text()).toContain("Nesoulad EAN");
        expect(text()).toContain("text-orange-700");
        expect(text()).toContain("00456");
        expect(text()).toContain("00123");
        expect(text()).toContain("900");
    });
    it("normalizes EAN whitespace while preserving leading zeros", async () => {
        await mount({ ...product, orderItemEan: " 00123 " });
        expect(text()).toContain("Shoda EAN");
    });
    it("does not display a missing EAN as a confirmed match", async () => {
        await mount({ ...product, orderItemEan: "" });
        expect(text()).toContain("EAN nelze porovnat");
        expect(text()).toContain("text-orange-700");
        expect(text()).not.toContain("Shoda EAN");
    });
    it("reports a missing catalog mapping while retaining feed metadata", async () => {
        vi.mocked(getKontriProductMapping).mockResolvedValue({ ...matched, status: "notFound", record: null });
        await mount();
        expect(text()).toContain("Katalogové ID nebylo v aktivním feedu nalezeno.");
        expect(text()).toContain("active-version");
    });
    it("shows missing feed dates explicitly", async () => {
        vi.mocked(getKontriProductMapping).mockResolvedValue({ ...matched, feedDate: null });
        await mount();
        expect(text()).toContain("Neuvedeno");
    });
    it("shows a safe error and allows a fresh retry", async () => {
        vi.mocked(getKontriProductMapping).mockRejectedValueOnce(new Error("private detail"));
        await mount();
        expect(text()).toContain("Mapování se nepodařilo načíst.");
        expect(text()).not.toContain("private detail");
        await act(async () => renderer!.root.findByProps({ "aria-label": "Znovu načíst mapování" }).props.onClick());
        expect(getKontriProductMapping).toHaveBeenCalledTimes(2);
        expect(text()).toContain("Shoda EAN");
    });
    it("shows loading immediately and permits closing before the request finishes", async () => {
        let finish!: (result: KontriProductMappingResult) => void;
        vi.mocked(getKontriProductMapping).mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            }),
        );
        await mount();
        expect(text()).toContain("Načítání mapování");
        act(() => renderer!.root.findByProps({ "aria-label": "Zavřít mapování" }).props.onClick());
        expect(close).toHaveBeenCalledOnce();
        act(() => renderer!.unmount());
        renderer = undefined;
        await act(async () => finish(matched));
    });
    it("closes on the native dialog cancel event", async () => {
        await mount();
        act(() => renderer!.root.findByType("dialog").props.onCancel());
        expect(close).toHaveBeenCalledOnce();
    });
    it("handles Escape explicitly without closing on other keys", async () => {
        await mount();
        const preventDefault = vi.fn();
        act(() => renderer!.root.findByType("dialog").props.onKeyDown({ key: "Enter", preventDefault }));
        expect(close).not.toHaveBeenCalled();
        act(() => renderer!.root.findByType("dialog").props.onKeyDown({ key: "Escape", preventDefault }));
        expect(close).toHaveBeenCalledOnce();
        expect(preventDefault).toHaveBeenCalledOnce();
    });
});
