const execFile = jest.fn();
jest.mock("child_process", () => ({ execFile: (...a: any[]) => execFile(...a) }));
jest.mock("@ffmpeg-installer/ffmpeg", () => ({ __esModule: true, default: { path: "/bin/ffmpeg" } }));

/* eslint-disable import/first */
import fs from "fs";
import convertToVoiceNote from "../convertToVoiceNote";
/* eslint-enable import/first */

describe("convertToVoiceNote", () => {
  it("calls ffmpeg without a shell, on random temp files, and cleans up", async () => {
    execFile.mockImplementation((_bin: string, args: string[], cb: any) => {
      fs.writeFileSync(args[args.length - 2], "converted");
      cb(null);
    });
    const out = await convertToVoiceNote(Buffer.from("raw"));
    expect(out.toString()).toBe("converted");

    const [bin, args] = execFile.mock.calls[0];
    expect(bin).toBe("/bin/ffmpeg");
    expect(Array.isArray(args)).toBe(true);
    const input = args[args.indexOf("-i") + 1];
    expect(input).toMatch(/voice-[0-9a-f]{24}\.in$/);
    expect(fs.existsSync(input)).toBe(false);
    expect(fs.existsSync(args[args.length - 2])).toBe(false);
  });

  it("fails when ffmpeg fails, still removing the temp files", async () => {
    execFile.mockImplementation((_b: string, _a: string[], cb: any) => cb(new Error("bad audio")));
    await expect(convertToVoiceNote(Buffer.from("raw"))).rejects.toThrow("bad audio");
    const input = execFile.mock.calls[execFile.mock.calls.length - 1][1][1];
    expect(fs.existsSync(input)).toBe(false);
  });
});
