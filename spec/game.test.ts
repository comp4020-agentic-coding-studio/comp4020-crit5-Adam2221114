import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Contract tests for crit 5 ("A game"): https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/05-game/
// They run against the BUILT site (dist/), same as spec/invariants.test.ts.
const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const shipped = files().map((path) => relative(DIST, path).split(sep).join("/"));

const pages = shipped
  .filter((name) => name.endsWith(".html"))
  .map((name) => ({
    name,
    doc: new JSDOM(readFileSync(join(DIST, name), "utf8")).window.document,
  }));

// A crude proxy for "no instructions anywhere, on screen or off": the spec
// asks for no how-to-play modal, no instructions page, nothing in the README
// standing in for either. This only catches literal instructional text; it
// can't judge whether the opening screen actually teaches itself — that's for
// the crit.
const INSTRUCTIONAL = /how\s*to\s*play|instructions|tutorial|controls\s*:|rules\s*:/i;

describe("game: no on-screen tutorial", () => {
  for (const { name, doc } of pages) {
    it(`${name} has no how-to-play text on load`, () => {
      const text = doc.body?.textContent ?? "";
      expect(
        INSTRUCTIONAL.test(text),
        "the opening screen has to teach the first move itself, not tell the player",
      ).toBe(false);
    });
  }
});
