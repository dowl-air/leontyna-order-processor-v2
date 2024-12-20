"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import ShopOrder from "@/types/ShopOrder";
import { TABLE_ITEMS_FETCH_COUNT } from "@/utils/constants";
import { feedsDownload } from "@/actions/feedsDownload";
import { checkOrder } from "@/actions/checkOrder";
import { sendOrders } from "@/actions/triggerOrdersSend";
import { getProducts } from "@/db/getProducts";
import { formatDate, formatTime } from "@/utils/formatDate";
import { OrderInfoModal } from "./OrderInfoModal";
import { OrderResponseResult } from "@/types/api/CheckOrderResponse";
import { checkOrderByRefNumber } from "@/actions/checkOrderRefNumber";

type Message = {
    type: "success" | "error" | "info";
    message: string;
};

const ProductsTable = ({ initialShopOrders }: { initialShopOrders: ShopOrder[] }) => {
    const [shopOrders, setShopOrders] = useState(initialShopOrders);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [messages, setMessages] = useState<Message[]>([]);
    const [modalOrder, setModalOrder] = useState<OrderResponseResult | null>(null);
    const observer = useRef<IntersectionObserver | null>(null);

    useEffect(() => {
        const loadMore = async () => {
            const newOrders = await getProducts(TABLE_ITEMS_FETCH_COUNT, new Date(shopOrders[shopOrders.length - 1].date));
            setShopOrders((s) => [...s, ...newOrders]);
        };

        if (page === 1) return;
        loadMore();
    }, [page]);

    const lastPostElementRef = useCallback(
        (node: HTMLElement | null) => {
            if (loading) return;
            if (observer.current) observer.current.disconnect();

            observer.current = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    setPage((prev) => prev + 1);
                }
            });

            if (node) observer.current.observe(node);
        },
        [loading]
    );

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
        setPage(1);
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

    const copyInnerText = (eventTarget: EventTarget) => {
        navigator.clipboard.writeText((eventTarget as HTMLElement).innerText as string);
        setMessages([...messages, { message: "Text byl zkopírován do schránky.", type: "info" }]);
    };

    const checkOrderStatus = async (orderNumber: string | null) => {
        if (!orderNumber) return setMessages([...messages, { message: "No order number.", type: "error" }]);
        setModalOrder(null);
        openModal();
        const shopOrdersAPI = await checkOrder(orderNumber);
        if (shopOrdersAPI.Code !== 200 && shopOrdersAPI.Code !== "200") {
            closeModal();
            console.log(shopOrdersAPI);
            return setMessages([...messages, { message: shopOrdersAPI.Message, type: "error" }]);
        }
        setModalOrder(shopOrdersAPI);
    };

    const checkOrderStatusByRefNumber = async (refNumber: string | undefined) => {
        if (!refNumber) return setMessages([...messages, { message: "No ref number.", type: "error" }]);
        setModalOrder(null);
        openModal();
        const shopOrdersAPI = await checkOrderByRefNumber(refNumber);
        if (shopOrdersAPI.Code !== 200 && shopOrdersAPI.Code !== "200") {
            closeModal();
            console.log(shopOrdersAPI);
            return setMessages([...messages, { message: shopOrdersAPI.Message, type: "error" }]);
        }
        setModalOrder(shopOrdersAPI);
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
                    <table className="table table-zebra table-pin-rows">
                        <thead className="">
                            <tr>
                                <th>Kód objednávky</th>
                                <th>Datum</th>
                                <th>Kód produktu</th>
                                <th>Název produktu</th>
                                <th>Varianta</th>
                                <th>Počet</th>
                                <th className="tracking-tight">Kontri objednávka</th>
                                <th className="tracking-tight">Referenční číslo</th>
                                <th className="tracking-tight">Nedostatky</th>
                                <th>Stav dodání</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {shopOrders.map((order, index) => (
                                <tr key={order.code + order.orderItemCode} ref={shopOrders.length === index + 1 ? lastPostElementRef : null}>
                                    <th>
                                        <div className="cursor-copy" onClick={(e) => copyInnerText(e.target)}>
                                            {order.code}
                                        </div>
                                    </th>
                                    <td>
                                        <div className="flex flex-col">
                                            <span className="text-nowrap">{formatDate(order.date as string)}</span>
                                            <span className="text-nowrap">{formatTime(order.date as string)}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="text-nowrap cursor-copy" onClick={(e) => copyInnerText(e.target)}>
                                            {order.orderItemCode}
                                        </div>
                                    </td>
                                    <td>
                                        <div className="cursor-copy" onClick={(e) => copyInnerText(e.target)}>
                                            {order.orderItemName}
                                        </div>
                                    </td>
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
                                    <td>
                                        <div className="flex flex-col gap-1">
                                            {order.AltumOrderID !== null && order.AltumOrderID !== order.RefNumber ? (
                                                <div className="text-nowrap">
                                                    Altum ID:{" "}
                                                    <b className="cursor-copy" onClick={(e) => copyInnerText(e.target)}>
                                                        {order.AltumOrderID}
                                                    </b>
                                                </div>
                                            ) : null}
                                            {order.kontriOrderCode ? (
                                                <div className="text-nowrap cursor-copy" onClick={(e) => copyInnerText(e.target)}>
                                                    {order.kontriOrderCode}
                                                </div>
                                            ) : null}
                                        </div>
                                    </td>
                                    <td>
                                        <div className="cursor-copy" onClick={(e) => copyInnerText(e.target)}>
                                            {order.RefNumber}
                                        </div>
                                    </td>
                                    <td className={`text-center ${order.shortage ? "text-error font-bold" : ""}`}>{order.shortage}</td>
                                    <td className="text-center">
                                        {order.kontriStatusCode !== undefined ? (
                                            <div className="flex flex-col gap-1 items-center">
                                                {order.kontriStatusCode === 0 ? <div className="badge badge-error">Neobjednáno</div> : null}
                                                {order.kontriStatusCode === 80 ? (
                                                    <div className="badge badge-error">{order.kontriStatusName}</div>
                                                ) : null}
                                                {order.kontriStatusCode === 90 ? (
                                                    <div className="badge badge-warning">{order.kontriStatusName}</div>
                                                ) : null}
                                                {[100, 300, 301, 400].includes(order.kontriStatusCode) ? (
                                                    <div className="badge badge-success">{order.kontriStatusName}</div>
                                                ) : null}
                                                {[300, 400].includes(order.kontriStatusCode) ? (
                                                    <div className="badge badge-accent text-nowrap">Agregováno sem</div>
                                                ) : null}
                                                {order.kontriStatusCode === 301 ? <div className="badge badge-warning">Přesunuto</div> : null}
                                                {order.kontriStatusCode === 400 ? <div className="badge badge-secondary">Odesláno</div> : null}
                                            </div>
                                        ) : null}
                                    </td>
                                    <td>
                                        <div className="flex flex-col gap-2">
                                            {order.RefNumber ? (
                                                <button
                                                    className="btn btn-primary btn-xs text-nowrap"
                                                    onClick={() => checkOrderStatusByRefNumber(order.RefNumber)}
                                                >
                                                    Dotaz [Referenční číslo]
                                                </button>
                                            ) : null}
                                            {order.kontriStatusCode && order.kontriStatusCode >= 100 ? (
                                                <button
                                                    className="btn btn-primary btn-xs text-nowrap"
                                                    onClick={() => checkOrderStatus(order.AltumOrderID)}
                                                >
                                                    Dotaz [Kontri ID]
                                                </button>
                                            ) : null}
                                        </div>
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
