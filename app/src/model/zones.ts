// Defensive zone drops (ZoneNum enum) → field ellipses for play art.
// Orientation is verified from the library: DEEP3A is the −x third (CB at x −16 in Cover 3 Sky), DEEP3B the middle,
// DEEP3C the +x third; *_LEFT zones are on −x (CURLFLAT_LEFT is played by the −x outside linebacker).
// Depths are drawing positions (where the zone sits after the drop), not the defender's alignment.
import type { Vec, ZoneKind } from "./types";

export interface ZoneSpec {
  kind: ZoneKind;
  center: Vec;
  rx: number;
  ry: number;
  /** Short uppercase label for detail views. */
  label: string;
}

const z = (kind: ZoneKind, x: number, y: number, rx: number, ry: number, label: string): ZoneSpec => ({
  kind,
  center: { x, y },
  rx,
  ry,
  label,
});

const SPECS: Record<string, ZoneSpec> = {
  // Deep halves / thirds / quarters, A → D from −x to +x.
  ZONENUM_DEEP2A: z("deep", -12, 21, 11, 5.5, "DEEP 1/2"),
  ZONENUM_DEEP2B: z("deep", 12, 21, 11, 5.5, "DEEP 1/2"),
  ZONENUM_DEEP3A: z("deep", -17, 19, 7.5, 5.5, "DEEP 1/3"),
  ZONENUM_DEEP3B: z("deep", 0, 22, 8, 5.5, "DEEP 1/3"),
  ZONENUM_DEEP3C: z("deep", 17, 19, 7.5, 5.5, "DEEP 1/3"),
  ZONENUM_DEEP4A: z("deep", -19.5, 18, 5.5, 5, "DEEP 1/4"),
  ZONENUM_DEEP4B: z("deep", -6.5, 21, 6, 5, "DEEP 1/4"),
  ZONENUM_DEEP4C: z("deep", 6.5, 21, 6, 5, "DEEP 1/4"),
  ZONENUM_DEEP4D: z("deep", 19.5, 18, 5.5, 5, "DEEP 1/4"),

  // Flats: near the sidelines, shallow.
  ZONENUM_FLATZONE_CLOUD_LEFT: z("flat", -19, 5, 5.5, 3, "CLOUD"),
  ZONENUM_FLATZONE_CLOUD_RIGHT: z("flat", 19, 5, 5.5, 3, "CLOUD"),
  ZONENUM_FLATZONE_HARDFLAT_LEFT: z("flat", -18, 3.5, 5.5, 2.5, "HARD FLAT"),
  ZONENUM_FLATZONE_HARDFLAT_RIGHT: z("flat", 18, 3.5, 5.5, 2.5, "HARD FLAT"),
  ZONENUM_FLATZONE_SOFTSQUAT_LEFT: z("flat", -18.5, 6, 5.5, 3, "SOFT SQUAT"),
  ZONENUM_FLATZONE_SOFTSQUAT_RIGHT: z("flat", 18.5, 6, 5.5, 3, "SOFT SQUAT"),
  ZONENUM_FLATZONE_PRIORITY_LEFT: z("flat", -17, 4.5, 5.5, 3, "FLAT"),
  ZONENUM_FLATZONE_PRIORITY_RIGHT: z("flat", 17, 4.5, 5.5, 3, "FLAT"),

  // Curl-to-flat: between the hook and the flat.
  ZONENUM_CURLTOFLAT_CURLFLAT_LEFT: z("curlflat", -14, 7, 5, 3.5, "CURL/FLAT"),
  ZONENUM_CURLTOFLAT_CURLFLAT_RIGHT: z("curlflat", 14, 7, 5, 3.5, "CURL/FLAT"),
  ZONENUM_CURLTOFLAT_SEAMFLAT_LEFT: z("curlflat", -11.5, 8, 5, 3.5, "SEAM/FLAT"),
  ZONENUM_CURLTOFLAT_SEAMFLAT_RIGHT: z("curlflat", 11.5, 8, 5, 3.5, "SEAM/FLAT"),
  ZONENUM_CURLTOFLAT_QUARTERSFLAT_LEFT: z("curlflat", -15, 5.5, 5, 3, "QTRS FLAT"),
  ZONENUM_CURLTOFLAT_QUARTERSFLAT_RIGHT: z("curlflat", 15, 5.5, 5, 3, "QTRS FLAT"),
  ZONENUM_CURLTOFLAT_PRIORITY_LEFT: z("curlflat", -14, 6, 5, 3, "CURL/FLAT"),
  ZONENUM_CURLTOFLAT_PRIORITY_RIGHT: z("curlflat", 14, 6, 5, 3, "CURL/FLAT"),

  // Hooks: underneath, y ≈ 8–11.
  ZONENUM_HOOK_MIDDLEREAD: z("hook", 0, 11, 3.5, 2.5, "MID READ"),
  ZONENUM_HOOK_3RECHOOK: z("hook", 0, 9, 4, 2.5, "3 REC HOOK"),
  ZONENUM_HOOK_HOOKCURL_LEFT: z("hook", -6, 9, 4, 2.5, "HOOK/CURL"),
  ZONENUM_HOOK_HOOKCURL_RIGHT: z("hook", 6, 9, 4, 2.5, "HOOK/CURL"),
  ZONENUM_HOOK_VERTICALHOOK_LEFT: z("hook", -4.5, 11, 3.5, 3, "VERT HOOK"),
  ZONENUM_HOOK_VERTICALHOOK_RIGHT: z("hook", 4.5, 11, 3.5, 3, "VERT HOOK"),
  ZONENUM_HOOK_CURL_LEFT: z("hook", -10, 9, 4, 2.5, "CURL"),
  ZONENUM_HOOK_CURL_RIGHT: z("hook", 10, 9, 4, 2.5, "CURL"),
};

