"use server";

import { updateProduct } from "@/db/updateProduct";
import type ShopOrder from "@/types/ShopOrder";
import type { KontriMappingRecord } from "@/utils/kontriFeed";
import { logKontriError, logKontriEvent } from "@/utils/kontriDiagnostics";
import { sendMail } from "./sendMail";

export async function blockKontriEanMismatch(product: ShopOrder, candidates: KontriMappingRecord[], version: string) {
    await updateProduct(product, { kontriEanBlocked: true });
    logKontriEvent("mapping.eanBlocked", "", {
        productId: product.fID ?? "",
        orderCode: product.code,
        productCode: product.orderItemCode,
        sourceEan: product.orderItemEan,
        mappingVersion: version,
        candidates: candidates.length,
    });
    const text = [
        "Položka byla vyřazena z automatického objednávání kvůli nesouladu EAN. Stav zůstává Neobjednáno; vyžaduje ruční vyřešení a objednání.",
        `Objednávka: ${product.code}`,
        `Produkt: ${product.orderItemCode}${product.orderItemName ? ` | ${product.orderItemName}` : ""}`,
        `Shoptet EAN: ${product.orderItemEan}`,
        ...candidates.map((record) => `Kontri: id_instancji ${record.catalogId}, API ID ${record.apiId}, EAN ${record.ean}`),
        `Verze feedu: ${version}`,
    ].join("\n");
    try {
        const sent = await sendMail({ subject: "[Kontri objednávky] Nesoulad EAN", text });
        logKontriEvent(sent ? "mapping.notification.sent" : "mapping.notification.failed", "", { productId: product.fID ?? "" });
    } catch (error) {
        logKontriError("mapping.notification", "", error);
    }
}
