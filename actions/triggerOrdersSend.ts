"use server";

import { getNewOrder } from "@/db/getNewOrder";
import { getUnconfirmedOrders } from "@/db/getUnconfirmedOrders";
import { KontriOrder } from "@/types/KontriOrder";
import { sendOrder } from "./sendOrder";
import { updateProduct } from "@/db/updateProduct";
import { getProductAltumID } from "@/utils/findProductByAltum";
import { sendMail } from "./sendMail";
import { sendOrderInfoMail } from "@/utils/sendOrderInfoMail";

const sendOrderHandler = async (orderObject: KontriOrder) => {
    try {
        const { products, ...orderReq } = orderObject;
        const refNumber = orderObject.RefNumber;

        console.log(`Sending order [${refNumber}]`);
        const orderResp = await sendOrder(orderReq);

        const subject = `[${orderResp.Code}][${refNumber}]: ${orderResp.Message}`;
        console.log(subject);

        if (!orderResp.Code) {
            await sendOrderInfoMail({ subject, orderObject, orderResp });
            // todo? do something here?
            return { Code: -1 };
        }

        switch (orderResp.Code) {
            case 100:
            case 101:
                const promises = products.map(async (product) => {
                    const altumIDFromProduct = getProductAltumID(product.orderItemCode);
                    const shortageItem = orderResp.Shortages?.Shortages?.find((shortage) => shortage.AltumArticleID === altumIDFromProduct);
                    const shortageQuantity = shortageItem ? shortageItem.Quantity : 0;

                    await updateProduct(product, {
                        AltumOrderID: orderResp.AltumOrderID,
                        RefNumber: refNumber,
                        kontriStatusCode: 100,
                        kontriStatusName: "Objednáno",
                        kontriOrderCode: orderResp.OrderNumber,
                        shortage: shortageQuantity,
                    });
                });

                await Promise.all(promises);

                return orderResp;
            case 90:
            case 99:
                const promises_ = products.map(async (product) => {
                    await updateProduct(product, {
                        AltumOrderID: refNumber,
                        RefNumber: refNumber,
                        kontriStatusCode: 90,
                        kontriStatusName: "Nepotvrzeno",
                    });
                });
                await Promise.all(promises_);

                return orderResp;
            case 80:
                const promises__ = products.map(async (product) => {
                    await updateProduct(product, {
                        AltumOrderID: refNumber,
                        RefNumber: refNumber,
                        kontriStatusCode: 80,
                        kontriStatusName: "Nedostupné",
                    });
                });
                await Promise.all(promises__);
                return orderResp;
            case 10:
            case 21:
            case 30:
            case 50:
            case 51:
            case 70:
            case 110:
                await sendOrderInfoMail({ subject, orderObject, orderResp });
                return orderResp;
            default:
                await sendOrderInfoMail({ subject: "[UNKNOWN]" + subject, orderObject, orderResp });
                console.error("Unknown error code: ", orderResp.Code);
                return { Code: orderResp.Code };
        }
    } catch (error) {
        await sendOrderInfoMail({ subject: `[UNEXPECTED][${orderObject.RefNumber}]`, orderObject, error });
        return { Code: -1 };
    }
};

export const sendOrders = async () => {
    try {
        let message = "";
        const ordersToResend = await getUnconfirmedOrders();
        if (ordersToResend.length > 0) {
            console.log(`${ordersToResend.length} orders to resend have been found.`);
            message += "Znovu posláno " + ordersToResend.length + " objednávek. Kódy: ";
            for (const order of ordersToResend) {
                await new Promise((resolve) => setTimeout(resolve, 2100));
                const resp = await sendOrderHandler(order);
                message += resp.Code + ", ";
            }
            message += " | ";
        }

        const order = await getNewOrder();
        if (order) {
            console.log(`New order [${order.RefNumber}] has been created.`);
            await new Promise((resolve) => setTimeout(resolve, 2100));
            const resp = await sendOrderHandler(order);
            message += "Kód nové objednávky: " + resp.Code;
        } else {
            message = message.slice(0, -3);
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
