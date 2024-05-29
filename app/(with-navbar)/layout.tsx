import { ReactNode } from "react";

import NavBar from "@/components/NavBar";

export default function NavbarLayout({ children }: { children: ReactNode }) {
    return (
        <>
            <NavBar />
            {children}
        </>
    );
}
