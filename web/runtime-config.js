/** Keep public assets under the deployed Vite base, including repository Pages. */
export function assetUrl(path, baseUrl = '/') {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}

/** A static production site needs an explicitly configured room service. */
export function resolveRoomServer({ configuredUrl = '', isProduction = false, location }) {
  const address = configuredUrl.trim();
  if (!address) {
    if (isProduction) return { url: null, error: '联机服务尚未配置', reason: 'missing' };
    return { url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`, error: null };
  }
  let parsed;
  try { parsed = new URL(address); }
  catch { return { url: null, error: '联机服务地址配置有误', reason: 'invalid' }; }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    return { url: null, error: '联机服务地址配置有误', reason: 'invalid' };
  }
  if ((isProduction || location.protocol === 'https:') && parsed.protocol !== 'wss:') {
    return { url: null, error: '联机服务需要安全连接', reason: 'insecure' };
  }
  return { url: parsed.href, error: null };
}
