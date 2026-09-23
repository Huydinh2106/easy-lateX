import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { firebaseUid: "development-user" },
    update: {},
    create: {
      firebaseUid: "development-user",
      email: "developer@easy-latex.local",
      emailVerified: true,
      displayName: "Development User",
      authProvider: "development"
    }
  });
}

void main().finally(() => prisma.$disconnect());
