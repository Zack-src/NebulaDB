/** Copy historical preferences without overwriting newer choices or changing plugin source. */
export function migrateBrandStorage(storage: Storage): void {
  for (const key of Object.keys(storage)) {
    const next = key.replace(/^athanordb(?=[._:])/, "nebuladb").replace(/^athanor:/, "nebula:");
    if (next === key || storage.getItem(next) !== null) continue;
    const value = storage.getItem(key);
    if (value !== null) storage.setItem(next, value);
  }
  const settings = storage.getItem("nebuladb_plugin_settings");
  if (!settings) return;
  try {
    const values = JSON.parse(settings);
    if (!values || typeof values !== "object" || Array.isArray(values)) return;
    for (const id of ["core-export", "core-import", "core-canvas", "core-editor"]) {
      const oldId = `athanordb.${id}`;
      const newId = `nebuladb.${id}`;
      if (values[oldId] !== undefined && values[newId] === undefined) values[newId] = values[oldId];
    }
    storage.setItem("nebuladb_plugin_settings", JSON.stringify(values));
  } catch {
    // Malformed settings are handled by the plugin registry as before.
  }
}
