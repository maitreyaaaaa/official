import { FalkorDB, type Graph } from 'falkordb';
import { isSecureGraphEndpoint } from '../config/guards.js';

let connection: Promise<FalkorDB> | undefined;

export async function getGraph(): Promise<Graph> {
  if (!connection) {
    const host = process.env.FALKORDB_HOST || 'localhost';
    const port = Number(process.env.FALKORDB_PORT || 6379);
    const tlsEnabled = process.env.FALKORDB_TLS === 'true';
    const username = process.env.FALKORDB_USERNAME;
    const password = process.env.FALKORDB_PASSWORD;

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('FALKORDB_PORT must be an integer between 1 and 65535.');
    }
    if (!isSecureGraphEndpoint(host, tlsEnabled) && process.env.ALLOW_INSECURE_FALKORDB !== 'true') {
      throw new Error('Remote FalkorDB hosts require FALKORDB_TLS=true.');
    }
    connection = FalkorDB.connect({
      host,
      port,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      socket: { connectTimeout: 3000, ...(tlsEnabled ? { tls: true } : {}) },
    }).catch((error: unknown) => {
      connection = undefined;
      throw error;
    });
  }

  const db = await connection;
  return db.selectGraph(process.env.FALKORDB_GRAPH || 'official');
}

export async function closeGraph(): Promise<void> {
  if (connection) {
    const db = await connection.catch(() => undefined);
    connection = undefined;
    await db?.close();
  }
}
