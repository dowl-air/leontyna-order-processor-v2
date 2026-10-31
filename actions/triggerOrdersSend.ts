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
import { logKontriError, logKontriEvent, logKontriResponse } from "@/utils/kontriDiagnostics";
import { KONTRI_RETRY_FAILURE_LIMIT, recordKontriRetryFailure } from "@/db/recordKontriRetryFailure";
import { checkService } from "@/utils/soapClient";

async function notifyOrderProblem(message: string, subject = "[Kontri objednávky] Kontrola zpracování") {
    try {
        if (await sendMail({ subject, text: message })) {
            logKontriEvent("notification.sent", "");
            return "";
        }
        logKontriEvent("notification.noResult", "");
    } catch (error) {
        logKontriError("notification", "", error);
    }
    return " E-mailové upozornění se nepodařilo odeslat.";
}

async function notifyShortages(products: ShopOrder[], shortages: Map<string, number>, refNumber: string, orderId?: string) {
    const missing = products.flatMap((product) => {
        const quantity = shortages.get(product.fID ?? `${product.code}_${product.orderItemCode}`) ?? 0;
        return quantity > 0 ? [{ product, quantity }] : [];
    });
    if (!missing.length) return "";
    const text = [
        orderId
            ? `Kontri objednávka ${refNumber} (Altum ID ${orderId}) má nedostatky.`
            : `Kontri objednávka ${refNumber} nevznikla kvůli skladovým nedostatkům (kód 80). Celé požadované množství je evidováno jako nedostatek.`,
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

type HandlerResult = { status: string; message: string; retryableCode?: number };

async function kontriServiceAvailable() {
    try {
        const result = (await checkService()) as { CheckStatusResult?: unknown } | null;
        return typeof result?.CheckStatusResult === "string" && !!result.CheckStatusResult.trim();
    } catch (error) {
        logKontriError("workflow.serviceCheck", "", error);
        return false;
    }
}

async function recordRetryFailure(products: ShopOrder[], refNumber: string, result: HandlerResult & { retryableCode: number }) {
    const code = result.retryableCode;
    const recorded = await recordKontriRetryFailure(products, refNumber, code).catch((error) => {
        logKontriError("retry.failure.record", refNumber, error);
        return null;
    });
    logKontriEvent("retry.failed", refNumber, { code, failures: recorded?.failures ?? 0, escalated: !!recorded?.escalated });
    if (recorded?.escalated) {
        const message = `Kontri objednávka ${refNumber} se nepodařilo potvrdit ani po ${recorded.failures} pokusech (poslední kód ${code}). Byla převedena na ruční kontrolu: automaticky se už nezkouší a neblokuje nové objednávky. Reference a uložený požadavek zůstávají beze změny; vyřešte ji ručně s Kontri.`;
        return message + (await notifyOrderProblem(message, "[Kontri objednávky] Ruční kontrola"));
    }
    const message = `${result.message} ${recorded ? `Neúspěšný pokus ${recorded.failures}/${KONTRI_RETRY_FAILURE_LIMIT}.` : "Počet neúspěšných pokusů se nepodařilo zapsat."}`;
    return message + (await notifyOrderProblem(message));
}

function validOrderId(value: unknown) {
    return (typeof value === "string" || typeof value === "number") && /^[1-9]\d*$/.test(String(value));
}

const sendOrderHandler = async (orderObject: KontriOrder): Promise<HandlerResult> => {
    try {
        const { products, ...orderReq } = orderObject;
        const refNumber = orderObject.RefNumber;
        const orderResp = await sendOrder(orderReq);
        logKontriResponse("submission.handler", refNumber, orderResp);
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
                logKontriEvent("submission.persisted", refNumber, { updated, shortagesKnown: !!shortages });
                if (!shortages) {
                    const message = `Kontri objednávka ${refNumber} byla potvrzena (${orderResp.AltumOrderID}), ale nedostatky jsou zatím neznámé. Další běh je zkusí doplnit z neagregované objednávky.`;
                    return { status: "info", message: message + (await notifyOrderProblem(message)) };
                }
                const notification = updated ? await notifyShortages(products, shortages, refNumber, String(orderResp.AltumOrderID)) : "";
                return {
                    status: notification ? "info" : "success",
                    message: `Kontri objednávka ${refNumber} byla potvrzena (${orderResp.AltumOrderID}).${notification}`,
                };
            case 80: {
                const rejectedShortages = new Map(
                    products.map((product) => {
                        const quantity = product.kontriOrderedAmount;
                        if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0)
                            throw new Error("Invalid saved Kontri quantity for rejection.");
                        return [product.fID ?? `${product.code}_${product.orderItemCode}`, quantity];
                    }),
                );
                const rejectedUpdated = await persistKontriProducts(
                    products.map((product) => ({
                        product,
                        fields: {
                            kontriStatusCode: 80,
                            kontriStatusName: "Nedostupné",
                            shortage: rejectedShortages.get(product.fID ?? `${product.code}_${product.orderItemCode}`)!,
                            kontriReconciliationRequired: false,
                        },
                    })),
                    refNumber,
                    false,
                    true,
                );
                logKontriEvent("submission.rejected", refNumber, { code: 80, updated: rejectedUpdated });
                if (!rejectedUpdated)
                    return {
                        status: "error",
                        message: `Kontri objednávka ${refNumber} nevznikla (kód 80). Nedostatky nebyly zapsány; email o nedostatcích nebyl odeslán.`,
                    };
                const notification = await notifyShortages(products, rejectedShortages, refNumber);
                return {
                    status: "error",
                    message: `Kontri objednávka ${refNumber} nevznikla (kód 80). Celé požadované množství bylo zapsáno jako nedostatek.${notification}`,
                };
            }
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
                logKontriEvent("submission.conflict", refNumber, { code: 110 });
                return orderError(
                    `Kontri reference ${refNumber} patří jinému požadavku (110). Reference nebyla změněna; konflikt vyžaduje ruční kontrolu.`,
                );
            default:
                return {
                    status: "error",
                    message: `Kontri objednávka ${refNumber} nebyla potvrzena (kód ${Number(orderResp.Code)}). Reference a požadavek zůstávají uložené pro další pokus.`,
                    retryableCode: Number(orderResp.Code),
                };
        }
    } catch (error) {
        logKontriError("submission.handler", orderObject.RefNumber, error);
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
        let failed = false;
        let retryFailed = false;
        const uncertainOrders = await getUnconfirmedOrders();
        logKontriEvent("workflow.pending", "", { groups: uncertainOrders.length });
        for (const order of uncertainOrders) {
            await new Promise((resolve) => setTimeout(resolve, 2100));
            const response = await checkOrderByRefNumber(order.RefNumber).catch((error) => {
                logKontriError("workflow.lookup", order.RefNumber, error);
                return null;
            });
            if (Number(response?.Code) !== 200) {
                if (order.products.some((product) => product.AltumOrderID && product.AltumOrderID !== order.RefNumber)) {
                    logKontriEvent("retry.skipped.confirmed", order.RefNumber);
                    messages.push(`Nedostatky potvrzené objednávky ${order.RefNumber} zatím nelze zjistit. Objednávka nebyla znovu odeslána.`);
                    requiresReviewOrWaiting = true;
                    continue;
                }
                const retry = await prepareKontriRetry(order.products, order.RefNumber);
                logKontriEvent("retry.prepared", order.RefNumber, { products: retry.products.length });
                await new Promise((resolve) => setTimeout(resolve, 2100));
                const result = await sendOrderHandler(retry);
                if (result.retryableCode !== undefined) {
                    failed = true;
                    retryFailed = true;
                    messages.push(await recordRetryFailure(retry.products, order.RefNumber, { ...result, retryableCode: result.retryableCode }));
                    continue;
                }
                retried = true;
                if (result.status === "info") requiresReviewOrWaiting = true;
                if (result.status === "error") failed = true;
                messages.push(result.message);
                continue;
            }
            if (!validOrderId(response!.AltumOrderID)) {
                failed = true;
                messages.push(
                    (
                        await orderError(
                            `Objednávku ${order.RefNumber} se nepodařilo bezpečně ověřit u Kontri. Žádný nový požadavek pro ni nebyl odeslán; je nutná ruční kontrola.`,
                        )
                    ).message,
                );
                continue;
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
                logKontriEvent("reconciliation.noWrite", order.RefNumber, { shortagesKnown: !!shortages });
                messages.push(
                    `Objednávka ${order.RefNumber}: výsledek nebyl zapsán (již potvrzená množství nebo souběžná agregace).${rejectionDetail ? ` Diagnostika: ${rejectionDetail}` : ""}`,
                );
                requiresReviewOrWaiting = true;
                continue;
            }
            logKontriEvent("reconciliation.persisted", order.RefNumber, { shortagesKnown: !!shortages });
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
        if (retryFailed) {
            await new Promise((resolve) => setTimeout(resolve, 2100));
            if (!(await kontriServiceAvailable())) {
                logKontriEvent("workflow.blocked", "", { reason: "serviceUnavailable" });
                messages.push("Kontri neodpovědělo na kontrolu stavu služby; nové produkty nebyly odeslány.");
                return { status: "error", message: messages.join(" | ") };
            }
        }
        const order = await getNewOrder();
        logKontriEvent("workflow.prepared", order?.RefNumber ?? "", { products: order?.products.length ?? 0 });
        if (order) {
            await new Promise((resolve) => setTimeout(resolve, 2100));
            const handled = await sendOrderHandler(order);
            const { retryableCode, ...result } =
                handled.retryableCode !== undefined ? { ...handled, message: handled.message + (await notifyOrderProblem(handled.message)) } : handled;
            return {
                ...result,
                status: failed ? "error" : result.status === "success" && requiresReviewOrWaiting ? "info" : result.status,
                message: [...messages, result.message].join(" | "),
            };
        }
        return {
            status: failed ? "error" : retried && !requiresReviewOrWaiting ? "success" : "info",
            message: messages.join(" | ") || "Žádné nové produkty k odeslání.",
        };
    } catch (error) {
        logKontriError("workflow", "", error);
        return orderError(
            "Příprava nebo ověření Kontri objednávek selhalo. Zkontrolujte diagnostické logy a historické reference; nový požadavek nebyl bezpečně připraven.",
        );
    }
};
