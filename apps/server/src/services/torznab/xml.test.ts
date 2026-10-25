import { describe, expect, it } from 'vitest'
import { readTorznabXml, SourceError } from './client.ts'
import { parseXml, text } from './xml.ts'

const withEntities = `<?xml version="1.0"?>
<!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>
<rss><channel><title>&b;&b;</title></channel></rss>`

describe('parseXml', () => {
  it('rejects a document with a DOCTYPE', () => {
    expect(() => parseXml(withEntities)).toThrow(/DOCTYPE/)
    expect(() => parseXml('<!doctype rss><rss/>')).toThrow(/DOCTYPE/)
  })

  it('rejects a DOCTYPE after a prolog comment or inside an element', () => {
    expect(() =>
      parseXml('<?xml version="1.0"?><!-- feed --><!DOCTYPE rss><rss/>'),
    ).toThrow(/DOCTYPE/)
    // Парсер принимает DTD и посреди документа: сущность раскрылась бы в <title>
    expect(() =>
      parseXml(
        '<rss><item><!DOCTYPE x [<!ENTITY e "zzz">]></item><title>&e;</title></rss>',
      ),
    ).toThrow(/DOCTYPE/)
  })

  it('rejects a DOCTYPE hidden behind fake comments, CDATA or PI', () => {
    const dtd = '<!DOCTYPE x [<!ENTITY e "zzz">]>'

    for (const body of [
      `<rss a="<!--">${dtd}<t>&e;</t><z c="-->"/></rss>`,
      `<rss a="<![CDATA[">${dtd}<t>&e;</t><z c="]]>"/></rss>`,
      `<?xml version="1.0"?><?pi <!-- ?>${dtd}<rss><t>&e;</t></rss><?pi --> ?>`,
      `<?xml version="1.0" x="<!--"?>${dtd}<rss><t>&e;</t><z y="-->"/></rss>`,
    ]) {
      expect(() => parseXml(body)).toThrow(/DOCTYPE/)
    }
  })

  it('rejects DOCTYPE text even inside CDATA', () => {
    expect(() =>
      parseXml(
        '<rss><item><description><![CDATA[a <!DOCTYPE x> b]]></description></item></rss>',
      ),
    ).toThrow(/DOCTYPE/)
  })

  it('still decodes the predefined entities', () => {
    const xml = parseXml('<rss><title>Tom &amp; Jerry</title></rss>')

    expect(text(xml.rss, 'title')).toBe('Tom & Jerry')
  })

  it('reports a DOCTYPE response as a bad source response', async () => {
    const error = await readTorznabXml(
      new Response(withEntities, { status: 200 }),
    ).catch((err: unknown) => err)

    expect(error).toBeInstanceOf(SourceError)
    expect((error as SourceError).kind).toBe('bad_response')
  })
})
