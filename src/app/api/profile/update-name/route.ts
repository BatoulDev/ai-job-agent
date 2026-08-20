import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MAX_NAME_LENGTH = 200;

function parseName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

// POST /api/profile/update-name
// Updates the authenticated user's profiles.full_name and queues a
// re-analysis task for their active CV so ownership validation runs again
// with the corrected name. Both writes happen atomically inside the
// update_profile_name_and_retry_analysis() SECURITY DEFINER RPC.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name =
    typeof body === "object" && body !== null
      ? parseName((body as Record<string, unknown>).name)
      : null;

  if (name === null) {
    return NextResponse.json(
      { error: "name is required and must be 1–200 non-whitespace characters." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc(
    "update_profile_name_and_retry_analysis",
    { p_full_name: name }
  );

  if (error) {
    if (error.message.includes("Not authenticated")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (
      error.message.includes("cannot be empty") ||
      error.message.includes("must not exceed")
    ) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error(
      "update_profile_name_and_retry_analysis RPC error:",
      error.code,
      error.message
    );
    return NextResponse.json(
      { error: "Could not update your name. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}
