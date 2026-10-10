import { describe, expect, it } from "vitest";
import { createKontriLookup, resolveKontriProduct } from "./resolveKontriProduct";

const records = [
    { catalogId: "100", apiId: "900", ean: "00123" },
    { catalogId: "900", apiId: "901", ean: "00456" },
];
const lookup = createKontriLookup(records);
const product = (orderItemCode: string, orderItemEan = "00123") => ({ orderItemCode, orderItemEan });

describe("Kontri product resolution", () => {
    it("resolves a catalog code using the matching EAN", () => {
        expect(resolveKontriProduct(product("AK-5-100"), lookup)).toMatchObject({ status: "matched", apiId: "900", source: "catalogId" });
    });
    it("resolves an old API code and disambiguates overlapping identifier spaces by EAN", () => {
        expect(resolveKontriProduct(product("AK-5-900"), lookup)).toMatchObject({ status: "matched", apiId: "900", source: "apiId" });
    });
    it("blocks overlapping identifier spaces without EAN", () => {
        expect(resolveKontriProduct(product("AK-5-900", ""), lookup)).toMatchObject({ status: "blocked", reason: "ambiguous" });
    });
    it("uses EAN only when the identifier is absent from both indexes", () => {
        expect(resolveKontriProduct(product("AK-5-999"), lookup)).toMatchObject({ status: "matched", apiId: "900", source: "ean" });
    });
    it("does not fall back to EAN when a known identifier points to a different product", () => {
        expect(resolveKontriProduct(product("AK-5-100", "00456"), lookup)).toMatchObject({ status: "blocked", reason: "eanMismatch" });
    });
    it("allows a unique identifier without EAN", () => {
        expect(resolveKontriProduct(product("AK-5-100", ""), lookup)).toMatchObject({ status: "matched", apiId: "900" });
    });
    it("preserves EAN leading zeros", () => {
        expect(resolveKontriProduct(product("AK-5-100", "123"), lookup)).toMatchObject({ status: "blocked", reason: "eanMismatch" });
    });
    it("blocks an unknown identifier and EAN", () => {
        expect(resolveKontriProduct(product("AK-5-999", "missing"), lookup)).toMatchObject({ status: "blocked", reason: "notFound" });
    });
    it.each(["AK-5", "AK-5-100-extra", "AK-5-0", "OTHER-5-100"])("blocks malformed codes: %s", (code) => {
        expect(resolveKontriProduct(product(code), lookup)).toMatchObject({ status: "blocked", reason: "invalidCode" });
    });
    it("blocks ambiguous EAN fallback rather than choosing the first record", () => {
        const duplicates = createKontriLookup([...records, { catalogId: "200", apiId: "902", ean: "00123" }]);
        expect(resolveKontriProduct(product("AK-5-999"), duplicates)).toMatchObject({ status: "blocked", reason: "ambiguous" });
    });
});
