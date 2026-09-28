import path from "path";
import AppError from "../../../errors/AppError";

// Libraries typed only for newer module resolution; loaded with require.
/* eslint-disable @typescript-eslint/no-var-requires */
const loadPdf = () => require("pdf-parse").PDFParse;
const loadMammoth = () => require("mammoth");
/* eslint-enable @typescript-eslint/no-var-requires */

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".csv", ".json"];

const extensionOf = (fileName: string) => path.extname(fileName || "").toLowerCase();

/** Collapses the whitespace PDFs and Word files leave behind. */
export const normalizeText = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/^-- \d+ of \d+ --$/gm, "") // page markers added by pdf-parse
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Plain text of an uploaded file. */
export const extractText = async (data: Buffer, fileName: string): Promise<string> => {
  const ext = extensionOf(fileName);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) throw new AppError("ERR_AI_KNOWLEDGE_FILE_TYPE");

  let text: string;
  try {
    if (ext === ".pdf") {
      const PDFParse = loadPdf();
      const parser = new PDFParse({ data });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (ext === ".docx") {
      text = (await loadMammoth().extractRawText({ buffer: data })).value;
    } else {
      text = data.toString("utf8");
    }
  } catch (err) {
    throw new AppError(`ERR_AI_KNOWLEDGE_READ: ${String((err as Error)?.message || err).slice(0, 200)}`);
  }

  const clean = normalizeText(text || "");
  // Scanned PDFs are images: nothing to read without OCR.
  if (!clean) throw new AppError("ERR_AI_KNOWLEDGE_EMPTY");
  return clean;
};
