// Nuxt UI component defaults. Colours are defined in app/assets/main.css.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'kaldi',
      error: 'rust',
      warning: 'orange',
      success: 'green',
      neutral: 'stone'
    },
    button: {
      // Kaldi buttons are pills.
      slots: { base: 'rounded-full' }
    },
    card: {
      slots: { root: 'rounded-2xl shadow-xs' }
    }
  }
})
