-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('ALLOCATED', 'INDEPENDENT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'NEGOTIATION', 'CONVERTED', 'LOST', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "LeadValidation" AS ENUM ('VALID', 'PENDING_VALIDATION', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'FOLLOW_UP', 'STATUS_CHANGE', 'OWNER_CHANGE', 'CREDIT_CHANGE', 'MERGE', 'CREATED');

-- CreateEnum
CREATE TYPE "SubmissionScope" AS ENUM ('EMPLOYEE', 'TEAM', 'COMPANY');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'LOCKED', 'REOPENED');

-- CreateEnum
CREATE TYPE "SyncFrequency" AS ENUM ('MANUAL', 'HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "employeeId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedOn" DATE,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "leaderId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_target_plans" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "teamId" TEXT NOT NULL,
    "mode" "AllocationMode" NOT NULL DEFAULT 'ALLOCATED',
    "monetaryTarget" DECIMAL(14,2) NOT NULL,
    "leadTarget" INTEGER NOT NULL,
    "allowUnallocated" BOOLEAN NOT NULL DEFAULT false,
    "memberSnapshot" JSONB NOT NULL,
    "notes" TEXT,
    "assignedById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_target_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_target_allocations" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" TEXT NOT NULL,
    "teamId" TEXT,
    "teamPlanId" TEXT,
    "departmentId" TEXT,
    "monetaryTarget" DECIMAL(14,2) NOT NULL,
    "leadTarget" INTEGER NOT NULL,
    "notes" TEXT,
    "assignedById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_target_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countsTowardTarget" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "achievement_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_entries" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" TEXT NOT NULL,
    "teamId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "countsTowardTarget" BOOLEAN NOT NULL,
    "description" TEXT,
    "leadId" TEXT,
    "referenceNo" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "achievement_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyNameNorm" TEXT NOT NULL,
    "contactPerson" TEXT,
    "email" TEXT,
    "emailNorm" TEXT,
    "phone" TEXT NOT NULL,
    "phoneNorm" TEXT NOT NULL,
    "altPhone" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "source" TEXT,
    "estimatedValue" DECIMAL(14,2),
    "followUpDate" DATE,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "leadDate" DATE NOT NULL,
    "ownerId" TEXT NOT NULL,
    "teamId" TEXT,
    "creditedEmployeeId" TEXT NOT NULL,
    "creditedTeamId" TEXT,
    "validation" "LeadValidation" NOT NULL DEFAULT 'VALID',
    "countsTowardTarget" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" TEXT,
    "convertedValue" DECIMAL(14,2),
    "convertedAt" TIMESTAMP(3),
    "importBatch" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignments" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromEmployeeId" TEXT,
    "toEmployeeId" TEXT NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_submissions" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scope" "SubmissionScope" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "employeeId" TEXT,
    "teamId" TEXT,
    "status" "SubmissionStatus" NOT NULL,
    "remarks" TEXT,
    "managerRemarks" TEXT,
    "snapshot" JSONB,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_report_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_sheets_integrations" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "spreadsheetId" TEXT,
    "spreadsheetUrl" TEXT,
    "worksheetMap" JSONB,
    "frequency" "SyncFrequency" NOT NULL DEFAULT 'MANUAL',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncDaysBack" INTEGER NOT NULL DEFAULT 31,
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_sheets_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "categories" JSONB NOT NULL,
    "rangeFrom" DATE,
    "rangeTo" DATE,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryOfId" TEXT,
    "result" JSONB,
    "error" TEXT,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_code_key" ON "employees"("code");

-- CreateIndex
CREATE INDEX "employees_departmentId_idx" ON "employees"("departmentId");

-- CreateIndex
CREATE INDEX "employees_active_idx" ON "employees"("active");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE INDEX "teams_leaderId_idx" ON "teams"("leaderId");

-- CreateIndex
CREATE INDEX "team_memberships_teamId_startDate_idx" ON "team_memberships"("teamId", "startDate");

-- CreateIndex
CREATE INDEX "team_memberships_employeeId_startDate_idx" ON "team_memberships"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "team_target_plans_date_idx" ON "team_target_plans"("date");

-- CreateIndex
CREATE UNIQUE INDEX "team_target_plans_date_teamId_key" ON "team_target_plans"("date", "teamId");

-- CreateIndex
CREATE INDEX "employee_target_allocations_date_teamId_idx" ON "employee_target_allocations"("date", "teamId");

-- CreateIndex
CREATE INDEX "employee_target_allocations_employeeId_date_idx" ON "employee_target_allocations"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "employee_target_allocations_date_employeeId_key" ON "employee_target_allocations"("date", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_categories_code_key" ON "achievement_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_entries_idempotencyKey_key" ON "achievement_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "achievement_entries_date_employeeId_idx" ON "achievement_entries"("date", "employeeId");

-- CreateIndex
CREATE INDEX "achievement_entries_date_teamId_idx" ON "achievement_entries"("date", "teamId");

-- CreateIndex
CREATE INDEX "achievement_entries_leadId_idx" ON "achievement_entries"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_idempotencyKey_key" ON "leads"("idempotencyKey");

-- CreateIndex
CREATE INDEX "leads_leadDate_creditedEmployeeId_idx" ON "leads"("leadDate", "creditedEmployeeId");

-- CreateIndex
CREATE INDEX "leads_ownerId_idx" ON "leads"("ownerId");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_companyNameNorm_idx" ON "leads"("companyNameNorm");

-- CreateIndex
CREATE INDEX "leads_emailNorm_idx" ON "leads"("emailNorm");

-- CreateIndex
CREATE INDEX "leads_phoneNorm_idx" ON "leads"("phoneNorm");

-- CreateIndex
CREATE INDEX "lead_assignments_leadId_idx" ON "lead_assignments"("leadId");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_createdAt_idx" ON "lead_activities"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "daily_report_submissions_date_scope_idx" ON "daily_report_submissions"("date", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_submissions_date_scopeKey_key" ON "daily_report_submissions"("date", "scopeKey");

-- CreateIndex
CREATE INDEX "sync_jobs_status_createdAt_idx" ON "sync_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_target_plans" ADD CONSTRAINT "team_target_plans_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_target_allocations" ADD CONSTRAINT "employee_target_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_target_allocations" ADD CONSTRAINT "employee_target_allocations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_target_allocations" ADD CONSTRAINT "employee_target_allocations_teamPlanId_fkey" FOREIGN KEY ("teamPlanId") REFERENCES "team_target_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_entries" ADD CONSTRAINT "achievement_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_entries" ADD CONSTRAINT "achievement_entries_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_entries" ADD CONSTRAINT "achievement_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "achievement_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_entries" ADD CONSTRAINT "achievement_entries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_creditedEmployeeId_fkey" FOREIGN KEY ("creditedEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_submissions" ADD CONSTRAINT "daily_report_submissions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_submissions" ADD CONSTRAINT "daily_report_submissions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
