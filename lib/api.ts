import { NextResponse } from "next/server";
export function apiError(error: unknown) {
  console.error("API error", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: "The request could not be completed. Check the database and server configuration." }, { status: 503 });
}
