// index.js — Flickr SDK (beta) upload handler with album check and JSON response

import express from "express";
import Flickr from "flickr-sdk";
import axios from "axios";
import FormData from "form-data";
import path from "path";

const app = express();
app.use(express.json());

const flickr = new Flickr(Flickr.OAuth.createPlugin(
  process.env.FLICKR_API_KEY,
  process.env.FLICKR_API_SECRET,
  process.env.FLICKR_ACCESS_TOKEN,
  process.env.FLICKR_ACCESS_SECRET
));

app.get("/", (_, res) => {
  res.send("✅ Flickr Upload API is running.");
});

app.post("/upload", async (req, res) => {
  const { albumTitle, imageUrls = [], tags = "" } = req.body;

  if (!Array.isArray(imageUrls)) {
    return res.status(400).json({ error: "imageUrls must be an array." });
  }

  try {
    // Get existing photosets
    const listResponse = await flickr.photosets.getList();
    const existing = listResponse.body.photosets.photoset;
    const album = existing.find(ps => ps.title._content === albumTitle);

    let albumId = album?.id ?? null;
    const uploadedIds = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const title = path.basename(url);

      const imageResp = await axios.get(url, { responseType: "stream" });
      const form = new FormData();
      form.append("photo", imageResp.data);
      form.append("title", title);
      form.append("tags", tags);

      const uploadResp = await flickr.upload(form);
      const photoId = uploadResp.body.photoid._content;
      uploadedIds.push(photoId);

      if (!albumId && i === 0) {
        const createResp = await flickr.photosets.create({
          title: albumTitle,
          primary_photo_id: photoId,
        });
        albumId = createResp.body.photoset.id;
      } else if (albumId && i !== 0) {
        await flickr.photosets.addPhoto({
          photoset_id: albumId,
          photo_id: photoId,
        });
      }
    }

    res.json({ success: true, albumId });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
