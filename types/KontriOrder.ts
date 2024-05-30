import ShopOrder from "./ShopOrder"

export type KontriOrder = {
    Segregation: boolean,
    NotifyWhenReadyToShip: boolean,
    ShipmentRecipientName: string,
    ShipmentStreetname: string,
    ShipmentHouseNumber: string,
    ShipmentCity: string,
    ShipmentPostcode: string,
    ShipmentCountry: string,
    AddOrderIfShortagesInStock: boolean,
    ShippingMethod: string,
    PaymentMethod: string,
    OrderedItems: {
        AltumArticleId: number,
        Amount: number,
        ClientOrderNumber?: string
    }[],
    products: ShopOrder[]
}