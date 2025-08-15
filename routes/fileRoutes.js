// server/routes/fileRoutes.js
import express from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import supabase from "../supabase/supabaseClient.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const BUCKET = "files";
const bucket = supabase.storage.from(BUCKET);

// ---------- helpers ----------
async function getFolderName(user_id, folder_id) {
  if (!folder_id) return "";
  const { data, error } = await supabase
    .from("folders")
    .select("folder_name, user_id")
    .eq("id", folder_id)
    .single();

  if (error || !data) throw new Error("Folder not found");
  if (data.user_id !== user_id) throw new Error("Forbidden");
  return data.folder_name;
}

function buildStoragePath({ user_id, folderName, serverFileName }) {
  return `${user_id}/${folderName ? folderName + "/" : ""}${serverFileName}`;
}

async function getOwnedFileById(user_id, file_id) {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", file_id)
    .eq("user_id", user_id)
    .single();

  if (error || !data) throw new Error("File not found");
  return data;
}

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/zip",
]);

// ---------- routes ----------

// Upload a file (multipart/form-data: file, optional folder_id)
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    if (!ALLOWED_MIME.has(file.mimetype)) {
      return res.status(415).json({ error: `File type not allowed: ${file.mimetype}` });
    }

    const folder_id = req.body.folder_id ? Number(req.body.folder_id) : null;
    const folderName = await getFolderName(user_id, folder_id).catch((e) => {
      if (folder_id) throw e;
      return "";
    });

    const serverFileName = `${uuidv4()}_${file.originalname}`;
    const storagePath = buildStoragePath({ user_id, folderName, serverFileName });

    const { error: storageError } = await bucket.upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (storageError) throw storageError;

    const { data: dbRows, error: dbError } = await supabase
      .from("files")
      .insert([
        {
          user_id,
          file_name: file.originalname,
          file_path: storagePath,
          file_type: file.mimetype,
          size: file.size,
          folder_id,
        },
      ])
      .select();

    if (dbError) throw dbError;

    res.json({ message: "File uploaded", file: dbRows[0] });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(400).json({ error: err.message || "Upload failed" });
  }
});

// List files (optionally filter by folder_id)
router.get("/", async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const folder_id = req.query.folder_id ? Number(req.query.folder_id) : null;

    let q = supabase.from("files").select("*").eq("user_id", user_id);
    if (folder_id) q = q.eq("folder_id", folder_id);
    else q = q.is("folder_id", null);

    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw error;

    res.json({ files: data });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to list files" });
  }
});

// Download by file ID
router.get("/download/:file_id", async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const file_id = Number(req.params.file_id);
    const file = await getOwnedFileById(user_id, file_id);

    const { data, error } = await bucket.download(file.file_path);
    if (error) throw error;

    const buffer = Buffer.from(await data.arrayBuffer());
    res.setHeader("Content-Disposition", `attachment; filename="${file.file_name}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message || "Download failed" });
  }
});

// Delete by file ID
router.delete("/:file_id", async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const file_id = Number(req.params.file_id);
    const file = await getOwnedFileById(user_id, file_id);

    const { error: storageError } = await bucket.remove([file.file_path]);
    if (storageError) throw storageError;

    const { error: dbError } = await supabase
      .from("files")
      .delete()
      .eq("id", file_id)
      .eq("user_id", user_id);
    if (dbError) throw dbError;

    res.json({ message: "File deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message || "Delete failed" });
  }
});

// Rename by file ID
router.put("/rename/:file_id", async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const file_id = Number(req.params.file_id);
    const { newName } = req.body;
    if (!newName) return res.status(400).json({ error: "newName is required" });

    const file = await getOwnedFileById(user_id, file_id);

    const { data: dl, error: dlErr } = await bucket.download(file.file_path);
    if (dlErr) throw dlErr;
    const buffer = Buffer.from(await dl.arrayBuffer());

    const parts = file.file_path.split("/");
    const maybeFolderName = parts.length > 2 ? parts[1] : "";
    const newStoragePath = buildStoragePath({
      user_id,
      folderName: maybeFolderName,
      serverFileName: `${uuidv4()}_${newName}`,
    });

    const { error: upErr } = await bucket.upload(newStoragePath, buffer, { upsert: false });
    if (upErr) throw upErr;

    const { error: dbErr } = await supabase
      .from("files")
      .update({ file_name: newName, file_path: newStoragePath })
      .eq("id", file_id)
      .eq("user_id", user_id);
    if (dbErr) throw dbErr;

    await bucket.remove([file.file_path]); // best-effort

    res.json({ message: "File renamed" });
  } catch (err) {
    res.status(400).json({ error: err.message || "Rename failed" });
  }
});

// (Optional) Signed share URL
router.post("/share/:file_id", async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const file_id = Number(req.params.file_id);
    const { expiresIn = 3600 } = req.body;

    const file = await getOwnedFileById(user_id, file_id);

    const { data, error } = await bucket.createSignedUrl(file.file_path, expiresIn);
    if (error) throw error;

    res.json({ url: data.signedUrl, expiresIn });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to create share link" });
  }
});

export default router;
