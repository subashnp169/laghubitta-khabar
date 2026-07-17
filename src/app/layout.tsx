import type { Metadata } from "next";
import "./globals.css";
import Ticker from "@/components/layout/Ticker";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Laghubitta Khabar — Nepal's MFI Intelligence Platform",
  description: "Data-driven intelligence on 51 Class D microfinance institutions of Nepal. Verified NRB directory, reports, jobs, and research.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Ticker />
        <Header />
        <main className="flex-grow">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
