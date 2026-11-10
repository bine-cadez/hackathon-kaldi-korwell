<template>
  <div>
    <NuxtRouteAnnouncer />
    <header class="archive-header">
      <NuxtLink class="archive-brand" to="/">Korwell</NuxtLink>
      <nav aria-label="Main navigation">
        <NuxtLink to="/">Search</NuxtLink>
        <NuxtLink to="/library">Library</NuxtLink>
        <NuxtLink to="/feed">Add document</NuxtLink>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>
