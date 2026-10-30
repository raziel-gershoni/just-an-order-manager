/**
 * The one place that sees every save. Drizzle sends each statement through the
 * neon client created in ./index.ts, so wrapping that client catches builder
 * writes, CTE writes sent with db.execute, and db.batch — including writes
 * added later by code that never heard of this hook. The kitchen screen's saved
 * copy (src/lib/kitchen-sheet.ts) is marked stale from here.
 */

// Comments and quoted text are blanked first, so a note that says "insert into
// the bag" or a column called "deleted_at" can't read as a write. A false
// positive costs one extra read; a false negative leaves a screen stale.
export function isWriteSql(text: string): boolean {
  const bare = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
  return /\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|merge\s+into|truncate)\b/i.test(bare);
}

type ThenableQuery = {
  then: (onF?: ((v: unknown) => unknown) | null, onR?: ((e: unknown) => unknown) | null) => Promise<unknown>;
  catch: (onR?: ((e: unknown) => unknown) | null) => Promise<unknown>;
  finally: (f?: (() => void) | null) => Promise<unknown>;
};

// neon's query result is a lazy NeonQueryPromise: nothing is sent until it is
// awaited, and db.batch hands the un-awaited objects to client.transaction,
// which insists they are still NeonQueryPromise instances. So the object is
// returned as-is, with its own then/catch/finally overridden: same instance,
// and the hook runs once the request has succeeded, before the caller resumes.
function afterSuccess<Q extends object>(query: Q, onDone: () => void): Q {
  const q = query as unknown as ThenableQuery;
  const originalThen = q.then.bind(query);
  let done = false;
  q.then = (onF, onR) =>
    originalThen((value) => {
      if (!done) {
        done = true;
        onDone();
      }
      return onF ? onF(value) : value;
    }, onR);
  q.catch = (onR) => q.then(undefined, onR);
  q.finally = (f) =>
    q.then(
      (value) => {
        f?.();
        return value;
      },
      (err) => {
        f?.();
        throw err;
      }
    );
  return query;
}

export function instrumentClient<C extends object>(client: C, onWrite: () => void): C {
  const fire = (where: string) => {
    try {
      onWrite();
    } catch (err) {
      console.error(`[db] write hook failed after a ${where}:`, err);
    }
  };
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'query' && typeof value === 'function') {
        return (text: string, params?: unknown[], opts?: unknown) => {
          const query = (value as (...a: unknown[]) => object).call(target, text, params, opts);
          return isWriteSql(text) ? afterSuccess(query, () => fire('query')) : query;
        };
      }
      if (prop === 'transaction' && typeof value === 'function') {
        return async (queries: unknown, opts?: unknown) => {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).call(target, queries, opts);
          // The callback form hides its statements; assume it wrote.
          const wrote = Array.isArray(queries)
            ? queries.some((q) => isWriteSql((q as { queryData?: { query?: string } })?.queryData?.query ?? ''))
            : true;
          if (wrote) fire('transaction');
          return result;
        };
      }
      return value;
    },
  });
}
