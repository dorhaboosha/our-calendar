import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Our Calendar",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
