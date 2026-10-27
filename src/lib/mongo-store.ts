import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  Decimal128, MongoClient, MongoError, MongoServerError,
  type ClientSession, type Db, type Filter, type IndexDescription, type Sort, type UpdateFilter,
} from "mongodb";
import bcrypt from "bcryptjs";
import { ADMIN_USER_ID, BCRYPT_ROUNDS, bootstrapAdminCredentials } from "./auth/admin";

type Row = Record<string, unknown>;
interface MongoRow extends Row { _id: string }
type Model = (typeof Prisma.dmmf.datamodel.models)[number];
type Field = Model["fields"][number];
interface Connection { client: MongoClient; db: Db }
interface Transaction { session: ClientSession; queue: Promise<unknown>; failure?: unknown }

const models = Prisma.dmmf.datamodel.models;
const modelMap = new Map(models.map((model) => [model.name, model]));
const transactions = new AsyncLocalStorage<Transaction>();
const globalMongo = globalThis as typeof globalThis & { mncMongo?: { url: string; promise: Promise<Connection> } };

export class DatabaseError extends Error {
  readonly code = "MONGODB_STORAGE";
}

export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && "code" in error && error.code === "MONGODB_STORAGE";
}

export function databaseFailure(error: MongoError): Error {
  if (error instanceof MongoServerError && error.code === 11000) {
    return new Prisma.PrismaClientKnownRequestError("A record with these details already exists.", {
      code: "P2002", clientVersion: Prisma.prismaVersion.client,
    });
  }
  console.error("[mongodb]", error.name, error instanceof MongoServerError ? error.code : "");
  if (error instanceof MongoServerError && error.code === 18) return new DatabaseError("MongoDB authentication failed. Check DATABASE_URL credentials and authSource.");
  if (error instanceof MongoServerError && error.code === 20) {
    return new DatabaseError("MongoDB must be a replica set or Atlas cluster to save multi-record changes safely. Check DATABASE_URL.");
  }
  if (error instanceof MongoServerError && (error.code === 112 || error.code === 251)) {
    return new DatabaseError("The transaction could not complete or another request changed these records. Refresh and retry your save.");
  }
  return new DatabaseError("Cannot access MongoDB. Check DATABASE_URL, server availability, Atlas network access, and TLS settings. No Google credentials are required.");
}

function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a repository query object.");
  return value as Row;
}

const collectionName = (model: Model) => model.dbName ?? model.name;
const primaryKey = (model: Model) => model.fields.find((field) => field.isId)!.name;
const scalars = (model: Model) => model.fields.filter((field) => field.kind !== "object");

