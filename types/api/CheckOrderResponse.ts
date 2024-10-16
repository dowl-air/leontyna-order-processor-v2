export type Article = {
    AltumArticleID: number;
    Barcode?: string;
    Code: string;
    NetPrice: number;
    Quantity: number;
    TotalGrossPrice: number;
    TotalNetPrice: number;
    VATRate: number;
};

type Document = {
    Number: string;
    Date: string;
    NetValue: number;
    GrossValue: number;
};

export enum OrderStatus {
    NEW = "Nowe",
    AGGREGATED = "Anulowane/zagregowane",
    SENT = "Wyslane",
}

export type OrderResponseResult = {
    Code: string | number;
    Message: string;
    AltumOrderID?: number | string;
    AltumOrderNumber?: string;
    Articles?: { Article: Article[] };
    PackageTrackingNumber?: string;
    Documents?: Document[];
    GrossValue?: number;
    NetValue?: number;
    Status?: OrderStatus;
};

export type CheckOrderResponse = {
    GetOrderStatusResult: OrderResponseResult | { Code: number; Message: string };
};

export type CheckOrderByRefNumberResponse = {
    GetOrderStatusByRefNumberResult: OrderResponseResult | { Code: number; Message: string };
};
