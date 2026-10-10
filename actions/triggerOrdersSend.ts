"use server";

import { getNewOrder } from "@/db/getNewOrder";
import { getUnconfirmedOrders } from "@/db/getUnconfirmedOrders";
import { KontriOrder } from "@/types/KontriOrder";
import { sendOrder } from "./sendOrder";
import { persistKontriProducts } from "@/db/persistKontriProducts";
import { allocateKontriShortages } from "@/utils/allocateKontriShortages";
import { sendMail } from "./sendMail";
import { checkOrderByRefNumber } from "./checkOrderRefNumber";

async function notifyOrderProblem(message: string) {
    try {
        if (await sendMail({ subject: "[Kontri objednávky] Kontrola zpracování", text: message })) return "";
    } catch {
        console.error("Kontri order notification failed.");
    }
    return " E-mailové upozornění se nepodařilo odeslat.";
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
        switch (orderResp.Code) {
            case 100:
            case 101:
                if (!validOrderId(orderResp.AltumOrderID)) throw new Error("Missing confirmed Kontri order ID.");
                const shortageDetails = orderResp.Shortages?.Shortages;
                const shortages = Array.isArray(shortageDetails) ? allocateKontriShortages(products, shortageDetails) : null;
                await persistKontriProducts(
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
                    const message = `Kontri objednávka ${refNumber} byla potvrzena (${orderResp.AltumOrderID}), ale odpověď neobsahuje potvrzené nedostatky. Množství vyžaduje ruční kontrolu.`;
                    return { status: "info", message: message + (await notifyOrderProblem(message)) };
                }
                return { status: "success", message: `Kontri objednávka ${refNumber} byla potvrzena (${orderResp.AltumOrderID}).` };
            case 80:
                await persistKontriProducts(
                    products.map((product) => ({ product, fields: { kontriStatusCode: 80, kontriStatusName: "Nedostupné" } })),
                    refNumber,
                );
                return orderError(`Kontri odmítlo dostupnost položek objednávky ${refNumber}. Vyžaduje ruční kontrolu.`);
            default:
                return orderError(
                    `Kontri objednávka ${refNumber} nebyla potvrzena. Reference a použitá API ID zůstávají uložené; další běh pouze ověří její existenci.`,
                );
        }
    } catch {
        return orderError(
            `Odeslání nebo uložení odpovědi objednávky ${orderObject.RefNumber} selhalo. Reference zůstává zachovaná; automatické znovuodeslání je zablokované.`,
        );
    }
};

export const sendOrders = async () => {
    try {
        const messages: string[] = [];
        const uncertainOrders = await getUnconfirmedOrders();
        for (const order of uncertainOrders) {
            await new Promise((resolve) => setTimeout(resolve, 2100));
            const response = await checkOrderByRefNumber(order.RefNumber);
            if (Number(response?.Code) !== 200 || !validOrderId(response.AltumOrderID)) {
                return orderError(
                    `Objednávku ${order.RefNumber} se nepodařilo bezpečně ověřit u Kontri. Žádný nový požadavek nebyl odeslán; je nutná ruční kontrola.`,
                );
            }
            const updated = await persistKontriProducts(
                order.products.map((product) => ({
                    product,
                    fields: {
                        AltumOrderID: String(response.AltumOrderID),
                        RefNumber: order.RefNumber,
                        kontriStatusCode: 100,
                        kontriStatusName: "Objednáno",
                        kontriReconciliationRequired: true,
                        ...(response.AltumOrderNumber ? { kontriOrderCode: response.AltumOrderNumber } : {}),
                    },
                })),
                order.RefNumber,
                true,
            );
            if (!updated) continue;
            const message = `Objednávka ${order.RefNumber} byla dohledána u Kontri (${response.AltumOrderID}) bez znovuodeslání. Nedostatky a množství vyžadují ruční kontrolu.`;
            messages.push(message + (await notifyOrderProblem(message)));
        }
        const order = await getNewOrder();
        if (order) {
            await new Promise((resolve) => setTimeout(resolve, 2100));
            const result = await sendOrderHandler(order);
            return { ...result, message: [...messages, result.message].join(" | ") };
        }
        return { status: "info", message: messages.join(" | ") || "Žádné nové produkty k odeslání." };
    } catch {
        return orderError(
            "Příprava nebo ověření Kontri objednávek selhalo. Zkontrolujte náhled párování a historické reference; nový požadavek nebyl bezpečně připraven.",
        );
    }
};
