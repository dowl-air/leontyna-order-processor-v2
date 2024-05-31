import { KontriOrder } from "@/types/KontriOrder";
import ShopOrder from "@/types/ShopOrder";

export const createKontriOrder = (products: ShopOrder[]): KontriOrder => {
    return {
        Segregation: false,
        NotifyWhenReadyToShip: false,
        Comments: "",
        ShipmentRecipientName: "Leontyna.cz",
        ShipmentStreetname: "Sirava",
        ShipmentHouseNumber: "27",
        ShipmentFlatNumber: "",
        ShipmentCity: "Prerov",
        ShipmentPostcode: "75002",
        ShipmentCountry: "CZ",
        AddOrderIfShortagesInStock: true,
        ShippingMethod: "DPD",
        PaymentMethod: "Prepayment",
        OrderedItems: products.map((product) => {
            const orderItemCodeParts = product.orderItemCode.split("-");
            const AltumArticleId = +orderItemCodeParts[2];
            return {
                AltumArticleId,
                Amount: +product.orderItemAmount,
                ClientOrderNumber: product.code,
            };
        }),
        products,
    };
}