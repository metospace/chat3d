export const MAX_GLB_BYTES = 512 * 1024 * 1024;

export function assertGlbSize(size: number): void {
  if (size > MAX_GLB_BYTES) throw Error(`GLB文件不能超过${MAX_GLB_BYTES / 1024 / 1024} MiB`);
}
