const BYTE_UNITS = Object.freeze(['B', 'KB', 'MB', 'GB', 'TB']);
const DURATION_UNITS = Object.freeze([
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
]);

/** 664.8 MB, 3.79 GB, 0 B (basis 1024, maks 2 desimal tanpa nol di belakang). */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(2))} ${BYTE_UNITS[index]}`;
}

/** 2 hours, 6 minutes, 1 second */
export function formatDuration(totalSeconds) {
  let remaining = Math.max(0, Math.floor(totalSeconds));
  const parts = [];

  for (const [unit, size] of DURATION_UNITS) {
    const value = Math.floor(remaining / size);
    remaining %= size;
    if (value > 0) parts.push(`${value} ${unit}${value === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(', ') : '0 seconds';
}

export const formatPercent = (value) => `${value.toFixed(2)}%`;

/** 195.206.***.*** (IPv4) atau 2a01:4f8:****:**** (IPv6). */
export function maskIp(ip) {
  if (ip.includes(':')) {
    const [first = '', second = ''] = ip.split(':');
    return `${first}:${second}:****:****`;
  }
  const [a, b] = ip.split('.');
  return `${a}.${b}.***.***`;
}
