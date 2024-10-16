"use server";
import { KontriOrder } from "@/types/KontriOrder";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { createKontriOrder } from "@/utils/createKontriOrder";
import { formatToUTC } from "@/utils/formatDate";

export const getUnconfirmedOrders = async (): Promise<KontriOrder[]> => {
    const q = query(collection(db, "products"), where("kontriStatusCode", "==", 90));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return [];

    const products: ShopOrder[] = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        products.push({ ...data, fID: doc.id, date: formatToUTC(data.date as Timestamp) } as ShopOrder);
    });
    // split to orders based on AltumOrderID
    const uniqueAltumOrderIDs = [...new Set(products.map((product) => product.AltumOrderID))];
    const orders: KontriOrder[] = [];
    uniqueAltumOrderIDs.forEach((AltumOrderID) => {
        const productsForOrder = products.filter((product) => product.AltumOrderID === AltumOrderID);
        orders.push(createKontriOrder(productsForOrder, productsForOrder[0].RefNumber ?? "test-01"));
    });
    return orders;
};
