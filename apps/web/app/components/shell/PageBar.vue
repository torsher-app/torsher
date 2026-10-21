<script setup lang="ts">
import { MenuIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'

defineProps<{
  title: string
  /** Раздел-родитель: на телефоне путь сокращается до названия */
  parent?: string
  parentTo?: string
}>()

const { t } = useI18n()
const { toggleSidebar } = useSidebar()
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-1.5 border-b px-2 md:px-3">
    <Button
      variant="ghost"
      size="icon-sm"
      class="md:hidden"
      :aria-label="t('panel.nav.open')"
      @click="toggleSidebar"
    >
      <MenuIcon />
    </Button>
    <Breadcrumb class="min-w-0 px-1">
      <BreadcrumbList class="flex-nowrap gap-1.5 text-[13.5px] sm:gap-1.5">
        <template v-if="parent">
          <BreadcrumbItem class="hidden md:inline-flex">
            <BreadcrumbLink v-if="parentTo" as-child>
              <NuxtLink :to="parentTo">
                {{ parent }}
              </NuxtLink>
            </BreadcrumbLink>
            <template v-else>
              {{ parent }}
            </template>
          </BreadcrumbItem>
          <BreadcrumbSeparator class="hidden md:block" />
        </template>
        <BreadcrumbItem class="min-w-0">
          <BreadcrumbPage class="truncate font-medium">
            {{ title }}
          </BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
    <div class="ml-auto flex shrink-0 items-center gap-1.5">
      <slot name="actions" />
    </div>
  </header>
</template>
