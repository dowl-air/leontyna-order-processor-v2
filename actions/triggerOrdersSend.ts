"use server";

import { getNewOrder, prepareKontriRetry } from "@/db/getNewOrder";
import { getUnconfirmedOrders } from "@/db/getUnconfirmedOrders";
import { KontriOrder } from "@/types/KontriOrder";
import { sendOrder } from "./sendOrder";
import { persistKontriProducts } from "@/db/persistKontriProducts";
import { allocateKontriShortages } from "@/utils/allocateKontriShortages";
import { sendMail } from "./sendMail";
import { checkOrderByRefNumber } from "./checkOrderRefNumber";
import { reconcileKontriShortages } from "@/utils/reconcileKontriShortages";
import ShopOrder from "@/types/ShopOrder";

async function notifyOrderProblem(message: string, subject = "[Kontri objednávky] Kontrola zpracování") {
    try {
        if (await sendMail({ subject, text: message })) return "";
    } catch {
        console.error("Kontri order notification failed.");
    }
    return " E-mailové upozornění se nepodařilo odeslat.";
}

async function notifyShortages(products: ShopOrder[], shortages: Map<string, number>, refNumber: string, orderId: string) {
    const missing = products.flatMap((product) => {
        const quantity = shortages.get(product.fID ?? `${product.code}_${product.orderItemCode}`) ?? 0;
        return quantity > 0 ? [{ product, quantity }] : [];
    });
    if (!missing.length) return "";
    const text = [
        `Kontri objednávka ${refNumber} (Altum ID ${orderId}) má nedostatky.`,
        `Celkem chybí: ${missing.reduce((sum, item) => sum + item.quantity, 0)} ks`,
        ...missing.map(
            ({ product, quantity }) =>
                `${product.code} | ${product.orderItemCode} | API ${product.kontriApiId} | chybí ${quantity} ks${product.orderItemName ? ` | ${product.orderItemName}` : ""}`,
        ),
    ].join("\n");
    return notifyOrderProblem(text, "[Kontri objednávky] Nedostatky");
}

async function orderError(message: string) {
    return { status: "error", message: message + (await notifyOrderProblem(message)) };
}

function validOrderId(value: unknown) {
    return (typeof value === "string" || typeof value === "number") && /^[1-9]\d*$/.test(String(value));
}

const sendOrderHandler = async (orderObject: KontriOrder) => {
    try {
        const { products, ...orderReq } = orderObject;
        const refNumber = orderObject.RefNumber;
        const orderResp = await sendOrder(orderReq);
        switch (Number(orderResp.Code)) {
            case 100:
            case 101:
                if (!validOrderId(orderResp.AltumOrderID)) throw new Error("Missing confirmed Kontri order ID.");
                const shortageDetails = orderResp.Shortages?.Shortages;
                const shortages = Array.isArray(shortageDetails) ? allocateKontriShortages(products, shortageDetails) : null;
                const updated = await persistKontriProducts(
                    products.map((product) => ({
                        product,
                        fields: {
                            AltumOrderID: String(orderResp.AltumOrderID),
                            RefNumber: refNumber,
                            kontriStatusCode: 100,
                            kontriStatusName: "Objednáno",
                            ...(orderResp.OrderNumber ? { kontriOrderCode: orderResp.OrderNumber } : {}),
                            ...(shortages ? { shortage: shortages.get(product.fID ?? `${product.code}_${product.orderItemCode}`)! } : {}),
                            kontriReconciliationRequired: !shortages,
                        },
                    })),
                    refNumber,
                );
                if (!shortages) {
                    const message = `Kontri objednávka ${refNumber} byla potvrzena (${orderResp.AltumOrderID}), ale nedostatky jsou zatím neznámé. Další běh je zkusí doplnit z neagregované objednávky.`;
                    return { status: "info", message: message + (await notifyOrderProblem(message)) };
                }
                const notification = updated ? await notifyShortages(products, shortages, refNumber, String(orderResp.AltumOrderID)) : "";
                return {
                    status: notification ? "info" : "success",
                    message: `Kontri objednávka ${refNumber} byla potvrzena (${orderResp.AltumOrderID}).${notification}`,
                };
            case 80:
                await persistKontriProducts(
                    products.map((product) => ({ product, fields: { kontriStatusCode: 80, kontriStatusName: "Nedostupné" } })),
                    refNumber,
                );
                return orderError(`Kontri odmítlo dostupnost položek objednávky ${refNumber}. Vyžaduje ruční kontrolu.`);
            case 90:
            case 99:
                return {
                    status: "info",
                    message: `Kontri objednávka ${refNumber} se zpracovává. Další běh ji dohledá nebo zopakuje stejný požadavek.`,
                };
            case 110:
                await persistKontriProducts(
                    products.map((product) => ({
                        product,
                        fields: {
                            kontriStatusCode: 110,
                            kontriStatusName: "Konflikt reference",
                        },
                    })),
                    refNumber,
                );
                return orderError(
                    `Kontri reference ${refNumber} patří jinému požadavku (110). Reference nebyla změněna; konflikt vyžaduje ruční kontrolu.`,
                );
            default:
                return orderError(
                    `Kontri objednávka ${refNumber} nebyla potvrzena (kód ${Number(orderResp.Code)}). Reference a požadavek zůstávají uložené pro další pokus.`,
                );
        }
    } catch {
        return orderError(
            `Odeslání nebo uložení odpovědi objednávky ${orderObject.RefNumber} selhalo. Další běh objednávku dohledá nebo zopakuje uložený požadavek se stejnou referencí.`,
        );
    }
};

