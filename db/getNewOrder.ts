"use server";
import { Timestamp, collection, getDocs, query, where } from "firebase/firestore/lite";
import { db } from "./init";
import ShopOrder from "@/types/ShopOrder";
import { KontriOrder } from "@/types/KontriOrder";
import { createKontriOrder } from "@/utils/createKontriOrder";
import { formatToUTC } from "@/utils/formatDate";
import { v4 as uuidv4 } from "uuid";
import { updateProduct } from "./updateProduct";

export const getNewOrder = async (): Promise<KontriOrder | null> => {
    const q = query(collection(db, "products"), where("AltumOrderID", "==", null));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return null;

    //generate unique order number (16 characters)
    const refNumber = uuidv4().replace(/-/g, "").slice(0, 16);

    const products: ShopOrder[] = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        products.push({ ...data, fID: doc.id, date: formatToUTC(data.date as Timestamp), RefNumber: refNumber } as ShopOrder);
    });

    //update products with refNumber to ensure consistency and atomicity for future requests
    const promises = products.map(async (product) => await updateProduct(product, { RefNumber: refNumber, AltumOrderID: refNumber }));
    await Promise.all(promises);

    return createKontriOrder(products, refNumber);
};
