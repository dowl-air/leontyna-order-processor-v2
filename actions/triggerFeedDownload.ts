"use server";
import { backendName } from "@/utils/backendName";

export const triggerFeedDownload = async (source: string) => {
    const response = await fetch(`${backendName}/api/orders/fetchOrders?source=${source}`, {cache: "no-store"});
    const data = await response.json();
    return data;
};
