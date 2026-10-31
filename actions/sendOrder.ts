"use server";

import { KontriOrderToSend } from "@/types/KontriOrder";
import { AddOrderResponse } from "@/types/api/AddOrderResponse";
import { logKontriError, logKontriEvent, logKontriResponse } from "@/utils/kontriDiagnostics";

const SEND_ORDER_URL = process.env.GCP_SERVER_ADDRESS!;

export const sendOrder = async (orderObject: KontriOrderToSend) => {
    logKontriEvent("submit.start", orderObject.RefNumber);
    try {
        for (const item of orderObject.OrderedItems)
            logKontriEvent("submit.item", orderObject.RefNumber, { apiId: item.AltumArticleId, quantity: item.Amount });
        const resp = await fetch(SEND_ORDER_URL, {
            method: "POST",
            body: JSON.stringify(orderObject),
            headers: { "Content-Type": "application/json" },
        });
        logKontriEvent("submit.http", orderObject.RefNumber, { httpStatus: resp.status });
        const result = ((await resp.json()) as AddOrderResponse).result;
        logKontriResponse("submit", orderObject.RefNumber, result);
        return result;
    } catch (error) {
        logKontriError("submit", orderObject.RefNumber, error);
        return { Code: -1, Message: "Error while sending order." };
    }
};
