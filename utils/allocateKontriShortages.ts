import ShopOrder from "@/types/ShopOrder";

export function allocateKontriShortages(products: ShopOrder[], shortages: { AltumArticleID: number; Quantity: number }[]) {
    const key = (product: ShopOrder) => product.fID ?? `${product.code}_${product.orderItemCode}`;
    const result = new Map(products.map((product) => [key(product), 0]));
    if (result.size !== products.length) throw new Error("Duplicate Kontri product documents.");
    const seen = new Set<string>();
    for (const shortage of shortages) {
        const apiId = String(shortage.AltumArticleID);
        const quantity = Number(shortage.Quantity);
        const candidates = products.filter((product) => product.kontriApiId === apiId);
        const total = candidates.reduce((sum, product) => sum + Number(product.kontriOrderedAmount), 0);
        if (!candidates.length || seen.has(apiId) || !Number.isFinite(quantity) || quantity < 0 || quantity > total)
            throw new Error("Inconsistent Kontri shortages.");
        seen.add(apiId);
        candidates.sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime() || key(second).localeCompare(key(first)));
        let remaining = quantity;
        for (const product of candidates) {
            const allocated = Math.min(remaining, product.kontriOrderedAmount!);
            result.set(key(product), allocated);
            remaining -= allocated;
        }
    }
    return result;
}
