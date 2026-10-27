import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Decimal128, MongoClient, MongoServerError } from "mongodb";
import { Prisma } from "@prisma/client";
import { databaseFailure, getMongoConnection, isDatabaseError, mongoRepository as db } from "../src/lib/mongo-store";
import { buildPerformance } from "../src/lib/performance";
import { toDbDate } from "../src/lib/dates";

test("MongoDB errors are sanitized and duplicate keys preserve conflict behavior", () => {
  const duplicate = databaseFailure(new MongoServerError({ code: 11000, errmsg: "private data" }));
  assert.ok(duplicate instanceof Prisma.PrismaClientKnownRequestError);
  assert.equal(duplicate.code, "P2002");
  const unavailable = databaseFailure(new MongoServerError({ code: 18, errmsg: "mongodb://private:password@host" }));
  assert.ok(isDatabaseError(unavailable));
  assert.match(unavailable.message, /authentication/);
  assert.doesNotMatch(unavailable.message, /password@/);
  const crossBundle = Object.assign(new Error("database unavailable"), { code: "MONGODB_STORAGE" });
  assert.equal(isDatabaseError(crossBundle), true);
  assert.match(databaseFailure(new MongoServerError({ code: 251, errmsg: "expired transaction" })).message, /retry/);
  assert.match(databaseFailure(new MongoServerError({ code: 20, errmsg: "standalone" })).message, /replica set/);
});

