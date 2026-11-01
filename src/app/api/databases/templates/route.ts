import { handler } from "@/lib/api";
import { templateSummaries } from "@/lib/databases/templates";
export const GET = handler(async () => Response.json(templateSummaries()));
