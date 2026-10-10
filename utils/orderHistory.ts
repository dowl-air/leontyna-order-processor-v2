export const ORDER_HISTORY_DAYS = 5;

export const getOrderHistoryCutoff = () => new Date(Date.now() - ORDER_HISTORY_DAYS * 24 * 60 * 60 * 1000);
