import { CheckOrderByRefNumberResponse, OrderResponseResult } from "@/types/api/CheckOrderResponse";
import { getOrderStatusByRefNumber } from "@/utils/soapClient";

export const checkOrderByRefNumber = async (): Promise<OrderResponseResult> => {
    try {
        const orderNumber = "f8ed1b7a6a9f4828";
        const response = await getOrderStatusByRefNumber(orderNumber);
        return (response as CheckOrderByRefNumberResponse).GetOrderStatusByRefNumberResult;
    } catch (error) {
        console.error(error);
        return { Code: 500, Message: "Nastala chyba při zjišťování stavu objednávky." };
    }
};
