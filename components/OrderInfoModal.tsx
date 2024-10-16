import { Article, OrderResponseResult } from "@/types/api/CheckOrderResponse";

export const OrderInfoModal = ({ order, onClose }: { order: OrderResponseResult | null; onClose: () => void }) => {
    if (!order)
        return (
            <dialog id="order-info-modal" className="modal modal-bottom sm:modal-middle">
                <div className="modal-box">
                    <div className="py-4 flex items-center justify-center">
                        <span className="loading loading-infinity w-20 mt-16"></span>
                    </div>
                    <div className="modal-action">
                        <form method="dialog">
                            <button className="btn btn-error" onClick={onClose}>
                                Zavřít
                            </button>
                        </form>
                    </div>
                </div>
            </dialog>
        );

    const articles = order.Articles?.Article;
    return (
        <dialog id="order-info-modal" className="modal modal-bottom sm:modal-middle">
            <div className="modal-box">
                <div className="py-4">
                    <p>
                        Altum ID: <span className="font-bold">{order?.AltumOrderID}</span>
                    </p>
                    <p>
                        Číslo objednávky: <span className="font-bold">{order?.AltumOrderNumber}</span>
                    </p>
                    <p>
                        Status: <span className="font-bold">{order?.Status}</span>
                    </p>
                    <p>
                        Číslo balíčku: <span className="font-bold">{order?.PackageTrackingNumber}</span>
                    </p>
                    <p>
                        Gross value: <span className="font-bold">{order?.GrossValue} €</span>
                    </p>
                    <p>
                        Net value: <span className="font-bold">{order?.NetValue} €</span>
                    </p>

                    <div className="flex flex-col mt-3">
                        <p className="font-bold">Produkty</p>
                        <div className="overflow-x-auto mt-2">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Altum ID</th>
                                        <th>Počet</th>
                                        <th>Cena</th>
                                        <th>VATRate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {articles &&
                                        articles.map((article, index) => (
                                            <tr key={index}>
                                                <th>{article.Code}</th>
                                                <th>{+article.Quantity} ks</th>
                                                <th className="text-nowrap">{(+article.TotalNetPrice).toFixed(2)} €</th>
                                                <th>{+article.VATRate}</th>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="modal-action">
                    <form method="dialog">
                        <button className="btn btn-error" onClick={onClose}>
                            Zavřít
                        </button>
                    </form>
                </div>
            </div>
        </dialog>
    );
};
