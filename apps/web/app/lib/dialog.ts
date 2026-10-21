/**
 * Классы для `DialogContent` и `AlertDialogContent`: на телефоне диалог —
 * нижний лист во всю ширину, тело прокручивается, футер с действиями виден.
 * Футер shadcn уже ставит основное действие сверху (`flex-col-reverse`).
 */
export const dialogSheetClass = [
  'max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[30rem]',
  'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:p-5',
  'max-sm:data-[size=default]:max-w-none max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom-10 max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom-10',
].join(' ')
