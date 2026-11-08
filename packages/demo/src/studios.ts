/** Fictional UI fixtures, deliberately separate from the production parser. */
export const demoStudios = [
  { name: 'Demo Studio A', aliases: ['Demo Alpha', 'Demo Voices'] },
  { name: 'Demo Studio B', aliases: ['Demo Beta', 'Studio North'] },
  { name: 'Demo Studio C', aliases: ['Demo Gamma'] },
]
export const demoFoundStudios = demoStudios
  .slice(0, 2)
  .map(studio => studio.name)

function key(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s.\-_]+/g, '')
}
export function demoStudioName(value: string): string | undefined {
  return demoStudios.find(studio =>
    [studio.name, ...studio.aliases].some(name => key(name) === key(value)),
  )?.name
}
