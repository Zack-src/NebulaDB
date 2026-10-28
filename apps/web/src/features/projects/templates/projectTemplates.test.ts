import assert from "node:assert/strict";
import { test } from "node:test";
import { applyVisualMetadata, parseDbml, toProject, validateProject } from "@nebuladb/dbml-engine";
import { PROJECT_TEMPLATES, projectTemplateSource } from "./projectTemplates";

for (const template of PROJECT_TEMPLATES) {
  test(`template "${template.id}" parses and every table gets its hand-placed position`, () => {
    const source = projectTemplateSource(template.id);
    const project = applyVisualMetadata(toProject(parseDbml(source), template.id, source), source);

    assert.ok(project.tables.length > 0);
    assert.ok(project.refs.length > 0, "a template with no relations is not much of a starter");
    assert.deepEqual(
      project.tables.map((table) => table.name).sort(),
      Object.keys(template.layout).sort(),
      "the layout must name exactly the template's tables",
    );
    const slots = new Set(project.tables.map((table) => `${table.position.x},${table.position.y}`));
    assert.equal(slots.size, project.tables.length, "two tables share a slot");
  });

  test(`template "${template.id}" passes project validation`, () => {
    const source = projectTemplateSource(template.id);
    const project = toProject(parseDbml(source), template.id, source);
    assert.deepEqual(
      validateProject(project).filter((issue) => issue.severity === "error"),
      [],
    );
  });
}

test("the example template carries table notes, so the dictionary has something to show", () => {
  const source = projectTemplateSource("example");
  const project = toProject(parseDbml(source), "example", source);
  assert.ok(project.tables.every((table) => Boolean(table.note)));
});
