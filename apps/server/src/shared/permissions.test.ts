import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same reasoning as auth/session.test.ts: db.ts opens its sqlite file at
// import time, so the env var must be set before the first (dynamic) import
// of anything that touches it.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-${randomUUID()}.sqlite`);

const { db } = await import("../infrastructure/db.js");
const { getEffectivePermission, hasPermission, canManageProject } = await import("./permissions.js");

function makeUser(isAdmin: 0 | 1 = 0): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, 'x', ?)").run(
    id,
    `${id}@example.com`,
    isAdmin,
  );
  return id;
}

function makeProject(ownerId: string | null): string {
  const id = randomUUID();
  db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, 'Test Project', ?)").run(id, ownerId);
  return id;
}

function makeTeam(): string {
  const id = randomUUID();
  db.prepare("INSERT INTO teams (id, name) VALUES (?, 'Test Team')").run(id);
  return id;
}

function addMember(teamId: string, userId: string) {
  db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
}

function grantTeam(projectId: string, teamId: string, permission: "view" | "edit" | "administrator") {
  db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)").run(
    projectId,
    teamId,
    permission,
  );
}

test("a global admin gets administrator on any project, owned or not", () => {
  const admin = makeUser(1);
  const owner = makeUser();
  const project = makeProject(owner);
  assert.equal(getEffectivePermission(admin, project), "administrator");
});

test("the project's owner gets administrator unconditionally", () => {
  const owner = makeUser();
  const project = makeProject(owner);
  assert.equal(getEffectivePermission(owner, project), "administrator");
});

test("a nonexistent project resolves to null, not a thrown error", () => {
  const user = makeUser();
  assert.equal(getEffectivePermission(user, randomUUID()), null);
});

test("a project with zero teams assigned is 'view' for any other logged-in user", () => {
  const owner = makeUser();
  const bystander = makeUser();
  const project = makeProject(owner);
  assert.equal(getEffectivePermission(bystander, project), "view");
});

test("once a project has any team assigned, it stops being open — a user outside every granted team gets null", () => {
  const owner = makeUser();
  const project = makeProject(owner);
  const team = makeTeam();
  grantTeam(project, team, "view");

  const outsider = makeUser();
  assert.equal(getEffectivePermission(outsider, project), null, "restricted the moment one team is assigned");
});

test("a member of a granted team gets that team's permission level", () => {
  const owner = makeUser();
  const project = makeProject(owner);
  const team = makeTeam();
  grantTeam(project, team, "edit");
  const member = makeUser();
  addMember(team, member);

  assert.equal(getEffectivePermission(member, project), "edit");
});

test("membership in multiple granted teams resolves to the highest-ranked permission", () => {
  const owner = makeUser();
  const project = makeProject(owner);
  const viewTeam = makeTeam();
  const adminTeam = makeTeam();
  grantTeam(project, viewTeam, "view");
  grantTeam(project, adminTeam, "administrator");
  const member = makeUser();
  addMember(viewTeam, member);
  addMember(adminTeam, member);

  assert.equal(getEffectivePermission(member, project), "administrator");
});

test("hasPermission compares against the rank of the minimum required level", () => {
  const owner = makeUser();
  const project = makeProject(owner);
  const team = makeTeam();
  grantTeam(project, team, "edit");
  const member = makeUser();
  addMember(team, member);

  assert.equal(hasPermission(member, project, "view"), true);
  assert.equal(hasPermission(member, project, "edit"), true);
  assert.equal(hasPermission(member, project, "administrator"), false);
});

test("canManageProject is true only at the administrator level", () => {
  const owner = makeUser();
  const project = makeProject(owner);
  const team = makeTeam();
  grantTeam(project, team, "edit");
  const editor = makeUser();
  addMember(team, editor);

  assert.equal(canManageProject(owner, project), true);
  assert.equal(canManageProject(editor, project), false);
});
