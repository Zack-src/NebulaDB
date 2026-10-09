import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../infrastructure/testDatabase.js";

// Same reasoning as auth/session.test.ts: db.ts connects at import time, so
// its database must be there before the first (dynamic) import of anything
// that touches it.
await useTestDatabase("test");

const { db } = await import("../infrastructure/db.js");
const { getEffectivePermission, hasPermission, canManageProject } = await import("./permissions.js");

async function makeUser(isAdmin: 0 | 1 = 0): Promise<string> {
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, 'x', ?)")
    .run(id, `${id}@example.com`, isAdmin);
  return id;
}

async function makeProject(ownerId: string | null): Promise<string> {
  const id = randomUUID();
  await db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, 'Test Project', ?)").run(id, ownerId);
  return id;
}

async function makeTeam(): Promise<string> {
  const id = randomUUID();
  await db.prepare("INSERT INTO teams (id, name) VALUES (?, 'Test Team')").run(id);
  return id;
}

async function addMember(teamId: string, userId: string) {
  await db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
}

async function grantTeam(projectId: string, teamId: string, permission: "view" | "edit" | "administrator") {
  await db
    .prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)")
    .run(projectId, teamId, permission);
}

test("a global admin gets administrator on any project, owned or not", async () => {
  const admin = await makeUser(1);
  const owner = await makeUser();
  const project = await makeProject(owner);
  assert.equal(await getEffectivePermission(admin, project), "administrator");
});

test("the project's owner gets administrator unconditionally", async () => {
  const owner = await makeUser();
  const project = await makeProject(owner);
  assert.equal(await getEffectivePermission(owner, project), "administrator");
});

test("a nonexistent project resolves to null, not a thrown error", async () => {
  const user = await makeUser();
  assert.equal(await getEffectivePermission(user, randomUUID()), null);
});

test("a project with zero teams assigned is 'view' for any other logged-in user", async () => {
  const owner = await makeUser();
  const bystander = await makeUser();
  const project = await makeProject(owner);
  assert.equal(await getEffectivePermission(bystander, project), "view");
});

test("once a project has any team assigned, it stops being open — a user outside every granted team gets null", async () => {
  const owner = await makeUser();
  const project = await makeProject(owner);
  const team = await makeTeam();
  await grantTeam(project, team, "view");

  const outsider = await makeUser();
  assert.equal(await getEffectivePermission(outsider, project), null, "restricted the moment one team is assigned");
});

test("a member of a granted team gets that team's permission level", async () => {
  const owner = await makeUser();
  const project = await makeProject(owner);
  const team = await makeTeam();
  await grantTeam(project, team, "edit");
  const member = await makeUser();
  await addMember(team, member);

  assert.equal(await getEffectivePermission(member, project), "edit");
});

test("membership in multiple granted teams resolves to the highest-ranked permission", async () => {
  const owner = await makeUser();
  const project = await makeProject(owner);
  const viewTeam = await makeTeam();
  const adminTeam = await makeTeam();
  await grantTeam(project, viewTeam, "view");
  await grantTeam(project, adminTeam, "administrator");
  const member = await makeUser();
  await addMember(viewTeam, member);
  await addMember(adminTeam, member);

  assert.equal(await getEffectivePermission(member, project), "administrator");
});

test("hasPermission compares against the rank of the minimum required level", async () => {
  const owner = await makeUser();
  const project = await makeProject(owner);
  const team = await makeTeam();
  await grantTeam(project, team, "edit");
  const member = await makeUser();
  await addMember(team, member);

  assert.equal(await hasPermission(member, project, "view"), true);
  assert.equal(await hasPermission(member, project, "edit"), true);
  assert.equal(await hasPermission(member, project, "administrator"), false);
});

test("canManageProject is true only at the administrator level", async () => {
  const owner = await makeUser();
  const project = await makeProject(owner);
  const team = await makeTeam();
  await grantTeam(project, team, "edit");
  const editor = await makeUser();
  await addMember(team, editor);

  assert.equal(await canManageProject(owner, project), true);
  assert.equal(await canManageProject(editor, project), false);
});
