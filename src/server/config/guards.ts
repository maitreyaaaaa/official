export interface LocalDemoConfig {
  nodeEnv?: string;
  seedFixture?: string;
  enableDemoWrites?: string;
  enablePublicDemo?: string;
  allowInsecureFalkordb?: string;
  graph?: string;
  falkordbHost?: string;
  falkordbTls?: string;
  vercelUrl?: string;
  vercelProjectProductionUrl?: string;
  port?: number;
}

export function localDemoConfigFromEnvironment(environment: Record<string, string | undefined>): LocalDemoConfig {
  return {
    nodeEnv: environment.NODE_ENV,
    seedFixture: environment.SEED_FIXTURE,
    enableDemoWrites: environment.ENABLE_DEMO_WRITES,
    enablePublicDemo: environment.ENABLE_PUBLIC_DEMO,
    allowInsecureFalkordb: environment.ALLOW_INSECURE_FALKORDB,
    graph: environment.FALKORDB_GRAPH,
    falkordbHost: environment.FALKORDB_HOST,
    falkordbTls: environment.FALKORDB_TLS,
    vercelUrl: environment.VERCEL_URL,
    vercelProjectProductionUrl: environment.VERCEL_PROJECT_PRODUCTION_URL,
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

function hostedDemoHosts(config: LocalDemoConfig): Set<string> {
  return new Set([config.vercelUrl, config.vercelProjectProductionUrl]
    .flatMap((value) => value ? [value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')] : [])
    .filter((value) => /^[a-z0-9.-]+(?::\d{1,5})?$/.test(value)));
}

function isHostedDemoRequest(config: LocalDemoConfig, request: DemoRequestContext): boolean {
  if (config.nodeEnv !== 'production' || config.enablePublicDemo !== 'true' || !request.host) return false;
  return hostedDemoHosts(config).has(request.host.toLowerCase());
}

export function canServeDemoApp(
  config: LocalDemoConfig,
  request: Pick<DemoRequestContext, 'remoteAddress' | 'host'>,
): boolean {
  return canServeLocalApp(config, request) || isHostedDemoRequest(config, request);
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

function isFixtureDemoConfig(config: LocalDemoConfig): boolean {
  const local = config.nodeEnv === 'development';
  const hosted = config.nodeEnv === 'production' && config.enablePublicDemo === 'true';
  const graphIsLocal = isLoopbackHost(config.falkordbHost);
  const remoteGraphAllowed = hosted && (config.falkordbTls === 'true' || config.allowInsecureFalkordb === 'true');
  return (local || hosted)
    && (config.graph || 'official') === 'official'
    && (graphIsLocal || remoteGraphAllowed);
}

export function canSeedFixture(config: LocalDemoConfig): boolean {
  return isFixtureDemoConfig(config) && config.seedFixture === 'true';
}

export function canEnableDemoRollout(config: LocalDemoConfig): boolean {
  return canSeedFixture(config) && config.enableDemoWrites === 'true';
}

function isSameDemoOrigin(config: LocalDemoConfig, request: DemoRequestContext): boolean {
  if (isHostedDemoRequest(config, request)) {
    return request.origin === `https://${request.host}`;
  }
  const port = config.port ?? 3001;
  return request.origin === `http://127.0.0.1:${port}` || request.origin === `http://localhost:${port}`;
}

export function canInitializeFixture(config: LocalDemoConfig, request: DemoRequestContext): boolean {
  return canSeedFixture(config)
    && (isLoopbackAddress(request.remoteAddress) || isHostedDemoRequest(config, request))
    && isSameDemoOrigin(config, request);
}

export function isSecureGraphEndpoint(host: string | undefined, tlsEnabled: boolean): boolean {
  return isLoopbackHost(host) || tlsEnabled;
}

export function canWriteDemo(config: LocalDemoConfig, request: DemoRequestContext): boolean {
  if (!canEnableDemoRollout(config)) {
    return false;
  }

  if (isHostedDemoRequest(config, request)) return isSameDemoOrigin(config, request);
  return isLoopbackAddress(request.remoteAddress) && isSameDemoOrigin(config, request);
}
