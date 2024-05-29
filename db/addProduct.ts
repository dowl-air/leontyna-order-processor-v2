"use server";
import { doc, setDoc } from "firebase/firestore/lite"
import { db } from "./init"
import ShopOrder from "@/types/ShopOrder";

export const addProduct = async (product: ShopOrder) => {
    const { date } = product;
    product.date = new Date(date);
    const ref = doc(db, "products", product.code + "_" + product.orderItemCode);
    await setDoc(ref, product, { merge: true});
}