/*
  Warnings:

  - You are about to drop the column `attachments` on the `Expense` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "attachments",
ADD COLUMN     "attachmentUrl" TEXT;
