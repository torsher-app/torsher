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

// Хеши — повторяющиеся цифры, а не реальные раздачи
export const searchXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Indexer A</title>
    <item>
      <title>Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 1080p | LostFilm</title>
      <guid>https://indexer.example/details/101</guid>
      <comments>https://indexer.example/details/101</comments>
      <link>https://indexer.example/download/101?apikey=secret-key</link>
      <pubDate>Mon, 14 Oct 2024 18:00:00 +0000</pubDate>
      <size>16106127360</size>
      <category>5000</category>
      <category>5040</category>
      <enclosure url="https://indexer.example/download/101?apikey=secret-key" length="16106127360" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="42" />
      <torznab:attr name="peers" value="50" />
      <torznab:attr name="infohash" value="1111111111111111111111111111111111111111" />
    </item>
    <item>
      <title>Quiet.Harbor.S02E05.2160p.WEB-DL.DV.H.265-GRP</title>
      <guid>quiet-harbor-s02e05</guid>
      <link>magnet:?xt=urn:btih:2222222222222222222222222222222222222222&amp;dn=Quiet.Harbor.S02E05</link>
      <torznab:attr name="size" value="5368709120" />
      <torznab:attr name="seeders" value="7" />
      <torznab:attr name="category" value="5000,5045" />
      <torznab:attr name="magneturl" value="magnet:?xt=urn:btih:2222222222222222222222222222222222222222&amp;dn=Quiet.Harbor.S02E05" />
    </item>
    <item>
      <title>   </title>
      <link>https://indexer.example/download/103</link>
    </item>
  </channel>
</rss>`

export const emptySearchXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Indexer A</title>
  </channel>
</rss>`
