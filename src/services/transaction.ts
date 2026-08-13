import { Prisma } from "@prisma/client";

export async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, retries = 3): Promise<T> {
  const { prisma } = await import("../db.js");
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attempt < retries && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") continue;
      throw error;
    }
  }
}
