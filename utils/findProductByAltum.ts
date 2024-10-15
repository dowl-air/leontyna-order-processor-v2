export const getProductAltumID = (productID: string) => {
    const orderItemCodeParts = productID.split("-");
    return +orderItemCodeParts[2];
};
