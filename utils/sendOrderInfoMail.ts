import { sendMail } from "@/actions/sendMail";
import { OrderResponseResult } from "@/types/api/CheckOrderResponse";
import { KontriOrder } from "@/types/KontriOrder";
import ShopOrder from "@/types/ShopOrder";

export const sendOrderInfoMail = async ({
    subject,
    text = "",
    products,
    orderObject,
    orderResp,
    error,
}: {
    subject: string;
    text?: string;
    products?: ShopOrder[];
    orderObject: KontriOrder;
    orderResp?: OrderResponseResult;
    error?: any;
}) => {
    const orderProducts = products ?? orderObject.products;
    const { products: _, ...orderReq } = orderObject;

    await sendMail({
        subject,
        text,
        html: `
            <h2>Produkty</h2>
            <table>
                <thead>
                    <tr>
                        <th>Název</th>
                        <th>Množství</th>
                        <th>Kód</th>
                        <th>AltumOrderID/TEMP</th>
                        <th>RefNumber</th>
                        <th>kontriStatusCode</th>
                        <th>kontriStatusName</th>
                        <th>shortage</th>
                    </tr>
                </thead>
                <tbody>
                    ${orderProducts
                        .map(
                            (product) => `
                            <tr>
                                <td>${product.orderItemName}</td>
                                <td>${product.orderItemAmount}</td>
                                <td>${product.orderItemCode}</td>
                                <td>${product.AltumOrderID}</td>
                                <td>${product.RefNumber}</td>
                                <td>${product.kontriStatusCode}</td>
                                <td>${product.kontriStatusName}</td>
                                <td>${product.shortage}</td>
                            </tr>
                        `
                        )
                        .join("")}
                </tbody>
            </table>
            <h2>Objednávka</h2>
            <p>${JSON.stringify(orderReq)}</p>
            <h2>Odpověď</h2>
            <p>${JSON.stringify(orderResp)}</p>
            <h2>Produkty</h2>
            <p>${JSON.stringify(orderProducts)}</p>
            ${error ? "<h2>Chyba</h2>" : ""}
            ${error ? `<p>${error}</p>` : ""}
        `,
    });
};
