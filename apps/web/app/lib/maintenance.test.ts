import { readFileSync } from 'node:fs'
import { MaintenanceReason } from '@torsher/api-client'
import { attentionMessage } from '@torsher/i18n'
import { expect, it } from 'vitest'

it('каждая серверная причина обслуживания имеет русский и английский текст', () => {
  for (const locale of ['en_US', 'ru_RU']) {
    const messages = JSON.parse(
      readFileSync(
        new URL(
          `../../../../packages/i18n/src/locales/${locale}/ui.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    )
    expect(Object.keys(messages.panel.maintenance.reasons).sort()).toEqual(
      Object.values(MaintenanceReason).sort(),
    )
  }
})

it('restore hold использует самостоятельное сообщение без суффикса one/many', () => {
  expect(
    attentionMessage({ kind: 'maintenance_restore_hold', params: {} }).key,
  ).toBe('panel.overview.attention.maintenance_restore_hold')
})
