import ShopOrder from "@/types/ShopOrder";
import { OrderResponseResult, OrderStatus } from "@/types/api/CheckOrderResponse";
import { createKontriOrder } from "./createKontriOrder";
import { allocateKontriShortages } from "./allocateKontriShortages";

export function reconcileKontriShortages(products: ShopOrder[], refNumber: string, response: OrderResponseResult) {
    if (
        Number(response.Code) !== 200 ||
        response.Status !== OrderStatus.NEW ||
        !Array.isArray(response.Articles?.Article) ||
        products.some((product) => Number(product.kontriStatusCode) >= 300)
    )
        return null;
    try {
        const sorted = [...products].sort((first, second) => first.fID!.localeCompare(second.fID!));
        const leaders = sorted.filter((product) => product.kontriRequestJson);
        if (
            leaders.length !== 1 ||
            sorted.some((product) => !product.fID || product.RefNumber !== refNumber || product.kontriRequestLeaderId !== leaders[0].fID)
        )
            return null;
        const leader = leaders[0];
        if (JSON.stringify(leader.kontriRequestProductIds) !== JSON.stringify(sorted.map((product) => product.fID))) return null;
        const payload = JSON.parse(leader.kontriRequestJson!);
        const expected = createKontriOrder(sorted, refNumber);
        if (payload.RefNumber !== refNumber || JSON.stringify(payload.OrderedItems) !== JSON.stringify(expected.OrderedItems)) return null;
        const requested = new Map<number, number>();
        for (const item of expected.OrderedItems) requested.set(item.AltumArticleId, (requested.get(item.AltumArticleId) ?? 0) + item.Amount);
        const accepted = new Map<number, number>();
        for (const article of response.Articles.Article) {
            if ((typeof article.Quantity !== "number" && typeof article.Quantity !== "string") || String(article.Quantity).trim() === "") return null;
            const apiId = Number(article.AltumArticleID);
            const quantity = Number(article.Quantity);
            if (!requested.has(apiId) || !Number.isFinite(quantity) || quantity < 0) return null;
            accepted.set(apiId, (accepted.get(apiId) ?? 0) + quantity);
        }
        const shortages = [...requested].map(([AltumArticleID, quantity]) => ({
            AltumArticleID,
            Quantity: quantity - (accepted.get(AltumArticleID) ?? 0),
        }));
        if (shortages.some((shortage) => shortage.Quantity < 0)) return null;
        const allocated = allocateKontriShortages(sorted, shortages);
        if (
            sorted.some(
                (product) =>
                    Number(product.kontriStatusCode) >= 100 &&
                    !product.kontriReconciliationRequired &&
                    product.shortage !== allocated.get(product.fID!),
            )
        )
            return null;
        return allocated;
    } catch {
        return null;
    }
}
