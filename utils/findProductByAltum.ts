import ShopOrder from "@/types/ShopOrder";

const getProductAltumID = (productID: string) => {
    const orderItemCodeParts = productID.split("-");
    return +orderItemCodeParts[2];
};

export const findProductByAltumID = (products: ShopOrder[], altumID: number) => {
    return products.find((product) => {
        const altumIDFromProduct = getProductAltumID(product.orderItemCode);
        return altumIDFromProduct === altumID;
    });
};