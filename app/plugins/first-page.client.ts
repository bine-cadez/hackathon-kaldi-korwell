// Tells components whether they are on the page the visit started on (a full
// page load) rather than one reached by clicking a link. The eye uses it to fly
// out of the logo only on arrival. The first navigation comes from the router's
// start location, which matches no route. Nuxt can also re-run the first route
// on load (same path), which does not count as clicking somewhere.
export default defineNuxtPlugin(() => {
  let navigated = false
  useRouter().afterEach((to, from) => {
    if (from.matched.length && from.path !== to.path) navigated = true
  })
  return { provide: { isFirstPage: () => !navigated } }
})
