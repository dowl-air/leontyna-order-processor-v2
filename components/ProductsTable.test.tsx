import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShopOrder from "@/types/ShopOrder";

vi.mock("@/actions/downloadKontriFeed", () => ({ downloadKontriFeed: vi.fn() }));
vi.mock("@/actions/feedsDownload", () => ({ feedsDownload: vi.fn() }));
vi.mock("@/actions/checkOrder", () => ({ checkOrder: vi.fn() }));
vi.mock("@/actions/triggerOrdersSend", () => ({ sendOrders: vi.fn() }));
vi.mock("@/db/getProducts", () => ({ getProducts: vi.fn() }));
vi.mock("./OrderInfoModal", () => ({ OrderInfoModal: () => null }));
vi.mock("./KontriMappingModal", () => ({ KontriMappingModal: () => null }));
vi.mock("@/actions/checkOrderRefNumber", () => ({ checkOrderByRefNumber: vi.fn() }));
import ProductsTable from "./ProductsTable";
import { KontriMappingModal } from "./KontriMappingModal";
import { getProducts } from "@/db/getProducts";
import { checkOrder } from "@/actions/checkOrder";
import { checkOrderByRefNumber } from "@/actions/checkOrderRefNumber";
import { OrderInfoModal } from "./OrderInfoModal";

const product = {
    code: "order",
    date: "2026-10-10",
    orderItemCode: "AK-5-100",
    orderItemName: "Product",
    orderItemVariantName: "Size",
    orderItemAmount: 2,
    orderItemUnit: "ks",
    AltumOrderID: "123",
    RefNumber: "stable",
    kontriStatusCode: 100,
    kontriStatusName: "Objednáno",
    shortage: 0,
} as ShopOrder;

describe("ProductsTable shortage certainty", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("does not offer the removed mapping preview", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[product]} />);
        expect(html).not.toContain("Náhled párování");
        expect(html).toContain("Vynutit stažení Kontri feedu");
        expect(html).toContain("Vynutit odeslání objednávek");
    });
    it("shows unknown instead of a zero shortage before quantity confirmation", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[{ ...product, kontriReconciliationRequired: true }]} />);
        expect(html).toContain("Neznámé");
        expect(html).toContain("Nedostatky zatím nejsou potvrzené");
    });
    it("shows the known shortage for a normal confirmed response", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[{ ...product, shortage: 2, kontriReconciliationRequired: false }]} />);
        expect(html).not.toContain("Neznámé");
        expect(html).toMatch(/text-center text-error font-bold[^>]*>2<\/td>/);
    });
    it("displays the persisted API ID alongside the unchanged source code", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[{ ...product, kontriApiId: "900" }]} />);
        expect(html).toContain("API ID: 900");
        expect(html).toContain("AK-5-100");
    });
    it("provides a mapping question button for each product with or without a saved API ID", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[product, { ...product, code: "second", kontriApiId: "900" }]} />);
        expect(html.match(/aria-label="Zobrazit Kontri mapování AK-5-100"/g)).toHaveLength(2);
    });
    it.each([0, undefined])("shows an EAN block alongside Neobjednáno and retains the mapping question button (status %s)", (kontriStatusCode) => {
        vi.stubGlobal("React", React);
        const blocked = { ...product, AltumOrderID: null, RefNumber: undefined, kontriStatusCode, kontriEanBlocked: true };
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[blocked]} />);
        expect(html).toContain("Nesoulad EAN");
        expect(html).toContain("Neobjednáno");
        expect(html).toContain('aria-label="Zobrazit Kontri mapování AK-5-100"');
        expect(html).not.toContain("Dotaz [Referenční číslo]");
    });
});