function normalize(field: Field, value: unknown): unknown {
  if (value === null) return null;
  switch (field.type) {
    case "Decimal": return new Prisma.Decimal(String(value));
    case "DateTime": {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field.name} date.`);
      return date;
    }
    case "Json": return JSON.parse(JSON.stringify(value));
    default: return value;
  }
}

function encode(field: Field, value: unknown): unknown {
  if (value === null) return null;
  const normalized = normalize(field, value);
  return field.type === "Decimal" ? Decimal128.fromString(String(normalized)) : normalized;
}

function hydrate(model: Model, document: Row): Row {
  return Object.fromEntries(scalars(model).map((field) => [field.name, document[field.name] == null ? null : normalize(field, document[field.name])]));
}

function newRecord(model: Model, data: Row): Row {
  for (const key of Object.keys(data)) {
    if (!scalars(model).some((field) => field.name === key)) throw new Error(`Unsupported create field ${model.name}.${key}.`);
  }
  return Object.fromEntries(scalars(model).map((field) => {
    let value = data[field.name];
    if (value === undefined) {
      const fallback = field.default;
      if (field.hasDefaultValue) value = fallback && typeof fallback === "object" && "name" in fallback
        ? fallback.name === "now" ? new Date() : randomUUID() : fallback;
      else if (field.isUpdatedAt) value = new Date();
      else if (!field.isRequired) value = null;
      else throw new Error(`Missing required ${model.name}.${field.name}.`);
    }
    return [field.name, normalize(field, value)];
  }));
}

function documentFor(model: Model, row: Row): MongoRow {
  return {
    _id: String(row[primaryKey(model)]),
    ...Object.fromEntries(scalars(model).map((field) => [field.name, encode(field, row[field.name])])),
  };
}

async function initialize(client: MongoClient): Promise<Connection> {
  const db = client.db();
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") {
    throw new DatabaseError("The MongoDB server is standalone. Use a replica-set or Atlas DATABASE_URL so multi-record saves can be transactional.");
  }
  for (const model of models) {
    const unique = [...model.fields.filter((field) => field.isId || field.isUnique).map((field) => [field.name]), ...model.uniqueFields];
    const indexes: IndexDescription[] = unique.map((fields) => {
      const optional = fields.filter((name) => !model.fields.find((field) => field.name === name)!.isRequired);
      return {
        key: Object.fromEntries(fields.map((name) => [name, 1])),
        unique: true,
        ...(optional.length ? { partialFilterExpression: Object.fromEntries(optional.map((name) => [name, { $type: "string" }])) } : {}),
      };
    });
    if (!indexes.length) indexes.push({ key: { [primaryKey(model)]: 1 }, unique: true });
    await db.collection(collectionName(model)).createIndexes(indexes);
  }
  for (const [name, key] of [
    ["AchievementEntry", { date: 1, employeeId: 1 }],
    ["Lead", { leadDate: 1, creditedEmployeeId: 1 }],
    ["TeamMembership", { employeeId: 1, startDate: 1 }],
    ["AuditLog", { createdAt: -1 }],
  ] as const) await db.collection(collectionName(modelMap.get(name)!)).createIndex(key);

  // Administrator account: created once from the initial .env credentials (bcrypt-hashed). An existing
  // password hash is never overwritten, so a password changed in the app stays in effect.
  const userModel = modelMap.get("User")!;
  const users = db.collection<MongoRow>(collectionName(userModel));
  const initial = bootstrapAdminCredentials();
  const admin = await users.findOne({ _id: ADMIN_USER_ID });
  if (!admin) {
    const passwordHash = initial.password ? await bcrypt.hash(initial.password, BCRYPT_ROUNDS) : "";
    const row = newRecord(userModel, { id: ADMIN_USER_ID, email: initial.email, role: "SUPER_ADMIN", passwordHash, active: true, passwordChangedAt: initial.password ? new Date() : null });
    await users.insertOne(documentFor(userModel, row));
  } else if (!admin.passwordHash && initial.password) {
    await users.updateOne({ _id: ADMIN_USER_ID }, { $set: { passwordHash: await bcrypt.hash(initial.password, BCRYPT_ROUNDS), passwordChangedAt: new Date(), updatedAt: new Date() } });
  }
  const categoryModel = modelMap.get("AchievementCategory")!;
  const categories = [
    ["SALE_CLOSED", "Sale closed / invoiced", true], ["PAYMENT_RECEIVED", "Payment received", true],
    ["ORDER_CONFIRMED", "Order confirmed (PO received)", true], ["RENEWAL", "Renewal / repeat business", true],
    ["QUOTATION", "Quotation sent (not counted)", false], ["PROJECTED", "Projected sale (not counted)", false],
  ] as const;
  for (const [index, [code, name, countsTowardTarget]] of categories.entries()) {
    const row = newRecord(categoryModel, { id: `category-${code}`, code, name, countsTowardTarget, sortOrder: index });
    await db.collection<MongoRow>(collectionName(categoryModel)).updateOne({ code }, { $setOnInsert: documentFor(categoryModel, row) }, { upsert: true });
  }
  return { client, db };
}

export async function getMongoConnection(): Promise<Connection> {
  const url = process.env.DATABASE_URL;
  if (!url || !/^mongodb(?:\+srv)?:\/\//.test(url)) throw new DatabaseError("Set DATABASE_URL in .env to a MongoDB replica-set or Atlas connection string.");
  if (!url.slice(url.indexOf("://") + 3).split("?")[0].split("/")[1]) {
    throw new DatabaseError("DATABASE_URL must include a database name after the hostname.");
  }
  if (!globalMongo.mncMongo || globalMongo.mncMongo.url !== url) {
    let client: MongoClient;
    try { client = new MongoClient(url, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000 }); }
    catch (error) {
      if (error instanceof MongoError) throw databaseFailure(error);
      throw new DatabaseError("DATABASE_URL contains invalid MongoDB connection options.");
    }
    const entry = { url, promise: client.connect().then(() => initialize(client)) };
    globalMongo.mncMongo = entry;
    entry.promise = entry.promise.catch(async (error: unknown) => {
      await client.close();
      if (globalMongo.mncMongo === entry) delete globalMongo.mncMongo;
      if (error instanceof MongoError) throw databaseFailure(error);
      throw error;
    });
  }
  return globalMongo.mncMongo.promise;
}

async function query<T>(fn: (db: Db, session?: ClientSession) => Promise<T>): Promise<T> {
  const { db } = await getMongoConnection();
  const tx = transactions.getStore();
  const perform = async () => {
    if (tx?.failure) throw tx.failure;
    try { return await fn(db, tx?.session); }
    catch (error) { if (error instanceof MongoError) throw databaseFailure(error); throw error; }
  };
  if (!tx) return perform();
  const next = tx.queue.then(perform, perform);
  tx.queue = next.then(() => undefined, (error: unknown) => { tx.failure = error; });
  return next;
}

function relation(model: Model, field: Field) {
  const target = modelMap.get(field.type)!;
  if (field.relationFromFields?.length) {
    return { target, local: field.relationFromFields[0], foreign: field.relationToFields![0] };
  }
  const reverse = target.fields.find((candidate) => candidate.kind === "object" && candidate.relationName === field.relationName && candidate.relationFromFields?.length);
  if (!reverse) throw new Error(`Unsupported relation ${model.name}.${field.name}.`);
  return { target, local: reverse.relationToFields![0], foreign: reverse.relationFromFields![0] };
}

function scalarFilter(field: Field, value: unknown): unknown {
  if (value === null || typeof value !== "object" || value instanceof Date || Prisma.Decimal.isDecimal(value)) return encode(field, value);
  const input = object(value);
  const output: Row = {};
  for (const [operator, operand] of Object.entries(input)) {
    if (operand === undefined || operator === "mode") continue;
    switch (operator) {
      case "equals": output.$eq = encode(field, operand); break;
      case "in":
      case "notIn":
        if (!Array.isArray(operand)) throw new Error("Invalid list filter.");
        output[operator === "in" ? "$in" : "$nin"] = operand.map((v) => encode(field, v));
        break;
      case "not":
        if (operand && typeof operand === "object" && !(operand instanceof Date) && !Prisma.Decimal.isDecimal(operand)) output.$not = scalarFilter(field, operand);
        else output.$ne = encode(field, operand);
        break;
      case "lt": case "lte": case "gt": case "gte": output[`$${operator}`] = encode(field, operand); break;
      case "contains": case "startsWith": case "endsWith": {
        const escaped = String(operand).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output.$regex = `${operator === "startsWith" ? "^" : ""}${escaped}${operator === "endsWith" ? "$" : ""}`;
        if (input.mode === "insensitive") output.$options = "i";
        break;
      }
      default: throw new Error(`Unsupported filter ${operator}.`);
    }
  }
  return output;
}

async function filterFor(model: Model, where: Row = {}): Promise<Filter<MongoRow>> {
  const clauses: Filter<MongoRow>[] = [];
  for (const [name, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (name === "AND" || name === "OR" || name === "NOT") {
      const children: Filter<MongoRow>[] = [];
      for (const child of Array.isArray(value) ? value : [value]) children.push(await filterFor(model, object(child)));
      if (!children.length) { if (name === "OR") clauses.push({ _id: { $in: [] } }); continue; }
      clauses.push({ [name === "AND" ? "$and" : name === "OR" ? "$or" : "$nor"]: children });
      continue;
    }
    const field = model.fields.find((candidate) => candidate.name === name);
    if (!field) {
      if (!model.uniqueFields.some((fields) => fields.join("_") === name)) throw new Error(`Unknown filter ${model.name}.${name}.`);
      clauses.push(await filterFor(model, object(value)));
    } else if (field.kind !== "object") {
      clauses.push({ [name]: scalarFilter(field, value) });
    } else {
      const { target, local, foreign } = relation(model, field);
      const relationInput = value === null ? { is: null } : object(value);
      const operators = Object.keys(relationInput).some((key) => ["some", "none", "every", "is"].includes(key)) ? relationInput : { is: relationInput };
      for (const [operator, input] of Object.entries(operators)) {
        const isNull = input === null;
        const negative = operator === "none" || operator === "every" || isNull;
        const targetFilter = await filterFor(target, isNull ? {} : operator === "every" ? { NOT: input } : object(input));
        const documents = await query((db, session) => db.collection<MongoRow>(collectionName(target)).find(targetFilter, { session, projection: { [foreign]: 1 } }).toArray());
        const ids = documents.map((document) => document[foreign]).filter((id) => id != null);
        clauses.push({ [local]: { [negative ? "$nin" : "$in"]: ids } });
      }
    }
  }
  return clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0] : { $and: clauses };
}

async function relatedRows(model: Model, row: Row, field: Field, args: Row): Promise<Row[]> {
  const { target, local, foreign } = relation(model, field);
  if (row[local] == null) return [];
  return findRows(target, { ...args, where: { AND: [args.where ?? {}, { [foreign]: row[local] }] } });
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (Prisma.Decimal.isDecimal(a)) return a.comparedTo(String(b));
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Loads a relation for many parent rows with ONE query ($in on the join key) instead of one query per row,
 * then groups the results back by parent. Per-parent skip/take are applied after grouping so results match
 * the per-row semantics exactly.
 */
async function relatedGroups(model: Model, rows: Row[], field: Field, args: Row): Promise<(row: Row) => Row[]> {
  const { target, local, foreign } = relation(model, field);
  const keys = [...new Set(rows.map((row) => row[local]).filter((value) => value != null))];
  if (!keys.length) return () => [];
  const { take, skip, ...rest } = args;
  const related = await findRows(target, { ...rest, where: { AND: [args.where ?? {}, { [foreign]: { in: keys } }] } });
  const byKey = new Map<string, Row[]>();
  for (const item of related) {
    const key = String(item[foreign]);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  const from = Number(skip ?? 0);
  return (row) => {
    if (row[local] == null) return [];
    const list = byKey.get(String(row[local])) ?? [];
    return from || take !== undefined ? list.slice(from, take === undefined ? undefined : from + Number(take)) : list;
  };
}

type OrderCache = Map<string, (row: Row) => Row[]>;

async function orderKeys(model: Model, row: Row, order: Row, cache?: OrderCache): Promise<Array<{ value: unknown; direction: unknown; nulls: unknown }>> {
  const keys: Array<{ value: unknown; direction: unknown; nulls: unknown }> = [];
  for (const [name, spec] of Object.entries(order)) {
    const field = model.fields.find((candidate) => candidate.name === name)!;
    if (!field) throw new Error(`Unknown sort field ${model.name}.${name}.`);
    if (field.kind === "object") {
      const related = cache?.get(name)?.(row) ?? (await relatedRows(model, row, field, {}));
      keys.push(...await orderKeys(modelMap.get(field.type)!, related[0] ?? {}, object(spec)));
    } else {
      const config = typeof spec === "string" ? { sort: spec } : object(spec);
      keys.push({ value: row[name], direction: config.sort, nulls: config.nulls ?? (config.sort === "asc" ? "last" : "first") });
    }
  }
  return keys;
}

async function findRows(model: Model, args: Row): Promise<Row[]> {
  const filter = await filterFor(model, args.where ? object(args.where) : {});
  const orders = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]).map(object) : [];
  const simple = !args.distinct && orders.every((order) => Object.entries(order).every(([name, direction]) =>
    typeof direction === "string" && model.fields.some((field) => field.name === name && field.kind !== "object" && field.isRequired)));
  let documents = await query(async (db, session) => {
    let cursor = db.collection<MongoRow>(collectionName(model)).find(filter, { session });
    if (simple) {
      const sort: Sort = Object.fromEntries(orders.flatMap((order) => Object.entries(order).map(([key, direction]) => [key, direction === "desc" ? -1 : 1])));
      if (orders.length) cursor = cursor.sort(sort);
      if (args.skip) cursor = cursor.skip(Number(args.skip));
      if (args.take !== undefined) cursor = cursor.limit(Number(args.take));
    }
    return cursor.toArray();
  });
  if (args.take === 0) return [];
  let rows = documents.map((document) => hydrate(model, document));
  if (simple) return rows;
  if (orders.length) {
    // Sorting by a related field (e.g. employee.name): load that relation once for all rows.
    const cache: OrderCache = new Map();
    for (const order of orders) {
      for (const name of Object.keys(order)) {
        const field = model.fields.find((candidate) => candidate.name === name);
        if (field?.kind === "object" && !cache.has(name)) cache.set(name, await relatedGroups(model, rows, field, {}));
      }
    }
    const decorated = [];
    for (const row of rows) {
      const keys = [];
      for (const order of orders) keys.push(...await orderKeys(model, row, order, cache));
      decorated.push({ row, keys });
    }
    decorated.sort((a, b) => {
      for (let i = 0; i < a.keys.length; i++) {
        const x = a.keys[i], y = b.keys[i];
        if (x.value == null || y.value == null) {
          if (x.value == null && y.value == null) continue;
          return x.value == null ? x.nulls === "first" ? -1 : 1 : x.nulls === "first" ? 1 : -1;
        }
        const difference = compare(x.value, y.value);
        if (difference) return x.direction === "desc" ? -difference : difference;
      }
      return 0;
    });
    rows = decorated.map(({ row }) => row);
  }
  if (args.distinct) {
    const fields = Array.isArray(args.distinct) ? args.distinct : [args.distinct];
    const seen = new Set<string>();
    rows = rows.filter((row) => {
      const key = JSON.stringify(fields.map((field) => row[String(field)]));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const skip = Number(args.skip ?? 0);
  return rows.slice(skip, args.take === undefined ? undefined : skip + Number(args.take));
}

async function project(model: Model, row: Row, args: Row): Promise<Row> {
  return (await projectMany(model, [row], args))[0];
}

/** Applies select/include to many rows, loading each relation with one batched query per level. */
async function projectMany(model: Model, rows: Row[], args: Row): Promise<Row[]> {
  if (!rows.length) return [];
  const selection = args.select ? object(args.select) : null;
  const fields = selection ?? (args.include ? object(args.include) : {});
  const results: Row[] = rows.map((row) => (selection ? {} : { ...row }));
  for (const [name, spec] of Object.entries(fields)) {
    if (!spec) continue;
    if (name === "_count") {
      const counts: Row[] = rows.map(() => ({}));
      const wanted = spec === true ? Object.fromEntries(model.fields.filter((field) => field.isList).map((field) => [field.name, true])) : object(object(spec).select);
      for (const [key, config] of Object.entries(wanted)) {
        if (!config) continue;
        const groups = await relatedGroups(model, rows, model.fields.find((field) => field.name === key)!, config === true ? {} : object(config));
        rows.forEach((row, i) => (counts[i][key] = groups(row).length));
      }
      results.forEach((result, i) => (result[name] = counts[i]));
      continue;
    }
    const field = model.fields.find((candidate) => candidate.name === name);
    if (!field) throw new Error(`Unknown selection ${model.name}.${name}.`);
    if (field.kind !== "object") {
      rows.forEach((row, i) => (results[i][name] = row[name]));
      continue;
    }
    const nested = spec === true ? {} : object(spec);
    const groups = await relatedGroups(model, rows, field, nested);
    const relatedLists = rows.map((row) => groups(row));
    // Project every related row once (a row shared by several parents is the same object).
    const unique = [...new Set(relatedLists.flat())];
    const projected = await projectMany(modelMap.get(field.type)!, unique, nested);
    const byRow = new Map(unique.map((item, i) => [item, projected[i]]));
    relatedLists.forEach((items, i) => {
      const values = items.map((item) => byRow.get(item)!);
      results[i][name] = field.isList ? values : values[0] ?? null;
    });
  }
  return results;
}

async function validateRelations(model: Model, row: Row) {
  for (const field of model.fields.filter((candidate) => candidate.kind === "object" && candidate.relationFromFields?.length)) {
    const { target, local, foreign } = relation(model, field);
    if (row[local] == null) continue;
    const filter = await filterFor(target, { [foreign]: row[local] });
    const exists = await query((db, session) => db.collection<MongoRow>(collectionName(target)).findOne(filter, { session, projection: { _id: 1 } }));
    if (!exists) throw new DatabaseError(`The selected ${field.name} no longer exists. Refresh and try again.`);
  }
}

async function aggregate(model: Model, args: Row, by: string[] = []): Promise<Row[]> {
  const filter = await filterFor(model, args.where ? object(args.where) : {});
  const group: Row = { _id: by.length ? Object.fromEntries(by.map((key) => [key, `$${key}`])) : null, count_all: { $sum: 1 } };
  const sums = args._sum ? Object.keys(object(args._sum)) : [];
  const counts = args._count && args._count !== true ? Object.keys(object(args._count)).filter((key) => key !== "_all") : [];
  for (const key of sums) {
    group[`sum_${key}`] = { $sum: `$${key}` };
    group[`present_${key}`] = { $sum: { $cond: [{ $ne: [{ $ifNull: [`$${key}`, null] }, null] }, 1, 0] } };
  }
  for (const key of counts) group[`count_${key}`] = { $sum: { $cond: [{ $ne: [{ $ifNull: [`$${key}`, null] }, null] }, 1, 0] } };
  const groups = await query((db, session) => db.collection<MongoRow>(collectionName(model)).aggregate<Row>([{ $match: filter }, { $group: group }], { session }).toArray());
  if (!groups.length && !by.length) groups.push({ _id: null, count_all: 0 });
  return groups.map((data) => {
    const result: Row = by.length ? hydrateSelection(model, object(data._id), by) : {};
    if (args._count) result._count = args._count === true ? data.count_all : {
      ...(object(args._count)._all ? { _all: data.count_all } : {}),
      ...Object.fromEntries(counts.map((key) => [key, data[`count_${key}`] ?? 0])),
    };
    if (args._sum) result._sum = Object.fromEntries(sums.map((key) => [key, Number(data[`present_${key}`] ?? 0) ? normalize(model.fields.find((field) => field.name === key)!, data[`sum_${key}`]) : null]));
    return result;
  });
}

function hydrateSelection(model: Model, row: Row, fields: string[]): Row {
  return Object.fromEntries(fields.map((name) => [name, normalize(model.fields.find((field) => field.name === name)!, row[name])]));
}

const notFound = () => { throw new Prisma.PrismaClientKnownRequestError("Record not found.", { code: "P2025", clientVersion: Prisma.prismaVersion.client }); };

async function execute(model: Model, method: string, args: Row): Promise<unknown> {
  if (method === "count") {
    const filter = await filterFor(model, args.where ? object(args.where) : {});
    return query((db, session) => db.collection<MongoRow>(collectionName(model)).countDocuments(filter, { session }));
  }
  if (method === "groupBy") return aggregate(model, args, args.by as string[]);
  if (method === "aggregate") return (await aggregate(model, args))[0];
  if (["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow"].includes(method)) {
    const rows = await findRows(model, method === "findMany" ? args : { ...args, take: 1 });
    if (method !== "findMany") {
      if (!rows.length && method.endsWith("OrThrow")) return notFound();
      return rows[0] ? project(model, rows[0], args) : null;
    }
    return projectMany(model, rows, args);
  }
  // Only the administrator account exists; it can be updated (password, last login) but not created or removed here.
  if (model.name === "User" && !["update", "updateMany"].includes(method)) throw new DatabaseError("Employee login accounts are not enabled.");
  if (method === "create") {
    const row = newRecord(model, object(args.data));
    await validateRelations(model, row);
    await query((db, session) => db.collection<MongoRow>(collectionName(model)).insertOne(documentFor(model, row), { session }));
    return project(model, row, args);
  }
  if (method === "createMany") {
    const input = Array.isArray(args.data) ? args.data : [args.data];
    for (const data of input) await execute(model, "create", { data });
    return { count: input.length };
  }
  const filter = await filterFor(model, args.where ? object(args.where) : {});
  if (method === "upsert") {
    const existing = await findRows(model, { where: args.where, take: 1 });
    return execute(model, existing.length ? "update" : "create", { ...args, data: existing.length ? args.update : args.create });
  }
  if (method === "update" || method === "updateMany") {
    const data = object(args.data);
    const update: UpdateFilter<MongoRow> = {};
    const sets: Row = {};
    const increments: Record<string, number | Decimal128> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const field = scalars(model).find((candidate) => candidate.name === key);
      if (!field) throw new Error(`Unsupported update field ${model.name}.${key}.`);
      if (value && typeof value === "object" && !(value instanceof Date) && !Prisma.Decimal.isDecimal(value) && field.type !== "Json") {
        const operation = object(value);
        if ("increment" in operation) {
          if (!["Int", "Float", "Decimal"].includes(field.type)) throw new Error(`Cannot increment non-numeric field ${key}.`);
          const amount = field.type === "Decimal" ? Decimal128.fromString(String(operation.increment)) : Number(operation.increment);
          if (typeof amount === "number" && !Number.isFinite(amount)) throw new Error(`Invalid increment for ${key}.`);
          increments[key] = amount;
        }
        else if ("set" in operation) sets[key] = encode(field, operation.set);
        else throw new Error(`Unsupported update operation on ${key}.`);
      } else sets[key] = encode(field, value);
    }
    const changes = Object.keys(sets).length || Object.keys(increments).length;
    if (changes) {
      for (const field of scalars(model).filter((candidate) => candidate.isUpdatedAt)) sets[field.name] = new Date();
      if (Object.keys(sets).length) update.$set = sets;
      // Numeric fields are validated against model metadata; the driver cannot infer dynamic field types.
      if (Object.keys(increments).length) update.$inc = increments as UpdateFilter<MongoRow>["$inc"];
      await validateRelations(model, hydrateSelection(model, sets, Object.keys(sets)));
    }
    if (method === "updateMany") {
      if (!changes) return { count: await query((db, session) => db.collection<MongoRow>(collectionName(model)).countDocuments(filter, { session })) };
      const result = await query((db, session) => db.collection<MongoRow>(collectionName(model)).updateMany(filter, update, { session }));
      return { count: result.matchedCount };
    }
    const result = changes
      ? await query((db, session) => db.collection<MongoRow>(collectionName(model)).findOneAndUpdate(filter, update, { session, returnDocument: "after" }))
      : await query((db, session) => db.collection<MongoRow>(collectionName(model)).findOne(filter, { session }));
    return result ? project(model, hydrate(model, result), args) : notFound();
  }
  if (method === "delete") {
    const result = await query((db, session) => db.collection<MongoRow>(collectionName(model)).findOneAndDelete(filter, { session }));
    return result ? project(model, hydrate(model, result), args) : notFound();
  }
  if (method === "deleteMany") {
    const result = await query((db, session) => db.collection<MongoRow>(collectionName(model)).deleteMany(filter, { session }));
    return { count: result.deletedCount };
  }
  throw new Error(`Unsupported repository method ${model.name}.${method}.`);
}

export async function mongoTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (transactions.getStore()) return fn(mongoRepository);
  const { client } = await getMongoConnection();
  const session = client.startSession();
  const tx: Transaction = { session, queue: Promise.resolve() };
  try {
    session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    const result = await transactions.run(tx, () => fn(mongoRepository));
    await tx.queue;
    if (tx.failure) throw tx.failure;
    await session.commitTransaction();
    return result;
  } catch (error) {
    await tx.queue;
    if (session.inTransaction()) {
      try { await session.abortTransaction(); }
      catch (abortError) {
        console.error("[mongodb] transaction abort failed", abortError instanceof Error ? abortError.name : "UnknownError");
      }
    }
    if (error instanceof MongoError) throw databaseFailure(error);
    throw error;
  } finally {
    await session.endSession();
  }
}

// Preserve existing model/query types while executing native MongoDB operations.
// Prisma supplies generated types and Decimal arithmetic only; no SQL client is constructed.
export const mongoRepository = new Proxy({} as PrismaClient, {
  get(_target, key) {
    if (key === "$transaction") return mongoTransaction;
    const model = models.find((candidate) => candidate.name[0].toLowerCase() + candidate.name.slice(1) === key);
    if (!model) throw new Error(`Unsupported repository property ${String(key)}.`);
    return new Proxy({}, { get: (_delegate, method) => (args: Row = {}) => execute(model, String(method), args) });
  },
});
