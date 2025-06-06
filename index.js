// index.js
import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import { createFlickr } from "flickr-sdk";
import { resolve } from "path";
import fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";

const app = express();
const upload = multer();
const PORT = process.env.PORT || 3000;

const {
  FLICKR_CONSUMER_KEY,
  FLICKR_CONSUMER_SECRET,
  FLICKR_OAUTH_TOKEN,
  FLICKR_OAUTH_TOKEN_SECRET,
  FLICKR_USER_ID
} = process.env;

const { upload: flickrUpload, flickr } = createFlickr({
  consumerKey: FLICKR_CONSUMER_KEY,
  consumerSecret: FLICKR_CONSUMER_SECRET,
  oauthToken: FLICKR_OAUTH_TOKEN,
  oauthTokenSecret: FLICKR_OAUTH_TOKEN_SECRET,
});

// Helper: Get all albums for the authenticated user
async function getAlbums() {
  const res = await flickr("flickr.photosets.getList", { user_id: FLICKR_USER_ID });
  return res.photosets.photoset;
}

// Helper: Find or create album
async function findOrCreateAlbum(title, primaryPhotoId) {
  const albums = await getAlbums();
  const match = albums.find((set) => set.title._content === title);
  if (match) return match.id;

  const { photoset } = await flickr("flickr.photosets.create", {
    title,
    primary_photo_id: primaryPhotoId,
  });
  return photoset.id;
}

// Health check
app.get("/", (req, res) => {
  res.json({ status: "Flickr uploader is running." });
});

// Upload endpoint
app.post("/upload", upload.array("images"), async (req, res) => {
  try {
    const { eventName, albumName } = req.body;
    const images = req.files;

    if (!images || images.length === 0) {
      return res.status(400).json({ error: "No images uploaded." });
    }

    const albumTitle = `${eventName} – ${albumName}`;
    const uploadedPhotoIds = [];

    for (const file of images) {
      const tempPath = join(tmpdir(), uuidv4());
      fs.writeFileSync(tempPath, file.buffer);

      const photoId = await flickrUpload(tempPath, {
        title: file.originalname,
        tags: `${eventName} ${albumName}`,
      });

      uploadedPhotoIds.push(photoId);
      fs.unlinkSync(tempPath);
    }

    const albumId = await findOrCreateAlbum(albumTitle, uploadedPhotoIds[0]);

    // Add photos to album
    for (let i = 1; i < uploadedPhotoIds.length; i++) {
      await flickr("flickr.photosets.addPhoto", {
        photoset_id: albumId,
        photo_id: uploadedPhotoIds[i],
      });
    }

    res.json({ success: true, albumId, photoIds: uploadedPhotoIds });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
