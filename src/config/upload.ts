import path from "path";
import multer from "multer";
import fs from "fs";

const publicFolder = path.resolve(__dirname, "..", "..", "public");

// Files sent by agents: kept in memory, then saved in the company folder
// when the message goes out (helpers/mediaStorage).
export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }
});

export default {
  directory: publicFolder,
  storage: multer.diskStorage({
    destination: async function (req, file, cb) {

      const { typeArch, fileId } = req.body;      

      let folder;

      if (typeArch && typeArch !== "announcements") {
        folder =  path.resolve(publicFolder , typeArch, fileId ? fileId : "") 
      } else if (typeArch && typeArch === "announcements") {
        folder =  path.resolve(publicFolder , typeArch) 
      }
      else
      {
        folder =  path.resolve(publicFolder) 
      }

      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder,  { recursive: true })
        fs.chmodSync(folder, 0o777)
      }
      return cb(null, folder);
    },
    filename(req, file, cb) {
      const { typeArch } = req.body;

      const fileName = typeArch && typeArch !== "announcements" ? file.originalname.replace('/','-').replace(/ /g, "_") : new Date().getTime() + '_' + file.originalname.replace('/','-').replace(/ /g, "_");
      return cb(null, fileName);
    }
  })
};
