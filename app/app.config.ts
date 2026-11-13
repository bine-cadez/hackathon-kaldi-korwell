// Nuxt UI component defaults, styled after kaldi.si. Colours are defined in
// app/assets/main.css.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'flame',
      error: 'rust',
      warning: 'orange',
      success: 'green',
      neutral: 'kaldi'
    },
    button: {
      // Kaldi buttons are pills.
      slots: { base: 'rounded-full font-normal' }
    },
    input: {
      slots: { base: 'rounded-full' }
    },
    select: {
      slots: { base: 'rounded-full' }
    },
    textarea: {
      slots: { base: 'rounded-2xl' }
    },
    card: {
      slots: { root: 'rounded-2xl ring-default' }
    }
  }
})
