"use server";
import { getNotSentProducts, getOrderedProducts } from "@/db/getProducts";
import ShopOrder from "@/types/ShopOrder";
import { checkOrderByRefNumber } from "./checkOrderRefNumber";
import { OrderStatus } from "@/types/api/CheckOrderResponse";
import { updateProduct } from "@/db/updateProduct";
import { logKontriError, logKontriEvent } from "@/utils/kontriDiagnostics";

// Returns false when Kontri confirmed the group is unchanged, which stops a non-full pass.
const updateProductGroupState = async (refNumber: string, products: ShopOrder[], baseStatus: OrderStatus): Promise<boolean> => {
    console.log("Checking product group state for refNumber:", refNumber, products.length);
    const status = await checkOrderByRefNumber(refNumber);
    if (Number(status?.Code) !== 200 || !status.Status || !Object.values(OrderStatus).includes(status.Status))
        throw new Error("Invalid Kontri status response.");
    if (status.Status === baseStatus || status.Status === OrderStatus.NEW) {
        logKontriEvent("status.unchanged", refNumber, { status: status.Status, products: products.length });
        return false;
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

    if (products.every((product) => product.kontriStatusCode === newStatusCode)) {
        logKontriEvent("status.unchanged", refNumber, { status: newStatusCode, products: products.length });
        return false;
    }

    console.log("Updating product group state for refNumber:", refNumber, "to", newStatusCode, "products:", products.length);

    const promises = products.map(async (product) => {
        await updateProduct(product, { kontriStatusCode: newStatusCode });
    });
    await Promise.all(promises);
    logKontriEvent("status.persisted", refNumber, { status: newStatusCode, products: products.length });
    return true;
};

// Groups are checked oldest first. Kontri is assumed to process orders in order, so a non-full pass stops at the
// first confirmed unchanged group; failed lookups do not stop it. The periodic full sweep catches out-of-order changes.
const updateOrdersState = async (getProducts: () => Promise<ShopOrder[]>, status: OrderStatus, fullSweep: boolean) => {
    console.log("Updating orders state that have: ", status, fullSweep ? "(full sweep)" : "");
    let checkedCount = 0;
    let stoppedEarly = false;
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

    for (const [refNumber, products] of refMap.entries()) {
        checkedCount++;
        try {
            if (!(await updateProductGroupState(refNumber, products, status)) && !fullSweep) {
                stoppedEarly = refMap.size > checkedCount;
                break;
            }
        } catch (error) {
            failedCount++;
            logKontriError("status.group", refNumber, error);
        }
    }
    logKontriEvent("status.completed", status, { checkedCount, failedCount, groups: refMap.size, stoppedEarly, fullSweep });
    return {
        status: failedCount ? "error" : "success",
        message: `Kontri status checks: ${checkedCount}/${refMap.size} groups checked, ${failedCount} failures${stoppedEarly ? ", stopped at the first unchanged group" : ""}.`,
        checkedCount,
        failedCount,
    };
};

export const updateNewOrdersState = async ({ fullSweep = false }: { fullSweep?: boolean } = {}) => {
    return updateOrdersState(getOrderedProducts, OrderStatus.NEW, fullSweep);
};

// Kontri sends an unpredictable one of the aggregated orders (others may stay 300/301 forever), so order-based
// early stopping does not apply here; the cron runs this full pass only in its three-hourly sweep.
export const updateAggregatedOrdersState = async () => {
    return updateOrdersState(getNotSentProducts, OrderStatus.AGGREGATED, true);
};
