import net from "net";

/** transport-agnostic IPC endpoint descriptor */
export type IpcEndpoint =
  | { type: "unix"; path: string }
  | { type: "tcp"; host: string; port: number };

/** create a Unix domain socket endpoint */
export function unixEndpoint(path: string): IpcEndpoint {
  return { type: "unix", path };
}

/** create a TCP endpoint with a known port */
export function tcpEndpoint(host: string, port: number): IpcEndpoint {
  return { type: "tcp", host, port };
}

/**
 * Bind a TCP server on an ephemeral port and return the endpoint + server.
 *
 * The caller owns the returned server and must close it when done. The server
 * is already listening and ready to accept connections.
 */
export async function bindTcpEndpoint(
  host = "127.0.0.1",
): Promise<{ endpoint: IpcEndpoint; server: net.Server }> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const addr = server.address() as net.AddressInfo;
  return {
    endpoint: { type: "tcp", host: addr.address, port: addr.port },
    server,
  };
}

/** format an endpoint for QEMU `-chardev socket` */
export function formatChardevSocket(id: string, endpoint: IpcEndpoint): string {
  if (endpoint.type === "unix") {
    return `socket,id=${id},path=${endpoint.path},server=off`;
  }
  return `socket,id=${id},host=${endpoint.host},port=${endpoint.port},server=off`;
}

/**
 * Format an endpoint for QEMU `-netdev stream`.
 *
 * Unix: `stream,id=ID,server=off,addr.type=unix,addr.path=PATH`
 * TCP:  `stream,id=ID,server=off,addr.type=inet,addr.host=HOST,addr.port=PORT`
 */
export function formatNetdevStream(
  id: string,
  endpoint: IpcEndpoint,
  mac?: string,
): string {
  if (endpoint.type === "unix") {
    return `stream,id=${id},server=off,addr.type=unix,addr.path=${endpoint.path}`;
  }
  return `stream,id=${id},server=off,addr.type=inet,addr.host=${endpoint.host},addr.port=${endpoint.port}`;
}

/** true when the current platform should use TCP instead of Unix sockets */
export function shouldUseTcp(): boolean {
  return process.platform === "win32";
}
