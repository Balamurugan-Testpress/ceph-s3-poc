// Shared formatting helpers. Each component used to declare its own
// formatBytes — the variants drifted in subtle ways (some returned "0 B" for
// undefined, some crashed; decimal precision varied). Centralizing keeps
// the dashboard tiles and the bucket tables visually consistent.

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes, decimals = 1) {
  if (bytes === 0 || bytes == null || Number.isNaN(bytes)) return "0 B";
  const abs = Math.abs(bytes);
  const i = Math.min(
    UNITS.length - 1,
    Math.floor(Math.log(abs) / Math.log(1024))
  );
  const val = bytes / Math.pow(1024, i);
  // Whole bytes don't need decimals — "1024 B" is noise.
  const d = i === 0 ? 0 : decimals;
  return val.toFixed(d) + " " + UNITS[i];
}

export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return "0";
  return Number(n).toLocaleString();
}

// Compact form for KPI tiles: 1.2k, 3.4M, etc. Keeps stat cards from wrapping.
export function formatCompact(num) {
  if (!num) return "0";
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "k";
  return String(num);
}
