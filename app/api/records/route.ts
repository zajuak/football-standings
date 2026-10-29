import { env } from "cloudflare:workers";
import { handleRecords } from "../../../lib/server/records-api.mjs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleRecords(request, env.DB); }
export function POST(request: Request) { return handleRecords(request, env.DB); }
