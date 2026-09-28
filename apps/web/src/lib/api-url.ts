/** Where the web server reaches the API. The browser reaches it through `/api` (see next.config.ts). */
export const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";
