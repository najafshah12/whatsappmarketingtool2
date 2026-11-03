import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown server error occurred.";
  console.error("API error details:", error);
  return NextResponse.json(
    { error: message || "The request could not be completed. Check database configuration." },
    { status: 503 }
  );
}

