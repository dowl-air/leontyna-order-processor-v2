"use server";

import { KontriOrderToSend } from "@/types/KontriOrder";
import { AddOrderResponse } from "@/types/api/AddOrderResponse";

const SEND_ORDER_URL = process.env.GCP_SERVER_ADDRESS!;

export const sendOrder = async (orderObject: KontriOrderToSend) => {
    try {
        const resp = await fetch(SEND_ORDER_URL, {
            method: "POST",
            body: JSON.stringify(orderObject),
            headers: { "Content-Type": "application/json" },
        });
        return ((await resp.json()) as AddOrderResponse).result;
    } catch (error) {
        console.log(error);
        return { Code: 0, Message: "Error while sending order." };
    }
};
