type Article = {
    AltumArticleID: number;
    Barcode?: string;
    Code: string;
    NetPrice: number;
    Quantity: number;
    TotalGrossPrice: number;
    TotalNetPrice: number;
    VATRate: number;
}

type Document = {
    Number: string;
    Date: string;
    NetValue: number;
    GrossValue: number;
}

type OrderResponseResult = {
    Code: number;
    Message: string;
    AltumOrderID: number;
    AltumOrderNumber: string;
    Articles: Article[];
    PackageTrackingNumber?: string;
    Documents: Document[],
    GrossValue: number;
    NetValue: number;
    Status: number;
}

export type CheckOrderResponse = {
    GetOrderStatusResult: OrderResponseResult | {Code: number, Message: string};
}