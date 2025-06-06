// index.js — Flickr SDK 7.0.0-beta.9 compliant version

import express from "express";
import Flickr from "flickr-sdk";
import axios from "axios";
import path from "path";
import FormData from "form-data";

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send("✅ Flickr Upload API is running.");
});

const flickr = new Flickr(process.env.FLICKR_API_KEY);
const oauth = Flickr.OAuth.createPlugin(
  process.env.FLICKR_API_KEY,
  process.env.FLICKR_API_SECRET,
  process.env.FLICKR_ACCESS_TOKEN,
  process.env.FLICKR_ACCESS_SECRET
);

async function getAlbumIdByTitle(title) {
  const res = await flickr.photosets.getList({ user_id: 'me' }).use(oauth);
  const albums = res.body.photosets.photoset;
  const match = albums.find(ps => ps.title._content === title);
  return match ? match.id : null;
}

async function createAlbum(title, primaryPhotoId) {
  const res = await flickr.photosets.create({
    title,
    primary_photo_id: primaryPhotoId
  }).use(oauth);
  return res.body.photoset.id;
}

async function uploadPhotoFromUrl(url, title, tags) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const form = new FormData();
  form.append("photo", response.data, { filename: title });
  form.append("title", title);
  form.append("tags", tags);

  const upload = new Flickr.Upload(form, oauth);
  const res = await upload.send();
  return res.body.photoid._content;
}

app.post("/upload", async (req, res) => {
  const { albumTitle, imageUrls, tags } = req.body;
  try {
    const uploadedIds = [];
    for (const imageUrl of imageUrls) {
      const title = path.basename(imageUrl);
      const id = await uploadPhotoFromUrl(imageUrl, title, tags);
      uploadedIds.push(id);
    }

    let albumId = await getAlbumIdByTitle(albumTitle);
    if (!albumId) {
      albumId = await createAlbum(albumTitle, uploadedIds[0]);
    }

    for (let i = 1; i < uploadedIds.length; i++) {
      await flickr.photosets.addPhoto({
        photoset_id: albumId,
        photo_id: uploadedIds[i]
      }).use(oauth);
    }

    res.json({ success: true, albumId });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
