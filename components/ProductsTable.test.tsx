import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShopOrder from "@/types/ShopOrder";

vi.mock("@/actions/downloadKontriFeed", () => ({ downloadKontriFeed: vi.fn() }));
vi.mock("./KontriMappingPreviewButton", () => ({ KontriMappingPreviewButton: () => null }));
vi.mock("@/actions/feedsDownload", () => ({ feedsDownload: vi.fn() }));
vi.mock("@/actions/checkOrder", () => ({ checkOrder: vi.fn() }));
vi.mock("@/actions/triggerOrdersSend", () => ({ sendOrders: vi.fn() }));
vi.mock("@/db/getProducts", () => ({ getProducts: vi.fn() }));
vi.mock("./OrderInfoModal", () => ({ OrderInfoModal: () => null }));
vi.mock("@/actions/checkOrderRefNumber", () => ({ checkOrderByRefNumber: vi.fn() }));
import ProductsTable from "./ProductsTable";

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
    it("shows manual verification instead of a zero shortage after reconciliation", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[{ ...product, kontriReconciliationRequired: true }]} />);
        expect(html).toContain("Ověřit");
        expect(html).toContain("Nedostatky nebyly potvrzeny původní odpovědí Kontri");
    });
    it("shows the known shortage for a normal confirmed response", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[{ ...product, shortage: 2, kontriReconciliationRequired: false }]} />);
        expect(html).not.toContain("Ověřit");
        expect(html).toMatch(/text-center text-error font-bold[^>]*>2<\/td>/);
    });
    it("displays the persisted API ID alongside the unchanged source code", () => {
        vi.stubGlobal("React", React);
        const html = renderToStaticMarkup(<ProductsTable initialShopOrders={[{ ...product, kontriApiId: "900" }]} />);
        expect(html).toContain("API ID: 900");
        expect(html).toContain("AK-5-100");
    });
});
