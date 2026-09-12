// In-memory database for isolated verification tests. No Prisma/database connection.
export function verificationTestDatabase() {
  let rows: Record<string, Map<string, any>> = { challenges: new Map(), passwordResets: new Map(), buckets: new Map(), users: new Map(), sessions: new Map() };
  const matches = (row: any, where: any): boolean => Object.entries(where || {}).every(([key, value]: [string, any]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("not" in value && row[key] === value.not) return false;
      if ("gt" in value && !(row[key] > value.gt)) return false;
      if ("lt" in value && !(row[key] < value.lt)) return false;
      if ("in" in value && !value.in.includes(row[key])) return false;
      return true;
    }
    return row[key] === value;
  });
  const apply = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data) as [string, any][]) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
    return structuredClone(row);
  };
  const model = (table: string) => ({
    findUnique: async ({ where }: any) => structuredClone([...rows[table].values()].find(r => matches(r, where)) || null),
    findMany: async ({ where, take = Infinity }: any) => structuredClone([...rows[table].values()].filter(r => matches(r, where)).slice(0, take)),
    create: async ({ data }: any) => {
      if (table === "users" && [...rows.users.values()].some(r => r.email === data.email)) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
      const row = { ...data, id: data.id || `${table}-${rows[table].size + 1}` };
      rows[table].set(row.id, row); return structuredClone(row);
    },
    update: async ({ where, data }: any) => {
      const row = [...rows[table].values()].find(r => matches(r, where));
      if (!row) throw new Error("Missing row");
      return apply(row, data);
    },
    updateMany: async ({ where, data }: any) => {
      const found = [...rows[table].values()].filter(r => matches(r, where)); found.forEach(r => apply(r, data)); return { count: found.length };
    },
    deleteMany: async ({ where }: any) => {
      const found = [...rows[table].values()].filter(r => matches(r, where)); found.forEach(r => rows[table].delete(r.id)); return { count: found.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = [...rows[table].values()].find(r => matches(r, where));
      if (row) return apply(row, update);
      rows[table].set(create.id, structuredClone(create)); return structuredClone(create);
    },
  });
  let queue = Promise.resolve();
  const db: any = { registrationVerificationChallenge: model("challenges"), passwordReset: model("passwordResets"), verificationRateLimitBucket: model("buckets"), user: model("users"), session: model("sessions") };
  db.$transaction = async (operation: any) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const snapshot = structuredClone(rows);
    try { return await operation(db); }
    catch (error) { rows = snapshot; throw error; }
    finally { release(); }
  };
  return db;
}
