import ShopOrder from "@/types/ShopOrder";
import { OrderResponseResult, OrderStatus } from "@/types/api/CheckOrderResponse";
import { createKontriOrder } from "./createKontriOrder";
import { allocateKontriShortages } from "./allocateKontriShortages";

export type KontriReconciliationDiagnostic = { code: string; detail: string };

export function reconcileKontriShortages(
    products: ShopOrder[],
    refNumber: string,
    response: OrderResponseResult,
    onRejected?: (diagnostic: KontriReconciliationDiagnostic) => void,
) {
    const reject = (code: string, detail: string) => {
        onRejected?.({ code, detail });
        return null;
    };
    if (Number(response.Code) !== 200) return reject("RESPONSE_CODE", `Kontri Code=${response.Code}; očekáváno 200.`);
    if (response.Status !== OrderStatus.NEW)
        return reject("ORDER_STATUS", `Kontri Status=${response.Status ?? "chybí"}; výpočet je povolen pouze pro Nowe.`);
    if (!Array.isArray(response.Articles?.Article)) return reject("ARTICLES_MISSING", "Odpověď neobsahuje pole Articles.Article.");
    const advanced = products.find((product) => Number(product.kontriStatusCode) >= 300);
    if (advanced)
        return reject("LOCAL_ADVANCED_STATUS", `Produkt ${advanced.fID} má lokální stav ${advanced.kontriStatusCode}; skupina již není nová.`);
    const leaders = products.filter((product) => product.kontriRequestJson);
    if (!leaders.length) return reject("SNAPSHOT_MISSING", `Ve skupině ${products.length} produktů chybí uložený kontriRequestJson.`);
    if (leaders.length !== 1) return reject("SNAPSHOT_MULTIPLE", `Skupina obsahuje ${leaders.length} uložených požadavků místo jednoho.`);
    const leader = leaders[0];
    const byId = new Map(products.map((product) => [product.fID, product]));
    if (byId.size !== products.length || products.some((product) => !product.fID))
        return reject("PRODUCT_IDS_INVALID", "Skupina obsahuje chybějící nebo duplicitní ID dokumentů.");
    if (products.some((product) => product.RefNumber !== refNumber))
        return reject("REFERENCE_MISMATCH", "Reference některého produktu neodpovídá kontrolované skupině.");
    const wrongLeader = products.find((product) => product.kontriRequestLeaderId !== leader.fID);
    if (wrongLeader) return reject("LEADER_MISMATCH", `Produkt ${wrongLeader.fID} nemá očekávaný kontriRequestLeaderId=${leader.fID}.`);
    const ids = leader.kontriRequestProductIds;
    if (!Array.isArray(ids) || ids.length !== products.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id)))
        return reject(
            "MEMBERSHIP_MISMATCH",
            `Snapshot uvádí ${Array.isArray(ids) ? ids.length : "chybějící seznam"} produktů, načteno ${products.length}; ID dokumentů nejsou shodná.`,
        );
    const ordered = ids.map((id) => byId.get(id)!);
    let payload;
    try {
        payload = JSON.parse(leader.kontriRequestJson!);
    } catch {
        return reject("SNAPSHOT_JSON_INVALID", "Uložený požadavek není platný JSON.");
    }
    if (payload?.RefNumber !== refNumber) return reject("SNAPSHOT_REFERENCE_MISMATCH", "Reference uloženého požadavku neodpovídá skupině.");
    try {
        const expected = createKontriOrder(ordered, refNumber);
        if (!Array.isArray(payload.OrderedItems) || payload.OrderedItems.length !== expected.OrderedItems.length)
            return reject("SNAPSHOT_ITEMS_MISMATCH", "Počet OrderedItems v uloženém požadavku neodpovídá produktům.");
        for (const [index, item] of expected.OrderedItems.entries()) {
            const saved = payload.OrderedItems[index];
            if (
                !saved ||
                saved.AltumArticleId !== item.AltumArticleId ||
                saved.Amount !== item.Amount ||
                saved.ClientOrderNumber !== item.ClientOrderNumber
            )
                return reject(
                    "SNAPSHOT_ITEMS_MISMATCH",
                    `Produkt ${ordered[index].fID}: uložené API ID/množství/číslo objednávky neodpovídá snapshotu produktu (očekáváno API ${item.AltumArticleId}, množství ${item.Amount}).`,
                );
        }
        const requested = new Map<number, number>();
        for (const item of expected.OrderedItems) requested.set(item.AltumArticleId, (requested.get(item.AltumArticleId) ?? 0) + item.Amount);
        const accepted = new Map<number, number>();
        for (const article of response.Articles.Article) {
            if ((typeof article.Quantity !== "number" && typeof article.Quantity !== "string") || String(article.Quantity).trim() === "")
                return reject("ARTICLE_QUANTITY_INVALID", `API ID ${article.AltumArticleID}: množství chybí nebo má neplatný typ.`);
            const apiId = Number(article.AltumArticleID);
            const quantity = Number(article.Quantity);
            if (!requested.has(apiId)) return reject("UNEXPECTED_API_ID", `Kontri vrátilo API ID ${apiId}, které není v uloženém požadavku.`);
            if (!Number.isFinite(quantity) || quantity < 0)
                return reject("ARTICLE_QUANTITY_INVALID", `API ID ${apiId}: množství musí být konečné nezáporné číslo.`);
            accepted.set(apiId, (accepted.get(apiId) ?? 0) + quantity);
        }
        const shortages = [...requested].map(([AltumArticleID, quantity]) => ({
            AltumArticleID,
            Quantity: quantity - (accepted.get(AltumArticleID) ?? 0),
        }));
        const excessive = shortages.find((shortage) => shortage.Quantity < 0);
        if (excessive)
            return reject(
                "EXCESS_QUANTITY",
                `API ID ${excessive.AltumArticleID}: požadováno ${requested.get(excessive.AltumArticleID)}, Kontri vrátilo ${accepted.get(excessive.AltumArticleID)}.`,
            );
        const allocated = allocateKontriShortages(ordered, shortages);
        const contradiction = ordered.find(
            (product) =>
                Number(product.kontriStatusCode) >= 100 && !product.kontriReconciliationRequired && product.shortage !== allocated.get(product.fID!),
        );
        if (contradiction)
            return reject(
                "KNOWN_SHORTAGE_CONFLICT",
                `Produkt ${contradiction.fID}: potvrzený nedostatek ${contradiction.shortage}, nový výpočet ${allocated.get(contradiction.fID!)}.`,
            );
        return allocated;
    } catch {
        return reject("PRODUCT_SNAPSHOT_INVALID", "API ID nebo množství v produktu není platné pro sestavení požadavku či rozdělení nedostatků.");
    }
}
