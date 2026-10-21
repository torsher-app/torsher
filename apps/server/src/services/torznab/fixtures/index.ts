// Синтетические ответы Torznab и менеджеров индексаторов по их документации:
// имена индексаторов и адреса вымышленные

export const capsXml = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.0" title="Indexer A" />
  <limits max="100" default="50" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep,imdbid" />
    <movie-search available="no" supportedParams="q" />
  </searching>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2040" name="Movies/HD" />
    </category>
    <category id="5000" name="TV">
      <subcat id="5030" name="TV/SD" />
      <subcat id="5040" name="TV/HD" />
    </category>
  </categories>
</caps>`

export function torznabErrorXml(code: number, description: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<error code="${code}" description="${description}" />`
}

export const prowlarrIndexers = [
  {
    id: 1,
    name: 'Indexer A',
    protocol: 'torrent',
    enable: true,
    privacy: 'public',
  },
  {
    id: 2,
    name: 'Indexer B',
    protocol: 'torrent',
    enable: false,
    privacy: 'private',
  },
  {
    id: 3,
    name: 'Usenet Indexer',
    protocol: 'usenet',
    enable: true,
    privacy: 'private',
  },
]

export const jackettIndexersXml = `<?xml version="1.0" encoding="UTF-8"?>
<indexers>
  <indexer id="indexer-a" configured="true">
    <title>Indexer A</title>
    <description>Synthetic indexer</description>
    <link>https://indexer.example/</link>
    <language>en-US</language>
    <type>public</type>
    <caps>
      <searching>
        <search available="yes" supportedParams="q" />
        <tv-search available="yes" supportedParams="q,season,ep" />
        <movie-search available="yes" supportedParams="q,imdbid" />
      </searching>
      <categories>
        <category id="2000" name="Movies" />
      </categories>
    </caps>
  </indexer>
  <indexer id="indexer-b" configured="true">
    <title>Indexer B</title>
    <description>Synthetic indexer</description>
    <link>https://indexer-b.example/</link>
    <language>en-US</language>
    <type>private</type>
    <caps>
      <searching>
        <search available="yes" supportedParams="q" />
      </searching>
      <categories />
    </caps>
  </indexer>
</indexers>`
