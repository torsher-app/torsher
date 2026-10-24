import { Buffer } from 'node:buffer'
import { crc32, deflateRawSync } from 'node:zlib'

/** Небольшой zip для тестов: файлы сжаты deflate, как у экспорта сервисов */
export function buildZip(files: Record<string, string>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content)
    const packed = deflateRawSync(data)
    const fileName = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)

    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fileName.length, 26)

    const central = Buffer.alloc(46)

    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)

    locals.push(local, fileName, packed)
    centrals.push(central, fileName)
    offset += local.length + fileName.length + packed.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  const count = Object.keys(files).length

  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}
