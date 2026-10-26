import { reactive, readonly } from 'vue'

const state = reactive({
  hasSources: undefined as boolean | undefined,
})

/**
 * Есть ли на сервере источники раздач — по последнему ответу главной, карточки
 * тайтла или поиска раздач. `undefined` — ответа ещё не было: витрина ведёт
 * себя как с источниками, а экраны поиска узнают об их отсутствии из своего
 * ответа.
 */
export const serverSources = readonly(state)

export function noteHasSources(value: boolean | undefined) {
  if (value !== undefined)
    state.hasSources = value
}

/** Источников точно нет: пути к поиску раздач витрина не показывает */
export function lacksSources() {
  return state.hasSources === false
}
