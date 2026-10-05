import { describe, expect, it } from "vitest";
import { filterOptions, normalizeOptions } from "./options";

const opts = normalizeOptions([
  "ReceiverCutAngle_Curl",
  "ReceiverCutAngle_Hitch",
  { value: "RunRoute/WR_Curl_12", label: "WR_Curl_12", hint: "CURL" },
  { value: "Shotgun/Y_Trips_Wk", label: "Y Trips Wk" },
  { value: "curl", label: "Curl" },
]);

describe("filterOptions", () => {
  it("returns everything for an empty query", () => {
    expect(filterOptions(opts, "  ")).toBe(opts);
  });
  it("ranks exact, then label prefix, then word prefix", () => {
    expect(filterOptions(opts, "curl").map((o) => o.value)).toEqual(["curl", "ReceiverCutAngle_Curl", "RunRoute/WR_Curl_12"]);
  });
  it("requires every term and searches spaced variants", () => {
    expect(filterOptions(opts, "trips wk").map((o) => o.value)).toEqual(["Shotgun/Y_Trips_Wk"]);
    expect(filterOptions(opts, "angle hitch").map((o) => o.value)).toEqual(["ReceiverCutAngle_Hitch"]);
    expect(filterOptions(opts, "zzz")).toEqual([]);
  });
});
