"use server";
import { CheckOrderResponse, OrderResponseResult } from "@/types/api/CheckOrderResponse";
import { getOrderStatus } from "@/utils/soapClient";
import { logKontriError, logKontriEvent, logKontriResponse } from "@/utils/kontriDiagnostics";

export const checkOrder = async (orderNumber: string): Promise<OrderResponseResult> => {
    logKontriEvent("lookup.orderId.start", orderNumber);
    try {
        /* orderNumber = "5814361"; */
        const response = await getOrderStatus(orderNumber);
        const result = (response as CheckOrderResponse).GetOrderStatusResult;
        logKontriResponse("lookup.orderId", orderNumber, result);
        return result;
    } catch (error) {
        logKontriError("lookup.orderId", orderNumber, error);
        return { Code: 500, Message: "Nastala chyba při zjišťování stavu objednávky." };
    }
};
