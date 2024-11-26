export type AddOrderResponse = {
    status: string;
    result: {
        Code: number;
        Message: string;
        OrderNumber?: string;
        Shortages?: {
            Shortages: {
                AltumArticleID: number;
                Quantity: number;
            }[];
        };
        AltumOrderID?: string;
        OrderItemResponse?: {
            OrderItemResponse: {
                AltumArticleID: string;
                Quantity: number;
                Price: number;
            }[];
        };
        TotalOrderValue?: number;
        ShipmentPayment?: number;
        ShipmentConst?: number;
        errno?: number;
    };
};
