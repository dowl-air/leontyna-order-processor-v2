type ShopOrder = {
    id: string,
    code: string,
    date: string,
    statusName: string,
    orderItemName: string,
    orderItemAmount: number,
    orderItemUnit: string,
    orderItemCode: string,
    orderItemManufacturer: string,
    orderItemVariantName: string,
    orderItemSupplier: string,
    orderItemEan: string
    shortage: number
    AltumOrderID: string
    kontriStatusCode: number
    kontriStatusName: string
}

export default ShopOrder