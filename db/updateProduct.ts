"use server";
import ShopOrder from "@/types/ShopOrder";
import { doc, updateDoc } from "firebase/firestore/lite";
import { db } from "./init";

export const updateProduct = async (product: ShopOrder, updateFields: any) => {
    const ref = doc(db, "products", product.code + "_" + product.orderItemCode);
    await updateDoc(ref, updateFields)
}