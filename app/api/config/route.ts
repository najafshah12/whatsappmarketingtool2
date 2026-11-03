import { NextResponse } from "next/server";
export async function GET(){const configured=Boolean(process.env.WA_ACCESS_TOKEN&&process.env.WA_PHONE_NUMBER_ID&&process.env.WA_BUSINESS_ACCOUNT_ID);return NextResponse.json({configured});}