test("replica-set seed-list URLs reach the MongoDB driver without WHATWG URL rejection", async () => {
  const previous = process.env.DATABASE_URL;
  const connect = mock.method(MongoClient.prototype, "connect", async () => {
    throw new MongoServerError({ code: 18, errmsg: "simulated authentication failure" });
  });
  try {
    process.env.DATABASE_URL = "mongodb://host-one:27017,host-two:27017/mnc_targets?replicaSet=test";
    await assert.rejects(getMongoConnection(), /authentication failed/);
    assert.equal(connect.mock.callCount(), 1);
    process.env.DATABASE_URL = "mongodb://host-one:27017/?replicaSet=test";
    await assert.rejects(getMongoConnection(), /database name/);
    assert.equal(connect.mock.callCount(), 1);
  } finally {
    connect.mock.restore();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("native MongoDB repository integration", { skip: !process.env.MONGODB_TEST_URL }, async (t) => {
  const previous = process.env.DATABASE_URL;
  const name = `mnc_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.MONGODB_TEST_URL!);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  let connection: Awaited<ReturnType<typeof getMongoConnection>> | undefined;
  try {
    connection = await getMongoConnection();
    assert.equal(connection.db.databaseName, name);
    const day = toDbDate("2024-02-29");
    const department = await db.department.create({ data: { name: "Integration department" } });
    const employee = await db.employee.create({ data: { code: "TEST01", name: "Alice [test]", departmentId: department.id } });
    const other = await db.employee.create({ data: { code: "TEST02", name: "Bob" } });
    const team = await db.team.create({ data: { name: "Integration team", departmentId: department.id, leaderId: employee.id } });
    await db.teamMembership.create({ data: { teamId: team.id, employeeId: employee.id, startDate: day } });
    const category = await db.achievementCategory.findUniqueOrThrow({ where: { code: "SALE_CLOSED" } });

    await t.test("bootstrap, defaults, dates, nullable unique indexes and duplicate keys", async () => {
      assert.equal(await db.achievementCategory.count(), 6);
      assert.equal(await db.user.count(), 1);
      assert.equal(employee.active, true);
      assert.equal(employee.phone, null);
      assert.ok(employee.createdAt instanceof Date);
      await assert.rejects(db.employee.create({ data: { code: "TEST01", name: "Duplicate" } }), { code: "P2002" });
      for (let i = 0; i < 2; i++) {
        await db.achievementEntry.create({ data: { date: day, employeeId: employee.id, teamId: team.id, categoryId: category.id, amount: i ? "0.20" : "0.10", countsTowardTarget: true } });
      }
      const stored = await connection!.db.collection("achievement_entries").findOne({});
      assert.ok(stored!.amount instanceof Decimal128);
      assert.ok(stored!.date instanceof Date);
      await db.achievementEntry.create({ data: { date: day, employeeId: employee.id, categoryId: category.id, amount: "1.00", countsTowardTarget: false, idempotencyKey: "test-key" } });
      await assert.rejects(db.achievementEntry.create({ data: { date: day, employeeId: employee.id, categoryId: category.id, amount: "1.00", countsTowardTarget: false, idempotencyKey: "test-key" } }), { code: "P2002" });
    });

    await t.test("relation filters, nested projections, counts, regex escaping and null sorting", async () => {
      const rows = await db.employee.findMany({
        where: { memberships: { some: { teamId: team.id } }, name: { contains: "[TEST]", mode: "insensitive" } },
        include: { department: true, memberships: { include: { team: true } }, _count: { select: { achievements: true } } },
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].department!.name, department.name);
      assert.equal(rows[0].memberships[0].team.name, team.name);
      assert.equal(rows[0]._count.achievements, 3);
      assert.deepEqual((await db.employee.findMany({ where: { memberships: { none: {} } } })).map((row) => row.id), [other.id]);
      assert.equal(await db.employee.count({ where: { department: { is: null } } }), 1);
      assert.equal(await db.employee.count({ where: { OR: [] } }), 0);
      assert.deepEqual(await db.employee.findMany({ take: 0 }), []);
      const selected = await db.employee.findMany({ select: { code: true }, orderBy: { code: "desc" }, skip: 1, take: 1 });
      assert.deepEqual(selected, [{ code: "TEST01" }]);
      const sorted = await db.employee.findMany({ orderBy: { department: { name: "asc" } } });
      assert.equal(sorted[0].id, employee.id);
      assert.equal(sorted[1].id, other.id);
    });

    await t.test("compound upserts and atomic increments preserve money precision", async () => {
      const allocation = await db.employeeTargetAllocation.upsert({
        where: { date_employeeId: { date: day, employeeId: employee.id } },
        create: { date: day, employeeId: employee.id, teamId: team.id, monetaryTarget: "100.30", leadTarget: 5 },
        update: { monetaryTarget: "200.30" },
      });
      assert.equal(allocation.monetaryTarget.toFixed(2), "100.30");
      const updated = await db.employeeTargetAllocation.upsert({
        where: { date_employeeId: { date: day, employeeId: employee.id } },
        create: { date: day, employeeId: employee.id, monetaryTarget: "0", leadTarget: 0 },
        update: { notes: "persisted" },
      });
      assert.equal(updated.id, allocation.id);
      assert.equal(updated.notes, "persisted");
      await Promise.all(Array.from({ length: 8 }, () => db.employeeTargetAllocation.update({ where: { id: allocation.id }, data: { leadTarget: { increment: 1 }, monetaryTarget: { increment: "0.10" } } })));
      const result = await db.employeeTargetAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
      assert.equal(result.leadTarget, 13);
      assert.equal(result.monetaryTarget.toFixed(2), "101.10");
      assert.equal(result.date.toISOString(), "2024-02-29T00:00:00.000Z");
    });

    await t.test("native Decimal128 group sums, counts and empty aggregate results", async () => {
      const grouped = await db.achievementEntry.groupBy({ by: ["date", "employeeId"], where: { countsTowardTarget: true }, _sum: { amount: true }, _count: { _all: true } });
      assert.equal(grouped.length, 1);
      assert.equal(grouped[0]._sum.amount!.toFixed(2), "0.30");
      assert.equal(grouped[0]._count._all, 2);
      assert.equal(grouped[0].date.toISOString(), day.toISOString());
      const empty = await db.achievementEntry.aggregate({ where: { employeeId: other.id }, _sum: { amount: true }, _count: true });
      assert.equal(empty._sum.amount, null);
      assert.equal(empty._count, 0);
    });

    await t.test("transactions commit business data and audit together and roll back failures", async () => {
      await db.$transaction(async (tx) => {
        await Promise.all([
          tx.employee.update({ where: { id: employee.id }, data: { designation: "Sales" } }),
          tx.employee.update({ where: { id: other.id }, data: { designation: "Support" } }),
        ]);
        await tx.auditLog.create({ data: { actorId: "static-admin", action: "TEST_COMMIT", entityType: "Employee", entityId: employee.id } });
      });
      assert.equal((await db.employee.findUniqueOrThrow({ where: { id: employee.id } })).designation, "Sales");
      assert.equal(await db.auditLog.count({ where: { action: "TEST_COMMIT" } }), 1);
      await assert.rejects(db.$transaction(async (tx) => {
        await tx.employee.update({ where: { id: employee.id }, data: { designation: "Should roll back" } });
        await tx.auditLog.create({ data: { action: "TEST_ROLLBACK", entityType: "Employee" } });
        throw new Error("rollback requested");
      }), /rollback requested/);
      assert.equal((await db.employee.findUniqueOrThrow({ where: { id: employee.id } })).designation, "Sales");
      assert.equal(await db.auditLog.count({ where: { action: "TEST_ROLLBACK" } }), 0);
      await assert.rejects(db.$transaction(async (tx) => {
        await Promise.all([
          tx.employee.create({ data: { code: "TEST01", name: "Duplicate" } }),
          tx.employee.create({ data: { code: "AFTER_FAILURE", name: "Must not persist" } }),
        ]);
      }));
      assert.equal(await db.employee.count({ where: { code: "AFTER_FAILURE" } }), 0);
    });

    await t.test("foreign key checks and missing-record errors remain explicit", async () => {
      await assert.rejects(db.employee.create({ data: { code: "BAD_FK", name: "Invalid department", departmentId: "missing" } }), /no longer exists/);
      await assert.rejects(db.employee.update({ where: { id: "missing" }, data: { name: "Missing" } }), { code: "P2025" });
      assert.equal(await db.employee.findUnique({ where: { id: "missing" } }), null);
    });

    await t.test("yearly performance is computed from stored records including leap day", async () => {
      const perf = await buildPerformance({ from: "2024-01-01", to: "2024-12-31", employeeIds: "ALL" });
      assert.equal(perf.byDate.length, 366);
      assert.equal(perf.totals.target, "101.10");
      assert.equal(perf.totals.achieved, "0.30");
      assert.equal(perf.totals.leadTarget, 13);
      assert.equal(perf.rows[0].employeeName, "Alice [test]");
      assert.equal(perf.rows[0].date, "2024-02-29");
    });

    await t.test("updates preserve unrelated fields and deleteMany returns actual count", async () => {
      await db.employee.updateMany({ where: { departmentId: null }, data: { designation: "Updated" } });
      const saved = await db.employee.findUniqueOrThrow({ where: { id: other.id } });
      assert.equal(saved.name, "Bob");
      assert.equal(saved.designation, "Updated");
      const removed = await db.achievementEntry.deleteMany({ where: { countsTowardTarget: false } });
      assert.equal(removed.count, 1);
    });
  } finally {
    if (connection) {
      assert.equal(connection.db.databaseName, name);
      await connection.db.dropDatabase();
      await connection.client.close();
    }
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
