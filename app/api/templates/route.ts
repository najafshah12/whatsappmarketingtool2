import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { z } from "zod";

const buttonText = z.string().trim().min(1).max(25);
const buttonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: buttonText }),
  z.object({ type: z.literal("URL"), text: buttonText, url: z.string().trim().url().refine(value => value.startsWith("https://"), "Website button URLs must start with https://.") }),
  z.object({ type: z.literal("PHONE_NUMBER"), text: buttonText, phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Enter a phone number in international format, e.g. +14155550123.") }),
]);
const schema=z.object({name:z.string().trim().regex(/^[a-z0-9_]{1,512}$/,"Use lowercase letters, numbers, and underscores for the Meta template name."),body:z.string().trim().min(1).max(1024),language:z.string().trim().min(2).max(16).default("en_US"),category:z.enum(["marketing","utility","authentication"]).default("marketing"),buttons:z.array(buttonSchema).max(3).default([])}).superRefine((value, ctx) => {
  if (value.category === "authentication" && value.buttons.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["buttons"], message: "Custom buttons are available for marketing and utility templates, not authentication templates." });
  if (value.buttons.filter(button => button.type !== "QUICK_REPLY").length > 2) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["buttons"], message: "A template can have at most two call-to-action buttons." });
});
export async function GET(){try{return NextResponse.json(await prisma.template.findMany({orderBy:{createdAt:"desc"},include:{account:{select:{id:true,name:true,phone:true,status:true}}}}))}catch(e){return apiError(e)}}
export async function POST(req:Request){try{const d=schema.parse(await req.json());const { buttons, ...fields }=d;const template=await prisma.template.create({data:{...fields,buttons:buttons as Prisma.InputJsonValue,status:"draft"}});await prisma.auditLog.create({data:{action:"template.created",entity:"template",entityId:template.id}});return NextResponse.json(template,{status:201})}catch(e){if(e instanceof z.ZodError)return NextResponse.json({error:e.issues[0]?.message},{status:400});return apiError(e)}}

