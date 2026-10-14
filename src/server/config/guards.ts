export interface LocalDemoConfig {
  nodeEnv?: string;
  seedFixture?: string;
  enableDemoWrites?: string;
  graph?: string;
  falkordbHost?: string;
  falkordbTls?: string;
  port?: number;
}

export interface DemoRequestContext {
  remoteAddress?: string;
  origin?: string;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function isLoopbackHost(host: string | undefined): boolean {
  const normalized = (host || 'localhost').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
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
