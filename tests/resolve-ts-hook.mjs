export async function resolve (specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  if (relative && !/\.[cm]?[jt]s$/.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context)
  }
  return nextResolve(specifier, context)
}
