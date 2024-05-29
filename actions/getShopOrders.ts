"use server";

import ShopOrder from "@/types/ShopOrder";
import { backendName } from "@/utils/backendName";

export const getShopOrders = async (limit : number, offset: number) : Promise<ShopOrder[]> => {
    /* const response = await fetch(`${backendName}/api/orders?limit=${limit}&offset=${offset}`, {cache: "no-store"});
    const data = await response.json() as ShopOrder[];
    return data; */
    //todo fix
    return []
}