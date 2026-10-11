"use server";
import { getNotSentProducts, getOrderedProducts } from "@/db/getProducts";
import ShopOrder from "@/types/ShopOrder";
import { checkOrderByRefNumber } from "./checkOrderRefNumber";
import { OrderStatus } from "@/types/api/CheckOrderResponse";
import { updateProduct } from "@/db/updateProduct";
import { logKontriError, logKontriEvent } from "@/utils/kontriDiagnostics";

const updateProductGroupState = async (refNumber: string, products: ShopOrder[], baseStatus: OrderStatus) => {
    console.log("Checking product group state for refNumber:", refNumber, products.length);
    const status = await checkOrderByRefNumber(refNumber);
    if (Number(status?.Code) !== 200 || !status.Status || !Object.values(OrderStatus).includes(status.Status))
        throw new Error("Invalid Kontri status response.");
    if (status.Status === baseStatus || status.Status === OrderStatus.NEW) {
        logKontriEvent("status.unchanged", refNumber, { status: status.Status, products: products.length });
        return;
    }

    let newStatusCode: number;

    switch (status.Status) {
        case OrderStatus.AGGREGATED:
        case OrderStatus.AGGREGATED_HERE:
            if ((status.Articles?.Article.length ?? 1) > products.length + 1) {
                newStatusCode = 300;
            } else {
                newStatusCode = 301;
            }
            break;
        case OrderStatus.SENT:
        case OrderStatus.READY_TO_SEND:
            newStatusCode = 400;
            break;
        default:
            throw new Error("Unsupported Kontri order status.");
    }

    console.log("Updating product group state for refNumber:", refNumber, "to", newStatusCode, "products:", products.length);

    const promises = products.map(async (product) => {
        await updateProduct(product, { kontriStatusCode: newStatusCode });
    });
    await Promise.all(promises);
    logKontriEvent("status.persisted", refNumber, { status: newStatusCode, products: products.length });
};

const updateOrdersState = async (getProducts: () => Promise<ShopOrder[]>, status: OrderStatus) => {
    console.log("Updating orders state that have: ", status);
    let checkedCount = 0;
    let failedCount = 0;
    let products: ShopOrder[];
    try {
        products = await getProducts();
    } catch (error) {
        logKontriError("status.read", status, error);
        return { status: "error", message: "Kontri status products could not be read.", checkedCount, failedCount: 1 };
    }

    const refMap = new Map<string, ShopOrder[]>();
    products.forEach((product) => {
        const refNumber = product.RefNumber;
        if (!refNumber) {
            failedCount++;
            return;
        }
        if (!refMap.has(refNumber)) refMap.set(refNumber, []);
        refMap.get(refNumber)!.push(product);
    });

    console.log("Found ", refMap.size, " product groups to update.");

    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
    let index = 0;
    for (const [refNumber, products] of refMap.entries()) {
        if (index > 0) await delay(2500);
        checkedCount++;
        try {
            await updateProductGroupState(refNumber, products, status);
        } catch (error) {
            failedCount++;
            logKontriError("status.group", refNumber, error);
        }
        index++;
    }
    logKontriEvent("status.completed", status, { checkedCount, failedCount });
    return {
        status: failedCount ? "error" : "success",
        message: `Kontri status checks: ${checkedCount} groups checked, ${failedCount} failures.`,
        checkedCount,
        failedCount,
    };
};

export const updateNewOrdersState = async () => {
    return updateOrdersState(getOrderedProducts, OrderStatus.NEW);
};

export const updateAggregatedOrdersState = async () => {
    return updateOrdersState(getNotSentProducts, OrderStatus.AGGREGATED);
};
