"use server";
import { doc, getDoc, setDoc } from "firebase/firestore/lite"
import { db } from "./init"
import ShopOrder from "@/types/ShopOrder";

export const addProduct = async (product: ShopOrder) => {
    const { date } = product;
    const productCopy: any = { ...product };
    productCopy.date = new Date(date);
    productCopy.kontriStatusCode = 0;
    productCopy.kontriStatusName = "New item";
    productCopy.AltumOrderID = null;

    const ref = doc(db, "products", product.code + "_" + product.orderItemCode);

    const docSnap = await getDoc(ref);

    if (!docSnap.exists()) {
        await setDoc(ref, productCopy, { merge: true });
    }
};