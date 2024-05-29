"use server";

export const triggerOrdersSend = async () => {
    const response = await fetch(`${"backendName"}/api/sendOrders`, {cache: "no-store"});
    const data = await response.json();
    return data;
};