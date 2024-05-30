"use server";
import { CheckOrderResponse, OrderResponseResult } from "@/types/api/CheckOrderResponse";
import { getOrderStatus } from "@/utils/soapClient";

export const checkOrder = async (orderNumber: string): Promise<OrderResponseResult> => {
    try {
        /* orderNumber = "5814361"; */
        const response = await getOrderStatus(orderNumber);
        return (response as CheckOrderResponse).GetOrderStatusResult;
    } catch (error) {
        console.error(error);
        return {Code: 500, Message: "Nastala chyba při zjišťování stavu objednávky."};
    }
}