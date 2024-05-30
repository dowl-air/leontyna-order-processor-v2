"use server";

import { getNewOrder } from "@/db/getNewOrder";
import { getUnconfirmedOrders } from "@/db/getUnconfirmedOrders";
import { KontriOrder } from "@/types/KontriOrder";
import { sendOrder } from "./sendOrder";
import { updateProduct } from "@/db/updateProduct";
import { findProductByAltumID } from "@/utils/findProductByAltum";

const sendOrderHandler = async (orderObject: KontriOrder) => {
    try {
        const { products, ...orderObjectCopy } = orderObject;
        console.log("Sending order to Kontri.pl.");
        const order = await sendOrder(orderObjectCopy);
        
        if (!order.Code) {
            //todo send mail to admin
            console.log("Order has not been sent.");
            console.log(order);
            return {Code: 0};
        }

        console.log(order);

        switch (order.Code) {
            case 100:
            case 101:
                console.log("Order has been sent successfully.");
                console.log(order.Message);

                const promises = products.map(async (product) => {
                    await updateProduct(product, { 
                        AltumOrderID: order.AltumOrderID, 
                        kontriStatusCode: 100, 
                        kontriStatusName: "Objednáno",
                        shortage: 0
                    });
                });
                await Promise.all(promises);

                if (order.Shortages) {
                    for (const shortage of order.Shortages) {
                        const { AltumArticleID, Quantity } = shortage;
                        const product = findProductByAltumID(products, AltumArticleID);
                        if (product) await updateProduct(product, { shortage: Quantity });
                    }
                }
                return order;
            case 90:
            case 99:
                console.log("Order has been added successfully. (but not sent yet)");
                const tempCode = "TEMP_" + new Date().getTime();
                const promises_ = products.map(async (product) => {
                    await updateProduct(product, { 
                        AltumOrderID: tempCode, 
                        kontriStatusCode: 90, 
                        kontriStatusName: "Přidáno" 
                    });
                });
                await Promise.all(promises_);
                return order;
            default:
                //todo send mail to admin (only some codes)
                console.log("Order has not been sent.");
                console.log("Error: " + order.Message);
                return order;
        }
    } catch (error) {
        //todo send mail to admin maybe
        console.log(error);
        return {Code: 0}
    }
};

export const sendOrders = async () => {
    try {
        let message = "";
        //get products that are not yet finished (but sent to Kontri) - there may be more orders
        const ordersToResend = await getUnconfirmedOrders();
        if (ordersToResend) {
            console.log(`Orders (${ordersToResend.length}) to resend have been found.`);
            console.log("Resending orders to Kontri.");
            message += "Resent " + ordersToResend.length + " orders. Codes: ";
            for (const order of ordersToResend) {
                await new Promise((resolve) => setTimeout(resolve, 2500));
                const resp = await sendOrderHandler(order);
                message += resp.Code + ", ";
            }
            message += " | ";
        }

        const order = await getNewOrder();
        if (order) {
            console.log("New order has been created.");
            console.log("Sending order to Kontri.");
            await new Promise((resolve) => setTimeout(resolve, 2500));
            const resp = await sendOrderHandler(order);
            message += "Kód nové objednávky: " + resp.Code;
        }
        return { status: "Success", message };
    } catch (error) {
        //todo send mail to admin with error
        console.error(error);
        return { status: "Error" };
    }
};