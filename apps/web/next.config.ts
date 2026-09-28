import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { apiUrl } from "./src/lib/api-url.ts";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  transpilePackages: ["@rabaed/domain"],
  // The browser calls the API on the web's own origin, so the session cookie
  // is first-party (HttpOnly, SameSite=Lax) and no CORS is needed.
  rewrites: async () => [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }],
};

export default withNextIntl(config);
