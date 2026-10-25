<template>
  <!-- Вход и «О программе» без входа: страница по центру, без оболочки панели -->
  <div class="flex min-h-svh flex-col items-center px-4 py-8">
    <div class="my-auto flex w-full flex-col items-center">
      <slot />
    </div>
  </div>
</template>
