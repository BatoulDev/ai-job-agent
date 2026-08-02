import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

// This project's Next.js renames the "middleware" file convention to
// "proxy" (see node_modules/next/dist/docs/.../file-conventions/proxy.md).
// The exported function must be named `proxy`, not `middleware`.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
