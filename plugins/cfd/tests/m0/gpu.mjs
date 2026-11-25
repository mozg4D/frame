export {gpuScope} from '../../plugin.js';

export const median = a => {
  const s = [...a].sort((x,y) => x-y), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i-1] + s[i]) / 2;
};
