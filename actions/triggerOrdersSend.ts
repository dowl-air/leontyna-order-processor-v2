"use server";

import { getNewOrder } from "@/db/getNewOrder";
import { getUnconfirmedOrders } from "@/db/getUnconfirmedOrders";
import { KontriOrder } from "@/types/KontriOrder";
import { sendOrder } from "./sendOrder";
import { updateProduct } from "@/db/updateProduct";
import { findProductByAltumID } from "@/utils/findProductByAltum";
import { sendMail } from "./sendMail";

const sendOrderHandler = async (orderObject: KontriOrder) => {
    try {
        const { products, ...orderObjectCopy } = orderObject;
        console.log("Sending order to Kontri.pl.");
        const order = await sendOrder(orderObjectCopy);

        if (!order.Code) {
            await sendMail({
                subject: "[BAD_CODE] Chyba při odesílání objednávky",
                text: `Objednávka s kódem ${orderObjectCopy.RefNumber} nebyla odeslána`,
                html: `<p>[BAD_CODE] Objednávka s kódem ${orderObjectCopy.RefNumber} nebyla odeslána</p>
                <p>Chyba: ${order.Message}</p>
                <p>Objednávka: ${JSON.stringify(orderObjectCopy)}</p>
                <p>Produkty: ${JSON.stringify(products)}</p>
                `,
            });
            return { Code: -1 };
        }

        console.log(order);

        switch (order.Code) {
            case 100:
            case 101:
                console.log("Order has been sent successfully.");
                console.log(order.Message);

                await sendMail({
                    subject: "Objednávka byla odeslána",
                    text: `Objednávka s kódem ${orderObjectCopy.RefNumber} byla odeslána, message: ${order.Message}`,
                    html: `<p>Objednávka s kódem ${orderObjectCopy.RefNumber} byla odeslána, message: ${order.Message}</p>
                    <p>Objednávka: ${JSON.stringify(orderObjectCopy)}</p>
                    <p>Produkty: ${JSON.stringify(products)}</p>`,
                });

                const promises = products.map(async (product) => {
                    await updateProduct(product, {
                        AltumOrderID: order.AltumOrderID,
                        RefNumber: orderObjectCopy.RefNumber,
                        kontriStatusCode: 100,
                        kontriStatusName: "Objednáno",
                        shortage: 0,
                    });
                });
                await Promise.all(promises);

                if (order.Shortages && order.Shortages.Shortages) {
                    for (const shortage of order.Shortages.Shortages) {
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

                await sendMail({
                    subject: "Objednávka byla přidána",
                    text: `Objednávka ${orderObjectCopy.RefNumber} byla přidána, message: ${order.Message}`,
                    html: `<p>Objednávka ${orderObjectCopy.RefNumber} byla přidána, message: ${order.Message}</p>
                    <p>Temp kód: ${tempCode}</p>
                    <p>Objednávka: ${JSON.stringify(orderObjectCopy)}</p>
                    <p>Produkty: ${JSON.stringify(products)}</p>`,
                });

                const promises_ = products.map(async (product) => {
                    await updateProduct(product, {
                        AltumOrderID: tempCode,
                        RefNumber: orderObjectCopy.RefNumber,
                        kontriStatusCode: 90,
                        kontriStatusName: "Přidáno",
                    });
                });
                await Promise.all(promises_);
                return order;

            case 10:
            case 21:
            case 30:
            case 50:
            case 51:
            case 70:
            case 80:
            case 110:
                await sendMail({
                    subject: `[ERROR CODE ${order.Code}] Chyba při odesílání objednávky`,
                    text: `Objednávka ${orderObjectCopy.RefNumber} nebyla odeslána`,
                    html: `<p>[ERROR CODE ${order.Code}] Objednávka ${orderObjectCopy.RefNumber} nebyla odeslána</p>
                    <p>Chyba: ${order.Message}</p>
                    <p>Objednávka: ${JSON.stringify(orderObjectCopy)}</p>
                    <p>Produkty: ${JSON.stringify(products)}</p>`,
                });
                return order;
            default:
                console.error("Unknown error code: ", order.Code);
                return { Code: order.Code };
        }
    } catch (error) {
        await sendMail({
            subject: "[UNEXPECTED] Chyba při odesílání objednávky",
            text: `Objednávka ${orderObject.RefNumber} nebyla odeslána`,
            html: `<p>[UNEXPECTED] Objednávka ${orderObject.RefNumber} nebyla odeslána</p>
            <p>Chyba: ${error}</p>
            <p>Objednávka: ${JSON.stringify(orderObject)}</p>
            <p>Produkty: ${JSON.stringify(orderObject.products)}</p>
            `,
        });
        return { Code: -1 };
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
            message += "Znovu posláno " + ordersToResend.length + " objednávek. Kódy: ";
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
            const resp = await sendOrderHandler(order);
            message += "Kód nové objednávky: " + resp.Code;
        }
        return { status: "success", message };
    } catch (error) {
        await sendMail({
            subject: "Chyba při odesílání objednávek",
            text: `Nastala chyba při odesílání objednávek`,
            html: `<p>Nastala chyba při odesílání objednávek</p>
            <p>Chyba: ${error}</p>`,
        });
        console.error(error);
        return { status: "error", message: "Nastala chyba při odesílání objednávek." };
    }
};
