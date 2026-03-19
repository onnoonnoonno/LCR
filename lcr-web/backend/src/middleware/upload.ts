/**
 * Multer middleware for Excel file uploads.
 *
 * Files are stored in memory (no disk write) so the controller
 * can hand the buffer directly to the parser service.
 *
 * Configuration is driven by environment variables so it can be
 * tuned without code changes for different deployment environments.
 */

import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';

const MAX_FILE_SIZE_MB = process.env.MAX_FILE_SIZE_MB
  ? parseInt(process.env.MAX_FILE_SIZE_MB, 10)
  : 50;

const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                          // .xls
]);

const ALLOWED_EXTENSIONS = /\.(xlsx|xls)$/i;

const storage = multer.memoryStorage();

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
): void {
  const mimeOk = ALLOWED_MIME_TYPES.has(file.mimetype);
  const extOk = ALLOWED_EXTENSIONS.test(file.originalname);

  if (mimeOk || extOk) {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files (.xlsx, .xls) are accepted.'));
  }
}

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
  },
}).single('file');
