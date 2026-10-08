import {
  parseProcStat,
  cpuPercentBetween,
  parseMeminfo,
  parseCgroupMemory,
  readServerMetrics
} from "../readServerMetrics";

const STAT_A = "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 50 0 50 350 50 0 0 0 0 0\n";
const STAT_B = "cpu  200 0 200 1300 100 0 0 0 0 0\n";
const MEMINFO = "MemTotal:        8000000 kB\nMemFree:          500000 kB\nMemAvailable:    2000000 kB\n";

describe("parsers", () => {
  it("reads idle (idle + iowait) and total from the cpu line", () => {
    expect(parseProcStat(STAT_A)).toEqual({ idle: 800, total: 1000 });
    expect(parseProcStat("garbage")).toBeNull();
  });

  it("computes busy percent between two samples", () => {
    // total +800, idle +600 → 25% busy
    expect(cpuPercentBetween(parseProcStat(STAT_A)!, parseProcStat(STAT_B)!)).toBe(25);
    expect(cpuPercentBetween({ idle: 1, total: 10 }, { idle: 1, total: 10 })).toBeNull();
  });

  it("uses MemAvailable for used memory", () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ total: 8000000 * 1024, used: 6000000 * 1024 });
    expect(parseMeminfo("MemTotal: 10 kB\n")).toBeNull();
  });

  it("reads cgroup v2 memory.current and ignores 'max'", () => {
    expect(parseCgroupMemory("123456\n")).toBe(123456);
    expect(parseCgroupMemory("max\n")).toBeNull();
    expect(parseCgroupMemory("")).toBeNull();
  });
});

describe("readServerMetrics", () => {
  it("reads Linux sources", async () => {
    const stats = [STAT_A, STAT_B];
    const files: Record<string, () => string> = {
      "/proc/stat": () => stats.shift() as string,
      "/proc/meminfo": () => MEMINFO,
      "/sys/fs/cgroup/memory.current": () => "300000000\n"
    };
    const snap = await readServerMetrics({
      sampleMs: 0,
      readFile: async p => (files[p] ? files[p]() : null),
      statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
      diskPath: "/x"
    });
    expect(snap.cpuPercent).toBe(25);
    expect(snap.memTotalBytes).toBe(8000000 * 1024);
    expect(snap.memUsedBytes).toBe(6000000 * 1024);
    expect(snap.apiMemBytes).toBe(300000000);
    expect(snap.diskTotalBytes).toBe(4096 * 1000);
    expect(snap.diskUsedBytes).toBe(4096 * 750);
    expect(snap.cpuCount).toBeGreaterThan(0);
    expect(typeof snap.load5).toBe("number");
  });

  it("falls back to os when /proc and cgroup are missing (Mac) and never throws", async () => {
    const snap = await readServerMetrics({
      sampleMs: 0,
      readFile: async () => null,
      statfs: async () => {
        throw new Error("ENOENT");
      },
      diskPath: "/nope"
    });
    expect(snap.memTotalBytes).toBeGreaterThan(0);
    expect(snap.apiMemBytes).toBeGreaterThan(0); // process rss
    expect(snap.diskUsedBytes).toBeNull();
    expect(snap.diskTotalBytes).toBeNull();
    expect(snap.cpuPercent === null || typeof snap.cpuPercent === "number").toBe(true);
  });
});
