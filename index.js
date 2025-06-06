import express from "express";
import axios from "axios";
import { createFlickr } from "flickr-sdk";
import { tmpdir } from "os";
import { createWriteStream } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";

// 🔐 OAuth Credentials
const { upload, flickr } = createFlickr({
  consumerKey: process.env.FLICKR_CONSUMER_KEY,
  consumerSecret: process.env.FLICKR_CONSUMER_SECRET,
  oauthToken: process.env.FLICKR_OAUTH_TOKEN,
  oauthTokenSecret: process.env.FLICKR_OAUTH_SECRET,
});

const app = express();
app.use(express.json({ limit: "50mb" }));

// 📸 Helper: Fetch user's albums
async function getAlbums(user_id) {
  const res = await flickr("flickr.photosets.getList", { user_id });
  return res.body.photosets.photoset.map((set) => ({
    id: set.id,
    title: set.title._content,
  }));
}

// 🔍 Helper: Find album by title
async function findOrCreateAlbum(user_id, title, primary_photo_id) {
  const albums = await getAlbums(user_id);
  const match = albums.find((a) => a.title === title);

  if (match) return match.id;

  const res = await flickr("flickr.photosets.create", {
    title,
    primary_photo_id,
  });

  return res.body.photoset.id;
}

// 🖼 Helper: Check if photo already in album
async function photoExistsInAlbum(photoset_id, photo_title) {
  const res = await flickr("flickr.photosets.getPhotos", { photoset_id });
  return res.body.photoset.photo.some((photo) => photo.title === photo_title);
}

// ⬆️ Upload from URL
async function uploadPhotoFromUrl(url, title, tags) {
  const tempFile = join(tmpdir(), uuidv4());
  const writer = createWriteStream(tempFile);

  const response = await axios.get(url, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const photoId = await upload(tempFile, { title, tags });
  await fs.unlink(tempFile);
  return photoId;
}

// 🚀 Endpoint
app.post("/upload", async (req, res) => {
  try {
    const { imageUrls, albumTitle, userId, tags } = req.body;

    if (!Array.isArray(imageUrls)) {
      return res.status(400).json({ error: "imageUrls must be an array" });
    }

    const uploaded = [];

    for (const url of imageUrls) {
      const filename = decodeURIComponent(url.split("/").pop().split("?")[0]);
      const exists = await photoExistsInAlbum(
        await findOrCreateAlbum(userId, albumTitle, "1"), // temp ID
        filename
      );
      if (exists) {
        uploaded.push({ url, skipped: true, reason: "duplicate" });
        continue;
      }

      const id = await uploadPhotoFromUrl(url, filename, tags);
      const photosetId = await findOrCreateAlbum(userId, albumTitle, id);

      await flickr("flickr.photosets.addPhoto", {
        photoset_id: photosetId,
        photo_id: id,
      });

      uploaded.push({ url, id, album: photosetId });
    }

    res.json({ status: "success", uploaded });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 🏠 Health check
app.get("/", (req, res) => {
  res.json({ status: "Flickr uploader active" });
});

export default app;
