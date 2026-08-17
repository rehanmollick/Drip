import { describe, expect, it } from "vitest";
import { handle } from "@/lib/api/envelope";

describe("operator config errors", () => {
  it("returns the actionable message for a missing DB schema, but still hides ordinary internals", async () => {
    const schemaErr = Object.assign(new Error("[supabase:listSessions] the DRIP tables are missing — run supabase/migrations/0001_init.sql"), { code: "schema_missing" });
    const r1 = await handle(async () => { throw schemaErr; })(new Request("http://x/api/sessions"), undefined);
    expect(r1.status).toBe(503);
    const b1 = await r1.json();
    expect(b1.error.code).toBe("schema_missing");
    expect(b1.error.message).toMatch(/0001_init\.sql/);
    expect(b1.error.message).not.toMatch(/^\[supabase/); // internal prefix stripped

    const leaky = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 (key=sk-secret)"), { code: "econnrefused" });
    const r2 = await handle(async () => { throw leaky; })(new Request("http://x/api/sessions"), undefined);
    expect(r2.status).toBe(500);
    const b2 = await r2.json();
    expect(b2.error.code).toBe("internal");
    expect(JSON.stringify(b2)).not.toMatch(/ECONNREFUSED|sk-secret|10\.0\.0\.5/);
  });
});
