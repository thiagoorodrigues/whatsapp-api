import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";

// Converts any uploaded audio into the mp4 voice-note format. The file name is
// random and the arguments go to ffmpeg as an array (execFile, no shell):
// nothing sent by the client ends up in a command line.
const convertToVoiceNote = async (input: Buffer): Promise<Buffer> => {
  const base = path.join(os.tmpdir(), `voice-${crypto.randomBytes(12).toString("hex")}`);
  const inputPath = `${base}.in`;
  const outputPath = `${base}.m4a`;
  await fs.promises.writeFile(inputPath, input);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath.path,
        ["-i", inputPath, "-vn", "-ar", "44100", "-ac", "1", "-b:a", "192k", "-f", "ipod", outputPath, "-y"],
        error => (error ? reject(error) : resolve())
      );
    });
    return await fs.promises.readFile(outputPath);
  } finally {
    await Promise.all([inputPath, outputPath].map(f => fs.promises.unlink(f).catch(() => undefined)));
  }
};

export default convertToVoiceNote;
