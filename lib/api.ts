import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export function apiError(error: unknown) {
  console.error("API error details:", error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return NextResponse.json({ error: "The requested record was not found." }, { status: 404 });
    }
    if (error.code === "P2002") {
      return NextResponse.json({ error: "A record with these details already exists." }, { status: 409 });
    }
    if (error.code === "P2003") {
      return NextResponse.json({ error: "This record is still referenced by other data and cannot be changed." }, { status: 409 });
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError) {
    return NextResponse.json(
      { error: "Database connection failed. Check DATABASE_URL and the server configuration." },
      { status: 503 }
    );
  }

  const message = error instanceof Error ? error.message : "Unknown server error occurred.";
  return NextResponse.json(
    { error: message || "The request could not be completed. Check database configuration." },
    { status: 503 }
  );
}
