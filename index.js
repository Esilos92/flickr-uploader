// index.js

import express from "express";
import { createFlickr } from "flickr-sdk";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";
import fetch from "node-fetch";
import multer from "multer";

const app = express();
app.use(express.json());

const uploadMiddleware = multer().none();

// Authenticated SDK setup
const { flickr, upload } = createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

async function getAlbums() {
  const res = await flickr("flickr.photosets.getList", {
    user_id: process.env.FLICKR_USER_ID,
  });
  return res.body.photosets.photoset;
}

async function findOrCreateAlbum(title, primaryPhotoId) {
  const albums = await getAlbums();
  const existing = albums.find((a) => a.title._content === title);
  if (existing) return existing.id;

  const res = await flickr("flickr.photosets.create", {
    title,
    primary_photo_id: primaryPhotoId,
  });
  return res.body.photoset.id;
}

async function uploadPhotoFromUrl(imageUrl, title, albumTitle) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("Failed to fetch image from URL");

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const tempFilePath = join(tmpdir(), title);
  await writeFile(tempFilePath, buffer);

  try {
    const photoId = await upload(tempFilePath, { title });
    const albumId = await findOrCreateAlbum(albumTitle, photoId);

    await flickr("flickr.photosets.addPhoto", {
      photoset_id: albumId,
      photo_id: photoId,
    });

    return { success: true, photoId, albumId };
  } finally {
    await unlink(tempFilePath);
  }
}

app.get("/", (req, res) => {
  res.send("✅ Flickr Upload API is running.");
});

app.post("/upload", uploadMiddleware, async (req, res) => {
  const { imageUrl, albumPath } = req.body;

  if (!imageUrl || !albumPath) {
    return res.status(400).json({ error: "Missing imageUrl or albumPath" });
  }

  try {
    const result = await uploadPhotoFromUrl(imageUrl, "upload.jpg", albumPath);
    res.json(result);
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default app;
