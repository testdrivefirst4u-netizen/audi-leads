import { Html, Head, Main, NextScript } from "next/document";
import { THEMES, DEFAULT_THEME } from "../lib/theme";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="theme-color" content="#161c2d" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="sales.broaddcast.com" />
        {/* Applies the saved colour theme before the first paint (and before the page loader picks its colours). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-boot.js" data-themes={THEMES.map((t) => t.key).join(",")} data-default={DEFAULT_THEME} />
      </Head>
      <body>
        {/* Loaded synchronously on purpose: the BroaddCast loader must cover the page before its first paint. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/brand-loader.js" />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
