-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "billMonth" TEXT NOT NULL,
    "occupiedDays" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bill_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Bill" ("amount", "applicationId", "billMonth", "code", "createdAt", "id", "paidAt", "status", "updatedAt") SELECT "amount", "applicationId", "billMonth", "code", "createdAt", "id", "paidAt", "status", "updatedAt" FROM "Bill";
DROP TABLE "Bill";
ALTER TABLE "new_Bill" RENAME TO "Bill";
CREATE UNIQUE INDEX "Bill_code_key" ON "Bill"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
