import uploadConfig from "../upload";

// O typeArch/fileId vêm do corpo e viram pasta em public/.
const destination = (body: Record<string, string>) =>
  new Promise<{ err: Error | null; folder: string }>(resolve => {
    (uploadConfig.storage as any).getDestination({ body }, {}, (err: Error | null, folder: string) => resolve({ err, folder }));
  });

describe("upload folder", () => {
  it("refuses folder names that leave public/", async () => {
    for (const body of [{ typeArch: "../../etc" }, { typeArch: "campaign", fileId: "../x" }, { typeArch: "a/b" }]) {
      const { err } = await destination(body);
      expect(err?.message).toBe("ERR_INVALID_UPLOAD_FOLDER");
    }
  });
});
