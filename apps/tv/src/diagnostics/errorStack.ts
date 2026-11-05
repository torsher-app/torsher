function resolvedData(
  value: object,
  key: string,
): { value: unknown } | undefined {
  let current: object | null = value
  for (let depth = 0; current && depth < 5; depth++) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor)
      return 'value' in descriptor ? { value: descriptor.value } : undefined
    current = Object.getPrototypeOf(current)
  }
  return current === null ? { value: undefined } : undefined
}

export function createSafeErrorStackReader() {
  const NativeError = Error
  const errorPrototype = Error.prototype
  const objectPrototype = Object.prototype
  const builtInPrototypes = [
    errorPrototype,
    TypeError.prototype,
    RangeError.prototype,
    ReferenceError.prototype,
    SyntaxError.prototype,
    URIError.prototype,
    EvalError.prototype,
  ]
  // Recent V8 exposes an own accessor; older engines retain the own data-property path.
  const nativeStackGetter = Object.getOwnPropertyDescriptor(
    new NativeError(),
    'stack',
  )?.get
  const maxStack = 16384

  /** Fail closed: no arbitrary stack/name/message getters or custom stack formatter. */
  return function safeErrorStack(value: unknown): string | undefined {
    try {
      if (!value || typeof value !== 'object')
        return
      const descriptor = Object.getOwnPropertyDescriptor(value, 'stack')
      if (!descriptor)
        return
      if ('value' in descriptor) {
        return typeof descriptor.value === 'string'
          ? descriptor.value.slice(0, maxStack)
          : undefined
      }
      if (!nativeStackGetter || descriptor.get !== nativeStackGetter)
        return

      const prototype = Object.getPrototypeOf(value)
      if (!builtInPrototypes.includes(prototype))
        return
      if (
        prototype !== errorPrototype
        && Object.getPrototypeOf(prototype) !== errorPrototype
      ) {
        return
      }
      if (
        Object.getPrototypeOf(errorPrototype) !== objectPrototype
        || Object.getPrototypeOf(objectPrototype) !== null
      ) {
        return
      }

      for (const key of ['name', 'message']) {
        const data = resolvedData(value, key)
        if (
          !data
          || (data.value !== undefined
            && (typeof data.value !== 'string'
              || data.value.length > (key === 'name' ? 80 : 4096)))
        ) {
          return
        }
      }
      // Ordinary property resolution includes inherited Function/Object prototype hooks.
      const formatter = resolvedData(NativeError, 'prepareStackTrace')
      if (!formatter || formatter.value !== undefined)
        return
      const stack: unknown = nativeStackGetter.call(value)
      return typeof stack === 'string' ? stack.slice(0, maxStack) : undefined
    }
    catch {
      // Includes revoked proxies, throwing descriptor traps and unsupported engines.
      return undefined
    }
  }
}
