import type { Device, Profile } from '@torsher/api-client'
import { language } from '@torsher/i18n'
import { useI18n } from 'vue-i18n'

/** Тексты профиля и устройства для строки и карточки */
export function useProfileMeta() {
  const { t } = useI18n()

  // Название языка — на нём самом, как в меню выбора языка
  function languageOf(profile: Pick<Profile, 'language'>) {
    return profile.language
      ? language[profile.language]
      : t('panel.people.profiles.deviceLanguage')
  }

  function ageOf(profile: Pick<Profile, 'ageLimit'>) {
    return profile.ageLimit
      ? t('panel.people.profiles.age', { age: profile.ageLimit })
      : t('panel.people.profileDialog.noLimits')
  }

  function typeOf(device: Pick<Device, 'type'>) {
    return t(`panel.people.devices.types.${device.type}`)
  }

  return { languageOf, ageOf, typeOf }
}
