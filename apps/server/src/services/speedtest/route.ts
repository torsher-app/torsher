import process from 'node:process'
/** Mirrors undici EnvHttpProxyAgent matching for the fixed HTTPS provider. */
export function cloudflareUsesEnvProxy(url: string) {
  const env = process.env
  const http = env.http_proxy ?? env.HTTP_PROXY
  const https = env.https_proxy ?? env.HTTPS_PROXY
  if (!(https || http))
    return false
  const host = new URL(url).hostname.toLowerCase()
  return !(env.no_proxy ?? env.NO_PROXY ?? '')
    .split(/[,\s]/)
    .filter(Boolean)
    .some((entry) => {
      const [name = '', port] = entry.toLowerCase().split(':')
      if (port && Number(port) !== 443)
        return false
      const wildcard = name.startsWith('*') && name !== '*'
      const match = name.replace(/^\*?\./, '').replace(/\.$/, '')
      return (
        match === '*'
        || (!wildcard && host === match)
        || host.endsWith(`.${match}`)
      )
    })
}