describe("ProductsTable pagination", () => {
    let renderer: ReactTestRenderer;
    let intersect: () => void;
    afterEach(() => {
        if (renderer) act(() => renderer.unmount());
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });
    function mount() {
        vi.stubGlobal("React", React);
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
                    intersect = () => callback([{ isIntersecting: true }]);
                }
                observe() {}
                disconnect() {}
            },
        );
        act(() => {
            renderer = create(<ProductsTable initialShopOrders={[product]} />, { createNodeMock: () => ({}) });
        });
    }
    it.each([
        ["Referenční číslo", 80, ""],
        ["Referenční číslo", "80", "   "],
        ["Kontri ID", 80, ""],
        ["Kontri ID", "80", "   "],
        ["Referenční číslo", 500, "Nastala chyba při zjišťování stavu objednávky."],
        ["Kontri ID", 500, "Nastala chyba při zjišťování stavu objednávky."],
    ])("shows order lookup failure details for %s, code %s and message %j", async (lookup, Code, Message) => {
        const dialog = { showModal: vi.fn(), close: vi.fn() };
        vi.stubGlobal("document", { getElementById: vi.fn(() => dialog) });
        vi.mocked(checkOrder).mockResolvedValue({ Code, Message });
        vi.mocked(checkOrderByRefNumber).mockResolvedValue({ Code, Message });
        mount();
        await act(async () => {
            await renderer.root
                .findAllByType("button")
                .find((button) => button.props.children === `Dotaz [${lookup}]`)!
                .props.onClick();
        });
        const output = JSON.stringify(renderer.toJSON());
        expect(output).toContain(
            `Kontri dotaz selhal (kód ${Code}, ${lookup === "Kontri ID" ? lookup : lookup.toLowerCase()}: ${lookup === "Kontri ID" ? "123" : "stable"}).`,
        );
        expect(output).toContain(Message.trim() || "Kontri nevrátilo popis chyby. Stav objednávky nebyl ověřen.");
        expect(dialog.showModal).toHaveBeenCalledOnce();
        expect(dialog.close).toHaveBeenCalledOnce();
        expect(getProducts).not.toHaveBeenCalled();
    });
    it.each([
        ["Referenční číslo", 200],
        ["Kontri ID", "200"],
    ])("keeps the detail modal open for successful order lookup by %s", async (lookup, Code) => {
        const dialog = { showModal: vi.fn(), close: vi.fn() };
        vi.stubGlobal("document", { getElementById: vi.fn(() => dialog) });
        const response = { Code, Message: "", AltumOrderID: "123" };
        vi.mocked(checkOrder).mockResolvedValue(response);
        vi.mocked(checkOrderByRefNumber).mockResolvedValue(response);
        mount();
        await act(async () => {
            await renderer.root
                .findAllByType("button")
                .find((button) => button.props.children === `Dotaz [${lookup}]`)!
                .props.onClick();
        });
        expect(renderer.root.findByType(OrderInfoModal).props.order).toEqual(response);
        expect(dialog.showModal).toHaveBeenCalledOnce();
        expect(dialog.close).not.toHaveBeenCalled();
        expect(JSON.stringify(renderer.toJSON())).not.toContain("Kontri dotaz selhal");
        expect(getProducts).not.toHaveBeenCalled();
    });
    it("opens the mapping modal for the clicked product and removes it on close", async () => {
        mount();
        expect(renderer.root.findAllByType(KontriMappingModal)).toHaveLength(0);
        act(() => renderer.root.findByProps({ "aria-label": "Zobrazit Kontri mapování AK-5-100" }).props.onClick());
        const modal = renderer.root.findByType(KontriMappingModal);
        expect(modal.props.product).toEqual(product);
        act(() => modal.props.onClose());
        expect(renderer.root.findAllByType(KontriMappingModal)).toHaveLength(0);
        expect(getProducts).not.toHaveBeenCalled();
    });
    it("loads once while pending and uses the newest cursor only after another intersection", async () => {
        let resolvePage!: (products: ShopOrder[]) => void;
        vi.mocked(getProducts).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolvePage = resolve;
                }),
        );
        mount();
        await act(async () => {
            intersect();
        });
        await act(async () => {
            intersect();
        });
        expect(getProducts).toHaveBeenCalledTimes(1);
        const next = { ...product, code: "older-order", date: "2026-10-09" };
        await act(async () => {
            resolvePage([next]);
        });
        expect(getProducts).toHaveBeenCalledTimes(1);
        vi.mocked(getProducts).mockResolvedValueOnce([]);
        await act(async () => {
            intersect();
        });
        expect(getProducts).toHaveBeenLastCalledWith(expect.any(Number), new Date(next.date));
    });
    it("does not resume pagination after an empty page", async () => {
        vi.mocked(getProducts).mockResolvedValue([]);
        mount();
        await act(async () => {
            intersect();
        });
        await act(async () => {
            intersect();
        });
        expect(getProducts).toHaveBeenCalledTimes(1);
    });
    it("discards a pending page after refresh and resumes from the refreshed cursor", async () => {
        let resolvePage!: (products: ShopOrder[]) => void;
        vi.mocked(getProducts).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolvePage = resolve;
                }),
        );
        mount();
        await act(async () => {
            intersect();
        });
        const refreshed = { ...product, code: "refreshed", date: "2026-10-11" };
        vi.mocked(getProducts).mockResolvedValueOnce([refreshed]);
        await act(async () => {
            await renderer.root.findAllByType("button")[0].props.onClick();
        });
        await act(async () => {
            resolvePage([{ ...product, code: "stale-page" }]);
        });
        expect(JSON.stringify(renderer.toJSON())).not.toContain("stale-page");
        vi.mocked(getProducts).mockResolvedValueOnce([]);
        await act(async () => {
            intersect();
        });
        expect(getProducts).toHaveBeenLastCalledWith(expect.any(Number), new Date(refreshed.date));
    });
    it("reports a failed page without an unhandled rejection and permits retry", async () => {
        vi.mocked(getProducts).mockRejectedValueOnce(new Error("failed"));
        mount();
        await act(async () => {
            intersect();
        });
        expect(JSON.stringify(renderer.toJSON())).toContain("Načtení dalších objednávek selhalo.");
        vi.mocked(getProducts).mockResolvedValueOnce([]);
        await act(async () => {
            intersect();
        });
        expect(getProducts).toHaveBeenCalledTimes(2);
    });
});
