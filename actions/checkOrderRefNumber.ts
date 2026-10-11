"use server";

import { CheckOrderByRefNumberResponse, OrderResponseResult } from "@/types/api/CheckOrderResponse";
import { getOrderStatusByRefNumber } from "@/utils/soapClient";
import { logKontriError, logKontriEvent, logKontriResponse } from "@/utils/kontriDiagnostics";

export const checkOrderByRefNumber = async (refNumber: string): Promise<OrderResponseResult> => {
    logKontriEvent("lookup.reference.start", refNumber);
    try {
        const response = await getOrderStatusByRefNumber(refNumber);
        const result = (response as CheckOrderByRefNumberResponse).GetOrderStatusByRefNumberResult;
        logKontriResponse("lookup.reference", refNumber, result);
        return result;
    } catch (error) {
        logKontriError("lookup.reference", refNumber, error);
        return { Code: 500, Message: "Nastala chyba při zjišťování stavu objednávky." };
    }
};
