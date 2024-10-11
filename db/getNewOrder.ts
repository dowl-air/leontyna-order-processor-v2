"use server";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { KontriOrder } from "@/types/KontriOrder";
import { createKontriOrder } from "@/utils/createKontriOrder";
import { formatToUTC } from "@/utils/formatDate";
import { v4 as uuidv4 } from "uuid";

export const getNewOrder = async (): Promise<KontriOrder | null> => {
    const q = query(collection(db, "products"), where("AltumOrderID", "==", null));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return null;

    //generate unique order number (16 characters)
    const refNumber = uuidv4().replace(/-/g, "").slice(0, 16);

    const products: ShopOrder[] = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        products.push({ ...data, fID: doc.id, date: formatToUTC(data.date as Timestamp) } as ShopOrder);
    });
    return createKontriOrder(products, refNumber);
};
