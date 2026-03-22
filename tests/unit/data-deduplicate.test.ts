import { describe, test, expect } from "bun:test";
import { deduplicate } from "../../src/data/deduplicate.js";
import type { JsonlRecord } from "../../src/data/types.js";

function rec(prompt: string, completion: string): JsonlRecord {
  return { prompt, completion };
}

describe("deduplicate", () => {
  test("returns all records when there are no duplicates", () => {
    const input = [rec("a", "x"), rec("b", "y"), rec("c", "z")];
    const { records, removed } = deduplicate(input);
    expect(records).toHaveLength(3);
    expect(removed).toBe(0);
  });

  test("removes exact duplicate (same prompt and completion)", () => {
    const input = [rec("hello", "world"), rec("hello", "world")];
    const { records, removed } = deduplicate(input);
    expect(records).toHaveLength(1);
    expect(removed).toBe(1);
  });

  test("keeps first occurrence of an exact duplicate", () => {
    const input = [rec("first", "body"), rec("first", "body")];
    const { records } = deduplicate(input);
    expect(records[0]).toEqual(rec("first", "body"));
  });

  test("does not remove records with same prompt but different completion", () => {
    const input = [
      rec("prompt", "function renderButton() { return <button>click</button>; }"),
      rec("prompt", "async function fetchUser(id: string) { return await db.find(id); }"),
    ];
    const { records, removed } = deduplicate(input);
    expect(records).toHaveLength(2);
    expect(removed).toBe(0);
  });

  test("removes near-duplicate above jaccard threshold 0.85", () => {
    // Two almost identical functions — differ only in one variable name
    const base =
      "function getUserById(id: string) {\n" +
      "  const user = db.users.find(u => u.id === id);\n" +
      "  if (!user) throw new Error('User not found');\n" +
      "  return user;\n" +
      "}";
    const nearDup =
      "function getUserById(id: string) {\n" +
      "  const user = db.users.find(u => u.id === id);\n" +
      "  if (!user) throw new Error('User not found');\n" +
      "  return user; // same\n" +
      "}";
    const input = [rec("get user", base), rec("get user", nearDup)];
    const { records, removed } = deduplicate(input);
    expect(records).toHaveLength(1);
    expect(removed).toBe(1);
  });

  test("keeps records below jaccard threshold", () => {
    // Two very different functions
    const input = [
      rec("auth", "function login(email: string, password: string) {\n  const user = await db.users.findByEmail(email);\n  if (!user) throw new Error('Not found');\n  return jwt.sign({ id: user.id }, secret);\n}"),
      rec("render", "function Button({ onClick, children }: ButtonProps) {\n  return <button className=\"btn\" onClick={onClick}>{children}</button>;\n}"),
    ];
    const { records, removed } = deduplicate(input);
    expect(records).toHaveLength(2);
    expect(removed).toBe(0);
  });

  test("handles empty input", () => {
    const { records, removed } = deduplicate([]);
    expect(records).toHaveLength(0);
    expect(removed).toBe(0);
  });

  test("handles single record", () => {
    const { records, removed } = deduplicate([rec("p", "c")]);
    expect(records).toHaveLength(1);
    expect(removed).toBe(0);
  });

  test("removes multiple exact duplicates", () => {
    const input = [
      rec("a", "x"),
      rec("a", "x"),
      rec("a", "x"),
      rec("b", "y"),
    ];
    const { records, removed } = deduplicate(input);
    expect(records).toHaveLength(2);
    expect(removed).toBe(2);
  });
});
