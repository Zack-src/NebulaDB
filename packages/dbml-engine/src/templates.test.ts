import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVisualMetadata } from "./serialize.js";
import { parseDbml, toProject } from "./dbml.js";
import { validateProject } from "./validate.js";
import { PROJECT_TEMPLATES, isProjectTemplateId, projectFromTemplate, projectTemplateSource } from "./templates.js";

for (const template of PROJECT_TEMPLATES) {
  test(`template "${template.id}" parses and every table gets its hand-placed position`, () => {
    const source = projectTemplateSource(template.id);
    const project = applyVisualMetadata(toProject(parseDbml(source), template.id, source), source);

    assert.ok(project.tables.length > 0);
    assert.ok(project.refs.length > 0, "a template with no relations isn't much of a starter");
    assert.deepEqual(
      project.tables.map((t) => t.name).sort(),
      Object.keys(template.layout).sort(),
      "layout must name exactly the template's tables — a typo would silently fall back to the default grid",
    );

    const positions = new Set(project.tables.map((t) => `${t.position.x},${t.position.y}`));
    assert.equal(positions.size, project.tables.length, "two tables share a slot");
  });

  test(`template "${template.id}" passes project validation`, () => {
    const source = projectTemplateSource(template.id);
    const project = toProject(parseDbml(source), template.id, source);
    const issues = validateProject(project).filter((issue) => issue.severity === "error");
    assert.deepEqual(issues, []);
  });
}

for (const template of PROJECT_TEMPLATES) {
  test(`projectFromTemplate("${template.id}") mints ids unique across the whole project`, () => {
    // Regression: `toProject`'s ids are per-parse counters, so writing its
    // output straight into a doc gave two tables' first fields the same id
    // and crashed the canvas (Svelte `each_key_duplicate`).
    const project = projectFromTemplate(template.id, "p1", "Seeded");
    const ids = [
      ...project.tables.map((t) => t.id),
      ...project.tables.flatMap((t) => t.fields.map((f) => f.id)),
      ...project.refs.map((r) => r.id),
      ...project.enums.map((e) => e.id),
    ];
    assert.equal(new Set(ids).size, ids.length, "duplicate id");
    assert.equal(project.id, "p1");

    // Merge must keep the hand-placed layout, not re-grid it.
    const [col, row] = template.layout[project.tables[0].name];
    assert.deepEqual(project.tables[0].position, { x: col * 340, y: row * 320 });

    // Every ref must point at a real table/field id — the merge remaps them.
    for (const ref of project.refs) {
      for (const endpoint of [ref.from, ref.to]) {
        const table = project.tables.find((t) => t.id === endpoint.tableId);
        assert.ok(
          table?.fields.some((f) => f.id === endpoint.fieldId),
          `dangling ref endpoint ${JSON.stringify(endpoint)}`,
        );
      }
    }
  });
}

test("isProjectTemplateId rejects anything outside the catalogue", () => {
  assert.equal(isProjectTemplateId("blog"), true);
  assert.equal(isProjectTemplateId("nope"), false);
  assert.equal(isProjectTemplateId(undefined), false);
  assert.equal(isProjectTemplateId(42), false);
});
