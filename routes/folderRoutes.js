// server/routes/folderRoutes.js
import express from "express";
import supabase from "../supabase/supabaseClient.js";

const router = express.Router();

/**
 * Create a folder (uses authenticated user)
 * POST /api/folders
 * body: { folder_name, parent_folder_id? }
 */
router.post("/", async (req, res) => {
  try {
    const user_id = req.user?.id;
    const { folder_name, parent_folder_id = null } = req.body;

    if (!user_id) return res.status(401).json({ error: "Unauthorized" });
    if (!folder_name) return res.status(400).json({ error: "folder_name is required" });

    const { data, error } = await supabase
      .from("folders")
      .insert([{ user_id, folder_name, parent_folder_id }])
      .select();

    if (error) throw error;

    res.json({ message: "Folder created", folder: data[0] });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to create folder" });
  }
});

/**
 * List folders for the current user
 * GET /api/folders?parent_folder_id=<id|null>
 */
router.get("/", async (req, res) => {
  try {
    const user_id = req.user?.id;
    if (!user_id) return res.status(401).json({ error: "Unauthorized" });

    const parent_folder_id_raw = req.query.parent_folder_id;
    const parent_folder_id =
      parent_folder_id_raw === "null" || parent_folder_id_raw === undefined
        ? null
        : Number(parent_folder_id_raw);

    const { data, error } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", user_id)
      .eq("parent_folder_id", parent_folder_id);

    if (error) throw error;

    res.json({ folders: data });
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to fetch folders" });
  }
});

export default router;
