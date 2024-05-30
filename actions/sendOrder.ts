"use server";

import { KontriOrder } from "@/types/KontriOrder";
import { AddOrderResponse } from "@/types/api/AddOrderResponse";

const SEND_ORDER_URL = "http://34.75.56.113:8080/api/sendOrder"

export const sendOrder = async (orderObject: Omit<KontriOrder, "products">) => {
    try {
        const resp = await fetch(SEND_ORDER_URL, { method: "POST", body: JSON.stringify(orderObject) });
        return (await resp.json() as AddOrderResponse).result;
    }
    catch (error) {
        console.log(error);
        return { Code: 0, Message: "Error while sending order." };
    }
}