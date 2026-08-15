/**
 * Source of the sandbox a user plugin runs inside.
 *
 * The plugin body is concatenated between `SANDBOX_PREFIX` and
 * `SANDBOX_SUFFIX` and turned into a Blob-URL Web Worker: no DOM, no React
 * state, no access to the page's memory — it can only reach the app through
 * the `postMessage` protocol in `types.ts`. That is the whole point of the
 * design: plugin code is third-party code, and it is never evaluated in the
 * document's realm where it would have the session cookie, the Y.Doc and
 * every DOM API within reach.
 *
 * The prefix additionally deletes the worker's network/storage globals. A
 * worker inherits same-origin `fetch` *with credentials*, so without this a
 * plugin could call `/api/...` as the logged-in user or POST the schema
 * somewhere. Treat it as defense in depth, not a hard boundary: users should
 * still only install plugin code they trust.
 */
export const SANDBOX_PREFIX = `"use strict";
(function () {
  var BLOCKED = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "indexedDB",
    "caches",
    "Notification",
    "navigator",
    "SharedWorker",
    "Worker",
  ];
  for (var i = 0; i < BLOCKED.length; i++) {
    try {
      Object.defineProperty(self, BLOCKED[i], { value: undefined, configurable: false, writable: false });
    } catch (err) {
      try {
        self[BLOCKED[i]] = undefined;
      } catch (err2) {
        // Non-configurable host global: nothing more we can do from in here.
      }
    }
  }

  var manifest = null;
  var contributions = [];
  var handlers = { exporter: {}, importer: {}, canvasCommand: {}, editorCommand: {} };

  function requireString(value, field, where) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(where + ": \\"" + field + "\\" must be a non-empty string");
    }
    return value.trim();
  }

  function register(kind, spec) {
    if (!spec || typeof spec !== "object") throw new Error(kind + ": expected an object");
    var id = requireString(spec.id, "id", kind);
    var label = requireString(spec.label, "label", kind);
    if (typeof spec.run !== "function") throw new Error(kind + " " + id + ": \\"run\\" must be a function");
    if (handlers[kind][id]) throw new Error(kind + " " + id + ": already registered");
    handlers[kind][id] = spec.run;
    var contribution = { kind: kind, id: id, label: label };
    if (typeof spec.description === "string") contribution.description = spec.description;
    if (typeof spec.shortcut === "string") contribution.shortcut = spec.shortcut.trim();
    if (kind === "exporter" && typeof spec.extension === "string") contribution.extension = spec.extension;
    if (kind === "importer" && Array.isArray(spec.fileExtensions)) {
      contribution.fileExtensions = spec.fileExtensions.filter(function (e) {
        return typeof e === "string";
      });
    }
    contributions.push(contribution);
  }

  // Normalizes the ergonomic return shapes (a bare string) into the protocol
  // shape the host expects, so plugin authors can just \`return sql\`.
  function normalize(kind, value) {
    if (kind === "exporter") return typeof value === "string" ? { text: value } : value || { text: "" };
    if (kind === "importer") return typeof value === "string" ? { dbml: value } : value || { dbml: "" };
    if (kind === "canvasCommand") {
      if (!value) return { project: null };
      if (value.project || value.message) return value;
      return { project: value };
    }
    if (typeof value === "string") return { text: value };
    return value || { text: null };
  }

  var SETTING_TYPES = ["string", "number", "boolean", "select"];

  function normalizeSettings(list) {
    if (!Array.isArray(list)) return undefined;
    return list.map(function (setting) {
      if (!setting || typeof setting !== "object") throw new Error("athanor.plugin: each setting must be an object");
      var key = requireString(setting.key, "key", "setting");
      var type = requireString(setting.type, "type", "setting " + key);
      if (SETTING_TYPES.indexOf(type) === -1) {
        throw new Error("setting " + key + ": type must be one of " + SETTING_TYPES.join(", "));
      }
      var normalized = {
        key: key,
        label: typeof setting.label === "string" && setting.label.trim() ? setting.label.trim() : key,
        type: type,
      };
      if (typeof setting.description === "string") normalized.description = setting.description;
      if (type === "select") {
        if (!Array.isArray(setting.options) || setting.options.length === 0) {
          throw new Error("setting " + key + ": a select needs a non-empty options array");
        }
        normalized.options = setting.options.map(String);
      }
      if (setting.default !== undefined) normalized.default = setting.default;
      return normalized;
    });
  }

  self.athanor = {
    plugin: function (meta) {
      if (!meta || typeof meta !== "object") throw new Error("athanor.plugin: expected an object");
      manifest = {
        id: requireString(meta.id, "id", "athanor.plugin"),
        name: requireString(meta.name, "name", "athanor.plugin"),
        version: typeof meta.version === "string" ? meta.version : undefined,
        description: typeof meta.description === "string" ? meta.description : undefined,
        author: typeof meta.author === "string" ? meta.author : undefined,
        category: typeof meta.category === "string" ? meta.category : undefined,
        icon: typeof meta.icon === "string" ? meta.icon : undefined,
        tags: Array.isArray(meta.tags) ? meta.tags.filter(function (t) { return typeof t === "string"; }) : undefined,
        homepage: typeof meta.homepage === "string" ? meta.homepage : undefined,
        doc: typeof meta.doc === "string" ? meta.doc : undefined,
        settings: normalizeSettings(meta.settings),
      };
    },
    registerExporter: function (spec) {
      register("exporter", spec);
    },
    registerImporter: function (spec) {
      register("importer", spec);
    },
    registerCanvasCommand: function (spec) {
      register("canvasCommand", spec);
    },
    registerEditorCommand: function (spec) {
      register("editorCommand", spec);
    },
  };

  // console inside a worker goes nowhere useful for a plugin author, so relay
  // it to the host, which surfaces it in the plugin manager.
  ["log", "warn", "error"].forEach(function (level) {
    self.console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(function (a) {
        try {
          return typeof a === "string" ? a : JSON.stringify(a);
        } catch (err) {
          return String(a);
        }
      });
      self.postMessage({ type: "log", level: level, args: args });
    };
  });

  self.__athanorFinish = function () {
    if (!manifest) {
      self.postMessage({ type: "load-error", message: "plugin never called athanor.plugin({ id, name })" });
      return;
    }
    if (contributions.length === 0) {
      self.postMessage({ type: "load-error", message: "plugin registered no exporter/importer/command" });
      return;
    }
    self.postMessage({ type: "ready", manifest: manifest, contributions: contributions });
  };

  self.onmessage = function (event) {
    var msg = event.data;
    if (!msg || msg.type !== "invoke") return;
    Promise.resolve()
      .then(function () {
        var handler = handlers[msg.kind] && handlers[msg.kind][msg.id];
        if (!handler) throw new Error("no " + msg.kind + " registered with id " + msg.id);
        return handler(msg.input, msg.context || { settings: {}, selection: { tableIds: [] } });
      })
      .then(function (value) {
        self.postMessage({ type: "result", callId: msg.callId, value: normalize(msg.kind, value) });
      })
      .catch(function (err) {
        self.postMessage({ type: "error", callId: msg.callId, message: String((err && err.message) || err) });
      });
  };
})();

try {
`;

export const SANDBOX_SUFFIX = `
} catch (err) {
  self.postMessage({ type: "load-error", message: String((err && err.message) || err) });
}
self.__athanorFinish();
`;

export function buildWorkerSource(pluginCode: string): string {
  return SANDBOX_PREFIX + pluginCode + SANDBOX_SUFFIX;
}
