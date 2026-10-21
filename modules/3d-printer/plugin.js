// Only registration is implemented. Slicing and printer output will be rewritten.
export function activate(context) {
  if (context.version !== 1) throw Error('Unsupported Frame plugin API');
}
