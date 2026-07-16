import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";

// Sibling to the SQLite file, same "where does persistent stuff live" convention as
// DATABASE_PATH — files live on disk (not as DB blobs, not in the cloud) since this is a
// single-process, single-filesystem app.
export const UPLOADS_DIR = process.env.UPLOADS_DIR || "./uploads";
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      cb(null, crypto.randomBytes(16).toString("hex") + (EXTENSION_BY_MIME[file.mimetype] ?? ""));
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Dateityp nicht erlaubt. Erlaubt: PDF, PNG, JPEG, WebP."));
      return;
    }
    cb(null, true);
  },
});

export function attachmentPath(storedName: string) {
  return path.join(UPLOADS_DIR, storedName);
}
