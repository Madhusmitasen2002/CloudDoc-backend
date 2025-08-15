// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import folderRoutes from "./routes/folderRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { verifyToken } from "./middleware/authMiddleware.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Public
app.use("/api/auth", authRoutes);

// Protected
app.use("/api/folders", verifyToken, folderRoutes);
app.use("/api/files", verifyToken, fileRoutes);

// Health
app.get("/", (_, res) => res.send("CloudVault backend running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
