import { Buffer } from 'node:buffer'

/** Ответ DNS на запрос: копия заголовка и вопроса плюс записи A/AAAA */
export function dnsAnswer(
  query: Buffer,
  records: { address: string, ttl?: number }[],
  rcode = 0,
) {
  const header = Buffer.from(query.subarray(0, 12))

  header.writeUInt16BE(0x8180 | rcode, 2)
  header.writeUInt16BE(records.length, 6)

  const answers = records.map(({ address, ttl = 300 }) => {
    const v6 = address.includes(':')
    const data = v6
      ? Buffer.from(
          address.split(':').flatMap((group) => {
            const value = Number.parseInt(group, 16)

            return [value >> 8, value & 0xFF]
          }),
        )
      : Buffer.from(address.split('.').map(Number))
    const record = Buffer.alloc(12)

    // Имя — указатель на вопрос (смещение 12)
    record.writeUInt16BE(0xC00C, 0)
    record.writeUInt16BE(v6 ? 28 : 1, 2)
    record.writeUInt16BE(1, 4)
    record.writeUInt32BE(ttl, 6)
    record.writeUInt16BE(data.length, 10)

    return Buffer.concat([record, data])
  })

  return Buffer.concat([header, query.subarray(12), ...answers])
}

export function queryType(query: Buffer) {
  return query.readUInt16BE(query.length - 4)
}

export function queryFromUrl(url: string) {
  return Buffer.from(new URL(url).searchParams.get('dns')!, 'base64url')
}
