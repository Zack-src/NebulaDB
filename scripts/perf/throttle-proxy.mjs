// A TCP proxy that behaves like a slow link: a round-trip time and a bandwidth shared by every connection.
//
// Chrome's own network emulation (DevTools "Slow 4G") treats WebSocket frames very differently from HTTP
// (a 150 KB frame takes ~1.8 s even at 90 Mbit/s), so it cannot time a page that also opens a socket. This
// sits between the browser and the server at the TCP level instead, so HTTP and WebSocket are slowed alike.
//
//   const proxy = await startThrottleProxy({ targetPort: 3001, rttMs: 50, mbit: 9 });
//   // browse to http://localhost:${proxy.port}
//   await proxy.close();
import net from "node:net";

export async function startThrottleProxy({ targetHost = "127.0.0.1", targetPort, rttMs = 50, mbit = 9, upMbit = 3 }) {
  const oneWay = rttMs / 2;
  const links = {
    down: { msPerByte: 8 / (mbit * 1000), freeAt: 0 },
    up: { msPerByte: 8 / (upMbit * 1000), freeAt: 0 },
  };
  /** When a chunk of `length` bytes leaves the link: after the one-way delay, queued behind what is already on it. */
  const release = (link, length) => {
    const now = performance.now();
    const start = Math.max(now + oneWay, link.freeAt);
    link.freeAt = start + length * link.msPerByte;
    return link.freeAt;
  };
  const sockets = new Set();

  const server = net.createServer((client) => {
    sockets.add(client);
    const upstream = net.connect(targetPort, targetHost);
    sockets.add(upstream);
    // A new connection pays a round trip before its first byte moves, like a TCP handshake.
    const ready = performance.now() + rttMs;
    const pump = (from, to, link) => {
      let lastRelease = 0;
      from.on("data", (chunk) => {
        let at = release(link, chunk.length);
        if (at < ready) at = ready;
        lastRelease = Math.max(lastRelease, at);
        setTimeout(() => !to.destroyed && to.write(chunk), Math.max(0, at - performance.now()));
      });
      from.on("end", () => setTimeout(() => !to.destroyed && to.end(), Math.max(0, lastRelease - performance.now()) + 1));
    };
    pump(client, upstream, links.up);
    pump(upstream, client, links.down);
    const drop = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
    client.on("error", drop);
    upstream.on("error", drop);
    client.on("close", drop);
    upstream.on("close", drop);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
