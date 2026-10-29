import { test } from "node:test";
import assert from "node:assert/strict";

/** The few browser globals `connectProject` touches, enough for it to open and close a connection. */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = "";
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener() {}
  send() {}
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

const globals = globalThis as unknown as Record<string, unknown>;
globals.WebSocket = FakeSocket;
globals.location = { protocol: "http:", host: "localhost" };
globals.window = { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
globals.document = { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" };

const { connectProject } = await import("./yjsClient");

test("closing a project connection destroys its document and its awareness", () => {
  const connection = connectProject("project-1", "ada");
  const socket = FakeSocket.instances.at(-1)!;
  // The awareness runs an interval timer that keeps it (and the document) alive until it is destroyed.
  const timer = (connection.awareness as unknown as { _checkInterval: NodeJS.Timeout & { _destroyed: boolean } })
    ._checkInterval;
  assert.ok(timer, "the awareness starts a timer");
  assert.equal(connection.doc.isDestroyed, false);

  connection.disconnect();

  assert.equal(socket.closed, true);
  assert.equal(connection.doc.isDestroyed, true);
  assert.equal(timer._destroyed, true, "the awareness timer is cleared");
});

test("a closed connection can be garbage collected", async () => {
  const refs: WeakRef<object>[] = [];
  const open = () => {
    const connection = connectProject("project-2", "ada");
    refs.push(new WeakRef(connection.doc));
    connection.disconnect();
  };
  for (let i = 0; i < 10; i++) open();
  FakeSocket.instances.length = 0;

  const v8 = await import("node:v8");
  const vm = await import("node:vm");
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  for (let i = 0; i < 5; i++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(refs.filter((ref) => ref.deref() !== undefined).length, 0);
});
