// RFC 6265 Cookie header: name=value pairs; no attributes, controls or challenge credentials.
const NAME = /^[!#$%&'*+.^`|~\w-]+$/
const VALUE
  = /^(?:[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*|"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*")$/

export function isSessionCookie(value: string) {
  if (
    !value
    || value.length > 8192
    || value
      .split('')
      .some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    return false
  }

  return value.split(';').every((part) => {
    const pair = part.trim()
    const split = pair.indexOf('=')
    const name = pair.slice(0, split)
    return (
      split > 0
      && NAME.test(name)
      && name.toLowerCase() !== 'cf_clearance'
      && VALUE.test(pair.slice(split + 1))
    )
  })
}
