/** Where the web server reaches the API. The browser reaches it through `/api/v1` (see src/app/api/v1/[...path]/route.ts). */
export const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";
