import express from "express";
import multer from "multer";
import { createFlickr } from "flickr-sdk";
import { tmpdir } from "os";
import { join, parse } from "path";
import { writeFile } from "fs/promises";
import { unlink } from "fs/promises";

// Flickr credentials (replace with your actual secrets)
const flickrAuth = {
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_OAUTH_TOKEN,
  oauthTokenSecret: process.env.FLICKR_OAUTH_TOKEN_SECRET,
};

const userId = process.env.FLICKR_USER_ID;

const { flickr, upload } = createFlickr(flickrAuth);

const app = express();
const uploadMiddleware = multer({ dest: tmpdir() });

app.use(express.json());

async function getAlbums() {
  const res = await flickr("flickr.photosets.getList", { user_id: userId });
  return res.photosets.photoset.map((set) => ({
    id: set.id,
    title: set.title._content,
  }));
}

async function findOrCreateAlbum(albumTitle, primaryPhotoId) {
  const albums = await getAlbums();
  const existingAlbum = albums.find((a) => a.title === albumTitle);

  if (existingAlbum) {
    return existingAlbum.id;
  }

  const res = await flickr("flickr.photosets.create", {
    title: albumTitle,
    primary_photo_id: primaryPhotoId,
  });

  return res.photoset.id;
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

// Health check
app.get("/", (_req, res) => {
  res.send("Flickr uploader running");
});

app.post("/upload", uploadMiddleware.none(), async (req, res) => {
  try {
    const { imageUrl, albumPath } = req.body;

    if (!imageUrl || !albumPath) {
      return res.status(400).json({ error: "Missing imageUrl or albumPath" });
    }

    const parts = albumPath.split("/").filter(Boolean);
    const eventName = parts[0] || "Uncategorized Event";
    const albumName = parts[1] || "General";

    const title = parse(imageUrl).base;

    const result = await uploadPhotoFromUrl(imageUrl, title, `${eventName} – ${albumName}`);

    res.json({ message: "Photo uploaded", result });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default app;
