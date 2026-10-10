import { KontriOrder } from "@/types/KontriOrder";
import ShopOrder from "@/types/ShopOrder";

export const createKontriOrder = (products: ShopOrder[], refNumber: string): KontriOrder => {
    if (!refNumber || refNumber.length > 16 || !products.length) throw new Error("Invalid Kontri order reference or products.");
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
        RefNumber: refNumber,
        OrderedItems: products.map((product) => {
            const AltumArticleId = Number(product.kontriApiId);
            const Amount = product.kontriOrderedAmount;
            if (
                !product.kontriApiId ||
                !/^[1-9]\d*$/.test(product.kontriApiId) ||
                !Number.isSafeInteger(AltumArticleId) ||
                AltumArticleId > 2147483647 ||
                typeof Amount !== "number" ||
                !Number.isFinite(Amount) ||
                Amount <= 0
            )
                throw new Error("Invalid persisted Kontri product snapshot.");
            return {
                AltumArticleId,
                Amount,
                ClientOrderNumber: product.code,
            };
        }),
        products,
    };
};
