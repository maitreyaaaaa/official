export interface LocalDemoConfig {
  nodeEnv?: string;
  seedFixture?: string;
  enableDemoWrites?: string;
  graph?: string;
  falkordbHost?: string;
  falkordbTls?: string;
  port?: number;
}

export function localDemoConfigFromEnvironment(environment: Record<string, string | undefined>): LocalDemoConfig {
  return {
    nodeEnv: environment.NODE_ENV,
    seedFixture: environment.SEED_FIXTURE,
    enableDemoWrites: environment.ENABLE_DEMO_WRITES,
    graph: environment.FALKORDB_GRAPH,
    falkordbHost: environment.FALKORDB_HOST,
    port: Number(environment.PORT || 3001),
  };
}

export interface DemoRequestContext {
  remoteAddress?: string;
  origin?: string;
  host?: string;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function canServeLocalApp(
  config: LocalDemoConfig,
  request: Pick<DemoRequestContext, 'remoteAddress' | 'host'>,
): boolean {
  return config.nodeEnv === 'development'
    && isLoopbackAddress(request.remoteAddress)
    && isLoopbackRequestHost(request.host);
}

export function isLoopbackHost(host: string | undefined): boolean {
  const normalized = (host || 'localhost').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
    || normalized === '::ffff:7f00:1';
}

function isLoopbackRequestHost(host: string | undefined): boolean {
  if (!host || host.trim() !== host || /[\s/@\\?#]/.test(host)) return false;

  try {
    const parsed = new URL(`http://${host}`);
    return !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === ''
      && isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isLocalFixtureConfig(config: LocalDemoConfig): boolean {
  return config.nodeEnv === 'development'
    && (config.graph || 'official') === 'official'
    && isLoopbackHost(config.falkordbHost);
}

export function canSeedFixture(config: LocalDemoConfig): boolean {
  return isLocalFixtureConfig(config) && config.seedFixture === 'true';
}

export function canEnableDemoRollout(config: LocalDemoConfig): boolean {
  return canSeedFixture(config) && config.enableDemoWrites === 'true';
}

function isSameLocalOrigin(config: LocalDemoConfig, request: DemoRequestContext): boolean {
  const port = config.port ?? 3001;
  return request.origin === `http://127.0.0.1:${port}` || request.origin === `http://localhost:${port}`;
}

export function canInitializeFixture(config: LocalDemoConfig, request: DemoRequestContext): boolean {
  return canSeedFixture(config)
    && isLoopbackAddress(request.remoteAddress)
    && isSameLocalOrigin(config, request);
}

export function isSecureGraphEndpoint(host: string | undefined, tlsEnabled: boolean): boolean {
  return isLoopbackHost(host) || tlsEnabled;
}

export function canWriteDemo(config: LocalDemoConfig, request: DemoRequestContext): boolean {
  if (!canEnableDemoRollout(config) || !isLoopbackAddress(request.remoteAddress)) {
    return false;
  }

  return isSameLocalOrigin(config, request);
}
