"use server";
import { CheckOrderResponse } from "@/types/api/CheckOrderResponse";
import { getOrderStatus } from "@/utils/soapClient";

export const checkOrder = async (orderNumber: string): Promise<CheckOrderResponse> => {
    try {
        //todo remove
        orderNumber = "5814361";
        const response = await getOrderStatus(orderNumber);
        return response as CheckOrderResponse;
    } catch (error) {
        console.error(error);
        return {GetOrderStatusResult: {Code: 500, Message: "Error checking order status."}};
    }
}