// Acceptance predicates, not GPU emulation. Used by hardware gates and CPU negative controls.
export const isHardwareAdapter=h=>!!h&&h.isFallbackAdapter===false&&Object.values(h).some(v=>typeof v==='string'&&v)&&!/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(h));
export const isDecodedNativeIcon=i=>!!i&&i.decoded===true&&i.complete===true&&i.width===32&&i.height===32&&i.naturalWidth===32&&i.naturalHeight===32&&i.rect?.width===32&&i.rect?.height===32;
export const hasBoundedFrameTimings=s=>!!s&&s.timestampQueries===true&&Array.isArray(s.frames)&&s.frames.length===12&&s.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<50&&f.gpuMs<50);
