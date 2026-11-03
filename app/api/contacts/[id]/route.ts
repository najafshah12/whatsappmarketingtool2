import { NextResponse } from "next/server"; import { prisma } from "@/lib/prisma"; import { apiError } from "@/lib/api"; import { z } from "zod";
const schema=z.object({name:z.string().trim().min(1).max(100).optional(),phone:z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).optional(),email:z.string().email().or(z.literal("")).nullable().optional(),groupName:z.string().max(100).nullable().optional(),tags:z.array(z.string().max(40)).max(20).optional(),optedOut:z.boolean().optional(),marketingOptIn:z.boolean().optional()});
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const data=schema.parse(await req.json());
    if(data.optedOut===true){data.marketingOptIn=false;}
    const update:Record<string,unknown>={...data,email:data.email===""?null:data.email};
    if(data.marketingOptIn===true){update.marketingOptInAt=new Date();update.marketingOptInSource="admin-confirmed-update";update.optedOut=false;}
    if(data.marketingOptIn===false){update.marketingOptInAt=null;update.marketingOptInSource=null;}
    if(data.optedOut===true){update.marketingOptInAt=null;update.marketingOptInSource=null;}
    const contact=await prisma.contact.update({where:{id},data:update});
    await prisma.auditLog.create({data:{action:data.optedOut===true?"contact.opted_out":"contact.updated",entity:"contact",entityId:id,detail:{marketingOptIn:contact.marketingOptIn,optedOut:contact.optedOut}}});
    return NextResponse.json(contact);
  }catch(e){if(e instanceof z.ZodError)return NextResponse.json({error:e.issues[0]?.message},{status:400});return apiError(e)}
}
export async function DELETE(_:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;await prisma.contact.delete({where:{id}});return NextResponse.json({ok:true})}catch(e){return apiError(e)}}
