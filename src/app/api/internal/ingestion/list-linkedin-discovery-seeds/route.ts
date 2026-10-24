import { NextResponse } from "next/server";
import { getLinkedInDiscoverySeeds } from "@/lib/ingestion/linkedinDiscoverySeeds";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the LinkedIn discovery branch
// calls this once per run to get its static, bounded per-market seed list
// (Lebanon/Saudi/UAE/Qatar/Kuwait). No DB access — the seed list itself is
// static config, same shape as Apify Multi-Company Source Seeds in the n8n
// workflow, just served from the app so the real safety gate
// (isProviderEnabled) lives in one place. Returns an empty list while
// providerConfig.ts's linkedin.enabled stays false, so the n8n loop has
// zero items and the paid Bebity actor call can never fire in that state —
// same structurally-inert-while-disabled posture as
// list-linkedin-enrichment-queue/route.ts.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "INGESTION_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const seeds = getLinkedInDiscoverySeeds();
    return NextResponse.json({ seeds });
  } catch (error) {
    console.error("list-linkedin-discovery-seeds failed:", error);
    return NextResponse.json({ error: "Failed to list LinkedIn discovery seeds. See server logs." }, { status: 500 });
  }
}
