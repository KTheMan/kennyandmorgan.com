export interface SupabaseClient {
  from(table: string): TableQueryBuilder;
}

export interface TableQueryBuilder {
  select(columns?: string): SelectQueryBuilder;
  upsert(
    payload: unknown[],
    options: { onConflict: string },
  ): Promise<{ error: { message: string } | null }>;
  delete(): DeleteQueryBuilder;
}

export interface SelectQueryBuilder
  extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  order(column: string, options: { ascending: boolean }): SelectQueryBuilder;
  limit(n: number): SelectQueryBuilder;
  maybeSingle(): PromiseLike<{ data: unknown | null; error: { message: string } | null }>;
}

export interface DeleteQueryBuilder {
  eq(column: string, value: unknown): Promise<{ error: { message: string } | null }>;
  in(column: string, values: unknown[]): Promise<{ error: { message: string } | null }>;
}

class SupabaseClientImpl implements SupabaseClient {
  private readonly baseUrl: string;
  private readonly key: string;

  constructor(url: string, key: string) {
    this.baseUrl = url.replace(/\/$/, "");
    this.key = key;
  }

  from(table: string): TableQueryBuilder {
    return new TableQueryBuilderImpl(this, table);
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
    };
  }

  async select(table: string, query: string): Promise<unknown[]> {
    const url = `${this.baseUrl}/rest/v1/${table}?${query}`;
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(
        `PostgREST select failed: ${response.status} ${response.statusText} - ${text}`,
      );
    }
    return response.json() as Promise<unknown[]>;
  }

  async upsert(
    table: string,
    payload: unknown[],
    onConflict: string,
  ): Promise<{ error: { message: string } | null }> {
    const params = new URLSearchParams({ on_conflict: onConflict });
    const url = `${this.baseUrl}/rest/v1/${table}?${params.toString()}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      return {
        error: {
          message:
            `PostgREST upsert failed: ${response.status} ${response.statusText} - ${text}`,
        },
      };
    }
    return { error: null };
  }

  async delete(
    table: string,
    query: string,
  ): Promise<{ error: { message: string } | null }> {
    const url = `${this.baseUrl}/rest/v1/${table}?${query}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      return {
        error: {
          message:
            `PostgREST delete failed: ${response.status} ${response.statusText} - ${text}`,
        },
      };
    }
    return { error: null };
  }
}

class TableQueryBuilderImpl implements TableQueryBuilder {
  constructor(private client: SupabaseClientImpl, private table: string) {}

  select(columns = "*"): SelectQueryBuilder {
    return new SelectQueryBuilderImpl(this.client, this.table, columns);
  }

  upsert(
    payload: unknown[],
    options: { onConflict: string },
  ): Promise<{ error: { message: string } | null }> {
    return this.client.upsert(this.table, payload, options.onConflict);
  }

  delete(): DeleteQueryBuilder {
    return new DeleteQueryBuilderImpl(this.client, this.table);
  }
}

class SelectQueryBuilderImpl implements SelectQueryBuilder {
  private orders: string[] = [];
  private limitValue?: number;

  constructor(
    private client: SupabaseClientImpl,
    private table: string,
    private columns: string,
  ) {}

  order(column: string, { ascending }: { ascending: boolean }): this {
    this.orders.push(`${column}.${ascending ? "asc" : "desc"}`);
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  maybeSingle(): PromiseLike<{ data: unknown | null; error: { message: string } | null }> {
    this.limit(1);
    return {
      then: (onfulfilled, onrejected) =>
        this.then((result) => {
          const value = {
            data: Array.isArray(result.data) && result.data.length > 0
              ? result.data[0]
              : null,
            error: result.error,
          };
          return onfulfilled
            ? onfulfilled(value)
            : value as ReturnType<typeof onfulfilled>;
        }, onrejected),
    };
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?:
      | ((
        value: { data: unknown; error: { message: string } | null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<
    { data: unknown; error: { message: string } | null }
  > {
    try {
      const params = new URLSearchParams();
      params.set("select", this.columns);
      if (this.orders.length > 0) {
        params.set("order", this.orders.join(","));
      }
      if (this.limitValue !== undefined) {
        params.set("limit", String(this.limitValue));
      }
      const data = await this.client.select(this.table, params.toString());
      return { data, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { data: null, error: { message } };
    }
  }
}

class DeleteQueryBuilderImpl implements DeleteQueryBuilder {
  constructor(private client: SupabaseClientImpl, private table: string) {}

  eq(column: string, value: unknown): Promise<{ error: { message: string } | null }> {
    const params = new URLSearchParams();
    params.set(column, String(value));
    return this.client.delete(this.table, params.toString());
  }

  in(column: string, values: unknown[]): Promise<{ error: { message: string } | null }> {
    const csv = values.map(String).map(encodeURIComponent).join(",");
    const query = `${encodeURIComponent(column)}=in.(${csv})`;
    return this.client.delete(this.table, query);
  }
}

export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return new SupabaseClientImpl(url, key);
}