// The dumper printed some values under their range-marker alias (same numeric value). Verified against the library:
// UNDERNEATHZONE_FIRST is used by FlatZone drops on −x (= CLOUD_LEFT); UNDERNEATHZONE_LAST by HookZone drops on +x
// (= HOOK_CURL_RIGHT, the mirror of HOOK_CURL_LEFT).
const ALIASES: Record<string, string> = {
  ZONENUM_DEEPZONE_FIRST: "ZONENUM_DEEP2A",
  ZONENUM_DEEPZONE_LAST: "ZONENUM_DEEP4D",
  ZONENUM_FLATZONE_FIRST: "ZONENUM_FLATZONE_CLOUD_LEFT",
  ZONENUM_UNDERNEATHZONE_FIRST: "ZONENUM_FLATZONE_CLOUD_LEFT",
  ZONENUM_FLATZONE_LAST: "ZONENUM_FLATZONE_PRIORITY_RIGHT",
  ZONENUM_CURLTOFLAT_FIRST: "ZONENUM_CURLTOFLAT_CURLFLAT_LEFT",
  ZONENUM_CURLTOFLAT_LAST: "ZONENUM_CURLTOFLAT_PRIORITY_RIGHT",
  ZONENUM_HOOK_FIRST: "ZONENUM_HOOK_MIDDLEREAD",
  ZONENUM_HOOK_LAST: "ZONENUM_HOOK_CURL_RIGHT",
  ZONENUM_UNDERNEATHZONE_LAST: "ZONENUM_HOOK_CURL_RIGHT",
};

/** Zone ellipse for a ZoneNum value, or undefined for ZONENUM_NONE / ZONENUM_MAX / unknown values. */
export function zoneSpec(zoneNum: string): ZoneSpec | undefined {
  return SPECS[ALIASES[zoneNum] ?? zoneNum];
}

/** Zone step type → the step field holding its ZoneNum and the zone kind it draws. */
export const ZONE_STEPS: Record<string, { field: string; kind: ZoneKind }> = {
  DeepZone: { field: "deepZone", kind: "deep" },
  HookZone: { field: "hookZone", kind: "hook" },
  FlatZone: { field: "flatZone", kind: "flat" },
  CurlFlatZone: { field: "curlFlatZone", kind: "curlflat" },
};

/** QB spy (ReadAndBlitz) area relative to the defender: sits over the ball a few yards deep. */
export function spyZone(from: Vec): ZoneSpec {
  return z("spy", from.x * 0.5, Math.min(8, Math.max(3.5, from.y)), 2.5, 1.8, "SPY");
}
