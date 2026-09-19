import { PrismaClient } from '@prisma/client'

// This app's own database only (DATABASE_URL). Never FlashManager's DB.
const g = globalThis as unknown as { prisma?: PrismaClient }
export const prisma = g.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') g.prisma = prisma
