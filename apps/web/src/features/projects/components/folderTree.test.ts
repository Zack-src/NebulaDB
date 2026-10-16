import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProjectFolder } from "@nebuladb/shared";
import { countInFolder, folderPath, shownFolderOf } from "./folderTree";

const folder = (id: string, parentId: string | null = null): ProjectFolder => ({
  id,
  name: id,
  parentId,
  createdBy: null,
  createdAt: "",
});
const folders = [folder("clients"), folder("acme", "clients"), folder("lyon", "acme"), folder("other")];

test("a folder's path runs from the top down to it", () => {
  assert.deepEqual(
    folderPath(folders, "lyon").map((f) => f.id),
    ["clients", "acme", "lyon"],
  );
  assert.deepEqual(folderPath(folders, null), []);
});

test("a project in a folder the reader cannot see shows at the top", () => {
  assert.equal(shownFolderOf(folders, "acme"), "acme");
  assert.equal(shownFolderOf(folders, "hidden"), null);
  assert.equal(shownFolderOf(folders, null), null);
});

test("a folder counts the projects of its subfolders too", () => {
  const projects = [{ folderId: "lyon" }, { folderId: "acme" }, { folderId: "other" }, { folderId: null }];
  assert.equal(countInFolder(folders, projects, "clients"), 2);
  assert.equal(countInFolder(folders, projects, "lyon"), 1);
});