export const sendOrders = async () => {
    try {
        const messages: string[] = [];
        let retried = false;
        let requiresReviewOrWaiting = false;
        const uncertainOrders = await getUnconfirmedOrders();
        for (const order of uncertainOrders) {
            await new Promise((resolve) => setTimeout(resolve, 2100));
            const response = await checkOrderByRefNumber(order.RefNumber).catch(() => null);
            if (Number(response?.Code) !== 200) {
                if (order.products.some((product) => product.AltumOrderID && product.AltumOrderID !== order.RefNumber)) {
                    messages.push(`Nedostatky potvrzené objednávky ${order.RefNumber} zatím nelze zjistit. Objednávka nebyla znovu odeslána.`);
                    requiresReviewOrWaiting = true;
                    continue;
                }
                const retry = await prepareKontriRetry(order.products, order.RefNumber);
                await new Promise((resolve) => setTimeout(resolve, 2100));
                const result = await sendOrderHandler(retry);
                retried = true;
                if (result.status === "info") requiresReviewOrWaiting = true;
                messages.push(result.message);
                if (result.status === "error") return { ...result, message: messages.join(" | ") };
                continue;
            }
            if (!validOrderId(response!.AltumOrderID)) {
                return orderError(
                    `Objednávku ${order.RefNumber} se nepodařilo bezpečně ověřit u Kontri. Žádný nový požadavek nebyl odeslán; je nutná ruční kontrola.`,
                );
            }
            let rejectionDetail = "";
            const shortages = reconcileKontriShortages(order.products, order.RefNumber, response!, (diagnostic) => {
                rejectionDetail = `[${diagnostic.code}] ${diagnostic.detail}`;
                console.warn("Kontri shortage reconciliation rejected", { refNumber: order.RefNumber, ...diagnostic });
            });
            const updated = await persistKontriProducts(
                order.products.map((product) => ({
                    product,
                    fields: {
                        AltumOrderID: String(response!.AltumOrderID),
                        RefNumber: order.RefNumber,
                        kontriStatusCode: 100,
                        kontriStatusName: "Objednáno",
                        kontriReconciliationRequired: !shortages,
                        ...(shortages ? { shortage: shortages.get(product.fID ?? `${product.code}_${product.orderItemCode}`)! } : {}),
                        ...(response!.AltumOrderNumber ? { kontriOrderCode: response!.AltumOrderNumber } : {}),
                    },
                })),
                order.RefNumber,
                true,
                !!shortages,
            );
            if (!updated) {
                messages.push(
                    `Objednávka ${order.RefNumber}: výsledek nebyl zapsán (již potvrzená množství nebo souběžná agregace).${rejectionDetail ? ` Diagnostika: ${rejectionDetail}` : ""}`,
                );
                requiresReviewOrWaiting = true;
                continue;
            }
            if (shortages) {
                const notification = await notifyShortages(order.products, shortages, order.RefNumber, String(response!.AltumOrderID));
                if (notification) requiresReviewOrWaiting = true;
                messages.push(
                    `Objednávka ${order.RefNumber} byla dohledána bez znovuodeslání. Nedostatky byly automaticky doplněny (${[...shortages.values()].reduce((sum, quantity) => sum + quantity, 0)} ks).${notification}`,
                );
                retried = true;
            } else {
                messages.push(`Objednávka ${order.RefNumber} byla dohledána bez znovuodeslání. Nedostatky zůstávají neznámé: ${rejectionDetail}`);
                requiresReviewOrWaiting = true;
            }
        }
        const order = await getNewOrder();
        if (order) {
            await new Promise((resolve) => setTimeout(resolve, 2100));
            const result = await sendOrderHandler(order);
            return {
                ...result,
                status: result.status === "success" && requiresReviewOrWaiting ? "info" : result.status,
                message: [...messages, result.message].join(" | "),
            };
        }
        return {
            status: retried && !requiresReviewOrWaiting ? "success" : "info",
            message: messages.join(" | ") || "Žádné nové produkty k odeslání.",
        };
    } catch {
        return orderError(
            "Příprava nebo ověření Kontri objednávek selhalo. Zkontrolujte náhled párování a historické reference; nový požadavek nebyl bezpečně připraven.",
        );
    }
};
