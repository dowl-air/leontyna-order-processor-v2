"use server";
import { getNotSentProducts, getOrderedProducts } from "@/db/getProducts";
import ShopOrder from "@/types/ShopOrder";
import { checkOrderByRefNumber } from "./checkOrderRefNumber";
import { OrderStatus } from "@/types/api/CheckOrderResponse";
import { updateProduct } from "@/db/updateProduct";

const PAST_DAYS = 3;

const updateProductGroupState = async (refNumber: string, products: ShopOrder[], baseStatus: OrderStatus) => {
    console.log("Checking product group state for refNumber:", refNumber, products.length);
    const status = await checkOrderByRefNumber(refNumber);
    if (!status) return true;
    if (status.Status === baseStatus) return false;

    let newStatusCode = 100;

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
    }

    console.log("Updating product group state for refNumber:", refNumber, "to", newStatusCode, "products:", products.length);

    const promises = products.map(async (product) => {
        await updateProduct(product, { kontriStatusCode: newStatusCode });
    });
    await Promise.all(promises);
    return true;
};

const updateOrdersState = async (getProducts: () => Promise<ShopOrder[]>, status: OrderStatus) => {
    console.log("Updating orders state that have: ", status);
    const products = await getProducts();
    if (products.length === 0) return;

    const refMap = new Map<string, ShopOrder[]>();
    products.forEach((product) => {
        const refNumber = product.RefNumber;
        if (!refNumber) return;
        if (!refMap.has(refNumber)) refMap.set(refNumber, []);
        refMap.get(refNumber)!.push(product);
    });

    console.log("Found ", refMap.size, " product groups to update.");

    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
    let index = 0;
    for (const [refNumber, products] of refMap.entries()) {
        await delay(index * 2500);
        const shouldContinue = await updateProductGroupState(refNumber, products, status);
        if (!shouldContinue) {
            console.log(`Stopping at refNumber ${refNumber}`);
            break;
        }
        index++;
    }
};

export const updateNewOrdersState = async () => {
    await updateOrdersState(getOrderedProducts.bind(null, PAST_DAYS), OrderStatus.NEW);
};

export const updateAggregatedOrdersState = async () => {
    await updateOrdersState(getNotSentProducts, OrderStatus.AGGREGATED);
};
