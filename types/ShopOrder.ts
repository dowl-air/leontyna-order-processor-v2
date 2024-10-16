type ShopOrder = {
    id: string;
    code: string;
    date: string | Date;
    statusName: string;
    orderItemName: string;
    orderItemAmount: number;
    orderItemUnit: string;
    orderItemCode: string;
    orderItemManufacturer: string;
    orderItemVariantName: string;
    orderItemSupplier: string;
    orderItemEan: string;
    shortage?: number;
    AltumOrderID: string | null;
    kontriStatusCode?: number;
    kontriStatusName?: string;
    kontriOrderCode?: string;
    RefNumber?: string;
    fID?: string;
};

export default ShopOrder;
