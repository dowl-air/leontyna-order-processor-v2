import ProductsTable from "@/components/ProductsTable";
import { getProducts } from "@/db/getProducts";
import { TABLE_ITEMS_FETCH_COUNT } from "@/utils/constants";

export const dynamic = "force-dynamic";

const Home = async () => {
    const shopOrders = await getProducts(TABLE_ITEMS_FETCH_COUNT, null);
    return (
        <main className="flex min-h-screen flex-col items-start pt-[4.5rem] max-w-7xl mx-auto">
            {/* <ProductsTable initialShopOrders={shopOrders} /> */}
        </main>
    );
};

export default Home;
