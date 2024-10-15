import { CheckOrderByRefNumberResponse, OrderResponseResult } from "@/types/api/CheckOrderResponse";
import { getOrderStatusByRefNumber } from "@/utils/soapClient";

export const checkOrderByRefNumber = async (refNumber: string): Promise<OrderResponseResult> => {
    try {
        const response = await getOrderStatusByRefNumber(refNumber);
        return (response as CheckOrderByRefNumberResponse).GetOrderStatusByRefNumberResult;
    } catch (error) {
        console.error(error);
        return { Code: 500, Message: "Nastala chyba při zjišťování stavu objednávky." };
    }
};
