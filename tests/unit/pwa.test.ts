import { describe, expect, it } from "vitest";
import { detectDevice } from "@/lib/pwa/device";

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("detectDevice", () => {
  it("recognises Android, iOS and desktop platforms and the browser", () => {
    expect(detectDevice(UA.androidChrome)).toEqual({ platform: "android", browser: "Chrome" });
    expect(detectDevice(UA.samsung)).toEqual({ platform: "android", browser: "Samsung Internet" });
    expect(detectDevice(UA.iphoneSafari)).toEqual({ platform: "ios", browser: "Safari" });
    expect(detectDevice(UA.iphoneChrome)).toEqual({ platform: "ios", browser: "Chrome" });
    expect(detectDevice(UA.windowsEdge)).toEqual({ platform: "windows", browser: "Edge" });
    expect(detectDevice(UA.windowsChrome)).toEqual({ platform: "windows", browser: "Chrome" });
    expect(detectDevice(UA.macChrome)).toEqual({ platform: "macos", browser: "Chrome" });
    expect(detectDevice(UA.linuxFirefox)).toEqual({ platform: "linux", browser: "Firefox" });
  });
  it("tells an iPad (which claims to be a Mac) from a real Mac by touch points", () => {
    expect(detectDevice(UA.ipadAsMac, { maxTouchPoints: 5 }).platform).toBe("ios");
    expect(detectDevice(UA.ipadAsMac, { maxTouchPoints: 0 }).platform).toBe("macos");
  });
  it("falls back safely", () => {
    expect(detectDevice("")).toEqual({ platform: "other", browser: "Other" });
    expect(detectDevice("curl/8.0")).toEqual({ platform: "other", browser: "Other" });
  });
});
