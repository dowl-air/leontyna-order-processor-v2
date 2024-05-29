import { getShopOrders } from "@/actions/getShopOrders";
import ProductsTable from "@/components/ProductsTable";
import { TABLE_ITEMS_FETCH_COUNT } from "@/utils/constants";

const Home = async () => {
    const shopOrders = await getShopOrders(TABLE_ITEMS_FETCH_COUNT, 0);
    return (
        <main className="flex min-h-screen flex-col items-start pt-[4.5rem] max-w-7xl mx-auto">
            <ProductsTable initialShopOrders={shopOrders} />
        </main>
    );
};

export default Home;
