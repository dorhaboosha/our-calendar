import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { appConfig } from "@/config/app.config";

/**
 * The installed app's icons and the PNG favicon (spec 8.1), all made from the one logo,
 * public/logo.svg. "Full" icons fill the whole square with the brand color: the
 * maskable ones, which Android crops to its own shape, and the iPhone's, which it rounds.
 * The others keep the logo's own rounded corners.
 */
const ICONS = {
  "favicon-32.png": { size: 32, full: false },
  "icon-192.png": { size: 192, full: false },
  "icon-512.png": { size: 512, full: false },
  "maskable-192.png": { size: 192, full: true },
  "maskable-512.png": { size: 512, full: true },
  "apple-touch-icon.png": { size: 180, full: true },
} as const;

type IconName = keyof typeof ICONS;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: RouteContext<"/icons/[name]">) {
  const { name } = await params;
  if (!(name in ICONS)) return new Response(null, { status: 404 });
  return new Response(await iconPng(name as IconName), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}

/** The icon's PNG, made once (at build time) and kept. */
async function iconPng(name: IconName) {
  "use cache";
  const { size, full } = ICONS[name];
  const logo = await readFile(join(process.cwd(), "public", "logo.svg"));
  const src = `data:image/svg+xml;base64,${logo.toString("base64")}`;
  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: full ? appConfig.themeColor : "transparent",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG, not a page */}
      <img src={src} width={size} height={size} alt="" />
    </div>,
    { width: size, height: size },
  );
  return new Uint8Array(await image.arrayBuffer());
}
