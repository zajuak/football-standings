import page from "../editor.html?raw";
export function GET() {
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
