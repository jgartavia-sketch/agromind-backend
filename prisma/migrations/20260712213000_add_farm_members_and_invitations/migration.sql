-- CreateEnum
CREATE TYPE "FarmRole" AS ENUM ('ADMIN', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "FarmMemberStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FarmInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "FarmMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "role" "FarmRole" NOT NULL,
    "status" "FarmMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmInvitation" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "FarmRole" NOT NULL DEFAULT 'CONSULTANT',
    "status" "FarmInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FarmMember_userId_idx" ON "FarmMember"("userId");

-- CreateIndex
CREATE INDEX "FarmMember_farmId_idx" ON "FarmMember"("farmId");

-- CreateIndex
CREATE INDEX "FarmMember_farmId_role_idx" ON "FarmMember"("farmId", "role");

-- CreateIndex
CREATE INDEX "FarmMember_farmId_status_idx" ON "FarmMember"("farmId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FarmMember_userId_farmId_key" ON "FarmMember"("userId", "farmId");

-- CreateIndex
CREATE UNIQUE INDEX "FarmInvitation_token_key" ON "FarmInvitation"("token");

-- CreateIndex
CREATE INDEX "FarmInvitation_farmId_idx" ON "FarmInvitation"("farmId");

-- CreateIndex
CREATE INDEX "FarmInvitation_email_idx" ON "FarmInvitation"("email");

-- CreateIndex
CREATE INDEX "FarmInvitation_status_idx" ON "FarmInvitation"("status");

-- CreateIndex
CREATE INDEX "FarmInvitation_farmId_email_idx" ON "FarmInvitation"("farmId", "email");

-- CreateIndex
CREATE INDEX "FarmInvitation_invitedById_idx" ON "FarmInvitation"("invitedById");

-- AddForeignKey
ALTER TABLE "FarmMember" ADD CONSTRAINT "FarmMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmMember" ADD CONSTRAINT "FarmMember_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmInvitation" ADD CONSTRAINT "FarmInvitation_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmInvitation" ADD CONSTRAINT "FarmInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

