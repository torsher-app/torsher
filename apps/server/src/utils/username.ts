/**
 * Ключ сравнения имени пользователя: вход не зависит от регистра, пробелов по
 * краям и способа набора одного символа (готовая «й» или «и» с бреве).
 * Локаль `und` — без турецких правил для `I`.
 */
export function normalizeUsername(username: string) {
  return username.trim().normalize('NFKC').toLocaleLowerCase('und')
}
