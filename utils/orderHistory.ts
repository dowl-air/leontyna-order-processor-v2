export const ORDER_HISTORY_DAYS = 5;
export const STATUS_HISTORY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export const getOrderHistoryCutoff = () => new Date(Date.now() - ORDER_HISTORY_DAYS * DAY_MS);

// Status passes (100/300/301) only look back three days; uncertain and unknown-quantity checks keep the five-day window.
export const getStatusHistoryCutoff = () => new Date(Date.now() - STATUS_HISTORY_DAYS * DAY_MS);
