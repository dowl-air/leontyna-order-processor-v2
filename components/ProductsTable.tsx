"use client";
import { useEffect, useState } from "react";

import ShopOrder from "@/types/ShopOrder";
import { TABLE_ITEMS_FETCH_COUNT } from "@/utils/constants";
import { feedsDownload } from "@/actions/feedsDownload";
import { checkOrder } from "@/actions/checkOrder";
import { sendOrders } from "@/actions/triggerOrdersSend";
import { getProducts } from "@/db/getProducts";
import { formatDate, formatTime } from "@/utils/formatDate";
import { OrderInfoModal } from "./OrderInfoModal";
import { OrderResponseResult } from "@/types/api/CheckOrderResponse";

type Message = {
    type: "success" | "error" | "info";
    message: string;
};

const ProductsTable = ({ initialShopOrders }: { initialShopOrders: ShopOrder[] }) => {
    const [shopOrders, setShopOrders] = useState(initialShopOrders);
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [modalOrder, setModalOrder] = useState<OrderResponseResult | null>(null);

    const openModal = () => {
        (document.getElementById("order-info-modal") as HTMLDialogElement).showModal();
    };

    const closeModal = () => {
        (document.getElementById("order-info-modal") as HTMLDialogElement).close();
        setModalOrder(null);
    };

    const refreshShopOrders = async () => {
        setLoading(true);
        const shopOrdersAPI = await getProducts(TABLE_ITEMS_FETCH_COUNT, null);
        setShopOrders(shopOrdersAPI);
        setLoading(false);
    };

    const triggerFeedDown = async () => {
        setLoading(true);
        const resp = await feedsDownload();
        if (resp.message) {
            setMessages([...messages, { message: resp.message, type: resp.status as Message["type"] }]);
        }
        await refreshShopOrders();
        setLoading(false);
    };

    const triggerOrders = async () => {
        setLoading(true);
        const resp = await sendOrders();
        if (resp.message) {
            setMessages([...messages, { message: resp.message, type: resp.status as Message["type"] }]);
        }
        await refreshShopOrders();
        setLoading(false);
    };

    useEffect(() => {
        if (messages.length === 0) return;
        const t = setTimeout(() => {
            setMessages([]);
        }, 8000);
        return () => clearTimeout(t);
    }, [messages]);

    const checkOrderStatus = async (orderNumber: string | null) => {
        if (!orderNumber) return setMessages([...messages, { message: "No order number.", type: "error" }]);
        const shopOrdersAPI = await checkOrder(orderNumber);
        if (shopOrdersAPI.Code !== 200 && shopOrdersAPI.Code !== "200") {
            console.log(shopOrdersAPI);
            return setMessages([...messages, { message: shopOrdersAPI.Message, type: "error" }]);
        }
        setModalOrder(shopOrdersAPI);
        openModal();
    };

    return (
        <>
            <div className="flex flex-col gap-2 lg:flex-row md:justify-between md:items-center mb-2 w-full">
                <h2 className="text-lg lg:text-2xl font-bold px-4">
                    <span className="text-primary">Kontri</span> produkty z objednávek
                </h2>
                <div className="flex flex-col md:flex-row gap-2 px-3">
                    <button className="btn btn-sm md:btn-md btn-square btn-outline btn-primary w-full" onClick={refreshShopOrders}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                            <path d="M16 16h5v5" />
                        </svg>
                    </button>
                    <button className="btn btn-sm md:btn-md btn-outline btn-primary" onClick={triggerFeedDown}>
                        Vynutit stažení feedů
                    </button>
                    <button className="btn btn-sm md:btn-md btn-outline btn-primary" onClick={triggerOrders}>
                        Vynutit odeslání objednávek
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto max-h-[calc(100vh-72px-48px-8px)] w-full">
                {!loading ? (
                    <table className="table table-pin-rows">
                        <thead className="">
                            <tr>
                                <th>Kód objednávky</th>
                                <th>Datum</th>
                                <th>Kód produktu</th>
                                <th>Název produktu</th>
                                <th>Varianta</th>
                                <th>Počet</th>
                                <th className="tracking-tight">Kontri objednávka</th>
                                <th className="tracking-tight">Nedostatky</th>
                                <th>Stav dodání</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {shopOrders.map((order) => (
                                <tr key={order.code + order.orderItemCode}>
                                    <th>{order.code}</th>
                                    <td>
                                        <div className="flex flex-col">
                                            <span className="text-nowrap">{formatDate(order.date)}</span>
                                            <span className="text-nowrap">{formatTime(order.date)}</span>
                                        </div>
                                    </td>
                                    <td>{order.orderItemCode}</td>
                                    <td>{order.orderItemName}</td>
                                    <td>
                                        <div className="flex flex-col">
                                            {order.orderItemVariantName.split(",").map((item) => {
                                                return (
                                                    <div key={item} className="text-nowrap">
                                                        {item}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </td>
                                    <td>
                                        {order.orderItemAmount} {order.orderItemUnit}
                                    </td>
                                    <td>{order.AltumOrderID}</td>
                                    <td className={`text-center ${order.shortage && "text-error font-bold"}`}>{order.shortage}</td>
                                    <td className="text-center">
                                        {order.kontriStatusCode === 100 && <div className="badge badge-success">{order.kontriStatusName}</div>}
                                        {order.kontriStatusCode === 90 && <div className="badge badge-warning">{order.kontriStatusName}</div>}
                                        {order.kontriStatusCode !== 100 && order.kontriStatusCode !== 90 && (
                                            <div className="badge badge-error">Neobjednáno</div>
                                        )}
                                    </td>
                                    <td>
                                        {(order.kontriStatusCode === 100 || order.kontriStatusCode === 101) && (
                                            <button
                                                className="btn btn-primary btn-xs text-nowrap"
                                                onClick={() => checkOrderStatus(order.AltumOrderID)}
                                            >
                                                Dotaz na stav
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="flex flex-col w-full items-center">
                        <span className="loading loading-infinity w-20 mt-16"></span>
                        <p>Načítá se...</p>
                    </div>
                )}
            </div>
            <div className="toast toast-start z-50">
                {messages.map((message, index) => (
                    <div
                        key={index}
                        className={`alert ${message.type === "success" ? "alert-success" : ""}${message.type === "error" ? "alert-error" : ""}${
                            message.type === "info" ? "alert-info" : ""
                        }`}
                    >
                        <span>{message.message}</span>
                    </div>
                ))}
            </div>

            <OrderInfoModal order={modalOrder} onClose={closeModal} />
        </>
    );
};

export default ProductsTable;
