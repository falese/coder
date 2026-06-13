import { describe, test, expect } from "bun:test";
import { parseThreads, stripThreads } from "../../../src/episodes/threads.js";

describe("parseThreads", () => {
  test("extracts the threads array from the tag", () => {
    const raw = 'answer text <threads>{"threads":["state machines","retry policy"]}</threads>';
    expect(parseThreads(raw)).toEqual(["state machines", "retry policy"]);
  });

  test("trims and drops empty entries", () => {
    const raw = '<threads>{"threads":["  spaced  ","",123,"ok"]}</threads>';
    expect(parseThreads(raw)).toEqual(["spaced", "ok"]);
  });

  test("returns [] when there is no tag", () => {
    expect(parseThreads("just prose")).toEqual([]);
  });

  test("returns [] on malformed JSON", () => {
    expect(parseThreads("<threads>{not json}</threads>")).toEqual([]);
  });
});

describe("stripThreads", () => {
  test("removes the tag and trailing whitespace", () => {
    const raw = 'the answer\n<threads>{"threads":["x"]}</threads>';
    expect(stripThreads(raw)).toBe("the answer");
  });

  test("leaves untagged text unchanged", () => {
    expect(stripThreads("plain")).toBe("plain");
  });
});
