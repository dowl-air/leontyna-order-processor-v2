import ShopOrder from "./ShopOrder"

export type KontriOrder = {
    Segregation: boolean,
    NotifyWhenReadyToShip: boolean,
    Comments: string,
    ShipmentRecipientName: string,
    ShipmentStreetname: string,
    ShipmentHouseNumber: string,
    ShipmentFlatNumber: string,
    ShipmentCity: string,
    ShipmentPostcode: string,
    ShipmentCountry: string,
    AddOrderIfShortagesInStock: boolean,
    ShippingMethod: string,
    PaymentMethod: string,
    RefNumber: string,
    OrderedItems: {
        AltumArticleId: number,
        Amount: number,
        ClientOrderNumber?: string
    }[],
    products: ShopOrder[]
}

export type KontriOrderToSend = Omit<KontriOrder, "products">;